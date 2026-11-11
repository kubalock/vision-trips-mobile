import { SavedTripsStore } from './saved-trips.store';

function trustToken(baseId: string, recordId: string, expiresAt = Date.now() + 86_400_000, signature = 'sig'): string {
  const payload = btoa(JSON.stringify({ b: baseId, r: recordId, e: expiresAt })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${payload}.${signature}`;
}

describe('SavedTripsStore device trust', () => {
  afterEach(() => localStorage.clear());

  it('remembers one token per booking instead of overwriting', async () => {
    const store = new SavedTripsStore();
    const first = trustToken('app1', 'recA');
    const second = trustToken('app1', 'recB');

    await store.saveDeviceTrust(first);
    await store.saveDeviceTrust(second);

    expect(await store.deviceTrusts()).toEqual([second, first]);
  });

  it('replaces an older token for the same booking', async () => {
    const store = new SavedTripsStore();
    await store.saveDeviceTrust(trustToken('app1', 'recA', Date.now() + 1_000, 'old'));
    const renewed = trustToken('app1', 'recA', Date.now() + 86_400_000, 'new');

    await store.saveDeviceTrust(renewed);

    expect(await store.deviceTrusts()).toEqual([renewed]);
  });

  it('reads a single token saved by an older version and drops expired ones', async () => {
    const legacy = trustToken('app1', 'recA');
    localStorage.setItem('vision-trips:device-trust', legacy);
    const store = new SavedTripsStore();
    expect(await store.deviceTrusts()).toEqual([legacy]);

    localStorage.setItem('vision-trips:device-trust', JSON.stringify([trustToken('app1', 'recA', Date.now() - 1)]));
    expect(await store.deviceTrusts()).toEqual([]);
  });
});
