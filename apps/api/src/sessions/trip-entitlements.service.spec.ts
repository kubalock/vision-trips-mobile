import { BadGatewayException, NotFoundException } from '@nestjs/common';
import type { AirtableRecord, AirtableService } from '../airtable/airtable.service.js';
import { TripActionsController } from '../trip-actions/trip-actions.controller.js';
import { DurableAuthStore } from './durable-auth.store.js';
import { SessionsService, type SessionGrant } from './sessions.service.js';
import { entitlementProblem, TripEntitlementsService } from './trip-entitlements.service.js';

const BASE = 'appABCDEFGHIJKLMN';
const BOOKING = 'recBOOKINGAAAAAAA';
const GRACE = 'recGRACEAAAAAAAAA';
const TWIN = 'recGRACETWINAAAAA';

function customer(id: string, trips: string[], accountId?: string): AirtableRecord {
  return { id, createdTime: '', fields: { Trips: trips, ...(accountId ? { 'Customer Account ID': accountId } : {}) } };
}
function booking(customers: string[], extra: Record<string, unknown> = {}): AirtableRecord {
  return { id: BOOKING, createdTime: '', fields: { Customers: customers, ...extra } };
}

/** A tiny Airtable: records by id; missing ones are 404s, `outage` makes every read fail like a 502. */
function fakeAirtable(records: Record<string, AirtableRecord>) {
  const state = { records, outage: false };
  const record = vi.fn(async (_base: string, _table: string, id: string) => {
    if (state.outage) throw new BadGatewayException('Airtable is unavailable.');
    const found = state.records[id];
    if (!found) throw new NotFoundException('Airtable could not find the record.');
    return found;
  });
  return { state, airtable: { record } as unknown as AirtableService, record };
}

function setup(records: Record<string, AirtableRecord>, now = () => Date.now()) {
  const store = new DurableAuthStore(':memory:');
  const fake = fakeAirtable(records);
  const entitlements = new TripEntitlementsService(fake.airtable, store, now);
  const sessions = new SessionsService(store, entitlements);
  return { ...fake, store, entitlements, sessions };
}

const direct: SessionGrant = { baseId: BASE, recordId: BOOKING, fellowTraveller: false, customerRecordId: GRACE, assurance: 'otp', accountKey: `customer:${GRACE}` };
const viaTwin: SessionGrant = { ...direct, accountKey: 'account:acct-grace', bookingOwnerCustomerRecordId: TWIN };

describe('entitlementProblem', () => {
  const principal = (grant: SessionGrant) => ({ ...grant, sessionId: 's1' });

  it('accepts a Customer linked to the Booking both ways', () => {
    expect(entitlementProblem(principal(direct), booking([GRACE]), customer(GRACE, [BOOKING]), customer(GRACE, [BOOKING]))).toBeNull();
  });

  it('refuses once the Customer is unlinked on either side, or removed', () => {
    expect(entitlementProblem(principal(direct), booking([]), customer(GRACE, [BOOKING]), customer(GRACE, [BOOKING]))).toBe('customer_not_linked');
    expect(entitlementProblem(principal(direct), booking([GRACE]), customer(GRACE, []), customer(GRACE, []))).toBe('customer_not_linked');
    expect(entitlementProblem(principal(direct), booking([GRACE]), null, null)).toBe('customer_removed');
    expect(entitlementProblem(principal(direct), booking([GRACE]), customer(GRACE, [BOOKING]), null)).toBe('customer_removed');
  });

  it('accepts a grouped duplicate only while it still shares the verified Customer’s account ID', () => {
    const root = customer(GRACE, [], 'acct-grace');
    expect(entitlementProblem(principal(viaTwin), booking([TWIN]), root, customer(TWIN, [BOOKING], 'acct-grace'))).toBeNull();
    expect(entitlementProblem(principal(viaTwin), booking([TWIN]), root, customer(TWIN, [BOOKING], 'acct-other'))).toBe('owner_not_grouped');
    expect(entitlementProblem(principal(viaTwin), booking([TWIN]), root, customer(TWIN, [BOOKING]))).toBe('owner_not_grouped');
  });

  it('ends a grouped session when the verified Customer’s account ID changes', () => {
    const owner = customer(TWIN, [BOOKING], 'acct-new');
    expect(entitlementProblem(principal(viaTwin), booking([TWIN]), customer(GRACE, [], 'acct-new'), owner)).toBe('account_changed');
    expect(entitlementProblem(principal({ ...direct, accountKey: 'account:acct-grace' }), booking([GRACE]), customer(GRACE, [BOOKING]), customer(GRACE, [BOOKING]))).toBe('account_changed');
  });

  it('lets an ungrouped session keep its own Booking when the agent later groups the Customer', () => {
    const grouped = customer(GRACE, [BOOKING], 'acct-grace');
    expect(entitlementProblem(principal(direct), booking([GRACE]), grouped, grouped)).toBeNull();
  });
});

