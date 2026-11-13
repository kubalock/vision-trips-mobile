import { createHmac } from 'node:crypto';

/**
 * An opaque, base-scoped label for "who" a session belongs to, so the app can tell two identities apart without ever
 * seeing Airtable IDs.
 *
 * - A verified Customer: `Airtable Base ID + Customer Record ID`. The same Customer on two Bookings in one base gets
 *   the same key; the same email address on two Customer records (or in two bases) never does.
 * - No Customer (share links, legacy sessions): scoped to the Booking and access level, so it can never equal a
 *   Customer's key.
 */
export function identityKey(input: { baseId: string; recordId: string; customerRecordId: string | null; fellowTraveller: boolean }): string {
  const subject = input.customerRecordId
    ? `customer:${input.baseId}:${input.customerRecordId}`
    : `booking:${input.baseId}:${input.recordId}:${input.fellowTraveller ? 'fellow' : 'unverified'}`;
  return `idk_${createHmac('sha256', secret()).update(`vision-identity:${subject}`).digest('base64url').slice(0, 22)}`;
}

/** The identity a trusted-device token was issued to (its payload names the base and Customer). */
export function trustIdentityKey(payload: { b: string; r: string; c?: string }): string | null {
  return payload.c ? identityKey({ baseId: payload.b, recordId: payload.r, customerRecordId: payload.c, fellowTraveller: false }) : null;
}

function secret(): string {
  return process.env.VISION_LINK_SECRET?.trim() || 'local-development-only';
}
