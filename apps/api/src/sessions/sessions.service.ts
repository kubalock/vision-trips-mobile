import { HttpException, HttpStatus, Inject, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import type { MobileSession, SessionAssurance } from '@vision-trips/contracts';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { identityKey } from '../security/identity-key.js';
import { DurableAuthStore, type StoredSession } from './durable-auth.store.js';
import { TripEntitlementsService, accessRevoked } from './trip-entitlements.service.js';

export interface SessionPrincipal {
  baseId: string;
  recordId: string;
  fellowTraveller: boolean;
  /** The verified Customer, when known (always set for sessions created from an invitation). */
  customerRecordId: string | null;
  assurance: SessionAssurance;
  /** Internal session id, used to end a session once a step-up verification replaces it. */
  sessionId?: string;
  /**
   * The verified Customer's account in this base (`account:<Customer Account ID>` or `customer:<record>`): groups trips
   * for switching and sign-out. `customerRecordId` stays the Customer who verified, for codes and security decisions.
   */
  accountKey?: string | null;
  /** The Customer linked to this booking, when it is an explicitly grouped duplicate rather than the verified one. */
  bookingOwnerCustomerRecordId?: string | null;
  /** The invitation the session was opened from, when there was one (recorded as evidence of how access was granted). */
  invitationId?: string | null;
}

export interface SessionGrant {
  baseId: string;
  recordId: string;
  fellowTraveller: boolean;
  customerRecordId: string | null;
  assurance: SessionAssurance;
  invitationId?: string | null;
  accountKey?: string | null;
  bookingOwnerCustomerRecordId?: string | null;
  /** A fixed end that refreshing never extends (fellow-traveller share sessions end with their link). */
  absoluteExpiresAt?: number | null;
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @Inject(DurableAuthStore) private readonly store: DurableAuthStore,
    @Optional() @Inject(TripEntitlementsService) private readonly entitlements?: TripEntitlementsService,
  ) {}

  issue(input: SessionGrant): MobileSession {
    const id = randomUUID();
    const refreshToken = token('vrt');
    const absoluteExpiresAt = input.absoluteExpiresAt ?? null;
    const refreshExpiresAt = capped(Date.now() + 30 * 86_400_000, absoluteExpiresAt);
    const accessExpiresAt = capped(Date.now() + 15 * 60_000, absoluteExpiresAt);
    const accessToken = `${token('vta')}.${id}`;
    this.store.putSession({ id, baseId: input.baseId, recordId: input.recordId, fellowTraveller: input.fellowTraveller, customerRecordId: input.customerRecordId, assurance: input.assurance, invitationId: input.invitationId ?? null, accountKey: input.accountKey ?? null, bookingOwnerCustomerRecordId: input.bookingOwnerCustomerRecordId ?? null, refreshHash: hash(refreshToken), refreshExpiresAt, accessHash: hash(accessToken), accessExpiresAt, revoked: false, absoluteExpiresAt });
    return response(accessToken, accessExpiresAt, refreshToken, refreshExpiresAt, identityKey(input));
  }

  /**
   * Rotates the refresh token, but only after re-checking in Airtable that the holder may still see the trip (see
   * TripEntitlementsService): an unlinked Customer's session ends here instead of extending for another 30 days.
   * An Airtable outage doesn't sign anyone out; the next refresh or action checks again.
   */
  async refresh(refreshToken: unknown): Promise<MobileSession> {
    if (typeof refreshToken !== 'string') throw invalidSession();
    const presented = hash(refreshToken);
    const found = this.current(presented);
    if (this.entitlements) {
      try {
        await this.entitlements.assertCurrent(principalOf(found), { fresh: true });
      } catch (error) {
        if (isAccessRevoked(error)) throw error;
        this.logger.warn(`Session refreshed without an entitlement check: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
    // Look again after the Airtable round trip: a concurrent refresh may have rotated or revoked it meanwhile.
    const stored = this.current(presented);
    this.store.retireRefreshHash(presented, stored.id, stored.refreshExpiresAt);
    const nextRefresh = token('vrt');
    stored.refreshHash = hash(nextRefresh);
    stored.refreshExpiresAt = capped(Date.now() + 30 * 86_400_000, stored.absoluteExpiresAt);
    return this.rotateAccess(stored, nextRefresh);
  }

  /**
   * The session behind an access token, after checking that Airtable still links its holder to the trip. Reads may
   * use a check from the last minute; pass `fresh` before payments, sharing, acceptance and other writes.
   */
  async authorize(authorization: unknown, options: { fresh?: boolean } = {}): Promise<SessionPrincipal> {
    const principal = this.validateAccess(authorization);
    await this.entitlements?.assertCurrent(principal, options);
    return principal;
  }

  validateAccess(authorization: unknown): SessionPrincipal {
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) throw invalidSession();
    const stored = this.store.sessionByAccessHash(hash(authorization.slice(7).trim()));
    if (stored?.accessRevoked) throw accessRevoked();
    if (!stored || stored.revoked || stored.accessExpiresAt < Date.now()) throw new UnauthorizedException('The access session has expired.');
    return principalOf(stored);
  }

  /**
   * A read-only token for the app's background check (`GET /v1/trips/current/watch`). It is separate from the
   * session's tokens because the background runner can't share the app's secure storage, and using the rotating
   * refresh token there would end the session as a replayed token. It never changes for a session (an HMAC of the
   * session id), works only while that session could still be refreshed, and ends with it.
   */
  watchToken(principal: Pick<SessionPrincipal, 'sessionId'>): string {
    if (!principal.sessionId) throw invalidSession();
    return `vtw_${principal.sessionId}.${watchSignature(principal.sessionId)}`;
  }

  /** The session behind `Authorization: Watch <token>`, if that session is still live. */
  validateWatch(authorization: unknown): SessionPrincipal {
    if (typeof authorization !== 'string' || !authorization.startsWith('Watch ')) throw invalidSession();
    const match = /^vtw_([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(authorization.slice(6).trim());
    const [, sessionId, signature] = match ?? [];
    if (!sessionId || !signature) throw invalidSession();
    const expected = Buffer.from(watchSignature(sessionId));
    const presented = Buffer.from(signature);
    if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) throw invalidSession();
    const stored = this.store.sessionById(sessionId);
    if (stored?.accessRevoked) throw accessRevoked();
    if (!stored || stored.revoked || stored.refreshExpiresAt < Date.now()) throw new UnauthorizedException('The session has expired.');
    // Phones check every 15 minutes at most; anything much faster is not the background check.
    if (!this.store.consumeRateLimit(`watch:${stored.id}`, WATCH_CHECKS_PER_HOUR, 3_600_000).allowed) throw new HttpException('Too many checks. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    return principalOf(stored);
  }

  /** Ends a session by its internal id (used when a step-up verification replaces it). */
  revokeById(sessionId: string): void {
    this.store.revokeSession(sessionId);
  }

  revoke(refreshToken: unknown): void {
    if (typeof refreshToken === 'string') this.store.revokeByRefreshHash(hash(refreshToken));
  }

  /** The live session for a presented refresh token; a replaced token reused after the grace period ends it. */
  private current(presented: string): StoredSession {
    const stored = this.store.sessionByRefreshHash(presented);
    if (!stored) {
      // A replaced token coming back after the grace period means it was copied: end the whole session.
      const retired = this.store.retiredRefresh(presented);
      if (retired && Date.now() - retired.retiredAt > REFRESH_REUSE_GRACE_MS) this.store.revokeSession(retired.sessionId);
      throw new UnauthorizedException('The session has expired.');
    }
    // Keep saying why access ended, so a device that missed the first answer still withdraws its saved copy.
    if (stored.accessRevoked) throw accessRevoked();
    if (stored.revoked || stored.refreshExpiresAt < Date.now()) throw new UnauthorizedException('The session has expired.');
    return stored;
  }

  private rotateAccess(stored: StoredSession, refreshToken: string): MobileSession {
    const accessToken = `${token('vta')}.${stored.id}`;
    stored.accessHash = hash(accessToken);
    stored.accessExpiresAt = capped(Date.now() + 15 * 60_000, stored.absoluteExpiresAt);
    this.store.updateTokens(stored);
    return response(accessToken, stored.accessExpiresAt, refreshToken, stored.refreshExpiresAt, identityKey(stored));
  }
}

/** Background checks allowed per session per hour (Android's minimum interval is 15 minutes; this leaves room for retries). */
const WATCH_CHECKS_PER_HOUR = 12;

/** Two requests racing with the same refresh token is normal; only treat reuse after this as theft. */
const REFRESH_REUSE_GRACE_MS = 10_000;

function principalOf(stored: StoredSession): SessionPrincipal {
  return { baseId: stored.baseId, recordId: stored.recordId, fellowTraveller: stored.fellowTraveller, customerRecordId: stored.customerRecordId, assurance: stored.assurance, sessionId: stored.id, accountKey: stored.accountKey, bookingOwnerCustomerRecordId: stored.bookingOwnerCustomerRecordId, invitationId: stored.invitationId };
}
function isAccessRevoked(error: unknown): boolean {
  if (!(error instanceof UnauthorizedException)) return false;
  const body = error.getResponse();
  return typeof body === 'object' && body !== null && (body as { code?: unknown }).code === 'access_revoked';
}
/** A rolling expiry, never past the session's fixed end. */
function capped(expiresAt: number, absoluteExpiresAt: number | null | undefined): number {
  return absoluteExpiresAt == null ? expiresAt : Math.min(expiresAt, absoluteExpiresAt);
}
function watchSignature(sessionId: string): string {
  return createHmac('sha256', watchKey()).update(`trip-watch:${sessionId}`).digest('base64url');
}
function watchKey(): Buffer {
  const secret = process.env.VISION_WATCH_SECRET?.trim() || process.env.VISION_LINK_SECRET?.trim();
  if (!secret && process.env.NODE_ENV === 'production') throw new Error('VISION_WATCH_SECRET or VISION_LINK_SECRET is required.');
  return createHash('sha256').update(`vision-trip-watch:${secret || 'local-development-only'}`).digest();
}
function token(prefix: string): string { return `${prefix}_${randomBytes(32).toString('base64url')}`; }
function hash(value: string): string { return createHash('sha256').update(value).digest('base64url'); }
function invalidSession(): UnauthorizedException { return new UnauthorizedException('The session is not valid.'); }
function response(accessToken: string, accessExpiresAt: number, refreshToken: string, refreshExpiresAt: number, identity: string): MobileSession {
  return { accessToken, accessExpiresAt: new Date(accessExpiresAt).toISOString(), refreshToken, refreshExpiresAt: new Date(refreshExpiresAt).toISOString(), identityKey: identity };
}
