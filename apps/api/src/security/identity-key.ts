import { createHmac } from 'node:crypto';

/** Values of `Customer Account ID` the API accepts; anything else is treated as "not grouped". */
export const CUSTOMER_ACCOUNT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;

/**
 * The stable account a verified Customer belongs to, within one base: their `Customer Account ID` when the agent
 * grouped duplicate records under one, otherwise the Customer record itself. Never derived from an email address.
 */
export function accountKeyFor(customerRecordId: string, customerAccountId: string | null | undefined): string {
  const accountId = customerAccountId?.trim();
  return accountId && CUSTOMER_ACCOUNT_ID_PATTERN.test(accountId) ? `account:${accountId}` : `customer:${customerRecordId}`;
}

/**
 * An opaque, base-scoped label for "who" a session belongs to, so the app can tell identities apart without ever
 * seeing Airtable IDs.
 *
 * - A verified Customer: `Airtable Base ID + account key` (see accountKeyFor). Every trip of the same account in one
 *   base — including trips linked to an explicitly grouped duplicate record — shares one key, so the app treats them
 *   as one account for switching, saved trips and "Sign out of this account". The same email on two ungrouped records,
 *   or in two bases, never does.
 * - No Customer (share links, legacy sessions): scoped to the Booking and access level, so it can never equal a
 *   Customer's key.
 */
export function identityKey(input: { baseId: string; recordId: string; customerRecordId: string | null; fellowTraveller: boolean; accountKey?: string | null }): string {
  // Ungrouped Customers keep the original `customer:<base>:<record>` subject, so keys already saved on devices still match.
  const grouped = input.accountKey?.startsWith('account:') ? input.accountKey.slice('account:'.length) : null;
  const subject = !input.customerRecordId
    ? `booking:${input.baseId}:${input.recordId}:${input.fellowTraveller ? 'fellow' : 'unverified'}`
    : grouped ? `account:${input.baseId}:${grouped}` : `customer:${input.baseId}:${input.customerRecordId}`;
  return `idk_${createHmac('sha256', secret()).update(`vision-identity:${subject}`).digest('base64url').slice(0, 22)}`;
}

/** The identity a trusted-device token belongs to: carried in the token (`k`), or derived for tokens issued before. */
export function trustIdentityKey(payload: { b: string; r: string; c?: string; k?: string }): string | null {
  if (payload.k) return payload.k;
  return payload.c ? identityKey({ baseId: payload.b, recordId: payload.r, customerRecordId: payload.c, fellowTraveller: false }) : null;
}

function secret(): string {
  return process.env.VISION_LINK_SECRET?.trim() || 'local-development-only';
}
