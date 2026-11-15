import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AirtableService, type AirtableRecord } from '../airtable/airtable.service.js';
import { TripsService } from './trips.service.js';

/**
 * A failed Airtable request for linked records must never look like a trip with no payments or no itinerary: required
 * tables fail the request (the app keeps its saved copy), optional enrichment marks the snapshot `partial`.
 */
describe('TripsService.snapshot when linked Airtable reads fail', () => {
  const base = 'appABCDEFGHIJKLMN';
  const id = (n: number) => `rec${String(n).padStart(14, '0')}`;
  const booking: AirtableRecord = {
    id: id(1), createdTime: '2026-11-01T10:00:00.000Z',
    fields: { Status: 'Confirmed', Members: [id(2)], 'Bookings [Elements]': [id(3)], 'Bookings [Payments]': [id(4)], 'Customers [People]': [id(5)], Customers: [id(6)], 'Bookings [Upsells]': [id(7)], 'Bookings [Customer Communication]': [id(8)] },
  };

  beforeEach(() => { process.env.VISION_LINK_SECRET = 'snapshot-secret'; process.env.AIRTABLE_TOKEN = 'test-token'; process.env.AIRTABLE_MIN_REQUEST_INTERVAL_MS = '0'; process.env.AIRTABLE_MAX_ATTEMPTS = '1'; });
  afterEach(() => vi.restoreAllMocks());

  /** A real AirtableService whose list() fails for the given tables. */
  function airtableFailing(...failing: string[]) {
    const airtable = new AirtableService();
    vi.spyOn(airtable, 'record').mockResolvedValue(booking);
    vi.spyOn(airtable, 'list').mockImplementation(async (_base, table, options) => {
      if (failing.includes(table)) throw new ServiceUnavailableException('Airtable is temporarily unavailable. Try again shortly.');
      const ids = [...(options?.filterByFormula ?? '').matchAll(/RECORD_ID\(\)='(rec[A-Za-z0-9]{14})'/g)].map((match) => match[1]);
      return ids.map((recordId) => ({ id: recordId, fields: table === 'Bookings [Payments]' ? { Amount: 100, Status: 'Complete', 'Customer Payment Type': 'Deposit Payment' } : { Name: recordId } }));
    });
    return airtable;
  }

  it.each(['Bookings [Elements]', 'Bookings [Payments]', 'Customers [People]', 'Customers'])('fails instead of returning an empty section when %s cannot be read', async (table) => {
    await expect(new TripsService(airtableFailing(table)).snapshot(base, booking.id, 'primary_customer')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('is fresh when every linked read succeeds', async () => {
    const snapshot = await new TripsService(airtableFailing()).snapshot(base, booking.id, 'primary_customer');
    expect(snapshot.freshness.status).toBe('fresh');
    expect(snapshot.freshness.incompleteSections).toBeUndefined();
  });

  it('marks the snapshot partial, naming what is missing, when only enrichment fails', async () => {
    const snapshot = await new TripsService(airtableFailing('Bookings [Upsells]', 'Bookings [Customer Communication]', 'Members')).snapshot(base, booking.id, 'primary_customer');
    expect(snapshot.freshness.status).toBe('partial');
    expect(snapshot.freshness.incompleteSections).toEqual(['extras', 'messages', 'agent']);
    // Retried sooner than a complete snapshot (five minutes).
    expect(Date.parse(snapshot.freshness.nextRefreshAfter!) - Date.parse(snapshot.serverTime)).toBe(60_000);
    expect(snapshot.payments?.items).toHaveLength(1);
  });

  it('leaves out a whole section, not just the chunk that failed', async () => {
    const messages = Array.from({ length: 40 }, (_, index) => id(100 + index));
    let failChunk = true;
    const airtable = new AirtableService();
    vi.spyOn(airtable, 'record').mockResolvedValue({ ...booking, fields: { ...booking.fields, 'Bookings [Customer Communication]': messages } });
    vi.spyOn(airtable, 'list').mockImplementation(async (_base, table, options) => {
      const ids = [...(options?.filterByFormula ?? '').matchAll(/RECORD_ID\(\)='(rec[A-Za-z0-9]{14})'/g)].map((match) => match[1]);
      // The second chunk of messages (records 31–40) fails; the first 30 load.
      if (failChunk && table === 'Bookings [Customer Communication]' && ids.includes(messages[35])) throw new ServiceUnavailableException('Airtable is temporarily unavailable. Try again shortly.');
      return ids.map((recordId) => ({ id: recordId, fields: table === 'Bookings [Payments]' ? { Amount: 100, Status: 'Complete', 'Customer Payment Type': 'Deposit Payment' } : { Name: recordId, Subject: `Update ${recordId.slice(-3)}`, Sent: true } }));
    });
    const snapshot = await new TripsService(airtable).snapshot(base, booking.id, 'primary_customer');
    expect(snapshot.freshness.incompleteSections).toEqual(['messages']);
    expect(snapshot.communications).toEqual([]);
    failChunk = false; // Control: with both chunks loaded, the latest 20 messages are shown.
    expect((await new TripsService(airtable).snapshot(base, booking.id, 'primary_customer')).communications).toHaveLength(20);
  });

  it('marks the Brand (and its letters) incomplete when the Brand record cannot be read, instead of publishing default branding as fresh', async () => {
    const branded: AirtableRecord = { ...booking, fields: { ...booking.fields, 'Brands & Branches': [id(9)] } };
    const airtable = airtableFailing();
    const brandRead = vi.spyOn(airtable, 'record').mockImplementation(async (_base, table) => {
      if (table === 'Brands & Branches') throw new ServiceUnavailableException('Airtable is temporarily unavailable. Try again shortly.');
      return branded;
    });

    const snapshot = await new TripsService(airtable).snapshot(base, branded.id, 'primary_customer');
    expect(snapshot.freshness.status).toBe('partial');
    expect(snapshot.freshness.incompleteSections).toEqual(['brand', 'letters']);

    // A Brand record that no longer exists is not an outage: default branding, and the trip is fresh.
    brandRead.mockImplementation(async (_base, table) => { if (table === 'Brands & Branches') throw new NotFoundException(); return branded; });
    const missing = await new TripsService(airtable).snapshot(base, branded.id, 'primary_customer');
    expect(missing.freshness.status).toBe('fresh');
    expect(missing.brand.name).toBe('Your travel company');
  });
});
