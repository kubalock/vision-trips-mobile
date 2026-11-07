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
      CREATE TABLE IF NOT EXISTS verification_challenges (
        exchange_id TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS verification_challenges_expiry ON verification_challenges(expires_at);
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

  onModuleDestroy(): void { this.database.close(); }

  private cleanup(): void {
    const now = Date.now();
    this.database.prepare('DELETE FROM verification_challenges WHERE expires_at < ?').run(now);
    this.database.prepare('DELETE FROM auth_sessions WHERE refresh_expires_at < ?').run(now);
  }
}

function mapSession(row: SessionRow | undefined): StoredSession | null {
  return row ? { id: row.id, baseId: row.base_id, recordId: row.record_id, fellowTraveller: Boolean(row.fellow_traveller), refreshHash: row.refresh_hash, refreshExpiresAt: row.refresh_expires_at, accessHash: row.access_hash, accessExpiresAt: row.access_expires_at, revoked: Boolean(row.revoked) } : null;
}
