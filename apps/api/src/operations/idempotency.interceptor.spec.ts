import { NotFoundException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
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
    const handler: CallHandler = { handle: () => of({ url: `https://pay.example/${++calls}` }) };
    const send = (accessToken: string | null, handlerName: keyof Routes = 'paymentLink', key = KEY) => {
      const headers: Record<string, string> = { 'idempotency-key': key, ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) };
      const request = { method: 'POST', path: '/v1/trips/current/payments/pay_1/link', route: { path: '/v1/trips/current/payments/:paymentId/link' }, body: {}, get: (name: string) => headers[name.toLowerCase()] };
      const context = { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => Routes.prototype[handlerName], getClass: () => Routes } as unknown as ExecutionContext;
      return firstValueFrom(interceptor.intercept(context, handler));
    };
    const grant = (baseId = BASE_A): SessionGrant => ({ baseId, recordId: BOOKING, fellowTraveller: false, customerRecordId: GRACE, assurance: 'otp' });
    return { sessions, records, send, grant, calls: () => calls };
  }

  it('replays the stored response to the same active session', async () => {
    const context = setup();
    const session = context.sessions.issue(context.grant());
    await expect(context.send(session.accessToken)).resolves.toEqual({ url: 'https://pay.example/1' });
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
