import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { VisionApiService } from '../api/vision-api.service';
import { SessionExpiredError, SessionManager } from './session-manager';
import { parseTripSnapshot } from '../api/trip-schema';
import { SavedTripsStore } from '../storage/saved-trips.store';

describe('SessionManager', () => {
  const future = () => new Date(Date.now() + 10 * 60_000).toISOString();
  const session = (name: string, accessExpiresAt = future()) => ({ accessToken: `${name}-access`, accessExpiresAt, refreshToken: `${name}-refresh`, refreshExpiresAt: future() });

  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }));
  afterEach(() => localStorage.clear());

  it('renews an expiring token before the request and reports the renewal', async () => {
    const manager = TestBed.inject(SessionManager);
    const renewed = vi.fn();
    manager.connect({ tripIdFor: () => undefined, renewed, expired: () => undefined });
    const fresh = session('new');
    vi.spyOn(TestBed.inject(VisionApiService), 'refreshSession').mockResolvedValue(fresh);
    manager.session.set(session('old', new Date(Date.now() + 5_000).toISOString()));

    const { result, session: used } = await manager.runWithSession(manager.session()!, async (token) => token);

    expect(result).toBe('new-access');
    expect(used.refreshToken).toBe('new-refresh');
    expect(manager.session()?.refreshToken).toBe('new-refresh');
    expect(renewed).toHaveBeenCalledWith({ previousRefreshToken: 'old-refresh', session: fresh, fromServer: true });
  });

  it('retries once after a 401 and then gives up', async () => {
    const manager = TestBed.inject(SessionManager);
    vi.spyOn(TestBed.inject(VisionApiService), 'refreshSession').mockResolvedValue(session('new'));
    const request = vi.fn().mockRejectedValue(new HttpErrorResponse({ status: 401 }));

    await expect(manager.run(session('old'), request)).rejects.toMatchObject({ status: 401 });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('retries a refused browser renewal once, since another tab may have just replaced the shared cookie', async () => {
    const manager = TestBed.inject(SessionManager);
    const fresh = { ...session('new'), refreshToken: 'web:handle' };
    const refresh = vi.spyOn(TestBed.inject(VisionApiService), 'refreshSession').mockRejectedValueOnce(new HttpErrorResponse({ status: 401 })).mockResolvedValueOnce(fresh);

    await expect(manager.renew({ ...session('old'), refreshToken: 'web:handle' })).resolves.toEqual(fresh);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not retry a refused renewal of an installed-app token', async () => {
    const manager = TestBed.inject(SessionManager);
    const refresh = vi.spyOn(TestBed.inject(VisionApiService), 'refreshSession').mockRejectedValue(new HttpErrorResponse({ status: 401 }));

    await expect(manager.renew(session('old'))).rejects.toBeInstanceOf(SessionExpiredError);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('reports a refused renewal once as SessionExpiredError and drops the open session', async () => {
    const manager = TestBed.inject(SessionManager);
    const expired = vi.fn();
    manager.connect({ tripIdFor: () => undefined, renewed: () => undefined, expired });
    vi.spyOn(TestBed.inject(VisionApiService), 'refreshSession').mockRejectedValue(new HttpErrorResponse({ status: 401 }));
    const dead = session('dead', new Date(Date.now() - 1_000).toISOString());
    manager.session.set(dead);

    const results = await Promise.allSettled([manager.run(dead, async () => 'x'), manager.run(dead, async () => 'y')]);

    for (const result of results) expect(result).toMatchObject({ status: 'rejected', reason: expect.any(SessionExpiredError) });
    expect(expired).toHaveBeenCalledOnce();
    expect(expired).toHaveBeenCalledWith('dead-refresh');
    expect(manager.session()).toBeNull();
  });

  it('does not call the server for a session whose refresh token has already expired', async () => {
    const manager = TestBed.inject(SessionManager);
    const refresh = vi.spyOn(TestBed.inject(VisionApiService), 'refreshSession');
    const old = { ...session('old', new Date(Date.now() - 1_000).toISOString()), refreshExpiresAt: new Date(Date.now() - 1_000).toISOString() };

    await expect(manager.forRequest(old)).rejects.toBeInstanceOf(SessionExpiredError);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps the session when renewal fails for another reason, such as being offline', async () => {
    const manager = TestBed.inject(SessionManager);
    const expired = vi.fn();
    manager.connect({ tripIdFor: () => undefined, renewed: () => undefined, expired });
    vi.spyOn(TestBed.inject(VisionApiService), 'refreshSession').mockRejectedValue(new HttpErrorResponse({ status: 0 }));
    const current = session('current', new Date(Date.now() - 1_000).toISOString());
    manager.session.set(current);

    await expect(manager.renew(current)).rejects.toMatchObject({ status: 0 });
    expect(expired).not.toHaveBeenCalled();
    expect(manager.session()).toEqual(current);
  });
});

describe('SessionManager across identities', () => {
  const future = () => new Date(Date.now() + 10 * 60_000).toISOString();
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }));

  it('never adopts a stored session that belongs to another Customer on the same trip', async () => {
    const manager = TestBed.inject(SessionManager);
    const store = TestBed.inject(SavedTripsStore);
    const values = new Map<string, unknown>();
    Object.assign(store, { native: true, secure: { get: async (key: string) => values.get(key) ?? null, set: async (key: string, value: unknown) => { values.set(key, value); }, remove: async (key: string) => values.delete(key) } });
    const snapshot = parseTripSnapshot({ schemaVersion: 3, tripId: 'trp_1', stage: 'confirmed', accessScope: 'primary_customer', summary: { name: 'Trip', reference: 'R' } });
    await store.save(snapshot, { accessToken: 'b', accessExpiresAt: future(), refreshToken: 'customer-b-refresh', refreshExpiresAt: future(), identityKey: 'idk_customerB' });
    manager.connect({ tripIdFor: () => 'trp_1', renewed: () => undefined, expired: () => undefined });
    const ours = { accessToken: 'a', accessExpiresAt: new Date(Date.now() + 1_000).toISOString(), refreshToken: 'customer-a-refresh', refreshExpiresAt: future(), identityKey: 'idk_customerA' };
    const fresh = { ...ours, accessToken: 'a2', accessExpiresAt: future(), refreshToken: 'customer-a-refresh-2' };
    const refresh = vi.spyOn(TestBed.inject(VisionApiService), 'refreshSession').mockResolvedValue(fresh);

    const renewed = await manager.renew(ours);

    expect(refresh).toHaveBeenCalledWith('customer-a-refresh');
    expect(renewed.identityKey).toBe('idk_customerA');
  });
});
