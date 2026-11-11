import type { MobileSession } from '@vision-trips/contracts';
import { parseTripSnapshot } from '../api/trip-schema';
import { SavedTripsStore } from './saved-trips.store';

function trustToken(baseId: string, recordId: string, expiresAt = Date.now() + 86_400_000, signature = 'sig'): string {
  const payload = btoa(JSON.stringify({ b: baseId, r: recordId, e: expiresAt })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${payload}.${signature}`;
}

const session = (refreshToken: string): MobileSession => ({ accessToken: 'vta_secret', accessExpiresAt: '2030-01-01T00:00:00.000Z', refreshToken, refreshExpiresAt: '2030-01-30T00:00:00.000Z' });
const snapshot = (tripId: string) => parseTripSnapshot({ schemaVersion: 3, tripId, stage: 'confirmed', accessScope: 'primary_customer', summary: { name: 'Trip', reference: 'REF' } });

/** The installed app's secure storage, backed by a map. */
function nativeStore(): SavedTripsStore {
  const values = new Map<string, unknown>();
  const store = new SavedTripsStore();
  Object.assign(store, {
    native: true,
    secure: {
      get: async (key: string) => values.get(key) ?? null,
      set: async (key: string, value: unknown) => { values.set(key, value); },
      remove: async (key: string) => values.delete(key),
    },
  });
  return store;
}

describe('SavedTripsStore in a browser', () => {
  afterEach(() => localStorage.clear());

  it('saves the trip with the cookie handle but never the access token', async () => {
    const store = new SavedTripsStore();
    expect(await store.save(snapshot('trp_1'), session('web:handle123456789012'))).toBe(true);

    const [saved] = await store.all();
    expect(saved.snapshot.tripId).toBe('trp_1');
    expect(saved.session?.refreshToken).toBe('web:handle123456789012');
    expect(saved.session?.accessToken).toBe('');
    expect(JSON.stringify(saved)).not.toContain('vta_secret');
  });

  it('refuses to write a raw refresh token to browser storage', async () => {
    const store = new SavedTripsStore();
    expect(await store.save(snapshot('trp_1'), session('vrt_raw'))).toBe(false);
    expect(await store.all()).toEqual([]);
  });

  it('keeps no trusted-device tokens and clears tokens left by older versions', async () => {
    localStorage.setItem('vision-trips:device-trust', trustToken('app1', 'recA'));
    localStorage.setItem('vision-trips:trip:trp_1', JSON.stringify({ snapshot: snapshot('trp_1'), session: session('vrt_raw') }));
    localStorage.setItem('vision-trips:trip:index', '["trp_1"]');
    localStorage.setItem('vision-trips:appearance', 'dark');
    const store = new SavedTripsStore();

    await store.saveDeviceTrust(trustToken('app1', 'recB'));
    expect(await store.deviceTrusts()).toEqual([]);
    expect(await store.all()).toEqual([]);
    expect(Object.keys(localStorage)).toEqual(['vision-trips:appearance']);
  });
});

describe('SavedTripsStore sign-out', () => {
  it('forgets an unusable credential but keeps the trip for offline viewing', async () => {
    const store = nativeStore();
    await store.save(snapshot('trp_1'), session('vrt_raw'));

    await store.signOut('trp_1');

    expect(await store.all()).toEqual([expect.objectContaining({ snapshot: snapshot('trp_1'), session: null })]);
  });

  it('signs out trips whose refresh token has passed its expiry instead of deleting them', async () => {
    const store = nativeStore();
    await store.save(snapshot('trp_old'), { ...session('vrt_old'), refreshExpiresAt: '2020-01-01T00:00:00.000Z' });
    await store.save(snapshot('trp_new'), session('vrt_new'));

    const trips = await store.signOutExpired();

    expect(trips.map((trip) => [trip.snapshot.tripId, trip.session?.refreshToken ?? null])).toEqual([['trp_old', null], ['trp_new', 'vrt_new']]);
    expect((await store.all()).find((trip) => trip.snapshot.tripId === 'trp_old')?.session).toBeNull();
  });
});

describe('SavedTripsStore schema checks', () => {
  it('migrates an older saved trip once and saves it back', async () => {
    const store = nativeStore();
    const secure = (store as unknown as { secure: { set: (key: string, value: unknown) => Promise<void>; get: (key: string) => Promise<unknown> } }).secure;
    await secure.set('trip:index', ['trp_old']);
    await secure.set('trip:trp_old', { snapshot: { schemaVersion: 2, tripId: 'trp_old', stage: 'confirmed', accessScope: 'primary_customer', summary: { name: 'Old', reference: 'R' } }, session: session('vrt_old'), savedAt: '2026-01-01T00:00:00.000Z' });

    const [trip] = await store.all();

    expect(trip.snapshot.schemaVersion).toBe(3);
    expect(trip.snapshot.itinerary).toEqual([]);
    expect(((await secure.get('trip:trp_old')) as { snapshot: { schemaVersion: number } }).snapshot.schemaVersion).toBe(3);
  });

  it('removes saved trips this version cannot read and keeps the rest', async () => {
    const store = nativeStore();
    const secure = (store as unknown as { secure: { set: (key: string, value: unknown) => Promise<void>; get: (key: string) => Promise<unknown> } }).secure;
    await store.save(snapshot('trp_good'), session('vrt_good'));
    await secure.set('trip:index', ['trp_good', 'trp_future', 'trp_broken']);
    await secure.set('trip:trp_future', { snapshot: { schemaVersion: 9, tripId: 'trp_future' }, session: session('vrt_f'), savedAt: '2026-01-01T00:00:00.000Z' });
    await secure.set('trip:trp_broken', { snapshot: { schemaVersion: 3 }, session: session('vrt_b'), savedAt: '2026-01-01T00:00:00.000Z' });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const trips = await store.all();

    expect(trips.map((trip) => trip.snapshot.tripId)).toEqual(['trp_good']);
    expect(await secure.get('trip:index')).toEqual(['trp_good']);
    expect(await secure.get('trip:trp_future')).toBeNull();
  });
});

describe('SavedTripsStore removal', () => {
  it('ignores a save that finishes after the trip was removed, whichever order they start in', async () => {
    for (const order of ['save-first', 'remove-first'] as const) {
      const store = nativeStore();
      await store.save(snapshot('trp_1'), session('vrt_1'));
      const late = order === 'save-first'
        ? [store.save(snapshot('trp_1'), session('vrt_2')), store.remove('trp_1')]
        : [store.remove('trp_1'), store.save(snapshot('trp_1'), session('vrt_2'))];

      await Promise.all(late);

      expect(await store.all()).toEqual([]);
      expect(store.wasRemoved('trp_1')).toBe(true);
    }
  });

  it('brings a removed trip back only when it is opened again', async () => {
    const store = nativeStore();
    await store.save(snapshot('trp_1'), session('vrt_1'));
    await store.remove('trp_1');

    expect(await store.save(snapshot('trp_1'), session('vrt_2'))).toBe(false);
    expect(await store.save(snapshot('trp_1'), session('vrt_3'), { reopened: true })).toBe(true);

    expect((await store.all()).map((trip) => trip.session?.refreshToken)).toEqual(['vrt_3']);
    expect(store.wasRemoved('trp_1')).toBe(false);
  });

  it('keeps the native index consistent when several trips are saved at once', async () => {
    const store = nativeStore();
    await Promise.all(['a', 'b', 'c', 'd'].map((id) => store.save(snapshot(`trp_${id}`), session(`vrt_${id}`))));
    expect((await store.all()).map((trip) => trip.snapshot.tripId).sort()).toEqual(['trp_a', 'trp_b', 'trp_c', 'trp_d']);
  });
});

describe('SavedTripsStore in the installed app', () => {
  it('remembers one trust token per booking and replaces an older one for the same booking', async () => {
    const store = nativeStore();
    const first = trustToken('app1', 'recA', Date.now() + 1_000, 'old');
    const second = trustToken('app1', 'recB');
    const renewed = trustToken('app1', 'recA', Date.now() + 86_400_000, 'new');

    await store.saveDeviceTrust(first);
    await store.saveDeviceTrust(second);
    await store.saveDeviceTrust(renewed);

    expect(await store.deviceTrusts()).toEqual([renewed, second]);
  });

  it('keeps the whole session in secure storage', async () => {
    const store = nativeStore();
    await store.save(snapshot('trp_1'), session('vrt_raw'));
    const [saved] = await store.all();
    expect(saved.session).toEqual(session('vrt_raw'));
  });
});
