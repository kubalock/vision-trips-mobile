import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { MintPaymentsService } from './mint-payments.service.js';

describe('MintPaymentsService', () => {
  afterEach(() => { vi.restoreAllMocks(); process.env.VISION_LINK_SECRET = 'snapshot-secret'; });

  it('creates an on-demand Mint link with the brand Airtable webhook', async () => {
    process.env.VISION_LINK_SECRET = 'snapshot-secret';
    const tripId = 'trp_public';
    const paymentRecordId = 'recPAYMENTABCDEFG';
    const paymentId = `pay_${createHmac('sha256', 'snapshot-secret').update(`${tripId}|${paymentRecordId}`).digest('base64url').slice(0, 18)}`;
    const booking = { id: 'recBOOKINGABCDEFG', fields: { 'Brands & Branches': ['recBRANDABCDEFGHI'], 'Bookings [Payments]': [paymentRecordId], 'Mint | Booking ID': 'BK.123' } };
    const brand = { id: 'recBRANDABCDEFGHI', fields: { 'Mint | API Key': 'mint-secret', 'Mint | Business Unit': 'unit-1', 'Mint | Custom Payment Methods': ['CARD'], 'Webhook URL': 'https://airtable.com/app/webhook' } };
    const payment = { id: paymentRecordId, fields: {} };
    const airtable = { record: vi.fn(async (_base: string, table: string) => table === 'Bookings' ? booking : brand), records: vi.fn().mockResolvedValue([payment]) };
    const trips = { snapshot: vi.fn().mockResolvedValue({ tripId, summary: { reference: 'VT-1', returnDate: '2027-01-01' }, payments: { currency: 'GBP', items: [{ id: paymentId, label: 'Deposit', amount: 250, currency: 'GBP', canPay: true, status: 'outstanding', actionUrl: null }] } }) };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ payment_link: { id: 'plink-1', url: 'https://secure.mintpayments.com/pay/1' } }), { status: 200 }));
    const service = new MintPaymentsService(airtable as never, trips as never);

    await expect(service.link('appABCDEFGHIJKLMN', booking.id, paymentId)).resolves.toMatchObject({ url: 'https://secure.mintpayments.com/pay/1', amount: 250 });
    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(typeof request?.body).toBe('string');
    expect(JSON.parse(request?.body as string)).toMatchObject({ webhook_url: 'https://airtable.com/app/webhook', amount: '250.00', booking: 'BK.123' });
  });
});
