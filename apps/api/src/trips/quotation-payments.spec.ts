import { beforeAll, describe, expect, it } from 'vitest';
import type { TripSnapshot } from '@vision-trips/contracts';
import { TripsService } from './trips.service.js';

const BASE = 'appABCDEFGHIJKLMN';
const brand = { id: 'recBRANDABCDEFGHI', fields: { 'Mint | API Key': 'k', 'Mint | Business Unit': 'u', 'Mint | Allow Custom Payments': true } };
const payment = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, fields: { Status: 'Outstanding', 'Customer Payment Type': type, Amount: 250, 'Payment Link URL': 'https://pay.example/x', "Show 'Pay Now' on Quotation": true, ...extra } });

function snapshot(status: string, fields: Record<string, unknown> = {}): TripSnapshot {
  const booking = { id: 'recABCDEFGHIJKLMN', createdTime: '2026-11-01T10:00:00.000Z', fields: { Status: status, 'Departure Date': '2027-03-01', 'Return Date': '2027-03-12', 'Total Price': 5000, 'MS Paid': 0, 'MS Outstanding': 5000, 'Mint | Booking ID': 'BK.1', ...fields } };
  return new TripsService({} as never).mapSnapshot(BASE, booking as never, brand as never, 'primary_customer', { payments: [payment('recPAYMENTAAAAAAA', 'Deposit Payment', { 'Date Due': '2026-12-01' }), payment('recPAYMENTBBBBBBB', 'Balance Payment', { 'Date Due': '2027-01-10' })] } as never);
}

describe('payments on quotations', () => {
  beforeAll(() => { process.env.VISION_LINK_SECRET ??= 'quotation-payments-test'; });

  it('offers no Pay now and no custom amount on an unaccepted quotation, even with the legacy Show Pay Now field', () => {
    const quote = snapshot('Quotation');
    expect(quote.stage).toBe('quote');
    expect(quote.payments?.items.every((item) => !item.canPay && item.actionUrl === null)).toBe(true);
    expect(quote.payments?.customPayments.enabled).toBe(false);
    expect(quote.capabilities.makePayment).toBe(false);
    expect(quote.capabilities.acceptQuotation).toBe(true);
    expect(quote.quotation).toMatchObject({ accepted: false, requiredConfirmations: [] });
  });

  it('offers only the deposit once the quotation is accepted, and still no custom amount', () => {
    const accepted = snapshot('Quotation', { 'Quotation Accepted': true });
    expect(accepted.quotation.accepted).toBe(true);
    expect(accepted.capabilities.acceptQuotation).toBe(false);
    expect(accepted.payments?.items.filter((item) => item.canPay).map((item) => item.label)).toEqual(['Deposit Payment']);
    expect(accepted.payments?.customPayments.enabled).toBe(false);
    expect(accepted.capabilities.makePayment).toBe(true);
  });

  it('offers normal and custom payments once booked', () => {
    const booked = snapshot('Confirmed');
    expect(booked.payments?.items.every((item) => item.canPay)).toBe(true);
    expect(booked.payments?.customPayments.enabled).toBe(true);
    expect(booked.capabilities.makePayment).toBe(true);
  });

  it('offers nothing on expired quotations', () => {
    const expired = snapshot('Quotation', { 'Quotation Expiry': '2020-01-01', 'Quotation Accepted': true });
    expect(expired.stage).toBe('quote_expired');
    expect(expired.capabilities.makePayment).toBe(false);
    expect(expired.payments?.items.some((item) => item.canPay)).toBe(false);
  });
});
