import { ForbiddenException } from '@nestjs/common';
import { buildAcceptanceReceipt, buildCalendar, buildDocument, TripActionsController } from './trip-actions.controller.js';

describe('calendar export', () => {
  it('creates an iCalendar event without exposing Airtable ids', () => {
    const calendar = buildCalendar({
      tripId: 'trp_public',
      summary: { name: 'Lisbon Escape' },
      itinerary: [{
        id: 'itm_public', title: 'London to Lisbon', typeLabel: 'Flight', startDate: '2027-03-01', endDate: '2027-03-01',
        startTime: '10:30', endTime: '13:10', from: 'London', to: 'Lisbon', reference: 'ABC123', notes: null, address: null,
      }],
    } as never);
    expect(calendar).toContain('BEGIN:VCALENDAR');
    expect(calendar).toContain('SUMMARY:London to Lisbon');
    expect(calendar).toContain('DTSTART:20270301T103000');
    expect(calendar).not.toContain('recABCDEFGHIJKLMN');
  });
});

describe('generated documents', () => {
  it('escapes customer content in printable confirmation HTML', () => {
    const html = buildDocument({
      summary: { name: '<script>alert(1)</script>', reference: 'VT-1' }, brand: { name: 'Example Travel' }, stage: 'confirmed',
      itinerary: [], protection: { summary: 'See confirmation.' }, serverTime: '2026-11-06T10:00:00Z',
    } as never, 'confirmation');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('creates an acceptance receipt from durable evidence', () => {
    const html = buildAcceptanceReceipt({
      summary: { name: 'Lisbon Escape', reference: 'VT-2' }, brand: { name: 'Example Travel' },
      quotation: { reviewSections: [{ id: 'package', title: 'What you are booking', introduction: 'Check your trip.' }] },
    } as never, {
      acceptedAt: '2026-11-06T12:00:00Z', name: 'Alex Traveller', email: 'alex@example.com', ip: '127.0.0.1',
      userAgent: 'test', snapshotVersion: 'v1', confirmations: ['package'], reference: 'VT-2',
    });
    expect(html).toContain('Quotation acceptance receipt');
    expect(html).toContain('Alex Traveller');
    expect(html).toContain('What you are booking');
  });
});

describe('quotation acceptance', () => {
  it('records acceptance fields and an audit comment without changing booking status', async () => {
    const sessions = { validateAccess: vi.fn().mockReturnValue({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false }) };
    const trips = { snapshot: vi.fn().mockResolvedValue({
      stage: 'quote', version: 'v1', summary: { reference: 'VT-1' }, support: { email: null }, payments: { items: [] }, quotation: { canAccept: true, requiredConfirmations: ['package', 'terms'] },
    }) };
    const airtable = { updateRecord: vi.fn().mockResolvedValue({}), addComment: vi.fn().mockResolvedValue(undefined) };
    const controller = new TripActionsController(sessions as never, trips as never, airtable as never, {} as never, { send: vi.fn().mockResolvedValue({ customer: "local_preview", agent: "not_configured" }) } as never, { create: vi.fn() } as never);

    const result = await controller.acceptQuotation('Bearer token', {
      name: 'Alex Traveller', email: 'alex@example.com', agreed: true,
      confirmations: ['package', 'terms'],
    }, { ip: '127.0.0.1', get: vi.fn().mockReturnValue('test-agent') } as never);

    expect(result.accepted).toBe(true);
    expect(airtable.updateRecord).toHaveBeenCalledWith('appABCDEFGHIJKLMN', 'Bookings', 'recABCDEFGHIJKLMN', expect.objectContaining({
      'Quotation Accepted': true,
      'Quotation Accepted By': 'Alex Traveller <alex@example.com>',
      'Quotation Accepted IP': '127.0.0.1',
    }));
    expect(airtable.updateRecord.mock.calls[0][3]).not.toHaveProperty('Status');
    expect(airtable.updateRecord.mock.calls[0][3]['Quotation Acceptance Evidence']).toContain('"confirmations":["package","terms"]');
    expect(airtable.addComment).toHaveBeenCalledOnce();
  });

  it('rejects acceptance by a fellow traveller before reading or writing Airtable', async () => {
    const sessions = { validateAccess: vi.fn().mockReturnValue({ fellowTraveller: true }) };
    const trips = { snapshot: vi.fn() };
    const airtable = { updateRecord: vi.fn(), addComment: vi.fn() };
    const controller = new TripActionsController(sessions as never, trips as never, airtable as never, {} as never, { send: vi.fn().mockResolvedValue({ customer: "local_preview", agent: "not_configured" }) } as never, { create: vi.fn() } as never);

    await expect(controller.acceptQuotation('Bearer token', {}, {} as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(trips.snapshot).not.toHaveBeenCalled();
    expect(airtable.updateRecord).not.toHaveBeenCalled();
  });
});

describe('customer messages', () => {
  it('adds a labelled booking comment for a fellow traveller', async () => {
    const sessions = { validateAccess: vi.fn().mockReturnValue({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: true }) };
    const airtable = { addComment: vi.fn().mockResolvedValue(undefined) };
    const controller = new TripActionsController(sessions as never, {} as never, airtable as never, {} as never, { send: vi.fn().mockResolvedValue({ customer: "local_preview", agent: "not_configured" }) } as never, { create: vi.fn() } as never);

    const result = await controller.sendMessage('Bearer token', { topic: 'documents', message: 'Please resend my travel documents.' });

    expect(result.sent).toBe(true);
    expect(airtable.addComment).toHaveBeenCalledWith(
      'appABCDEFGHIJKLMN', 'Bookings', 'recABCDEFGHIJKLMN',
      expect.stringMatching(/Customer question via Vision Trips · documents · fellow traveller[\s\S]*Please resend my travel documents\./),
    );
  });

  it('rejects short messages without writing a comment', async () => {
    const sessions = { validateAccess: vi.fn().mockReturnValue({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false }) };
    const airtable = { addComment: vi.fn() };
    const controller = new TripActionsController(sessions as never, {} as never, airtable as never, {} as never, { send: vi.fn().mockResolvedValue({ customer: "local_preview", agent: "not_configured" }) } as never, { create: vi.fn() } as never);

    await expect(controller.sendMessage('Bearer token', { topic: 'other', message: 'Hi' })).rejects.toThrow('between 10 and 800');
    expect(airtable.addComment).not.toHaveBeenCalled();
  });
});

describe('snapshot refresh', () => {
  it('reloads the trip using the session access scope', async () => {
    const sessions = { validateAccess: vi.fn().mockReturnValue({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: true }) };
    const trips = { snapshot: vi.fn().mockResolvedValue({ tripId: 'trp_public' }) };
    const controller = new TripActionsController(sessions as never, trips as never, {} as never, {} as never, { send: vi.fn().mockResolvedValue({ customer: "local_preview", agent: "not_configured" }) } as never, { create: vi.fn() } as never);

    await expect(controller.snapshot('Bearer token')).resolves.toEqual({ tripId: 'trp_public' });
    expect(trips.snapshot).toHaveBeenCalledWith('appABCDEFGHIJKLMN', 'recABCDEFGHIJKLMN', 'fellow_traveller');
  });
});

describe('payment links', () => {
  it('returns the current server-validated link for a payable item', async () => {
    const sessions = { validateAccess: vi.fn().mockReturnValue({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false }) };
    const trips = { snapshot: vi.fn().mockResolvedValue({ payments: { items: [{
      id: 'pay_public', amount: 250, currency: 'GBP', canPay: true, actionUrl: 'https://pay.example/secure',
    }] } }) };
    const controller = new TripActionsController(sessions as never, trips as never, {} as never, {} as never, { send: vi.fn().mockResolvedValue({ customer: "local_preview", agent: "not_configured" }) } as never, { create: vi.fn() } as never);

    await expect(controller.paymentLink('Bearer token', 'pay_public')).resolves.toEqual({
      paymentId: 'pay_public', url: 'https://pay.example/secure', amount: 250, currency: 'GBP',
    });
    expect(trips.snapshot).toHaveBeenCalledWith('appABCDEFGHIJKLMN', 'recABCDEFGHIJKLMN', 'primary_customer');
  });

  it('blocks payment links for fellow travellers', async () => {
    const sessions = { validateAccess: vi.fn().mockReturnValue({ fellowTraveller: true }) };
    const trips = { snapshot: vi.fn() };
    const controller = new TripActionsController(sessions as never, trips as never, {} as never, {} as never, { send: vi.fn().mockResolvedValue({ customer: "local_preview", agent: "not_configured" }) } as never, { create: vi.fn() } as never);

    await expect(controller.paymentLink('Bearer token', 'pay_public')).rejects.toBeInstanceOf(ForbiddenException);
    expect(trips.snapshot).not.toHaveBeenCalled();
  });

  it('rejects stale or already-paid payment actions', async () => {
    const sessions = { validateAccess: vi.fn().mockReturnValue({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false }) };
    const trips = { snapshot: vi.fn().mockResolvedValue({ payments: { items: [{ id: 'pay_public', canPay: false, actionUrl: null }] } }) };
    const controller = new TripActionsController(sessions as never, trips as never, {} as never, {} as never, { send: vi.fn().mockResolvedValue({ customer: "local_preview", agent: "not_configured" }) } as never, { create: vi.fn() } as never);

    await expect(controller.paymentLink('Bearer token', 'pay_public')).rejects.toThrow('no longer available');
  });
});

describe('fellow-traveller sharing', () => {
  it('mints a restricted link for the lead customer', async () => {
    const sessions = { validateAccess: vi.fn().mockReturnValue({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false }) };
    const trips = { snapshot: vi.fn().mockResolvedValue({ capabilities: { shareWithTraveller: true } }) };
    const tokens = { mintFellowTravellerLink: vi.fn().mockReturnValue('https://trips.example/trip/signed') };
    const controller = new TripActionsController(sessions as never, trips as never, {} as never, tokens as never, { send: vi.fn().mockResolvedValue({ customer: "local_preview", agent: "not_configured" }) } as never, { create: vi.fn() } as never);

    const result = await controller.fellowTravellerLink('Bearer token');

    expect(result.url).toBe('https://trips.example/trip/signed');
    expect(tokens.mintFellowTravellerLink).toHaveBeenCalledWith('appABCDEFGHIJKLMN', 'recABCDEFGHIJKLMN', expect.any(Number));
  });

  it('prevents fellow travellers from creating another share link', async () => {
    const sessions = { validateAccess: vi.fn().mockReturnValue({ fellowTraveller: true }) };
    const trips = { snapshot: vi.fn() };
    const tokens = { mintFellowTravellerLink: vi.fn() };
    const controller = new TripActionsController(sessions as never, trips as never, {} as never, tokens as never, { send: vi.fn().mockResolvedValue({ customer: "local_preview", agent: "not_configured" }) } as never, { create: vi.fn() } as never);

    await expect(controller.fellowTravellerLink('Bearer token')).rejects.toBeInstanceOf(ForbiddenException);
    expect(tokens.mintFellowTravellerLink).not.toHaveBeenCalled();
  });
});
