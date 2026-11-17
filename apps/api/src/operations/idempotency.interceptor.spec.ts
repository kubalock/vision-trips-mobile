import { NotFoundException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, from } from 'rxjs';
import type { AirtableRecord, AirtableService } from '../airtable/airtable.service.js';
import { DurableAuthStore } from '../sessions/durable-auth.store.js';
import { SessionsService, type SessionGrant } from '../sessions/sessions.service.js';
import { TripEntitlementsService } from '../sessions/trip-entitlements.service.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { Idempotent } from './idempotent.js';

const BASE_A = 'appBRANCHAAAAAAAA';
const BASE_B = 'appBRANCHBBBBBBBB';
const BOOKING = 'recBOOKINGAAAAAAA';
const GRACE = 'recGRACEAAAAAAAAA';
const KEY = 'op-1234567890';

class Routes {
  @Idempotent() paymentLink(): void { /* marked */ }
  refresh(): void { /* not marked */ }
}

/** Stored responses are only handed back to the session that may still see them. */
describe('IdempotencyInterceptor', () => {
  function setup() {
    const records: Record<string, AirtableRecord> = {
      [BOOKING]: { id: BOOKING, createdTime: '', fields: { Customers: [GRACE] } },
      [GRACE]: { id: GRACE, createdTime: '', fields: { Trips: [BOOKING] } },
    };
    const airtable = { record: vi.fn(async (_base: string, _table: string, id: string) => { if (!records[id]) throw new NotFoundException(); return records[id]; }) };
    const store = new DurableAuthStore(':memory:');
    const sessions = new SessionsService(store, new TripEntitlementsService(airtable as unknown as AirtableService, store));
    const interceptor = new IdempotencyInterceptor(store, new Reflector(), sessions);
    let calls = 0;
    let hold: Promise<void> | null = null;
    const handler: CallHandler = { handle: () => from((async () => { const n = ++calls; if (hold) await hold; return { url: `https://pay.example/${n}` }; })()) };
    const send = (accessToken: string | null, handlerName: keyof Routes = 'paymentLink', key = KEY, paymentId = 'pay_1') => {
      const headers: Record<string, string> = { 'idempotency-key': key, ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) };
      const request = { method: 'POST', path: `/v1/trips/current/payments/${paymentId}/link`, route: { path: '/v1/trips/current/payments/:paymentId/link' }, params: { paymentId }, query: {}, body: {}, get: (name: string) => headers[name.toLowerCase()] };
      const context = { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => Routes.prototype[handlerName], getClass: () => Routes } as unknown as ExecutionContext;
      return firstValueFrom(interceptor.intercept(context, handler));
    };
    const grant = (baseId = BASE_A, overrides: Partial<SessionGrant> = {}): SessionGrant => ({ baseId, recordId: BOOKING, fellowTraveller: false, customerRecordId: GRACE, assurance: 'otp', ...overrides });
    return { sessions, records, send, grant, calls: () => calls, holdHandler: (until: Promise<void>) => { hold = until; } };
  }

  it('replays the stored response to the same active session, also after its access token was renewed', async () => {
    const context = setup();
    const session = context.sessions.issue(context.grant());
    await expect(context.send(session.accessToken)).resolves.toEqual({ url: 'https://pay.example/1' });
    await expect(context.send(session.accessToken)).resolves.toEqual({ url: 'https://pay.example/1' });
    const renewed = await context.sessions.refresh(session.refreshToken);
    await expect(context.send(renewed.accessToken)).resolves.toEqual({ url: 'https://pay.example/1' });
    expect(context.calls()).toBe(1);
  });

  it.each([
    ['a fellow-traveller session', { fellowTraveller: true }],
    ['a legacy (unverified) session', { assurance: 'legacy' }],
    ['another session of the same verified Customer', {}],
  ] as const)('never hands %s of the same Customer the response stored for the lead session', async (_name, overrides) => {
    const context = setup();
    await context.send(context.sessions.issue(context.grant()).accessToken);
    const other = context.sessions.issue(context.grant(BASE_A, overrides as Partial<SessionGrant>));
    await expect(context.send(other.accessToken)).resolves.toEqual({ url: 'https://pay.example/2' });
    expect(context.calls()).toBe(2);
  });

  it('treats the same key for another payment item as a different request, not a replay of the first link', async () => {
    const context = setup();
    const session = context.sessions.issue(context.grant());
    await context.send(session.accessToken, 'paymentLink', KEY, 'pay_1');
    await expect(context.send(session.accessToken, 'paymentLink', KEY, 'pay_2')).rejects.toMatchObject({ status: 409 });
    expect(context.calls()).toBe(1);
  });

  it('answers idempotency_in_progress while the same operation is still running, and the stored reply afterwards', async () => {
    const context = setup();
    const session = context.sessions.issue(context.grant());
    let finish!: () => void;
    context.holdHandler(new Promise<void>((resolve) => { finish = resolve; }));
    const first = context.send(session.accessToken);
    await vi.waitFor(() => expect(context.calls()).toBe(1));
    await expect(context.send(session.accessToken)).rejects.toMatchObject({ status: 409, response: { code: 'idempotency_in_progress' } });
    finish();
    await expect(first).resolves.toEqual({ url: 'https://pay.example/1' });
    await expect(context.send(session.accessToken)).resolves.toEqual({ url: 'https://pay.example/1' });
    expect(context.calls()).toBe(1);
  });

  it('refuses a replay without authorization (401)', async () => {
    const context = setup();
    const session = context.sessions.issue(context.grant());
    await context.send(session.accessToken);
    await expect(context.send(null)).rejects.toMatchObject({ status: 401 });
    expect(context.calls()).toBe(1);
  });

  it('never hands one branch or person the stored response of another: the same key is a miss there', async () => {
    const context = setup();
    await context.send(context.sessions.issue(context.grant()).accessToken);
    const otherBranch = context.sessions.issue(context.grant(BASE_B));
    await expect(context.send(otherBranch.accessToken)).resolves.toEqual({ url: 'https://pay.example/2' });
    const shareSession = context.sessions.issue({ baseId: BASE_A, recordId: BOOKING, fellowTraveller: true, customerRecordId: null, assurance: 'link' });
    await expect(context.send(shareSession.accessToken)).resolves.toEqual({ url: 'https://pay.example/3' });
  });

  it('answers access_revoked, not the stored response, once the session has been revoked', async () => {
    const context = setup();
    const session = context.sessions.issue(context.grant());
    await context.send(session.accessToken);
    context.records[BOOKING] = { id: BOOKING, createdTime: '', fields: { Customers: [] } }; // Unlinked in Airtable.
    await expect(context.send(session.accessToken)).rejects.toMatchObject({ response: { code: 'access_revoked' } });
    await expect(context.send(session.accessToken)).rejects.toMatchObject({ response: { code: 'access_revoked' } });
    expect(context.calls()).toBe(1);
  });

  it('leaves routes that did not opt in alone, so their responses are never stored or replayed', async () => {
    const context = setup();
    await expect(context.send(null, 'refresh')).resolves.toEqual({ url: 'https://pay.example/1' });
    await expect(context.send(null, 'refresh')).resolves.toEqual({ url: 'https://pay.example/2' });
  });
});
