import { SessionsService } from './sessions.service.js';
import { DurableAuthStore } from './durable-auth.store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

describe('SessionsService', () => {
  it('rotates refresh tokens and rejects replay of the previous token', async () => {
    const service = serviceInMemory();
    const initial = service.issue({
      baseId: 'appABCDEFGHIJKLMN',
      recordId: 'recABCDEFGHIJKLMN',
      fellowTraveller: false,
      customerRecordId: null,
      assurance: 'otp',
    });
    const refreshed = await service.refresh(initial.refreshToken);

    expect(refreshed.refreshToken).not.toBe(initial.refreshToken);
    await expect(service.refresh(initial.refreshToken)).rejects.toThrow('expired');
  });

  it('ends the whole session when a replaced refresh token is reused after the grace period', async () => {
    vi.useFakeTimers();
    try {
      const service = serviceInMemory();
      const initial = service.issue({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false, customerRecordId: null, assurance: 'otp' });
      const legitimate = await service.refresh(initial.refreshToken);

      vi.advanceTimersByTime(60_000);
      await expect(service.refresh(initial.refreshToken)).rejects.toThrow('expired');

      // The holder of the current tokens is signed out too, because we can't tell which copy is genuine.
      await expect(service.refresh(legitimate.refreshToken)).rejects.toThrow('expired');
      expect(() => service.validateAccess(`Bearer ${legitimate.accessToken}`)).toThrow();
    } finally { vi.useRealTimers(); }
  });

  it('tolerates a near-simultaneous reuse without ending the session', async () => {
    const service = serviceInMemory();
    const initial = service.issue({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false, customerRecordId: null, assurance: 'otp' });
    const legitimate = await service.refresh(initial.refreshToken);

    await expect(service.refresh(initial.refreshToken)).rejects.toThrow('expired');
    expect((await service.refresh(legitimate.refreshToken)).refreshToken).toBeTruthy();
  });

  it('rejects refresh after revocation', async () => {
    const service = serviceInMemory();
    const session = service.issue({
      baseId: 'appABCDEFGHIJKLMN',
      recordId: 'recABCDEFGHIJKLMN',
      fellowTraveller: true,
      customerRecordId: null,
      assurance: 'link',
    });
    service.revoke(session.refreshToken);
    await expect(service.refresh(session.refreshToken)).rejects.toThrow('expired');
  });

  it('validates issued access tokens and rejects fabricated ones', async () => {
    const service = serviceInMemory();
    const session = service.issue({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false, customerRecordId: null, assurance: 'otp' });
    expect(service.validateAccess(`Bearer ${session.accessToken}`)).toMatchObject({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false, customerRecordId: null, assurance: 'otp' });
    expect(() => service.validateAccess('Bearer vta_fabricated.session')).toThrow('expired');
  });

  it('keeps sessions valid when the API service is recreated', async () => {
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
  it('keeps the assurance and customer a session was verified with across refreshes', async () => {
    const service = new SessionsService(new DurableAuthStore(':memory:'));
    const session = service.issue({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false, customerRecordId: 'recCUSTOMERABCDEF', assurance: 'trusted_device', invitationId: 'inv_1' });
    const renewed = await service.refresh(session.refreshToken);
    expect(service.validateAccess(`Bearer ${renewed.accessToken}`)).toMatchObject({ customerRecordId: 'recCUSTOMERABCDEF', assurance: 'trusted_device' });
  });

  it('treats sessions stored before invitations existed as legacy (unverified)', async () => {
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

describe('SessionsService background-check (watch) tokens', () => {
  const grant = { baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false, customerRecordId: null, assurance: 'otp' as const };

  it('identifies the session, keeps working across refresh-token rotation and never touches the session tokens', async () => {
    const service = serviceInMemory();
    const session = service.issue(grant);
    const principal = service.validateAccess(`Bearer ${session.accessToken}`);
    const watch = service.watchToken(principal);

    expect(watch).toMatch(/^vtw_/);
    expect(service.validateWatch(`Watch ${watch}`)).toMatchObject({ baseId: grant.baseId, recordId: grant.recordId, sessionId: principal.sessionId });
    const refreshed = await service.refresh(session.refreshToken);
    expect(service.validateWatch(`Watch ${watch}`).sessionId).toBe(principal.sessionId);
    // Using the watch token must not count as replaying a refresh token.
    expect(() => service.validateAccess(`Bearer ${refreshed.accessToken}`)).not.toThrow();
  });

  it('rejects altered tokens, other schemes and tokens for ended sessions', () => {
    const service = serviceInMemory();
    const session = service.issue(grant);
    const watch = service.watchToken(service.validateAccess(`Bearer ${session.accessToken}`));
    const other = service.issue(grant);
    const otherId = service.validateAccess(`Bearer ${other.accessToken}`).sessionId!;

    expect(() => service.validateWatch(`Bearer ${watch}`)).toThrow();
    expect(() => service.validateWatch(`Watch ${watch.slice(0, -2)}xx`)).toThrow();
    // A signature from one session can't be moved onto another session id.
    expect(() => service.validateWatch(`Watch vtw_${otherId}.${watch.split('.')[1]}`)).toThrow();
    service.revoke(session.refreshToken);
    expect(() => service.validateWatch(`Watch ${watch}`)).toThrow('expired');
  });

  it('limits how often a session can be checked', () => {
    const service = serviceInMemory();
    const session = service.issue(grant);
    const watch = service.watchToken(service.validateAccess(`Bearer ${session.accessToken}`));
    for (let check = 0; check < 12; check += 1) service.validateWatch(`Watch ${watch}`);
    expect(() => service.validateWatch(`Watch ${watch}`)).toThrow('Too many checks');
  });
});
