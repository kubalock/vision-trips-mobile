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
/** Images and the post-acceptance payment page are checked again where they're used; a bad one must not reject the response. */
const optUrlText = z.nullable(z.string());

/** A list that keeps its valid items and drops malformed ones; the list itself must be an array. */
function listOf<T extends z.ZodMiniType>(item: T) {
  return z.pipe(z.array(z.unknown()), z.transform((items: unknown[]) => items.flatMap((value) => {
    const parsed = item.safeParse(value);
    return parsed.success ? [parsed.data as z.output<T>] : [];
  })));
}

export { mobileSessionSchema };

export const quotationAcceptanceResponseSchema = z.object({
  accepted: z.literal(true), acceptedAt: isoDateTime, receiptAvailable: z.literal(true), paymentUrl: optUrlText,
  notifications: z.object({
    customer: z.enum(['sent', 'local_preview', 'failed']),
    agent: z.enum(['sent', 'local_preview', 'failed', 'not_configured']),
  }),
});

export const customerMessageResponseSchema = z.object({ sent: z.literal(true), sentAt: isoDateTime });
export const customerEngagementResponseSchema = z.object({ accepted: z.literal(true) });

export const paymentStatusResponseSchema = z.object({
  tripId: nonEmpty, checkedAt: isoDateTime, currency, total: optAmount, paid: optAmount, balance: optAmount,
  items: listOf(z.object({ id: nonEmpty, status: z.enum(['outstanding', 'paid', 'overdue', 'local', 'refund']), completedDate: optDate })),
});

export const paymentLinkResponseSchema = z.object({ paymentId: nonEmpty, url: httpsUrl, amount, currency });
export const fellowTravellerLinkResponseSchema = z.object({ url: webUrl, expiresAt: isoDateTime });

export const relatedQuotationsResponseSchema = z.object({
  quotations: listOf(z.object({
    comparisonId: nonEmpty, reference: text, name: text, departureDate: optDate, returnDate: optDate,
    durationDays: z.nullable(z.number()), total: amount, currency, heroImageUrl: optUrlText,
    status: z.enum(['available', 'expired']), current: z.boolean(),
  })),
});

export const customerPreferencesSchema = z.object({
  emailMarketing: z.boolean(), smsMarketing: z.boolean(), postalMarketing: z.boolean(),
  preferredAirports: z.array(text), preferredMonths: z.array(text),
});

export const customerAccountSchema = z.object({
  emailHint: text, preferences: customerPreferencesSchema, airportOptions: z.array(text), monthOptions: z.array(text),
  trips: listOf(z.object({
    accountTripId: nonEmpty, tripId: nonEmpty, reference: text, name: text, departureDate: optDate, returnDate: optDate,
    status: z.enum(tripStages), heroImageUrl: optUrlText, current: z.boolean(),
  })),
});

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
