import { Inject, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import type { MobileSession, SessionAssurance } from '@vision-trips/contracts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { identityKey } from '../security/identity-key.js';
import { DurableAuthStore, type StoredSession } from './durable-auth.store.js';
import { TripEntitlementsService } from './trip-entitlements.service.js';

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
    const refreshExpiresAt = Date.now() + 30 * 86_400_000;
    const accessExpiresAt = Date.now() + 15 * 60_000;
    const accessToken = `${token('vta')}.${id}`;
    this.store.putSession({ id, baseId: input.baseId, recordId: input.recordId, fellowTraveller: input.fellowTraveller, customerRecordId: input.customerRecordId, assurance: input.assurance, invitationId: input.invitationId ?? null, accountKey: input.accountKey ?? null, bookingOwnerCustomerRecordId: input.bookingOwnerCustomerRecordId ?? null, refreshHash: hash(refreshToken), refreshExpiresAt, accessHash: hash(accessToken), accessExpiresAt, revoked: false });
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
    stored.refreshExpiresAt = Date.now() + 30 * 86_400_000;
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
    if (!stored || stored.revoked || stored.accessExpiresAt < Date.now()) throw new UnauthorizedException('The access session has expired.');
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
    if (stored.revoked || stored.refreshExpiresAt < Date.now()) throw new UnauthorizedException('The session has expired.');
    return stored;
  }

  private rotateAccess(stored: StoredSession, refreshToken: string): MobileSession {
    const accessToken = `${token('vta')}.${stored.id}`;
    stored.accessHash = hash(accessToken);
    stored.accessExpiresAt = Date.now() + 15 * 60_000;
    this.store.updateTokens(stored);
    return response(accessToken, stored.accessExpiresAt, refreshToken, stored.refreshExpiresAt, identityKey(stored));
  }
}

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
function token(prefix: string): string { return `${prefix}_${randomBytes(32).toString('base64url')}`; }
function hash(value: string): string { return createHash('sha256').update(value).digest('base64url'); }
function invalidSession(): UnauthorizedException { return new UnauthorizedException('The session is not valid.'); }
function response(accessToken: string, accessExpiresAt: number, refreshToken: string, refreshExpiresAt: number, identity: string): MobileSession {
  return { accessToken, accessExpiresAt: new Date(accessExpiresAt).toISOString(), refreshToken, refreshExpiresAt: new Date(refreshExpiresAt).toISOString(), identityKey: identity };
}
