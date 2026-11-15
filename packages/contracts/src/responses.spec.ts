import { describe, expect, it } from 'vitest';
import { customerAccountSchema, mobileSessionSchema, paymentLinkResponseSchema, paymentStatusResponseSchema, quotationAcceptanceResponseSchema, relatedQuotationsResponseSchema, tripSessionResponseSchema } from './index.js';

describe('API response contracts', () => {
  const session = { accessToken: 'a', accessExpiresAt: '2026-11-15T10:00:00Z', refreshToken: 'r', refreshExpiresAt: '2026-12-15T10:00:00Z' };

  it('rejects null and malformed bodies', () => {
    for (const schema of [paymentStatusResponseSchema, customerAccountSchema, mobileSessionSchema, quotationAcceptanceResponseSchema, tripSessionResponseSchema]) {
      expect(schema.safeParse(null).success).toBe(false);
      expect(schema.safeParse({}).success).toBe(false);
    }
    expect(mobileSessionSchema.safeParse({ ...session, accessExpiresAt: 'soon' }).success).toBe(false);
    expect(paymentLinkResponseSchema.safeParse({ paymentId: 'pay_1', url: 'javascript:alert(1)', amount: 10, currency: 'GBP' }).success).toBe(false);
    expect(paymentStatusResponseSchema.safeParse({ tripId: 't', checkedAt: '2026-11-15T10:00:00Z', currency: 'GBP', total: 'lots', paid: 0, balance: 0, items: [] }).success).toBe(false);
  });

  it('accepts valid bodies and drops unknown keys', () => {
    expect(mobileSessionSchema.parse({ ...session, extra: true })).toEqual(session);
    expect(tripSessionResponseSchema.parse({ snapshot: { tripId: 't' }, session }).session).toEqual(session);
    expect(quotationAcceptanceResponseSchema.parse({ accepted: true, acceptedAt: '2026-11-15T10:00:00Z', receiptAvailable: true, paymentUrl: null, notifications: { customer: 'sent', agent: 'not_configured' } }).accepted).toBe(true);
  });

  it('keeps the valid items of a list and drops malformed ones', () => {
    const quotation = { comparisonId: 'cmp_1', reference: 'R1', name: 'Lisbon', departureDate: null, returnDate: null, durationDays: 7, total: 1200, currency: 'GBP', heroImageUrl: null, status: 'available', current: false };
    const parsed = relatedQuotationsResponseSchema.parse({ quotations: [quotation, { ...quotation, total: null }, null] });
    expect(parsed.quotations).toEqual([quotation]);
    expect(relatedQuotationsResponseSchema.safeParse({ quotations: null }).success).toBe(false);
    const account = customerAccountSchema.parse({ emailHint: 'al**@example.com', preferences: { emailMarketing: true, smsMarketing: false, postalMarketing: false, preferredAirports: [], preferredMonths: [] }, airportOptions: [], monthOptions: [], trips: [{ accountTripId: 'a', tripId: 't', reference: 'R', name: 'N', departureDate: null, returnDate: null, status: 'not-a-stage', heroImageUrl: null, current: true }] });
    expect(account.trips).toEqual([]);
  });
});
