import { beforeAll, describe, expect, it } from 'vitest';
import type { TripSnapshot } from '@vision-trips/contracts';
import { currencyCode, formatMoney, moneyValue } from './field-map.js';
import { TripsService } from './trips.service.js';

const BASE = 'appABCDEFGHIJKLMN';
const brand = { id: 'recBRANDABCDEFGHI', fields: {} };
const payment = (id: string, fields: Record<string, unknown>) => ({ id, fields: { Status: 'Outstanding', 'Customer Payment Type': 'Balance', 'Payment Link URL': 'https://pay.example/x', ...fields } });

function snapshot(bookingFields: Record<string, unknown>, payments: Array<{ id: string; fields: Record<string, unknown> }> = []): TripSnapshot {
  const booking = { id: 'recABCDEFGHIJKLMN', createdTime: '2026-11-01T10:00:00.000Z', fields: { Status: 'Confirmed', 'Departure Date': '2027-03-01', 'Return Date': '2027-03-12', ...bookingFields } };
  return new TripsService({} as never).mapSnapshot(BASE, booking as never, brand as never, 'primary_customer', { payments } as never);
}

describe('payment money handling', () => {
  beforeAll(() => { process.env.VISION_LINK_SECRET ??= 'payments-money-test'; });

  it('reports missing booking totals as unavailable, not £0.00 or paid in full', () => {
    const result = snapshot({ 'Total Price': '', Currency: 'GBP' });
    expect(result.payments).toMatchObject({ total: null, paid: null, balance: null });
    expect(result.payments?.customPayments.enabled).toBe(false);
    const balanceStep = result.bookingJourney.steps.find((step) => step.id === 'balance');
    expect(balanceStep).toMatchObject({ done: false, description: 'Your travel agent will confirm your remaining balance.' });
  });

  it('gives an instalment without its own currency the booking currency, not GBP', () => {
    const result = snapshot({ Currency: 'EUR', 'Total Price': 1000, 'MS Paid': 0, 'MS Outstanding': 1000 }, [payment('recPAYMENTAAAAAAA', { 'EUR Amount': 250 })]);
    expect(result.payments?.items[0]).toMatchObject({ currency: 'EUR', amount: 250, canPay: true });
  });

  it('reads USD and EUR instalments from their own amount fields', () => {
    const result = snapshot({ Currency: 'GBP', 'Total Price': 1000 }, [
      payment('recPAYMENTUSDAAAA', { 'Mint: Currency': 'USD', Amount: 100, 'USD Amount': 127 }),
      payment('recPAYMENTUSDBBBB', { 'Mint: Currency': 'USD', Amount: 100 }),
    ]);
    const [withUsd, withoutUsd] = result.payments!.items;
    expect(withUsd).toMatchObject({ currency: 'USD', amount: 127, canPay: true });
    // The pound figure is never relabelled as dollars: the USD amount is unavailable and can't be paid.
    expect(withoutUsd).toMatchObject({ currency: 'USD', amount: null, canPay: false, actionUrl: null });
  });

  it('keeps other currencies as they are, but does not offer online payment for them', () => {
    const result = snapshot({ Currency: 'AUD', 'Total Price': 4200, 'MS Paid': 200, 'MS Outstanding': 4000 }, [payment('recPAYMENTAUDAAAA', { Amount: 4000 })]);
    expect(result.payments).toMatchObject({ currency: 'AUD', total: 4200, balance: 4000 });
    expect(result.payments?.items[0]).toMatchObject({ currency: 'AUD', amount: 4000, canPay: false });
  });

  it('makes figures unavailable when the currency is not a currency', () => {
    const result = snapshot({ Currency: 'Pounds', 'Total Price': 1000, 'MS Outstanding': 1000 }, [payment('recPAYMENTBADAAAA', { Amount: 100, 'Mint: Currency': '£' })]);
    expect(result.payments).toMatchObject({ total: null, balance: null });
    expect(result.payments?.items[0]).toMatchObject({ amount: null, canPay: false });
  });

  it('parses and formats money without inventing zeros', () => {
    expect(moneyValue('')).toBeNull();
    expect(moneyValue('n/a')).toBeNull();
    expect(moneyValue('£1,250.50')).toBe(1250.5);
    expect(moneyValue(0)).toBe(0);
    expect(currencyCode('aud')).toBe('AUD');
    expect(currencyCode('')).toBeUndefined();
    expect(currencyCode('XYZ1')).toBeNull();
    expect(formatMoney(null, 'GBP')).toBe('Unavailable');
    expect(formatMoney(12.5, 'EUR')).toBe('€12.50');
  });
});
