import type { SessionAssurance } from '@vision-trips/contracts';
import { createHmac } from 'node:crypto';
import type { SessionPrincipal } from '../sessions/sessions.service.js';

/**
 * What a quotation acceptance proves, stored as JSON in the Booking's `Quotation Acceptance Evidence` field.
 *
 * `name` and `email` are what the signer typed (the declared signer): someone may legitimately accept on behalf of
 * the booking, so they are recorded as given. `signedInAs` records who was actually signed in, separately: opaque,
 * base-scoped references to the verified Customer, their account and (when the trip is linked through a grouped
 * duplicate) the booking owner, plus how the session was verified, its invitation and the session itself.
 *
 * The references are keyed hashes, never Airtable record IDs, because the receipt shown to the customer is built
 * from this evidence. The internal relationship is kept in the Booking's audit comment, which names the records.
 */
export interface AcceptanceEvidence {
  acceptedAt: string;
  name: string;
  email: string;
  ip: string;
  userAgent: string;
  snapshotVersion: string;
  /** v3 acceptances: the sections the customer confirmed. Empty since v4. */
  confirmations: string[];
  /** v4: review sections the customer opened (recorded, never required). */
  openedSections?: string[];
  reference: string;
  /** Absent on acceptances recorded before it was added. */
  signedInAs?: SignedInAs;
}

export interface SignedInAs {
  customerSubject: string;
  accountSubject: string | null;
  bookingOwnerSubject: string | null;
  assurance: SessionAssurance;
  invitationId: string | null;
  sessionSubject: string | null;
  /** Whether the email typed by the signer is the verified Customer's own email; null when it couldn't be read. */
  signerIsVerifiedCustomer: boolean | null;
}

export function signedInAs(principal: SessionPrincipal, verifiedEmail: string | null, declaredEmail: string): SignedInAs {
  const customer = principal.customerRecordId ?? 'none';
  const owner = principal.bookingOwnerCustomerRecordId && principal.bookingOwnerCustomerRecordId !== principal.customerRecordId ? principal.bookingOwnerCustomerRecordId : null;
  return {
    customerSubject: opaqueSubject('customer', principal.baseId, customer),
    accountSubject: principal.accountKey ? opaqueSubject('account', principal.baseId, principal.accountKey) : null,
    bookingOwnerSubject: owner ? opaqueSubject('customer', principal.baseId, owner) : null,
    assurance: principal.assurance,
    invitationId: principal.invitationId ?? null,
    sessionSubject: principal.sessionId ? opaqueSubject('session', principal.baseId, principal.sessionId) : null,
    signerIsVerifiedCustomer: verifiedEmail ? verifiedEmail === declaredEmail.trim().toLowerCase() : null,
  };
}

/** A stable, opaque reference (`sub_…`) to a record within one base: the same input always gives the same value. */
export function opaqueSubject(kind: 'customer' | 'account' | 'session', baseId: string, value: string): string {
  const secret = process.env.VISION_LINK_SECRET?.trim() || 'local-development-only';
  return `sub_${createHmac('sha256', secret).update(`acceptance-${kind}:${baseId}:${value}`).digest('base64url').slice(0, 20)}`;
}

export function parseAcceptanceEvidence(value: unknown): AcceptanceEvidence | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as Partial<AcceptanceEvidence>;
    return typeof parsed.acceptedAt === 'string' && typeof parsed.name === 'string' && typeof parsed.email === 'string' && Array.isArray(parsed.confirmations) ? parsed as AcceptanceEvidence : null;
  } catch { return null; }
}

/** Receipt lines about the signed-in account, in customer words: no record IDs, only the opaque reference. */
export function signedInRows(evidence: AcceptanceEvidence): Array<[string, string]> {
  const signedIn = evidence.signedInAs;
  if (!signedIn) return [];
  const verifiedBy = signedIn.assurance === 'otp' ? 'a code sent to the account email' : signedIn.assurance === 'trusted_device' ? 'a trusted device (email confirmed earlier)' : 'a trip link';
  const signer = signedIn.signerIsVerifiedCustomer === true ? 'The account holder'
    : signedIn.signerIsVerifiedCustomer === false ? 'Someone signing on behalf of the account holder (the email entered is not the account email)'
      : 'Not checked';
  return [
    ['Signed in as', `The verified account holder, confirmed with ${verifiedBy}`],
    ['Signer', signer],
    ['Account reference', signedIn.accountSubject ?? signedIn.customerSubject],
  ];
}

/** For the Booking's internal audit comment: names the actual records, which never appear on the receipt. */
export function signedInAuditText(principal: SessionPrincipal, evidence: SignedInAs): string {
  const owner = principal.bookingOwnerCustomerRecordId && principal.bookingOwnerCustomerRecordId !== principal.customerRecordId
    ? `, trip linked through grouped Customer ${principal.bookingOwnerCustomerRecordId}` : '';
  const account = principal.accountKey?.startsWith('account:') ? ` (account ${principal.accountKey.slice('account:'.length)})` : '';
  const signer = evidence.signerIsVerifiedCustomer === true ? 'the signer’s email is the Customer’s own'
    : evidence.signerIsVerifiedCustomer === false ? 'the signer’s email differs from the Customer’s (signed on their behalf)' : 'the Customer’s email could not be checked';
  return `Signed in as Customer ${principal.customerRecordId ?? 'unknown'}${account}${owner}, verified by ${principal.assurance}${principal.invitationId ? ` via invitation ${principal.invitationId}` : ''}; ${signer}.`;
}
