import * as z from 'zod/mini';
import { tripStages } from './stages.js';
import { mobileSessionSchema } from './invitations.js';

/**
 * Runtime schemas for the customer API's JSON responses (the trip snapshot, invitations and external content have
 * their own). The app parses every response with these before it enters application state, so a malformed or null
 * upstream body is rejected at the boundary instead of failing later in a template. Unknown keys are dropped.
 */

const text = z.string();
const nonEmpty = z.string().check(z.minLength(1));
const isoDateTime = z.string().check(z.refine((value) => !Number.isNaN(Date.parse(value)), 'Expected an ISO date-time.'));
/** Dates are shown as given; only their type is checked. */
const optDate = z.nullable(z.string());
const amount = z.number().check(z.refine(Number.isFinite, 'Expected a finite number.'));
const optAmount = z.nullable(amount);
const currency = z.string().check(z.regex(/^[A-Z]{3}$/));
const httpsUrl = z.string().check(z.refine((value) => { try { return new URL(value).protocol === 'https:'; } catch { return false; } }, 'Expected an https URL.'));
/** Fellow-traveller links point at the app itself, which is plain http in local development. */
const webUrl = z.string().check(z.refine((value) => { try { return /^https?:$/.test(new URL(value).protocol); } catch { return false; } }, 'Expected a URL.'));
/** Images are checked again where they're shown; a bad image URL must not reject the response. */
const optUrlText = z.nullable(z.string());

/*
 * Lists here are strict: one malformed payment, account trip or quotation rejects the whole response (the app then
 * says the information is temporarily unavailable) rather than silently dropping a record, which could make payment
 * reconciliation report "not confirmed" or hide a trip. Tolerant filtering is kept for non-critical enrichment only
 * (the external-content schemas).
 */

export { mobileSessionSchema };

export const quotationAcceptanceResponseSchema = z.object({
  accepted: z.literal(true), acceptedAt: isoDateTime, receiptAvailable: z.literal(true), paymentUrl: z.nullable(httpsUrl),
  notifications: z.object({
    customer: z.enum(['sent', 'local_preview', 'failed']),
    agent: z.enum(['sent', 'local_preview', 'failed', 'not_configured']),
  }),
});

export const quotationAcceptanceContextSchema = z.object({ emailHint: z.nullable(text) });

export const customerMessageResponseSchema = z.object({ sent: z.literal(true), sentAt: isoDateTime });
export const customerEngagementResponseSchema = z.object({ accepted: z.literal(true) });

export const paymentStatusResponseSchema = z.object({
  tripId: nonEmpty, checkedAt: isoDateTime, currency, total: optAmount, paid: optAmount, balance: optAmount,
  items: z.array(z.object({ id: nonEmpty, status: z.enum(['outstanding', 'paid', 'overdue', 'local', 'refund']), completedDate: optDate })),
});

export const paymentLinkResponseSchema = z.object({ paymentId: nonEmpty, url: httpsUrl, amount, currency });
export const fellowTravellerLinkResponseSchema = z.object({ url: webUrl, expiresAt: isoDateTime });

export const relatedQuotationsResponseSchema = z.object({
  quotations: z.array(z.object({
    comparisonId: nonEmpty, reference: text, name: text, departureDate: optDate, returnDate: optDate,
    durationDays: z.nullable(z.number()), nights: z.optional(z.nullable(z.number())), total: amount, perPerson: z.optional(z.nullable(amount)), currency, heroImageUrl: optUrlText,
    status: z.enum(['available', 'expired']), current: z.boolean(),
  })),
});

export const customerPreferencesSchema = z.object({
  emailMarketing: z.boolean(), smsMarketing: z.boolean(), postalMarketing: z.boolean(),
  preferredAirports: z.array(text), preferredMonths: z.array(text),
});

const loyaltyNumber = z.nullable(z.number().check(z.refine(Number.isFinite, 'Expected a finite number.')));
/** Loyalty is enrichment: an unreadable block becomes null instead of failing the whole account. */
export const customerLoyaltySchema = z.object({
  available: loyaltyNumber, availableValue: loyaltyNumber, currency, lifetime: loyaltyNumber, expiresAt: optDate,
  transactions: z.array(z.object({ id: nonEmpty, type: z.enum(['earn', 'redeem', 'adjustment', 'expiry']), points: amount, date: optDate, tripName: z.nullable(text), description: z.nullable(text) })),
});

export const customerAccountSchema = z.object({
  emailHint: text, preferences: customerPreferencesSchema, airportOptions: z.array(text), monthOptions: z.array(text),
  loyalty: z.optional(z.catch(z.nullable(customerLoyaltySchema), null)), vip: z.optional(z.boolean()),
  trips: z.array(z.object({
    accountTripId: nonEmpty, tripId: nonEmpty, reference: text, name: text, departureDate: optDate, returnDate: optDate,
    status: z.enum(tripStages), heroImageUrl: optUrlText, current: z.boolean(),
  })),
});

export const travellerProfileSchema = z.object({
  travellerId: z.string().check(z.regex(/^tvl_[A-Za-z0-9_-]{22}$/)), name: text, dateOfBirth: optDate,
  passport: z.object({ numberHint: z.nullable(text), nationality: z.nullable(text), issuingCountry: z.nullable(text), issueDate: optDate, expiryDate: optDate }),
  drivingLicence: z.object({ numberHint: z.nullable(text), expiryDate: optDate }),
  nextOfKin: z.object({ name: z.nullable(text), phone: z.nullable(text) }),
  airlineLoyalty: z.nullable(text), cruiseLoyalty: z.nullable(text),
});
export const travellerProfilesResponseSchema = z.object({ travellers: z.array(travellerProfileSchema) });
export const travellerProfileUpdateResponseSchema = z.object({ saved: z.literal(true), traveller: travellerProfileSchema });
export const callbackResponseSchema = z.object({ sent: z.literal(true), sentAt: isoDateTime });

export const updateCustomerPreferencesResponseSchema = z.object({
  saved: z.literal(true), updatedRecords: z.number().check(z.int(), z.nonnegative()), preferences: customerPreferencesSchema,
});

/** Opening another trip (account or related quotation): the snapshot is validated by the client's TripSnapshot schema. */
export const tripSessionResponseSchema = z.object({ snapshot: z.record(z.string(), z.unknown()), session: mobileSessionSchema });

/** An authorised link exchange; `invitation_required` answers use invitationRequiredLinkExchangeSchema. */
export const authorizedLinkExchangeSchema = z.object({
  status: z.literal('authorized'), exchangeId: nonEmpty, expiresAt: isoDateTime,
  snapshot: z.record(z.string(), z.unknown()), session: mobileSessionSchema, trustedDeviceToken: z.optional(z.string()),
});
