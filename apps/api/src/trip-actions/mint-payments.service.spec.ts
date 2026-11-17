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
    const trips = { snapshot: vi.fn().mockResolvedValue({ tripId, stage: 'confirmed', quotation: { accepted: false }, summary: { reference: 'VT-1', returnDate: '2027-01-01' }, payments: { currency: 'GBP', items: [{ id: paymentId, label: 'Deposit', amount: 250, currency: 'GBP', canPay: true, status: 'outstanding', actionUrl: null }] } }) };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ payment_link: { id: 'plink-1', url: 'https://secure.mintpayments.com/pay/1' } }), { status: 200 }));
    const service = new MintPaymentsService(airtable as never, trips as never);

    await expect(service.link('appABCDEFGHIJKLMN', booking.id, paymentId)).resolves.toMatchObject({ url: 'https://secure.mintpayments.com/pay/1', amount: 250 });
    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(typeof request?.body).toBe('string');
    expect(JSON.parse(request?.body as string)).toMatchObject({ webhook_url: 'https://airtable.com/app/webhook', amount: '250.00', booking: 'BK.123' });
    expect(airtable.records).toHaveBeenCalledWith('appABCDEFGHIJKLMN', 'Bookings [Payments]', [paymentRecordId]);
  });

  it('returns a stored payment link without reading Mint settings from Airtable', async () => {
    const airtable = { record: vi.fn(), records: vi.fn() };
    const trips = { snapshot: vi.fn().mockResolvedValue({ tripId: 'trp_public', stage: 'countdown', quotation: { accepted: false }, payments: { currency: 'GBP', items: [{ id: 'pay_1', label: 'Balance', amount: 498, currency: 'GBP', canPay: true, status: 'outstanding', actionUrl: 'https://pay.example/balance' }] } }) };
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const service = new MintPaymentsService(airtable as never, trips as never);

    await expect(service.link('appABCDEFGHIJKLMN', 'recBOOKINGABCDEFG', 'pay_1')).resolves.toEqual({ paymentId: 'pay_1', url: 'https://pay.example/balance', amount: 498, currency: 'GBP' });
    expect(airtable.record).not.toHaveBeenCalled();
    expect(airtable.records).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe('a quotation cannot bypass acceptance', () => {
    const quote = (accepted: boolean) => ({
      tripId: 'trp_public', stage: 'quote', quotation: { accepted }, summary: { reference: 'VT-1', returnDate: '2027-01-01' },
      // Even a stale or crafted snapshot offering "Pay now" on the quote is refused by the stage check.
      payments: { currency: 'GBP', items: [{ id: 'pay_1', label: 'Deposit', amount: 250, currency: 'GBP', canPay: true, status: 'outstanding', actionUrl: 'https://pay.example/deposit' }], customPayments: { enabled: true, minimum: 0.01, maximum: 5000 } },
    });
    const booking = { id: 'recBOOKINGABCDEFG', fields: { 'Brands & Branches': ['recBRANDABCDEFGHI'], 'Bookings [Payments]': [], 'Mint | Booking ID': 'BK.123' } };
    const airtable = () => ({ record: vi.fn(async (_base: string, table: string) => table === 'Bookings' ? booking : { id: 'recBRANDABCDEFGHI', fields: { 'Mint | API Key': 'k', 'Mint | Business Unit': 'u', 'Webhook URL': 'https://airtable.com/hook' } }), records: vi.fn().mockResolvedValue([]) });

    it('refuses a scheduled payment on an unaccepted quotation', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const service = new MintPaymentsService(airtable() as never, { snapshot: vi.fn().mockResolvedValue(quote(false)) } as never);
      await expect(service.link('appABCDEFGHIJKLMN', booking.id, 'pay_1')).rejects.toMatchObject({ status: 403 });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('refuses a custom amount on a quotation, accepted or not', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      for (const accepted of [false, true]) {
        const service = new MintPaymentsService(airtable() as never, { snapshot: vi.fn().mockResolvedValue(quote(accepted)) } as never);
        await expect(service.link('appABCDEFGHIJKLMN', booking.id, 'custom', 100)).rejects.toMatchObject({ status: 403 });
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('gives no deposit link before acceptance, and the deposit once accepted', async () => {
      const unaccepted = new MintPaymentsService(airtable() as never, { snapshot: vi.fn().mockResolvedValue(quote(false)) } as never);
      await expect(unaccepted.depositLink('appABCDEFGHIJKLMN', booking.id)).resolves.toBeNull();
      const accepted = new MintPaymentsService(airtable() as never, { snapshot: vi.fn().mockResolvedValue(quote(true)) } as never);
      await expect(accepted.link('appABCDEFGHIJKLMN', booking.id, 'pay_1')).resolves.toMatchObject({ url: 'https://pay.example/deposit' });
    });
  });

  describe('deposit chosen at acceptance', () => {
    const BASE = 'appABCDEFGHIJKLMN';
    const booking = { id: 'recBOOKINGABCDEFG', createdTime: '2026-11-01T00:00:00.000Z', fields: { Status: 'Quotation', 'Quotation Accepted': true, 'Departure Date': '2027-05-01', 'Return Date': '2027-05-08', 'Total Price': 3000, 'MS Paid': 0, 'MS Outstanding': 3000, 'Brands & Branches': ['recBRANDABCDEFGHI'], 'Mint | Booking ID': 'BK.123', 'Bookings [Payments]': [] as string[] } };
    const brand = { id: 'recBRANDABCDEFGHI', fields: { 'Mint | API Key': 'k', 'Mint | Business Unit': 'u', 'Webhook URL': 'https://airtable.com/hook' } };
    const scheme = { id: 'recPAYSCHEMEAAAAA', fields: { 'Payment Type': 'Loyalty Redemption', 'Customer Payment Type': 'Deposit', Amount: 150, Status: 'Outstanding', 'Date Due': '2026-11-20' } };
    const points = { id: 'recPAYPOINTSAAAAA', fields: { 'Payment Type': 'Customer Payment', Method: 'Loyalty Redemption', 'Customer Payment Type': 'Deposit (points)', Amount: 25, Status: 'Outstanding', 'Date Due': '2026-11-21' } };
    const deposit = { id: 'recPAYDEPOSITAAAA', fields: { 'Payment Type': 'Customer Payment', 'Customer Payment Type': 'Deposit Payment', Amount: 300, Status: 'Outstanding', 'Date Due': '2026-12-01' } };
    async function depositFor(rows: Array<{ id: string; fields: Record<string, unknown> }>) {
      process.env.VISION_LINK_SECRET = 'snapshot-secret';
      const { TripsService } = await import('../trips/trips.service.js');
      const snapshot = new TripsService({} as never).mapSnapshot(BASE, { ...booking, fields: { ...booking.fields, 'Bookings [Payments]': rows.map((row) => row.id) } } as never, brand as never, 'primary_customer', { payments: rows } as never);
      const airtable = { record: vi.fn(async (_base: string, table: string) => table === 'Bookings' ? { ...booking, fields: { ...booking.fields, 'Bookings [Payments]': rows.map((row) => row.id) } } : brand), records: vi.fn().mockResolvedValue(rows) };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ payment_link: { url: 'https://secure.mintpayments.com/pay/dep' } }), { status: 200 }));
      const url = await new MintPaymentsService(airtable as never, { snapshot: vi.fn().mockResolvedValue(snapshot) } as never).depositLink(BASE, booking.id);
      return { url, fetchSpy };
    }

    it('skips scheme-funding and points rows listed before the real deposit', async () => {
      const { url, fetchSpy } = await depositFor([scheme, points, deposit]);
      expect(url).toBe('https://secure.mintpayments.com/pay/dep');
      expect(JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string)).toMatchObject({ amount: '300.00', customer_reference: 'NWG-1 Deposit Payment'.replace('NWG-1', 'Your trip') });
    });

    it('creates no link when only loyalty rows exist', async () => {
      const { url, fetchSpy } = await depositFor([scheme, points]);
      expect(url).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
