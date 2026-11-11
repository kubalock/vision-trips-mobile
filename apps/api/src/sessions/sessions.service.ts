import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { MobileSession } from '@vision-trips/contracts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DurableAuthStore, type StoredSession } from './durable-auth.store.js';

export interface SessionPrincipal { baseId: string; recordId: string; fellowTraveller: boolean }

@Injectable()
export class SessionsService {
  constructor(@Inject(DurableAuthStore) private readonly store: DurableAuthStore) {}

  issue(input: SessionPrincipal): MobileSession {
    const id = randomUUID();
    const refreshToken = token('vrt');
    const refreshExpiresAt = Date.now() + 30 * 86_400_000;
    const accessExpiresAt = Date.now() + 15 * 60_000;
    const accessToken = `${token('vta')}.${id}`;
    this.store.putSession({ id, ...input, refreshHash: hash(refreshToken), refreshExpiresAt, accessHash: hash(accessToken), accessExpiresAt, revoked: false });
    return response(accessToken, accessExpiresAt, refreshToken, refreshExpiresAt);
  }

  refresh(refreshToken: unknown): MobileSession {
    if (typeof refreshToken !== 'string') throw invalidSession();
    const presented = hash(refreshToken);
    const stored = this.store.sessionByRefreshHash(presented);
    if (!stored) {
      // A replaced token coming back after the grace period means it was copied: end the whole session.
      const retired = this.store.retiredRefresh(presented);
      if (retired && Date.now() - retired.retiredAt > REFRESH_REUSE_GRACE_MS) this.store.revokeSession(retired.sessionId);
      throw new UnauthorizedException('The session has expired.');
    }
    if (stored.revoked || stored.refreshExpiresAt < Date.now()) throw new UnauthorizedException('The session has expired.');
    this.store.retireRefreshHash(presented, stored.id, stored.refreshExpiresAt);
    const nextRefresh = token('vrt');
    stored.refreshHash = hash(nextRefresh);
    stored.refreshExpiresAt = Date.now() + 30 * 86_400_000;
    return this.rotateAccess(stored, nextRefresh);
  }

  validateAccess(authorization: unknown): SessionPrincipal {
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) throw invalidSession();
    const stored = this.store.sessionByAccessHash(hash(authorization.slice(7).trim()));
    if (!stored || stored.revoked || stored.accessExpiresAt < Date.now()) throw new UnauthorizedException('The access session has expired.');
    return { baseId: stored.baseId, recordId: stored.recordId, fellowTraveller: stored.fellowTraveller };
  }

  revoke(refreshToken: unknown): void {
    if (typeof refreshToken === 'string') this.store.revokeByRefreshHash(hash(refreshToken));
  }

  private rotateAccess(stored: StoredSession, refreshToken: string): MobileSession {
    const accessToken = `${token('vta')}.${stored.id}`;
    stored.accessHash = hash(accessToken);
    stored.accessExpiresAt = Date.now() + 15 * 60_000;
    this.store.updateTokens(stored);
    return response(accessToken, stored.accessExpiresAt, refreshToken, stored.refreshExpiresAt);
  }
}

/** Two requests racing with the same refresh token is normal; only treat reuse after this as theft. */
const REFRESH_REUSE_GRACE_MS = 10_000;

function token(prefix: string): string { return `${prefix}_${randomBytes(32).toString('base64url')}`; }
function hash(value: string): string { return createHash('sha256').update(value).digest('base64url'); }
function invalidSession(): UnauthorizedException { return new UnauthorizedException('The session is not valid.'); }
function response(accessToken: string, accessExpiresAt: number, refreshToken: string, refreshExpiresAt: number): MobileSession {
  return { accessToken, accessExpiresAt: new Date(accessExpiresAt).toISOString(), refreshToken, refreshExpiresAt: new Date(refreshExpiresAt).toISOString() };
}
