import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface StoredSession {
  id: string;
  baseId: string;
  recordId: string;
  fellowTraveller: boolean;
  refreshHash: string;
  refreshExpiresAt: number;
  accessHash: string;
  accessExpiresAt: number;
  revoked: boolean;
}

interface SessionRow {
  id: string; base_id: string; record_id: string; fellow_traveller: number;
  refresh_hash: string; refresh_expires_at: number; access_hash: string;
  access_expires_at: number; revoked: number;
}

@Injectable()
export class DurableAuthStore implements OnModuleDestroy {
  private readonly database: DatabaseSync;

  constructor(@Optional() @Inject('AUTH_DATABASE_PATH') path = process.env.AUTH_DATABASE_PATH?.trim() || resolve(process.cwd(), '.data/auth.sqlite')) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY, base_id TEXT NOT NULL, record_id TEXT NOT NULL,
        fellow_traveller INTEGER NOT NULL, refresh_hash TEXT NOT NULL UNIQUE,
        refresh_expires_at INTEGER NOT NULL, access_hash TEXT NOT NULL UNIQUE,
        access_expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS auth_sessions_refresh_expiry ON auth_sessions(refresh_expires_at);
      CREATE INDEX IF NOT EXISTS auth_sessions_access_expiry ON auth_sessions(access_expires_at);
      CREATE TABLE IF NOT EXISTS retired_refresh_tokens (
        refresh_hash TEXT PRIMARY KEY, session_id TEXT NOT NULL,
        retired_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS retired_refresh_tokens_expiry ON retired_refresh_tokens(expires_at);
      CREATE TABLE IF NOT EXISTS verification_challenges (
        exchange_id TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS verification_challenges_expiry ON verification_challenges(expires_at);
      CREATE TABLE IF NOT EXISTS notification_deliveries (
        delivery_key TEXT PRIMARY KEY, status TEXT NOT NULL, delivered_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS rate_limits (
        bucket TEXT PRIMARY KEY, window_started_at INTEGER NOT NULL, count INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS idempotency_results (
        scope TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL,
        status TEXT NOT NULL, response_json TEXT, created_at INTEGER NOT NULL,
        PRIMARY KEY (scope, key)
      );
      CREATE TABLE IF NOT EXISTS background_jobs (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, payload_json TEXT NOT NULL,
        status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        available_at INTEGER NOT NULL, last_error TEXT, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS background_jobs_ready ON background_jobs(status, available_at);
      UPDATE background_jobs SET status = 'pending' WHERE status = 'running';
    `);
  }

  putSession(session: StoredSession): void {
    this.cleanup();
    this.database.prepare(`INSERT INTO auth_sessions
      (id, base_id, record_id, fellow_traveller, refresh_hash, refresh_expires_at, access_hash, access_expires_at, revoked)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(session.id, session.baseId, session.recordId, Number(session.fellowTraveller), session.refreshHash, session.refreshExpiresAt, session.accessHash, session.accessExpiresAt, Number(session.revoked));
  }

  sessionByRefreshHash(hash: string): StoredSession | null {
    return mapSession(this.database.prepare('SELECT * FROM auth_sessions WHERE refresh_hash = ?').get(hash) as unknown as SessionRow | undefined);
  }

  sessionByAccessHash(hash: string): StoredSession | null {
    return mapSession(this.database.prepare('SELECT * FROM auth_sessions WHERE access_hash = ?').get(hash) as unknown as SessionRow | undefined);
  }

  updateTokens(session: StoredSession): void {
    this.database.prepare(`UPDATE auth_sessions SET refresh_hash = ?, refresh_expires_at = ?, access_hash = ?, access_expires_at = ? WHERE id = ?`)
      .run(session.refreshHash, session.refreshExpiresAt, session.accessHash, session.accessExpiresAt, session.id);
  }

  /** Remembers a replaced refresh token so a later reuse can be recognised as theft. */
  retireRefreshHash(hash: string, sessionId: string, expiresAt: number, now = Date.now()): void {
    this.database.prepare('INSERT OR REPLACE INTO retired_refresh_tokens (refresh_hash, session_id, retired_at, expires_at) VALUES (?, ?, ?, ?)').run(hash, sessionId, now, expiresAt);
  }

  retiredRefresh(hash: string): { sessionId: string; retiredAt: number } | null {
    const row = this.database.prepare('SELECT session_id, retired_at FROM retired_refresh_tokens WHERE refresh_hash = ?').get(hash) as { session_id: string; retired_at: number } | undefined;
    return row ? { sessionId: row.session_id, retiredAt: row.retired_at } : null;
  }

  revokeSession(sessionId: string): void {
    this.database.prepare('UPDATE auth_sessions SET revoked = 1 WHERE id = ?').run(sessionId);
  }

  revokeByRefreshHash(hash: string): void {
    this.database.prepare('UPDATE auth_sessions SET revoked = 1 WHERE refresh_hash = ?').run(hash);
  }

  putChallenge<T>(exchangeId: string, value: T, expiresAt: number): void {
    this.cleanup();
    this.database.prepare('INSERT OR REPLACE INTO verification_challenges (exchange_id, payload, expires_at) VALUES (?, ?, ?)').run(exchangeId, JSON.stringify(value), expiresAt);
  }

  challenge<T>(exchangeId: string): T | null {
    const row = this.database.prepare('SELECT payload, expires_at FROM verification_challenges WHERE exchange_id = ?').get(exchangeId) as { payload: string; expires_at: number } | undefined;
    if (!row || row.expires_at < Date.now()) { this.deleteChallenge(exchangeId); return null; }
    try { return JSON.parse(row.payload) as T; } catch { this.deleteChallenge(exchangeId); return null; }
  }

  deleteChallenge(exchangeId: string): void {
    this.database.prepare('DELETE FROM verification_challenges WHERE exchange_id = ?').run(exchangeId);
  }

  beginNotificationDelivery(key: string): 'new' | 'pending' | 'delivered_unaudited' | 'complete' {
    const existing = this.database.prepare('SELECT status FROM notification_deliveries WHERE delivery_key = ?').get(key) as { status: 'pending' | 'delivered_unaudited' | 'complete' } | undefined;
    if (existing) return existing.status;
    this.database.prepare("INSERT INTO notification_deliveries (delivery_key, status) VALUES (?, 'pending')").run(key);
    return 'new';
  }

  markNotificationDelivered(key: string): void { this.database.prepare("UPDATE notification_deliveries SET status = 'delivered_unaudited', delivered_at = ? WHERE delivery_key = ?").run(Date.now(), key); }
  completeNotificationDelivery(key: string): void { this.database.prepare("UPDATE notification_deliveries SET status = 'complete' WHERE delivery_key = ?").run(key); }
  releaseNotificationDelivery(key: string): void { this.database.prepare("DELETE FROM notification_deliveries WHERE delivery_key = ? AND status = 'pending'").run(key); }

  /** True while a bucket has already used up its limit in the current window (does not count as a use). */
  rateLimitExhausted(bucket: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const row = this.database.prepare('SELECT window_started_at, count FROM rate_limits WHERE bucket = ?').get(bucket) as { window_started_at: number; count: number } | undefined;
    return Boolean(row && row.window_started_at + windowMs > now && row.count >= limit);
  }

  consumeRateLimit(bucket: string, limit: number, windowMs: number, now = Date.now()): { allowed: boolean; remaining: number; resetAt: number } {
    const row = this.database.prepare('SELECT window_started_at, count FROM rate_limits WHERE bucket = ?').get(bucket) as { window_started_at: number; count: number } | undefined;
    const windowStartedAt = !row || row.window_started_at + windowMs <= now ? now : row.window_started_at;
    const count = windowStartedAt === row?.window_started_at ? row.count + 1 : 1;
    this.database.prepare('INSERT INTO rate_limits (bucket, window_started_at, count) VALUES (?, ?, ?) ON CONFLICT(bucket) DO UPDATE SET window_started_at = excluded.window_started_at, count = excluded.count').run(bucket, windowStartedAt, count);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt: windowStartedAt + windowMs };
  }

  idempotency(scope: string, key: string): { requestHash: string; status: string; responseJson: string | null } | null {
    const row = this.database.prepare('SELECT request_hash, status, response_json FROM idempotency_results WHERE scope = ? AND key = ?').get(scope, key) as { request_hash: string; status: string; response_json: string | null } | undefined;
    return row ? { requestHash: row.request_hash, status: row.status, responseJson: row.response_json } : null;
  }

  beginIdempotency(scope: string, key: string, requestHash: string): boolean {
    return this.database.prepare("INSERT OR IGNORE INTO idempotency_results (scope, key, request_hash, status, created_at) VALUES (?, ?, ?, 'pending', ?)").run(scope, key, requestHash, Date.now()).changes === 1;
  }

  completeIdempotency(scope: string, key: string, response: unknown): void {
    this.database.prepare("UPDATE idempotency_results SET status = 'complete', response_json = ? WHERE scope = ? AND key = ?").run(JSON.stringify(response ?? null), scope, key);
  }

  releaseIdempotency(scope: string, key: string): void {
    this.database.prepare("DELETE FROM idempotency_results WHERE scope = ? AND key = ? AND status = 'pending'").run(scope, key);
  }

  enqueueJob(id: string, type: string, payload: unknown, availableAt = Date.now()): boolean {
    return this.database.prepare("INSERT OR IGNORE INTO background_jobs (id, type, payload_json, status, available_at, created_at) VALUES (?, ?, ?, 'pending', ?, ?)").run(id, type, JSON.stringify(payload), availableAt, Date.now()).changes === 1;
  }

  claimJobs(type: string, limit = 10): Array<{ id: string; payload: unknown; attempts: number }> {
    const rows = this.database.prepare("SELECT id, payload_json, attempts FROM background_jobs WHERE type = ? AND status = 'pending' AND available_at <= ? ORDER BY created_at LIMIT ?").all(type, Date.now(), limit) as Array<{ id: string; payload_json: string; attempts: number }>;
    return rows.flatMap((row) => {
      const claimed = this.database.prepare("UPDATE background_jobs SET status = 'running', attempts = attempts + 1 WHERE id = ? AND status = 'pending'").run(row.id).changes === 1;
      if (!claimed) return [];
      try { return [{ id: row.id, payload: JSON.parse(row.payload_json) as unknown, attempts: row.attempts + 1 }]; } catch { this.completeJob(row.id); return []; }
    });
  }

  completeJob(id: string): void { this.database.prepare("UPDATE background_jobs SET status = 'complete' WHERE id = ?").run(id); }
  retryJob(id: string, error: string, availableAt: number): void { this.database.prepare("UPDATE background_jobs SET status = 'pending', last_error = ?, available_at = ? WHERE id = ?").run(error.slice(0, 500), availableAt, id); }
  failJob(id: string, error: string): void { this.database.prepare("UPDATE background_jobs SET status = 'failed', last_error = ? WHERE id = ?").run(error.slice(0, 500), id); }

  onModuleDestroy(): void { this.database.close(); }

  private cleanup(): void {
    const now = Date.now();
    this.database.prepare('DELETE FROM verification_challenges WHERE expires_at < ?').run(now);
    this.database.prepare('DELETE FROM auth_sessions WHERE refresh_expires_at < ?').run(now);
    this.database.prepare('DELETE FROM retired_refresh_tokens WHERE expires_at < ?').run(now);
    this.database.prepare('DELETE FROM rate_limits WHERE window_started_at < ?').run(now - 86_400_000);
    this.database.prepare('DELETE FROM idempotency_results WHERE created_at < ?').run(now - 86_400_000);
    this.database.prepare("DELETE FROM background_jobs WHERE status = 'complete' AND created_at < ?").run(now - 86_400_000);
  }
}

function mapSession(row: SessionRow | undefined): StoredSession | null {
  return row ? { id: row.id, baseId: row.base_id, recordId: row.record_id, fellowTraveller: Boolean(row.fellow_traveller), refreshHash: row.refresh_hash, refreshExpiresAt: row.refresh_expires_at, accessHash: row.access_hash, accessExpiresAt: row.access_expires_at, revoked: Boolean(row.revoked) } : null;
}
