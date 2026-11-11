import { SessionsService } from './sessions.service.js';
import { DurableAuthStore } from './durable-auth.store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('SessionsService', () => {
  it('rotates refresh tokens and rejects replay of the previous token', () => {
    const service = serviceInMemory();
    const initial = service.issue({
      baseId: 'appABCDEFGHIJKLMN',
      recordId: 'recABCDEFGHIJKLMN',
      fellowTraveller: false,
    });
    const refreshed = service.refresh(initial.refreshToken);

    expect(refreshed.refreshToken).not.toBe(initial.refreshToken);
    expect(() => service.refresh(initial.refreshToken)).toThrow('expired');
  });

  it('ends the whole session when a replaced refresh token is reused after the grace period', () => {
    vi.useFakeTimers();
    try {
      const service = serviceInMemory();
      const initial = service.issue({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false });
      const legitimate = service.refresh(initial.refreshToken);

      vi.advanceTimersByTime(60_000);
      expect(() => service.refresh(initial.refreshToken)).toThrow('expired');

      // The holder of the current tokens is signed out too, because we can't tell which copy is genuine.
      expect(() => service.refresh(legitimate.refreshToken)).toThrow('expired');
      expect(() => service.validateAccess(`Bearer ${legitimate.accessToken}`)).toThrow();
    } finally { vi.useRealTimers(); }
  });

  it('tolerates a near-simultaneous reuse without ending the session', () => {
    const service = serviceInMemory();
    const initial = service.issue({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false });
    const legitimate = service.refresh(initial.refreshToken);

    expect(() => service.refresh(initial.refreshToken)).toThrow('expired');
    expect(service.refresh(legitimate.refreshToken).refreshToken).toBeTruthy();
  });

  it('rejects refresh after revocation', () => {
    const service = serviceInMemory();
    const session = service.issue({
      baseId: 'appABCDEFGHIJKLMN',
      recordId: 'recABCDEFGHIJKLMN',
      fellowTraveller: true,
    });
    service.revoke(session.refreshToken);
    expect(() => service.refresh(session.refreshToken)).toThrow('expired');
  });

  it('validates issued access tokens and rejects fabricated ones', () => {
    const service = serviceInMemory();
    const session = service.issue({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false });
    expect(service.validateAccess(`Bearer ${session.accessToken}`)).toEqual({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false });
    expect(() => service.validateAccess('Bearer vta_fabricated.session')).toThrow('expired');
  });

  it('keeps sessions valid when the API service is recreated', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vision-auth-'));
    const path = join(directory, 'auth.sqlite');
    const firstStore = new DurableAuthStore(path);
    const session = new SessionsService(firstStore).issue({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false });
    firstStore.onModuleDestroy();

    const secondStore = new DurableAuthStore(path);
    expect(new SessionsService(secondStore).validateAccess(`Bearer ${session.accessToken}`)).toEqual({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false });
    secondStore.onModuleDestroy();
    rmSync(directory, { recursive: true });
  });
});

function serviceInMemory(): SessionsService { return new SessionsService(new DurableAuthStore(':memory:')); }
