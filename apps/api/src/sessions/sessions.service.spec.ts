import { SessionsService } from './sessions.service.js';
import { DurableAuthStore } from './durable-auth.store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

describe('SessionsService', () => {
  it('rotates refresh tokens and rejects replay of the previous token', () => {
    const service = serviceInMemory();
    const initial = service.issue({
      baseId: 'appABCDEFGHIJKLMN',
      recordId: 'recABCDEFGHIJKLMN',
      fellowTraveller: false,
      customerRecordId: null,
      assurance: 'otp',
    });
    const refreshed = service.refresh(initial.refreshToken);

    expect(refreshed.refreshToken).not.toBe(initial.refreshToken);
    expect(() => service.refresh(initial.refreshToken)).toThrow('expired');
  });

  it('ends the whole session when a replaced refresh token is reused after the grace period', () => {
    vi.useFakeTimers();
    try {
      const service = serviceInMemory();
      const initial = service.issue({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false, customerRecordId: null, assurance: 'otp' });
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
    const initial = service.issue({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false, customerRecordId: null, assurance: 'otp' });
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
      customerRecordId: null,
      assurance: 'link',
    });
    service.revoke(session.refreshToken);
    expect(() => service.refresh(session.refreshToken)).toThrow('expired');
  });

  it('validates issued access tokens and rejects fabricated ones', () => {
    const service = serviceInMemory();
    const session = service.issue({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false, customerRecordId: null, assurance: 'otp' });
    expect(service.validateAccess(`Bearer ${session.accessToken}`)).toMatchObject({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false, customerRecordId: null, assurance: 'otp' });
    expect(() => service.validateAccess('Bearer vta_fabricated.session')).toThrow('expired');
  });

  it('keeps sessions valid when the API service is recreated', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vision-auth-'));
    const path = join(directory, 'auth.sqlite');
    const firstStore = new DurableAuthStore(path);
    const session = new SessionsService(firstStore).issue({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false, customerRecordId: null, assurance: 'otp' });
    firstStore.onModuleDestroy();

    const secondStore = new DurableAuthStore(path);
    expect(new SessionsService(secondStore).validateAccess(`Bearer ${session.accessToken}`)).toMatchObject({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false, customerRecordId: null, assurance: 'otp' });
    secondStore.onModuleDestroy();
    rmSync(directory, { recursive: true });
  });
});

function serviceInMemory(): SessionsService { return new SessionsService(new DurableAuthStore(':memory:')); }

describe('SessionsService assurance', () => {
  it('keeps the assurance and customer a session was verified with across refreshes', () => {
    const service = new SessionsService(new DurableAuthStore(':memory:'));
    const session = service.issue({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false, customerRecordId: 'recCUSTOMERABCDEF', assurance: 'trusted_device', invitationId: 'inv_1' });
    const renewed = service.refresh(session.refreshToken);
    expect(service.validateAccess(`Bearer ${renewed.accessToken}`)).toMatchObject({ customerRecordId: 'recCUSTOMERABCDEF', assurance: 'trusted_device' });
  });

  it('treats sessions stored before invitations existed as legacy (unverified)', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vision-auth-legacy-'));
    const path = join(directory, 'auth.sqlite');
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE auth_sessions (id TEXT PRIMARY KEY, base_id TEXT NOT NULL, record_id TEXT NOT NULL, fellow_traveller INTEGER NOT NULL,
      refresh_hash TEXT NOT NULL UNIQUE, refresh_expires_at INTEGER NOT NULL, access_hash TEXT NOT NULL UNIQUE, access_expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)`);
    const accessToken = 'vta_legacy-access-token.session-1';
    legacy.prepare('INSERT INTO auth_sessions VALUES (?, ?, ?, 0, ?, ?, ?, ?, 0)').run('session-1', 'appABCDEFGHIJKLMN', 'recABCDEFGHIJKLMN', 'refresh-hash', Date.now() + 60_000, createHash('sha256').update(accessToken).digest('base64url'), Date.now() + 60_000);
    legacy.close();

    const store = new DurableAuthStore(path);
    expect(new SessionsService(store).validateAccess(`Bearer ${accessToken}`)).toMatchObject({ assurance: 'legacy', customerRecordId: null });
    store.onModuleDestroy();
    rmSync(directory, { recursive: true });
  });
});
