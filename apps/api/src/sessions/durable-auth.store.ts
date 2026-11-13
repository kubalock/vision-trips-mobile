import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { InvitationScope, SessionAssurance } from '@vision-trips/contracts';

export interface StoredSession {
  id: string;
  baseId: string;
  recordId: string;
  fellowTraveller: boolean;
  /** The Customer the session was verified for; null for share links and sessions created before invitations. */
  customerRecordId: string | null;
  /** How the session was established; only `otp` and `trusted_device` may perform sensitive actions. */
  assurance: SessionAssurance;
  invitationId: string | null;
  refreshHash: string;
  refreshExpiresAt: number;
  accessHash: string;
  accessExpiresAt: number;
  revoked: boolean;
}

interface SessionRow {
  id: string; base_id: string; record_id: string; fellow_traveller: number;
  customer_record_id: string | null; assurance: string | null; invitation_id: string | null;
  refresh_hash: string; refresh_expires_at: number; access_hash: string;
  access_expires_at: number; revoked: number;
}

export type InvitationSource = 'agent' | 'legacy_link' | 'step_up' | 'share' | 'development';

/** A durable invitation. Only the SHA-256 hash of its token is stored; the raw token exists only in the link. */
export interface StoredInvitation {
  id: string;
  tokenHash: string;
  tenantId: string | null;
  baseId: string;
  bookingRecordId: string;
  customerRecordId: string | null;
  scope: InvitationScope;
  verification: 'email_otp' | 'none';
  source: InvitationSource;
  createdAt: number;
  expiresAt: number;
  sentAt: number | null;
  acceptedAt: number | null;
  revokedAt: number | null;
  /** Unique while the invitation is the active one for its booking, customer and scope; cleared when it ends. */
  activeKey: string | null;
  idempotencyKey: string | null;
  /** True while an email for this invitation was requested; used to ignore duplicate automation deliveries. */
  emailRequested: boolean;
  /** Share links can be opened by several fellow travellers until they expire; every other invitation is single-use. */
  reusable: boolean;
  /** A session to end once this (step-up) invitation is verified. */
  replacesSessionId: string | null;
  consumingUntil: number | null;
  /**
   * HMAC of the invited Customer's email at creation (see invitation-token.ts). If the Customer's email changes later,
   * the invitation stops working rather than sending codes to an address the agent never chose. Null for share links
   * and invitations created before this existed (those follow the Customer's current email).
   */
  destinationHash: string | null;
  /** Why the invitation ended early: replaced by a newer one, revoked by the agent, or its email could not be sent. */
  revokedReason: InvitationRevokedReason | null;
}

export type InvitationRevokedReason = 'replaced' | 'revoked' | 'delivery_failed';

export interface InvitationOtp {
  invitationId: string;
  codeHash: string | null;
  codeSentAt: number | null;
  codeExpiresAt: number | null;
  attempts: number;
  sends: number;
  sendWindowStartedAt: number;
}

interface InvitationRow {
  id: string; token_hash: string; tenant_id: string | null; base_id: string; booking_record_id: string;
  customer_record_id: string | null; scope: string; verification: string; source: string; created_at: number;
  expires_at: number; sent_at: number | null; accepted_at: number | null; revoked_at: number | null;
  active_key: string | null; idempotency_key: string | null; email_requested: number; reusable: number;
  replaces_session_id: string | null; consuming_until: number | null;
  destination_hash: string | null; revoked_reason: string | null;
}

