import type { MobileSession, TripSnapshot } from '@vision-trips/contracts';
import { SavedTripsStore } from './saved-trips.store';

function trustToken(baseId: string, recordId: string, expiresAt = Date.now() + 86_400_000, signature = 'sig'): string {
  const payload = btoa(JSON.stringify({ b: baseId, r: recordId, e: expiresAt })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${payload}.${signature}`;
}

const session = (refreshToken: string): MobileSession => ({ accessToken: 'vta_secret', accessExpiresAt: '2030-01-01T00:00:00.000Z', refreshToken, refreshExpiresAt: '2030-01-30T00:00:00.000Z' });
const snapshot = (tripId: string) => ({ tripId }) as TripSnapshot;

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
    expect(saved.session.refreshToken).toBe('web:handle123456789012');
    expect(saved.session.accessToken).toBe('');
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
