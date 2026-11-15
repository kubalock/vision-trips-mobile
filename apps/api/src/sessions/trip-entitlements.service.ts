import { Inject, Injectable, Logger, NotFoundException, Optional, UnauthorizedException } from '@nestjs/common';
import { AirtableService, type AirtableRecord } from '../airtable/airtable.service.js';
import { accountKeyFor } from '../security/identity-key.js';
import { bookingFields, customerFields, firstString, pick, strings, truthy } from '../trips/field-map.js';
import { DurableAuthStore } from './durable-auth.store.js';
import type { SessionPrincipal } from './sessions.service.js';

/**
 * Re-checks in Airtable that a session's holder may still see its trip, so changing Airtable takes away live access
 * that was already granted — not only new invitations or trips opened from the account.
 *
 * A session with a verified Customer stays entitled only while:
 * - the verified Customer record still exists (and is not soft-deleted);
 * - the booking owner (the verified Customer, or the grouped duplicate the trip was opened through) still has the
 *   verified Customer's `Customer Account ID`;
 * - the Booking still exists, is not soft-deleted, its `Customers` lists the owner and the owner's `Trips` lists it.
 *
 * Sessions without a Customer (fellow-traveller share links, older unverified sessions) only need the Booking to still
 * exist; they cannot pay, share or accept a quotation anyway.
 *
 * When one of these no longer holds, the session is ended (its refresh token stops working too) and the request fails
 * with 401 `access_revoked`. An Airtable outage is not a revocation: that error is passed on as it is.
 *
 * The session's account follows Airtable too: when the agent adds, changes or removes the verified Customer's
 * `Customer Account ID` (and the trip is still theirs), the session is moved to the new account key, so its next
 * refresh returns the new identity and the app moves the trips saved under the old one.
 */
@Injectable()
export class TripEntitlementsService {
  private readonly logger = new Logger(TripEntitlementsService.name);
  /** Sessions confirmed recently, so reads don't each cost extra Airtable calls. Sensitive actions always re-check. */
  private readonly confirmed = new Map<string, number>();

  constructor(
    private readonly airtable: AirtableService,
    @Inject(DurableAuthStore) private readonly store: DurableAuthStore,
    @Optional() private readonly now: () => number = Date.now,
  ) {}

  /**
   * Throws 401 `access_revoked` (and ends the session) when the Airtable relationship behind it is gone.
   * `fresh` skips the short confirmation cache: use it before payments, sharing, acceptance and other writes.
   */
  async assertCurrent(principal: SessionPrincipal, options: { fresh?: boolean } = {}): Promise<void> {
    // Note: moves `principal.accountKey` to the Customer's current account when it changed.
    const key = principal.sessionId;
    const confirmedAt = key ? this.confirmed.get(key) : undefined;
    if (!options.fresh && confirmedAt !== undefined && this.now() - confirmedAt < CONFIRMED_FOR_MS) return;
    const { problem, accountKey } = await this.evaluate(principal);
    if (problem) {
      if (key) { this.store.revokeSession(key, 'access_revoked'); this.confirmed.delete(key); }
      this.logger.warn(JSON.stringify({ event: 'session_access_revoked', reason: problem }));
      throw accessRevoked();
    }
    if (accountKey !== undefined && accountKey !== (principal.accountKey ?? null)) {
      if (key) this.store.updateAccountKey(key, accountKey);
      this.logger.log(JSON.stringify({ event: 'session_account_moved', grouped: accountKey?.startsWith('account:') ?? false }));
      principal.accountKey = accountKey;
    }
    if (key) this.remember(key);
  }

  /**
   * Why the session is no longer entitled (null while it still is), and the verified Customer's current account key
   * (undefined for sessions without a Customer). Transient Airtable errors are thrown.
   */
  async evaluate(principal: SessionPrincipal): Promise<{ problem: EntitlementProblem | null; accountKey?: string | null }> {
    const booking = await this.optional(principal.baseId, bookingsTable(), principal.recordId);
    if (!booking || truthy(booking.fields['Soft Delete'])) return { problem: 'booking_removed' };
    if (!principal.customerRecordId) return { problem: null };
    const ownerId = principal.bookingOwnerCustomerRecordId && principal.bookingOwnerCustomerRecordId !== principal.customerRecordId
      ? principal.bookingOwnerCustomerRecordId : null;
    const [root, owner] = await Promise.all([
      this.optional(principal.baseId, customersTable(), principal.customerRecordId),
      ownerId ? this.optional(principal.baseId, customersTable(), ownerId) : Promise.resolve(null),
    ]);
    const problem = entitlementProblem(booking, root, ownerId ? owner : root);
    return problem || !root ? { problem } : { problem, accountKey: accountKeyFor(root.id, firstString(root.fields[CUSTOMER_ACCOUNT_ID]).trim() || null) };
  }

  private async optional(baseId: string, table: string, recordId: string): Promise<AirtableRecord | null> {
    try {
      return await this.airtable.record(baseId, table, recordId);
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
  }

  private remember(key: string): void {
    if (this.confirmed.size >= MAX_CONFIRMED) {
      const cutoff = this.now() - CONFIRMED_FOR_MS;
      for (const [id, at] of this.confirmed) if (at < cutoff) this.confirmed.delete(id);
      if (this.confirmed.size >= MAX_CONFIRMED) this.confirmed.clear();
    }
    this.confirmed.set(key, this.now());
  }
}

export type EntitlementProblem = 'booking_removed' | 'customer_removed' | 'owner_not_grouped' | 'customer_not_linked';

/** The pure policy (see TripEntitlementsService). `owner` is the verified Customer unless the trip belongs to a grouped duplicate. */
export function entitlementProblem(booking: AirtableRecord, root: AirtableRecord | null, owner: AirtableRecord | null): EntitlementProblem | null {
  if (!root || truthy(root.fields['Soft Delete'])) return 'customer_removed';
  const accountId = firstString(root.fields[CUSTOMER_ACCOUNT_ID]).trim() || null;
  if (!owner || truthy(owner.fields['Soft Delete'])) return 'customer_removed';
  if (owner.id !== root.id && (!accountId || firstString(owner.fields[CUSTOMER_ACCOUNT_ID]).trim() !== accountId)) return 'owner_not_grouped';
  const bookingLists = strings(pick(booking.fields, bookingFields.customers)).includes(owner.id);
  const ownerLists = strings(pick(owner.fields, customerFields.trips)).includes(booking.id);
  return bookingLists && ownerLists ? null : 'customer_not_linked';
}

export function accessRevoked(): UnauthorizedException {
  return new UnauthorizedException({ statusCode: 401, code: 'access_revoked', message: 'You no longer have access to this trip. Contact your travel agent if you think this is a mistake.' });
}

const CUSTOMER_ACCOUNT_ID = 'Customer Account ID';
const CONFIRMED_FOR_MS = 60_000;
const MAX_CONFIRMED = 5_000;
const bookingsTable = (): string => process.env.AIRTABLE_BOOKINGS_TABLE?.trim() || 'Bookings';
const customersTable = (): string => process.env.AIRTABLE_CUSTOMERS_TABLE?.trim() || 'Customers';
