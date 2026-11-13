import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AirtableRecord, AirtableService } from '../airtable/airtable.service.js';
import type { SessionPrincipal } from '../sessions/sessions.service.js';
import { bookingFields, customerFields, firstString, pick, strings, truthy } from '../trips/field-map.js';

/**
 * Customer identity policy (account discovery, preferences and trips opened from the account):
 *
 * 1. The identity root is the verified `principal.customerRecordId`, within `principal.baseId`. Nothing else — not the
 *    Booking's rolled-up customer email, not another record's Primary/Secondary Email — can select a Customer.
 * 2. Several Customer records form one account only when they carry the same non-empty `Customer Account ID` in the
 *    same base (an explicit relationship set by the agent). Matching email strings never merge records.
 * 3. A Booking belongs to the account only when it is linked both ways: the Customer's `Trips` lists it and the
 *    Booking's `Customers` lists that Customer. Soft-deleted Bookings are left out.
 * 4. Every lookup uses the session's base, so one branch's records can never be read or changed from another's.
 */
export const CUSTOMER_ACCOUNT_ID_FIELD = 'Customer Account ID';
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
const MAX_ACCOUNT_MEMBERS = 20;

export interface CustomerIdentity {
  /** The verified Customer the session belongs to. */
  root: AirtableRecord;
  /** The root plus any records explicitly grouped with it by `Customer Account ID` (same base only). */
  members: AirtableRecord[];
  email: string;
}

export interface AccountBooking {
  record: AirtableRecord;
  /** The account member the Booking is linked to: the verified Customer whenever it is one of them. */
  ownerCustomerRecordId: string;
}

export const customersTable = (): string => process.env.AIRTABLE_CUSTOMERS_TABLE?.trim() || 'Customers';
export const bookingsTable = (): string => process.env.AIRTABLE_BOOKINGS_TABLE?.trim() || 'Bookings';

/** Sessions without a verified Customer (created before invitations, or by an older account-open) must verify again. */
export function requireCustomer(principal: SessionPrincipal): string {
  if (principal.customerRecordId) return principal.customerRecordId;
  throw new ForbiddenException({ statusCode: 403, code: 'verification_required', message: 'For your security, confirm it’s you with a code sent to your email before continuing.' });
}

export async function resolveCustomerIdentity(airtable: AirtableService, principal: SessionPrincipal): Promise<CustomerIdentity> {
  const customerRecordId = requireCustomer(principal);
  let root: AirtableRecord;
  try {
    root = await airtable.record(principal.baseId, customersTable(), customerRecordId);
  } catch (error) {
    if (error instanceof NotFoundException) throw new NotFoundException('Your customer profile is no longer available. Contact your travel agent.');
    throw error;
  }
  const accountId = firstString(root.fields[CUSTOMER_ACCOUNT_ID_FIELD]);
  let members = [root];
  if (accountId && ACCOUNT_ID_PATTERN.test(accountId)) {
    const grouped = await airtable.list(principal.baseId, customersTable(), {
      filterByFormula: `{${CUSTOMER_ACCOUNT_ID_FIELD}}='${accountId}'`, maxRecords: MAX_ACCOUNT_MEMBERS,
    });
    // Re-check each record's value: the formula is only a filter, never the authority.
    members = [root, ...grouped.filter((record) => record.id !== root.id && firstString(record.fields[CUSTOMER_ACCOUNT_ID_FIELD]) === accountId)];
  }
  return { root, members, email: customerEmail(root) };
}

/** Bookings linked both ways to an account member, in the session's base. */
export async function accountBookings(airtable: AirtableService, principal: SessionPrincipal, identity: CustomerIdentity): Promise<AccountBooking[]> {
  const memberIds = identity.members.map((member) => member.id);
  const ids = [...new Set(identity.members.flatMap((member) => strings(pick(member.fields, customerFields.trips))))];
  if (!ids.length) return [];
  const records = await airtable.records(principal.baseId, bookingsTable(), ids);
  return records.flatMap((record) => {
    if (truthy(record.fields['Soft Delete'])) return [];
    const linked = strings(pick(record.fields, bookingFields.customers)).filter((id) => memberIds.includes(id));
    // A booking whose own Customers field does not name an account member is not this account's, whatever Trips says.
    const memberClaims = identity.members.filter((member) => strings(pick(member.fields, customerFields.trips)).includes(record.id)).map((member) => member.id);
    const owners = linked.filter((id) => memberClaims.includes(id));
    if (!owners.length) return [];
    const ownerCustomerRecordId = owners.includes(identity.root.id) ? identity.root.id : owners[0];
    return [{ record, ownerCustomerRecordId }];
  });
}

export function customerEmail(record: AirtableRecord): string {
  return (firstString(pick(record.fields, customerFields.primaryEmail)) || firstString(pick(record.fields, customerFields.secondaryEmail))).trim().toLowerCase();
}
