import { ServiceUnavailableException } from '@nestjs/common';
import { AirtableService, type AirtableRecord } from '../airtable/airtable.service.js';
import { SNAPSHOT_CACHE_MS, TripsService } from './trips.service.js';

/** Fewer Airtable calls per refresh: shared reads, a short snapshot cache, and longer-lived Brand and reference records. */
describe('TripsService snapshot caching', () => {
  const base = 'appABCDEFGHIJKLMN';
  const id = (n: number) => `rec${String(n).padStart(14, '0')}`;
  const BRAND = id(9);
  const AIRPORT = id(10);
  const booking: AirtableRecord = {
    id: id(1), createdTime: '2026-11-01T10:00:00.000Z',
    fields: { Status: 'Confirmed', 'Brands & Branches': [BRAND], 'Bookings [Elements]': [id(3)], 'Bookings [Payments]': [id(4)], Customers: [id(6)] },
  };

  beforeEach(() => { process.env.VISION_LINK_SECRET = 'snapshot-secret'; process.env.AIRTABLE_TOKEN = 'test-token'; process.env.AIRTABLE_MIN_REQUEST_INTERVAL_MS = '0'; process.env.AIRTABLE_MAX_ATTEMPTS = '1'; });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  function fakeAirtable() {
    const state = { paymentStatus: 'Pending', failing: [] as string[] };
    const airtable = new AirtableService();
    const record = vi.spyOn(airtable, 'record').mockImplementation(async (_base, table, recordId) => table === 'Brands & Branches'
      ? { id: recordId, fields: { 'Brand Name': 'Sunway Travel' } }
      : booking);
    const list = vi.spyOn(airtable, 'list').mockImplementation(async (_base, table, options) => {
      if (state.failing.includes(table)) throw new ServiceUnavailableException('Airtable is temporarily unavailable. Try again shortly.');
      const ids = [...(options?.filterByFormula ?? '').matchAll(/RECORD_ID\(\)='(rec[A-Za-z0-9]{14})'/g)].map((match) => match[1]);
      return ids.map((recordId) => ({
        id: recordId,
        fields: table === 'Bookings [Payments]' ? { Amount: 100, Status: state.paymentStatus, 'Customer Payment Type': 'Deposit Payment' }
          : table === 'Bookings [Elements]' ? { Type: 'Flight', 'Dep. Airport Name': [AIRPORT] }
            : { Name: recordId },
      }));
    });
    const calls = (table: string) => [...record.mock.calls, ...list.mock.calls].filter((call) => call[1] === table).length;
    return { airtable, state, calls };
  }

  it('shares one set of Airtable reads between concurrent requests for the same trip and scope', async () => {
    const { airtable, calls } = fakeAirtable();
    const trips = new TripsService(airtable);
    const [first, second] = await Promise.all([trips.snapshot(base, booking.id, 'primary_customer'), trips.snapshot(base, booking.id, 'primary_customer')]);
    expect(second.tripId).toBe(first.tripId);
    expect(calls('Bookings')).toBe(1);
    // Another scope is another snapshot.
    await trips.snapshot(base, booking.id, 'fellow_traveller');
    expect(calls('Bookings')).toBe(2);
  });

  it('serves read endpoints a complete snapshot for 30 seconds, while actions still read Airtable', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { airtable, calls } = fakeAirtable();
    const trips = new TripsService(airtable);
    await trips.snapshot(base, booking.id, 'primary_customer');
    await trips.snapshot(base, booking.id, 'primary_customer', { maxAgeMs: SNAPSHOT_CACHE_MS });
    expect(calls('Bookings')).toBe(1);
    await trips.snapshot(base, booking.id, 'primary_customer'); // An action (payment, acceptance): always fresh.
    expect(calls('Bookings')).toBe(2);
    vi.setSystemTime(Date.now() + SNAPSHOT_CACHE_MS + 1);
    await trips.snapshot(base, booking.id, 'primary_customer', { maxAgeMs: SNAPSHOT_CACHE_MS });
    expect(calls('Bookings')).toBe(3);
  });

  it('forgets the cached snapshot after a write, and never caches a partial one', async () => {
    const { airtable, state, calls } = fakeAirtable();
    const trips = new TripsService(airtable);
    await trips.snapshot(base, booking.id, 'primary_customer');
    trips.invalidate(base, booking.id);
    await trips.snapshot(base, booking.id, 'primary_customer', { maxAgeMs: SNAPSHOT_CACHE_MS });
    expect(calls('Bookings')).toBe(2);

    trips.invalidate(base, booking.id);
    state.failing = ['Bookings [Upsells]', 'Members'];
    const partial = { ...booking, fields: { ...booking.fields, 'Bookings [Upsells]': [id(7)], Members: [id(2)] } };
    vi.spyOn(airtable, 'record').mockImplementation(async (_base, table, recordId) => table === 'Brands & Branches' ? { id: recordId, fields: {} } : partial);
    expect((await trips.snapshot(base, booking.id, 'primary_customer')).freshness.status).toBe('partial');
    expect((await trips.snapshot(base, booking.id, 'primary_customer', { maxAgeMs: SNAPSHOT_CACHE_MS })).freshness.status).toBe('partial');
    expect(calls('Bookings')).toBe(4); // Both partial reads went to Airtable.
  });

  it('drops the cached snapshot when a payment check sees a change, so the next refresh shows the payment', async () => {
    const { airtable, state, calls } = fakeAirtable();
    const trips = new TripsService(airtable);
    await trips.snapshot(base, booking.id, 'primary_customer');
    await trips.paymentStatus(base, booking.id); // Unchanged: the cached snapshot stays.
    await trips.snapshot(base, booking.id, 'primary_customer', { maxAgeMs: SNAPSHOT_CACHE_MS });
    expect(calls('Bookings')).toBe(2); // One for the snapshot, one for the payment check.

    state.paymentStatus = 'Complete';
    await trips.paymentStatus(base, booking.id);
    const refreshed = await trips.snapshot(base, booking.id, 'primary_customer', { maxAgeMs: SNAPSHOT_CACHE_MS });
    expect(calls('Bookings')).toBe(4);
    expect(refreshed.payments?.items[0].status).toBe('paid');
  });

  it('reuses the Brand and reference records (airports, airlines, …) across snapshots', async () => {
    const { airtable, calls } = fakeAirtable();
    const trips = new TripsService(airtable);
    const first = await trips.snapshot(base, booking.id, 'primary_customer');
    trips.invalidate(base, booking.id);
    const second = await trips.snapshot(base, booking.id, 'primary_customer');
    expect(calls('Bookings')).toBe(2);
    expect(calls('Brands & Branches')).toBe(1);
    expect(calls('CMS [Airports]')).toBe(1);
    expect(second.brand.name).toBe(first.brand.name);
    expect(second.itinerary[0].from).toBe(first.itinerary[0].from);
  });
});