interface OtpRow {
  invitation_id: string; code_hash: string | null; code_sent_at: number | null; code_expires_at: number | null;
  attempts: number; sends: number; send_window_started_at: number;
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
      CREATE TABLE IF NOT EXISTS customer_invitations (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, tenant_id TEXT,
        base_id TEXT NOT NULL, booking_record_id TEXT NOT NULL, customer_record_id TEXT,
        scope TEXT NOT NULL, verification TEXT NOT NULL, source TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        sent_at INTEGER, accepted_at INTEGER, revoked_at INTEGER,
        active_key TEXT, idempotency_key TEXT, email_requested INTEGER NOT NULL DEFAULT 0,
        reusable INTEGER NOT NULL DEFAULT 0, replaces_session_id TEXT, consuming_until INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS customer_invitations_active ON customer_invitations(active_key) WHERE active_key IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS customer_invitations_idempotency ON customer_invitations(idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS customer_invitations_booking ON customer_invitations(base_id, booking_record_id);
      CREATE INDEX IF NOT EXISTS customer_invitations_expiry ON customer_invitations(expires_at);
      CREATE TABLE IF NOT EXISTS invitation_otps (
        invitation_id TEXT PRIMARY KEY, code_hash TEXT, code_sent_at INTEGER, code_expires_at INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0, sends INTEGER NOT NULL DEFAULT 0, send_window_started_at INTEGER NOT NULL DEFAULT 0
      );
    `);
    this.migrateSessions();
    this.migrateInvitations();
  }

  private migrateInvitations(): void {
    const columns = new Set((this.database.prepare('PRAGMA table_info(customer_invitations)').all() as Array<{ name: string }>).map((column) => column.name));
    if (!columns.has('destination_hash')) this.database.exec('ALTER TABLE customer_invitations ADD COLUMN destination_hash TEXT');
    if (!columns.has('revoked_reason')) this.database.exec('ALTER TABLE customer_invitations ADD COLUMN revoked_reason TEXT');
  }

  /** Sessions created before invitations have no customer or assurance: they count as `legacy` (no sensitive actions). */
  private migrateSessions(): void {
    const columns = new Set((this.database.prepare('PRAGMA table_info(auth_sessions)').all() as Array<{ name: string }>).map((column) => column.name));
    if (!columns.has('customer_record_id')) this.database.exec('ALTER TABLE auth_sessions ADD COLUMN customer_record_id TEXT');
    if (!columns.has('assurance')) this.database.exec("ALTER TABLE auth_sessions ADD COLUMN assurance TEXT NOT NULL DEFAULT 'legacy'");
    if (!columns.has('invitation_id')) this.database.exec('ALTER TABLE auth_sessions ADD COLUMN invitation_id TEXT');
  }

  putSession(session: StoredSession): void {
    this.cleanup();
    this.database.prepare(`INSERT INTO auth_sessions
      (id, base_id, record_id, fellow_traveller, customer_record_id, assurance, invitation_id, refresh_hash, refresh_expires_at, access_hash, access_expires_at, revoked)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(session.id, session.baseId, session.recordId, Number(session.fellowTraveller), session.customerRecordId, session.assurance, session.invitationId, session.refreshHash, session.refreshExpiresAt, session.accessHash, session.accessExpiresAt, Number(session.revoked));
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

  // --- Customer invitations -------------------------------------------------------------------------------------

  /**
   * Stores a new invitation. When it has an active key, any earlier invitation holding that key is revoked in the same
   * transaction, so a booking's customer has at most one active agent invitation at a time.
   */
  insertInvitation(invitation: StoredInvitation): void {
    this.cleanup();
    this.transaction(() => {
      if (invitation.activeKey) {
        // Only the unused invitation is replaced; sessions already created from earlier invitations are unaffected.
        this.database.prepare("UPDATE customer_invitations SET revoked_at = ?, revoked_reason = 'replaced', active_key = NULL WHERE active_key = ?").run(invitation.createdAt, invitation.activeKey);
      }
      this.database.prepare(`INSERT INTO customer_invitations
        (id, token_hash, tenant_id, base_id, booking_record_id, customer_record_id, scope, verification, source, created_at, expires_at,
         sent_at, accepted_at, revoked_at, active_key, idempotency_key, email_requested, reusable, replaces_session_id, consuming_until,
         destination_hash, revoked_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        invitation.id, invitation.tokenHash, invitation.tenantId, invitation.baseId, invitation.bookingRecordId, invitation.customerRecordId,
        invitation.scope, invitation.verification, invitation.source, invitation.createdAt, invitation.expiresAt, invitation.sentAt,
        invitation.acceptedAt, invitation.revokedAt, invitation.activeKey, invitation.idempotencyKey, Number(invitation.emailRequested),
        Number(invitation.reusable), invitation.replacesSessionId, invitation.consumingUntil,
        invitation.destinationHash, invitation.revokedReason,
      );
    });
  }

  invitationByTokenHash(tokenHash: string): StoredInvitation | null { return this.invitationWhere('token_hash = ?', tokenHash); }
  invitationById(id: string): StoredInvitation | null { return this.invitationWhere('id = ?', id); }
  invitationByIdempotencyKey(key: string): StoredInvitation | null { return this.invitationWhere('idempotency_key = ?', key); }
  activeInvitation(activeKey: string): StoredInvitation | null { return this.invitationWhere('active_key = ?', activeKey); }

  markInvitationSent(id: string, sentAt: number): void {
    this.database.prepare('UPDATE customer_invitations SET sent_at = ? WHERE id = ?').run(sentAt, id);
  }

  /** Ends an invitation whose email could not be sent, and frees its idempotency key so a retry starts again. */
  abandonInvitation(id: string, now = Date.now()): void {
    this.database.prepare("UPDATE customer_invitations SET revoked_at = COALESCE(revoked_at, ?), revoked_reason = COALESCE(revoked_reason, 'delivery_failed'), active_key = NULL, idempotency_key = NULL WHERE id = ?").run(now, id);
  }

  revokeInvitations(baseId: string, bookingRecordId: string, customerRecordId: string | null, now = Date.now()): number {
    const filter = customerRecordId ? ' AND customer_record_id = ?' : '';
    const values: SQLInputValue[] = [now, baseId, bookingRecordId, ...(customerRecordId ? [customerRecordId] : [])];
    return Number(this.database.prepare(`UPDATE customer_invitations SET revoked_at = ?, revoked_reason = 'revoked', active_key = NULL
      WHERE base_id = ? AND booking_record_id = ?${filter} AND revoked_at IS NULL AND accepted_at IS NULL`).run(...values).changes);
  }

  /**
   * Claims an invitation for the final step of verification. Only one request can hold the claim, so two concurrent
   * submissions of a correct code cannot both create sessions. Returns the claim's expiry, or null if already claimed,
   * consumed or revoked.
   */
  claimInvitation(id: string, now = Date.now(), holdMs = 30_000): number | null {
    const until = now + holdMs;
    const changed = this.database.prepare(`UPDATE customer_invitations SET consuming_until = ?
      WHERE id = ? AND revoked_at IS NULL AND (accepted_at IS NULL OR reusable = 1) AND expires_at > ?
      AND (consuming_until IS NULL OR consuming_until <= ?)`).run(until, id, now, now).changes;
    return changed === 1 ? until : null;
  }

  releaseInvitationClaim(id: string, claim: number): void {
    this.database.prepare('UPDATE customer_invitations SET consuming_until = NULL WHERE id = ? AND consuming_until = ?').run(id, claim);
  }

  /** Marks a claimed invitation as accepted. Single-use invitations stop being active and lose their code. */
  consumeInvitation(id: string, claim: number, now = Date.now()): boolean {
    return this.transaction(() => {
      const changed = this.database.prepare(`UPDATE customer_invitations
        SET accepted_at = COALESCE(accepted_at, ?), consuming_until = NULL, active_key = CASE WHEN reusable = 1 THEN active_key ELSE NULL END
        WHERE id = ? AND consuming_until = ?`).run(now, id, claim).changes === 1;
      if (changed) this.database.prepare('DELETE FROM invitation_otps WHERE invitation_id = ?').run(id);
      return changed;
    });
  }

  invitationOtp(invitationId: string): InvitationOtp {
    const row = this.database.prepare('SELECT * FROM invitation_otps WHERE invitation_id = ?').get(invitationId) as unknown as OtpRow | undefined;
    return row
      ? { invitationId, codeHash: row.code_hash, codeSentAt: row.code_sent_at, codeExpiresAt: row.code_expires_at, attempts: row.attempts, sends: row.sends, sendWindowStartedAt: row.send_window_started_at }
      : { invitationId, codeHash: null, codeSentAt: null, codeExpiresAt: null, attempts: 0, sends: 0, sendWindowStartedAt: 0 };
  }

  putInvitationOtp(otp: InvitationOtp): void {
    this.database.prepare(`INSERT INTO invitation_otps (invitation_id, code_hash, code_sent_at, code_expires_at, attempts, sends, send_window_started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(invitation_id) DO UPDATE SET code_hash = excluded.code_hash, code_sent_at = excluded.code_sent_at,
      code_expires_at = excluded.code_expires_at, attempts = excluded.attempts, sends = excluded.sends, send_window_started_at = excluded.send_window_started_at`)
      .run(otp.invitationId, otp.codeHash, otp.codeSentAt, otp.codeExpiresAt, otp.attempts, otp.sends, otp.sendWindowStartedAt);
  }

  /** Counts one wrong code atomically and returns the attempts used so far. */
  recordOtpFailure(invitationId: string): number {
    const row = this.database.prepare('UPDATE invitation_otps SET attempts = attempts + 1 WHERE invitation_id = ? RETURNING attempts').get(invitationId) as { attempts: number } | undefined;
    return row?.attempts ?? 0;
  }

  onModuleDestroy(): void { this.database.close(); }

  private invitationWhere(clause: string, value: string): StoredInvitation | null {
    return mapInvitation(this.database.prepare(`SELECT * FROM customer_invitations WHERE ${clause}`).get(value) as unknown as InvitationRow | undefined);
  }

  private transaction<T>(work: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private cleanup(): void {
    const now = Date.now();
    this.database.prepare('DELETE FROM verification_challenges WHERE expires_at < ?').run(now);
    this.database.prepare('DELETE FROM auth_sessions WHERE refresh_expires_at < ?').run(now);
    this.database.prepare('DELETE FROM retired_refresh_tokens WHERE expires_at < ?').run(now);
    this.database.prepare('DELETE FROM rate_limits WHERE window_started_at < ?').run(now - 86_400_000);
    this.database.prepare('DELETE FROM idempotency_results WHERE created_at < ?').run(now - 86_400_000);
    this.database.prepare("DELETE FROM background_jobs WHERE status = 'complete' AND created_at < ?").run(now - 86_400_000);
    // Ended invitations are kept for 30 days after expiry for audit and duplicate detection.
    this.database.prepare('DELETE FROM invitation_otps WHERE invitation_id IN (SELECT id FROM customer_invitations WHERE expires_at < ?)').run(now);
    this.database.prepare('DELETE FROM customer_invitations WHERE expires_at < ?').run(now - 30 * 86_400_000);
  }
}

function mapSession(row: SessionRow | undefined): StoredSession | null {
  return row ? { id: row.id, baseId: row.base_id, recordId: row.record_id, fellowTraveller: Boolean(row.fellow_traveller), customerRecordId: row.customer_record_id ?? null, assurance: assuranceOf(row.assurance), invitationId: row.invitation_id ?? null, refreshHash: row.refresh_hash, refreshExpiresAt: row.refresh_expires_at, accessHash: row.access_hash, accessExpiresAt: row.access_expires_at, revoked: Boolean(row.revoked) } : null;
}

function assuranceOf(value: string | null): SessionAssurance {
  return value === 'otp' || value === 'trusted_device' || value === 'link' ? value : 'legacy';
}

function mapInvitation(row: InvitationRow | undefined): StoredInvitation | null {
  if (!row) return null;
  return {
    id: row.id, tokenHash: row.token_hash, tenantId: row.tenant_id, baseId: row.base_id, bookingRecordId: row.booking_record_id,
    customerRecordId: row.customer_record_id, scope: row.scope === 'fellow_traveller' ? 'fellow_traveller' : 'primary_customer',
    verification: row.verification === 'none' ? 'none' : 'email_otp', source: row.source as InvitationSource,
    createdAt: row.created_at, expiresAt: row.expires_at, sentAt: row.sent_at, acceptedAt: row.accepted_at, revokedAt: row.revoked_at,
    activeKey: row.active_key, idempotencyKey: row.idempotency_key, emailRequested: Boolean(row.email_requested), reusable: Boolean(row.reusable),
    replacesSessionId: row.replaces_session_id, consumingUntil: row.consuming_until,
    destinationHash: row.destination_hash ?? null, revokedReason: revokedReasonOf(row.revoked_reason),
  };
}

function revokedReasonOf(value: string | null | undefined): InvitationRevokedReason | null {
  return value === 'replaced' || value === 'revoked' || value === 'delivery_failed' ? value : null;
}
