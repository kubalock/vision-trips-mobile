import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { VisionApiService } from '../api/vision-api.service';
import { SessionManager } from './session-manager';

describe('SessionManager', () => {
  const future = () => new Date(Date.now() + 10 * 60_000).toISOString();
  const session = (name: string, accessExpiresAt = future()) => ({ accessToken: `${name}-access`, accessExpiresAt, refreshToken: `${name}-refresh`, refreshExpiresAt: future() });

  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }));
  afterEach(() => localStorage.clear());

  it('renews an expiring token before the request and reports the renewal', async () => {
    const manager = TestBed.inject(SessionManager);
    const renewed = vi.fn();
    manager.connect({ tripIdFor: () => undefined, renewed });
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
});