describe('TripEntitlementsService', () => {
  const linked = () => ({ [BOOKING]: booking([GRACE]), [GRACE]: customer(GRACE, [BOOKING]) });

  it('ends the session and refuses with access_revoked once the Customer is unlinked', async () => {
    const context = setup(linked());
    const session = context.sessions.issue(direct);
    await expect(context.sessions.authorize(`Bearer ${session.accessToken}`)).resolves.toMatchObject({ recordId: BOOKING });

    context.state.records[BOOKING] = booking([]);
    await expect(context.sessions.authorize(`Bearer ${session.accessToken}`, { fresh: true })).rejects.toMatchObject({ response: { code: 'access_revoked' } });
    // Ended for good: the access token and the refresh token both stop working, even after relinking.
    context.state.records[BOOKING] = booking([GRACE]);
    expect(() => context.sessions.validateAccess(`Bearer ${session.accessToken}`)).toThrow();
    await expect(context.sessions.refresh(session.refreshToken)).rejects.toThrow('expired');
  });

  it('refuses a deleted or soft-deleted Booking, also for share-link sessions', async () => {
    const context = setup(linked());
    const share = context.sessions.issue({ baseId: BASE, recordId: BOOKING, fellowTraveller: true, customerRecordId: null, assurance: 'link' });
    context.state.records[BOOKING] = booking([GRACE], { 'Soft Delete': true });
    await expect(context.sessions.authorize(`Bearer ${share.accessToken}`)).rejects.toMatchObject({ response: { code: 'access_revoked' } });
    const second = context.sessions.issue(direct);
    delete context.state.records[BOOKING];
    await expect(context.sessions.authorize(`Bearer ${second.accessToken}`)).rejects.toMatchObject({ response: { code: 'access_revoked' } });
  });

  it('reuses a check from the last minute for reads, but sensitive actions always re-check', async () => {
    let now = 1_000_000;
    const context = setup(linked(), () => now);
    const session = context.sessions.issue(direct);
    await context.sessions.authorize(`Bearer ${session.accessToken}`);
    const reads = context.record.mock.calls.length;
    await context.sessions.authorize(`Bearer ${session.accessToken}`);
    expect(context.record.mock.calls.length).toBe(reads);
    await context.sessions.authorize(`Bearer ${session.accessToken}`, { fresh: true });
    expect(context.record.mock.calls.length).toBeGreaterThan(reads);
    const afterFresh = context.record.mock.calls.length;
    now += 61_000;
    await context.sessions.authorize(`Bearer ${session.accessToken}`);
    expect(context.record.mock.calls.length).toBeGreaterThan(afterFresh);
  });

  it('treats an Airtable outage as an error, not a revocation', async () => {
    const context = setup(linked());
    const session = context.sessions.issue(direct);
    context.state.outage = true;
    await expect(context.sessions.authorize(`Bearer ${session.accessToken}`, { fresh: true })).rejects.toBeInstanceOf(BadGatewayException);
    context.state.outage = false;
    await expect(context.sessions.authorize(`Bearer ${session.accessToken}`, { fresh: true })).resolves.toMatchObject({ customerRecordId: GRACE });
  });
});

describe('refreshing a session', () => {
  it('stops extending a session once its Customer is unlinked', async () => {
    const context = setup({ [BOOKING]: booking([GRACE]), [GRACE]: customer(GRACE, [BOOKING]) });
    const session = context.sessions.issue(direct);
    const renewed = await context.sessions.refresh(session.refreshToken);

    context.state.records[GRACE] = customer(GRACE, []);
    await expect(context.sessions.refresh(renewed.refreshToken)).rejects.toMatchObject({ response: { code: 'access_revoked' } });
    expect(() => context.sessions.validateAccess(`Bearer ${renewed.accessToken}`)).toThrow();
  });

  it('stops extending a grouped session when the duplicate is removed from the account', async () => {
    const context = setup({ [BOOKING]: booking([TWIN]), [GRACE]: customer(GRACE, [], 'acct-grace'), [TWIN]: customer(TWIN, [BOOKING], 'acct-grace') });
    const session = context.sessions.issue(viaTwin);
    context.state.records[TWIN] = customer(TWIN, [BOOKING]);
    await expect(context.sessions.refresh(session.refreshToken)).rejects.toMatchObject({ response: { code: 'access_revoked' } });
  });

  it('keeps customers signed in through an Airtable outage', async () => {
    const context = setup({ [BOOKING]: booking([GRACE]), [GRACE]: customer(GRACE, [BOOKING]) });
    const session = context.sessions.issue(direct);
    context.state.outage = true;
    await expect(context.sessions.refresh(session.refreshToken)).resolves.toMatchObject({ identityKey: session.identityKey });
  });
});

describe('sensitive actions after unlinking', () => {
  it('refuses a payment link, a share link and quotation acceptance without calling Mint or Airtable writes', async () => {
    const context = setup({ [BOOKING]: booking([GRACE]), [GRACE]: customer(GRACE, [BOOKING]) });
    const mintPayments = { link: vi.fn(), depositLink: vi.fn() };
    const invitations = { shareLink: vi.fn() };
    const trips = { snapshot: vi.fn() };
    const controller = new TripActionsController(context.sessions, trips as never, context.airtable, invitations as never, {} as never, {} as never, mintPayments as never, undefined, undefined, context.entitlements);
    const sessions = [0, 1, 2].map(() => context.sessions.issue(direct));
    // Confirm each session once, so a cached check would let the action through if it were used.
    for (const session of sessions) await context.sessions.authorize(`Bearer ${session.accessToken}`);

    context.state.records[BOOKING] = booking([]);
    const revoked = { response: { code: 'access_revoked' } };
    await expect(controller.paymentLink(`Bearer ${sessions[0].accessToken}`, 'recPAYMENTAAAAAAA')).rejects.toMatchObject(revoked);
    await expect(controller.fellowTravellerLink(`Bearer ${sessions[1].accessToken}`)).rejects.toMatchObject(revoked);
    await expect(controller.acceptQuotation(`Bearer ${sessions[2].accessToken}`, { name: 'Grace Hopper', email: 'grace@example.com', agreed: true }, {} as never)).rejects.toMatchObject(revoked);
    expect(mintPayments.link).not.toHaveBeenCalled();
    expect(invitations.shareLink).not.toHaveBeenCalled();
    expect(trips.snapshot).not.toHaveBeenCalled();
  });
});
