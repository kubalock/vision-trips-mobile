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

  it('rejects the whole response when one payment, account trip or quotation is malformed, rather than dropping it', () => {
    const quotation = { comparisonId: 'cmp_1', reference: 'R1', name: 'Lisbon', departureDate: null, returnDate: null, durationDays: 7, total: 1200, currency: 'GBP', heroImageUrl: null, status: 'available', current: false };
    expect(relatedQuotationsResponseSchema.parse({ quotations: [quotation] }).quotations).toEqual([quotation]);
    expect(relatedQuotationsResponseSchema.safeParse({ quotations: [quotation, { ...quotation, total: null }] }).success).toBe(false);
    expect(relatedQuotationsResponseSchema.safeParse({ quotations: null }).success).toBe(false);
    const preferences = { emailMarketing: true, smsMarketing: false, postalMarketing: false, preferredAirports: [], preferredMonths: [] };
    const trip = { accountTripId: 'a', tripId: 't', reference: 'R', name: 'N', departureDate: null, returnDate: null, status: 'confirmed', heroImageUrl: null, current: true };
    const account = { emailHint: 'al**@example.com', preferences, airportOptions: [], monthOptions: [] };
    expect(customerAccountSchema.parse({ ...account, trips: [trip] }).trips).toEqual([trip]);
    expect(customerAccountSchema.safeParse({ ...account, trips: [trip, { ...trip, status: 'not-a-stage' }] }).success).toBe(false);
    const status = { tripId: 't', checkedAt: '2026-11-15T10:00:00Z', currency: 'GBP', total: 1000, paid: 200, balance: 800 };
    const payment = { id: 'pay_1', status: 'paid', completedDate: '2026-11-15' };
    expect(paymentStatusResponseSchema.parse({ ...status, items: [payment] }).items).toEqual([payment]);
    expect(paymentStatusResponseSchema.safeParse({ ...status, items: [payment, { id: 'pay_2', status: 'mystery', completedDate: null }] }).success).toBe(false);
  });

  it('only accepts an https payment page after accepting a quotation', () => {
    const body = { accepted: true, acceptedAt: '2026-11-15T10:00:00Z', receiptAvailable: true, notifications: { customer: 'sent', agent: 'not_configured' } };
    expect(quotationAcceptanceResponseSchema.parse({ ...body, paymentUrl: 'https://pay.example.com/x' }).paymentUrl).toBe('https://pay.example.com/x');
    for (const paymentUrl of ['http://pay.example.com/x', 'javascript:alert(1)', 'not a url']) expect(quotationAcceptanceResponseSchema.safeParse({ ...body, paymentUrl }).success).toBe(false);
  });
});
