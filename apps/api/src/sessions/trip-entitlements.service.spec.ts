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
  it('accepts a Customer linked to the Booking both ways', () => {
    expect(entitlementProblem(booking([GRACE]), customer(GRACE, [BOOKING]), customer(GRACE, [BOOKING]))).toBeNull();
  });

  it('refuses once the Customer is unlinked on either side, or removed', () => {
    expect(entitlementProblem(booking([]), customer(GRACE, [BOOKING]), customer(GRACE, [BOOKING]))).toBe('customer_not_linked');
    expect(entitlementProblem(booking([GRACE]), customer(GRACE, []), customer(GRACE, []))).toBe('customer_not_linked');
    expect(entitlementProblem(booking([GRACE]), null, null)).toBe('customer_removed');
    expect(entitlementProblem(booking([GRACE]), customer(GRACE, [BOOKING]), null)).toBe('customer_removed');
  });

  it('accepts a grouped duplicate only while it still shares the verified Customer’s account ID', () => {
    const root = customer(GRACE, [], 'acct-grace');
    expect(entitlementProblem(booking([TWIN]), root, customer(TWIN, [BOOKING], 'acct-grace'))).toBeNull();
    expect(entitlementProblem(booking([TWIN]), root, customer(TWIN, [BOOKING], 'acct-other'))).toBe('owner_not_grouped');
    expect(entitlementProblem(booking([TWIN]), root, customer(TWIN, [BOOKING]))).toBe('owner_not_grouped');
  });

  it('ends a grouped session when its duplicate no longer shares the verified Customer’s new account ID', () => {
    expect(entitlementProblem(booking([TWIN]), customer(GRACE, [], 'acct-new'), customer(TWIN, [BOOKING], 'acct-grace'))).toBe('owner_not_grouped');
  });

  it('lets an ungrouped session keep its own Booking when the agent later groups the Customer', () => {
    const grouped = customer(GRACE, [BOOKING], 'acct-grace');
    expect(entitlementProblem(booking([GRACE]), grouped, grouped)).toBeNull();
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

describe('when the agent changes Customer Account ID', () => {
  const identityOf = (sessions: SessionsService, accessToken: string) => sessions.validateAccess(`Bearer ${accessToken}`).accountKey;

  it('moves a session on its own Booking to the new account, and the refresh returns the new identity', async () => {
    const context = setup({ [BOOKING]: booking([GRACE]), [GRACE]: customer(GRACE, [BOOKING], 'acct-grace') });
    const session = context.sessions.issue({ ...direct, accountKey: 'account:acct-grace' });
    context.state.records[GRACE] = customer(GRACE, [BOOKING], 'acct-renamed');
    const renewed = await context.sessions.refresh(session.refreshToken);
    expect(identityOf(context.sessions, renewed.accessToken)).toBe('account:acct-renamed');
    expect(renewed.identityKey).not.toBe(session.identityKey);
    // Removing the ID moves it back to the Customer itself; adding one to an ungrouped Customer groups it.
    context.state.records[GRACE] = customer(GRACE, [BOOKING]);
    const ungrouped = await context.sessions.refresh(renewed.refreshToken);
    expect(identityOf(context.sessions, ungrouped.accessToken)).toBe(`customer:${GRACE}`);
    expect(ungrouped.identityKey).toBe(context.sessions.issue(direct).identityKey);
  });

  it('keeps a grouped duplicate’s session when the whole group is renamed together', async () => {
    const context = setup({ [BOOKING]: booking([TWIN]), [GRACE]: customer(GRACE, [], 'acct-grace'), [TWIN]: customer(TWIN, [BOOKING], 'acct-grace') });
    const session = context.sessions.issue(viaTwin);
    context.state.records[GRACE] = customer(GRACE, [], 'acct-family');
    context.state.records[TWIN] = customer(TWIN, [BOOKING], 'acct-family');
    const renewed = await context.sessions.refresh(session.refreshToken);
    expect(identityOf(context.sessions, renewed.accessToken)).toBe('account:acct-family');
  });

  it('updates the account of a session checked on an ordinary request too', async () => {
    const context = setup({ [BOOKING]: booking([GRACE]), [GRACE]: customer(GRACE, [BOOKING], 'acct-new') });
    const session = context.sessions.issue(direct);
    await expect(context.sessions.authorize(`Bearer ${session.accessToken}`)).resolves.toMatchObject({ accountKey: 'account:acct-new' });
    expect(identityOf(context.sessions, session.accessToken)).toBe('account:acct-new');
  });
});

