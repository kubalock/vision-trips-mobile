import type { NotificationBasis } from '@vision-trips/contracts';
import { checkTrips, configure, drain, type WatchHost, type WatchedTrip } from './trip-watch';

const TODAY = new Date(2026, 10, 20, 9, 0);

function basis(overrides: Partial<NotificationBasis> = {}): NotificationBasis {
  return {
    tripId: 'trp_one', version: 'v1', awaitingAcceptance: false, departureDate: '2027-06-01', tripName: 'Danube cruise',
    payments: { currency: 'GBP', balance: 1500, items: [{ id: 'pay_deposit', label: 'Deposit', status: 'outstanding', dueDate: '2027-01-10', completedDate: null }] },
    documents: [{ id: 'doc_confirmation', title: 'Booking confirmation', status: 'pending', version: 'd1' }],
    ...overrides,
  };
}

function watched(overrides: Partial<WatchedTrip> = {}): WatchedTrip {
  return { tripId: 'trp_one', apiBase: 'https://api.example.com/v1', watchToken: 'vtw_one', basis: basis(), knownIds: [], ...overrides };
}

function host(responses: Record<string, { status: number; body?: unknown } | Error>) {
  const kv = new Map<string, string>();
  const shown: Array<{ id: number; title: string; body: string; tripId: string }> = [];
  const requests: Array<{ url: string; authorization: string }> = [];
  const headers: Array<Record<string, string>> = [];
  const value: WatchHost = {
    get: (key) => kv.get(key) ?? null,
    set: (key, item) => { kv.set(key, item); },
    fetch: async (url, init) => {
      const token = init.headers['Authorization'].replace('Watch ', '');
      requests.push({ url, authorization: init.headers['Authorization'] });
      headers.push(init.headers);
      const response = responses[token];
      if (!response || response instanceof Error) throw response ?? new Error('offline');
      return { status: response.status, json: async () => response.body };
    },
    notify: (items) => { shown.push(...items); },
    now: () => TODAY,
  };
  return { value, kv, shown, requests, headers, trips: () => (JSON.parse(kv.get('trip-watch:configuration') ?? '{}') as { trips: WatchedTrip[] }).trips };
}

