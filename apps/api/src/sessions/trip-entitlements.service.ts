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
 * - a session grouped by `Customer Account ID` still has that same ID on the verified Customer;
 * - the booking owner (the verified Customer, or the grouped duplicate the trip was opened through) still has the
 *   verified Customer's `Customer Account ID`;
 * - the Booking still exists, is not soft-deleted, its `Customers` lists the owner and the owner's `Trips` lists it.
 *
 * Sessions without a Customer (fellow-traveller share links, older unverified sessions) only need the Booking to still
 * exist; they cannot pay, share or accept a quotation anyway.
 *
 * When one of these no longer holds, the session is ended (its refresh token stops working too) and the request fails
 * with 401 `access_revoked`. An Airtable outage is not a revocation: that error is passed on as it is.
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
    const key = principal.sessionId;
    const confirmedAt = key ? this.confirmed.get(key) : undefined;
    if (!options.fresh && confirmedAt !== undefined && this.now() - confirmedAt < CONFIRMED_FOR_MS) return;
    const problem = await this.problem(principal);
    if (problem) {
      if (key) { this.store.revokeSession(key); this.confirmed.delete(key); }
      this.logger.warn(JSON.stringify({ event: 'session_access_revoked', reason: problem }));
      throw accessRevoked();
    }
    if (key) this.remember(key);
  }

  /** Why the session is no longer entitled, or null while it still is. Transient Airtable errors are thrown. */
  async problem(principal: SessionPrincipal): Promise<EntitlementProblem | null> {
    const booking = await this.optional(principal.baseId, bookingsTable(), principal.recordId);
    if (!booking || truthy(booking.fields['Soft Delete'])) return 'booking_removed';
    if (!principal.customerRecordId) return null;
    const ownerId = principal.bookingOwnerCustomerRecordId && principal.bookingOwnerCustomerRecordId !== principal.customerRecordId
      ? principal.bookingOwnerCustomerRecordId : null;
    const [root, owner] = await Promise.all([
      this.optional(principal.baseId, customersTable(), principal.customerRecordId),
      ownerId ? this.optional(principal.baseId, customersTable(), ownerId) : Promise.resolve(null),
    ]);
    return entitlementProblem(principal, booking, root, ownerId ? owner : root);
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

export type EntitlementProblem = 'booking_removed' | 'customer_removed' | 'account_changed' | 'owner_not_grouped' | 'customer_not_linked';

/** The pure policy (see TripEntitlementsService). `owner` is the verified Customer unless the trip belongs to a grouped duplicate. */
export function entitlementProblem(principal: SessionPrincipal, booking: AirtableRecord, root: AirtableRecord | null, owner: AirtableRecord | null): EntitlementProblem | null {
  if (!root || truthy(root.fields['Soft Delete'])) return 'customer_removed';
  const accountId = firstString(root.fields[CUSTOMER_ACCOUNT_ID]).trim() || null;
  // A session grouped under an account keeps it only while the verified Customer still carries that account ID.
  if (principal.accountKey?.startsWith('account:') && accountKeyFor(root.id, accountId) !== principal.accountKey) return 'account_changed';
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