describe('background trip check', () => {
  it('shows what changed since the trip was last seen, using the watch token, and hands it to the app once', async () => {
    const paid = basis({ version: 'v2', payments: { currency: 'GBP', balance: 1000, items: [{ id: 'pay_deposit', label: 'Deposit', status: 'paid', dueDate: '2027-01-10', completedDate: '2026-11-19' }] }, documents: [{ id: 'doc_confirmation', title: 'Booking confirmation', status: 'ready', version: 'd2' }] });
    const device = host({ vtw_one: { status: 200, body: paid } });
    configure(device.value, { enabled: true, trips: [watched()] });

    await checkTrips(device.value);

    expect(device.requests).toEqual([{ url: 'https://api.example.com/v1/trips/current/watch', authorization: 'Watch vtw_one' }]);
    expect(device.shown.map((item) => item.title)).toEqual(['Payment received', 'Document ready']);
    expect(device.shown[0].body).toBe('Deposit has been received. Your balance is now £1,000.00.');
    expect(device.trips()[0].basis.version).toBe('v2');
    const handedOver = drain(device.value);
    expect(handedOver.map((item) => item.id)).toEqual(['payment_received:payment:pay_deposit:2026-11-19', 'documents_ready:documents:doc_confirmation:d2']);
    expect(handedOver[0]).toMatchObject({ tripId: 'trp_one', kind: 'payment_received' });
    expect(drain(device.value)).toEqual([]);

    // Nothing new next time: the same change is never shown twice.
    await checkTrips(device.value);
    expect(device.shown).toHaveLength(2);
  });

  it('never shows a notification the app already recorded, such as a departure reminder', async () => {
    const soon = basis({ departureDate: '2026-12-10' });
    const device = host({ vtw_one: { status: 200, body: soon } });
    configure(device.value, { enabled: true, trips: [watched({ basis: soon, knownIds: ['departure_reminder:departure:2026-12-10:30'] })] });

    await checkTrips(device.value);

    expect(device.shown).toEqual([]);
  });

  it('records but does not show notifications when they are turned off on the device', async () => {
    const ready = basis({ version: 'v2', documents: [{ id: 'doc_confirmation', title: 'Booking confirmation', status: 'ready', version: 'd2' }] });
    const device = host({ vtw_one: { status: 200, body: ready } });
    configure(device.value, { enabled: false, trips: [watched()] });

    await checkTrips(device.value);

    expect(device.shown).toEqual([]);
    expect(drain(device.value).map((item) => item.title)).toEqual(['Document ready']);
  });

  it('stops following a trip whose session ended, and keeps the others going when one is unreachable', async () => {
    const changed = basis({ tripId: 'trp_three', version: 'v2', documents: [{ id: 'doc_confirmation', title: 'Booking confirmation', status: 'ready', version: 'd2' }] });
    const device = host({ vtw_one: { status: 401 }, vtw_two: new Error('offline'), vtw_three: { status: 200, body: changed } });
    configure(device.value, { enabled: true, trips: [watched(), watched({ tripId: 'trp_two', watchToken: 'vtw_two', basis: basis({ tripId: 'trp_two' }) }), watched({ tripId: 'trp_three', watchToken: 'vtw_three', basis: basis({ tripId: 'trp_three' }) })] });

    await checkTrips(device.value);

    expect(device.trips().map((trip) => trip.tripId)).toEqual(['trp_two', 'trp_three']);
    expect(device.shown.map((item) => item.tripId)).toEqual(['trp_three']);
  });

  it('ignores answers for another trip and malformed configuration', async () => {
    const device = host({ vtw_one: { status: 200, body: basis({ tripId: 'trp_other', version: 'v9', documents: [{ id: 'doc_confirmation', title: 'Booking confirmation', status: 'ready', version: 'd9' }] }) } });
    configure(device.value, { enabled: true, trips: [watched(), { tripId: 'trp_bad', apiBase: 'javascript:alert(1)', watchToken: 'vtw_bad', basis: basis(), knownIds: [] }, null] });

    await checkTrips(device.value);

    expect(device.trips().map((trip) => trip.tripId)).toEqual(['trp_one']);
    expect(device.trips()[0].basis.version).toBe('v1');
    expect(device.shown).toEqual([]);
  });

  it('sends the app version headers it was given, and nothing else from the app', async () => {
    const device = host({ vtw_one: { status: 426, body: { code: 'app_update_required' } } });
    configure(device.value, { enabled: true, trips: [watched()], client: { 'X-Vision-App-Version': '1.0.0', 'X-Vision-Platform': 'android', Authorization: 'Bearer stolen', Cookie: 'x' } });

    await checkTrips(device.value);

    expect(device.headers[0]).toEqual({ 'X-Vision-App-Version': '1.0.0', 'X-Vision-Platform': 'android', Authorization: 'Watch vtw_one', Accept: 'application/json' });
    // An outdated app's check is refused: nothing is shown and the trip is kept for after the update.
    expect(device.shown).toEqual([]);
    expect(device.trips().map((trip) => trip.tripId)).toEqual(['trp_one']);
  });

  it('keeps a newer trip list the app sent while a check was running', async () => {
    const device = host({});
    configure(device.value, { enabled: true, trips: [watched()] });
    device.value.fetch = async () => {
      configure(device.value, { enabled: true, trips: [watched({ tripId: 'trp_new', watchToken: 'vtw_new', basis: basis({ tripId: 'trp_new' }) })] });
      return { status: 200, json: async () => basis({ version: 'v2' }) };
    };

    await checkTrips(device.value);

    expect(device.trips().map((trip) => trip.tripId)).toEqual(['trp_new']);
  });
});
