import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import type { AirtableRecord } from '../airtable/airtable.service.js';
import { DurableAuthStore } from '../sessions/durable-auth.store.js';
import { SessionsService, type SessionPrincipal } from '../sessions/sessions.service.js';
import { publicTripId } from '../trips/trips.service.js';
import { CustomerAccountService } from './customer-account.service.js';
import { RelatedQuotationsService } from './related-quotations.service.js';

const BASE_A = 'appBRANCHAAAAAAAA';
const BASE_B = 'appBRANCHBBBBBBBB';
const GRACE = 'recCUSTOMERGRACE1';
const IMPOSTOR = 'recCUSTOMERIMPOST'; // Same email as Grace, different person/record.
const SECONDARY = 'recCUSTOMERSECOND'; // Grace's email is this record's Secondary Email.
const TWIN = 'recCUSTOMERTWIN01'; // Explicitly grouped with Grace by Customer Account ID.
const LISBON = 'recBOOKINGLISBON1';
const JAPAN = 'recBOOKINGJAPAN01';
const IMPOSTOR_TRIP = 'recBOOKINGIMPOST1';
const TWIN_TRIP = 'recBOOKINGTWIN001';
const QUOTE = 'recBOOKINGQUOTE01';

type Tables = Record<string, Record<string, Record<string, Record<string, unknown>>>>;

/** An in-memory Airtable keyed by base, table and record, recording every call so tests can prove what was touched. */
function fakeAirtable(tables: Tables) {
  const table = (base: string, name: string) => tables[base]?.[name] ?? {};
  const toRecord = (id: string, fields: Record<string, unknown>): AirtableRecord => ({ id, fields: structuredClone(fields) } as AirtableRecord);
  return {
    record: vi.fn(async (base: string, name: string, id: string) => {
      const fields = table(base, name)[id];
      if (!fields) throw new NotFoundException(`Airtable could not find the ${name} record.`);
      return toRecord(id, fields);
    }),
    records: vi.fn(async (base: string, name: string, ids: string[]) => ids.filter((id) => table(base, name)[id]).map((id) => toRecord(id, table(base, name)[id]))),
    list: vi.fn(async (base: string, name: string, options: { filterByFormula?: string } = {}) => {
      const match = /^\{Customer Account ID\}='([^']*)'$/.exec(options.filterByFormula ?? '');
      if (!match) throw new Error(`Unexpected Airtable search: ${options.filterByFormula}`);
      return Object.entries(table(base, name)).filter(([, fields]) => fields['Customer Account ID'] === match[1]).map(([id, fields]) => toRecord(id, fields));
    }),
    updateRecord: vi.fn().mockResolvedValue({}),
    addComment: vi.fn().mockResolvedValue(undefined),
  };
}

const booking = (name: string, customers: string[], extra: Record<string, unknown> = {}) => ({ 'Trip Name': name, 'Booking Reference': name.toUpperCase(), Status: 'Confirmed', 'Departure Date': '2027-04-01', Customers: customers, ...extra });

function world(): Tables {
  return {
    [BASE_A]: {
      Customers: {
        [GRACE]: { 'Primary Email': 'grace@example.com', 'Email Marketing': true, 'Preferred Departure Airport(s)': ['Bristol Airport'], Trips: [LISBON, JAPAN, QUOTE] },
        [IMPOSTOR]: { 'Primary Email': 'grace@example.com', 'SMS Marketing': true, 'Preferred Travel Month(s)': ['June'], Trips: [IMPOSTOR_TRIP, LISBON] },
        [SECONDARY]: { 'Primary Email': 'someone@example.com', 'Secondary Email': 'grace@example.com', 'Postal Marketing': true, Trips: [IMPOSTOR_TRIP] },
      },
      Bookings: {
        // Booking rollup email deliberately points at someone else: it must never change who the account belongs to.
        [LISBON]: booking('Lisbon', [GRACE, IMPOSTOR], { 'Customers | Email': 'someone@example.com' }),
        [JAPAN]: booking('Japan', [GRACE], { 'Departure Date': '2028-03-01' }),
        [IMPOSTOR_TRIP]: booking('Impostor trip', [IMPOSTOR, SECONDARY]),
        [QUOTE]: booking('Quote', [GRACE], { Status: 'Quotation', 'Quotation Expiry': '2099-01-01', 'Departure Date': '2099-02-01' }),
      },
    },
    // Branch B reuses the very same record IDs and email for a different customer profile.
    [BASE_B]: {
      Customers: { [GRACE]: { 'Primary Email': 'grace@example.com', 'Postal Marketing': true, Trips: [LISBON] } },
      Bookings: { [LISBON]: booking('Branch B Lisbon', [GRACE]) },
    },
  };
}

function setup(tables = world()) {
  const airtable = fakeAirtable(tables);
  const store = new DurableAuthStore(':memory:');
  const sessions = new SessionsService(store);
  const trips = {
    snapshot: vi.fn(async (base: string, recordId: string) => ({ tripId: publicTripId(base, recordId) })),
    verificationProfile: vi.fn(async () => { throw new Error('The booking rollup email must not be used for account identity.'); }),
  };
  const account = new CustomerAccountService(airtable as never, trips as never, sessions);
  const quotations = new RelatedQuotationsService(airtable as never, trips as never, sessions);
  return { airtable, sessions, trips, account, quotations };
}

const principal = (overrides: Partial<SessionPrincipal> = {}): SessionPrincipal => ({ baseId: BASE_A, recordId: LISBON, fellowTraveller: false, customerRecordId: GRACE, assurance: 'otp', ...overrides });
const basesTouched = (airtable: ReturnType<typeof fakeAirtable>) => new Set([...airtable.record.mock.calls, ...airtable.records.mock.calls, ...airtable.list.mock.calls, ...airtable.updateRecord.mock.calls].map((call) => call[0]));

describe('CustomerAccountService identity', () => {
  beforeEach(() => { process.env.VISION_LINK_SECRET = 'test-secret-at-least-32-characters'; });
  afterEach(() => { delete process.env.VISION_LINK_SECRET; });

  it('lists only bookings linked to the verified Customer, never to records sharing its email', async () => {
    const { account, airtable, trips } = setup();
    const result = await account.account(principal());
    expect(result.trips.map((trip) => trip.name).sort()).toEqual(['Japan', 'Lisbon', 'Quote']);
    expect(result.trips.some((trip) => trip.name === 'Impostor trip')).toBe(false);
    expect(result.emailHint).toBe('gr***@example.com');
    // Preferences come from Grace alone, not merged with the same-email or secondary-email records.
    expect(result.preferences).toEqual({ emailMarketing: true, smsMarketing: false, postalMarketing: false, preferredAirports: ['Bristol Airport'], preferredMonths: [] });
    expect(airtable.list).not.toHaveBeenCalled(); // No email search at all.
    expect(trips.verificationProfile).not.toHaveBeenCalled(); // The Booking's rollup email is irrelevant.
  });

  it('marks the current trip and gives each trip its public trip ID (for the “saved on this device” label)', async () => {
    const { account } = setup();
    const result = await account.account(principal());
    expect(result.trips[0]).toMatchObject({ name: 'Lisbon', current: true, tripId: publicTripId(BASE_A, LISBON) });
    expect(result.trips.every((trip) => !trip.accountTripId.includes('rec') && trip.tripId.startsWith('trp_'))).toBe(true);
  });

  it('updates preferences on the verified Customer only', async () => {
    const { account, airtable } = setup();
    const result = await account.update(principal(), { emailMarketing: false, smsMarketing: true, postalMarketing: false, preferredAirports: ['Manchester Airport'], preferredMonths: ['May'] });
    expect(result.updatedRecords).toBe(1);
    expect(airtable.updateRecord).toHaveBeenCalledOnce();
    expect(airtable.updateRecord).toHaveBeenCalledWith(BASE_A, 'Customers', GRACE, {
      'Email Marketing': false, 'Email Marketing Unsubscribe': true, 'SMS Marketing': true, 'Postal Marketing': false,
      'Preferred Departure Airport(s)': ['Manchester Airport'], 'Preferred Travel Month(s)': ['May'],
    });
  });

  it('never lets one Customer on a shared Booking read or change the other’s account', async () => {
    const { account, airtable } = setup();
    const impostor = await account.account(principal({ customerRecordId: IMPOSTOR }));
    expect(impostor.trips.map((trip) => trip.name).sort()).toEqual(['Impostor trip', 'Lisbon']);
    expect(impostor.preferences.smsMarketing).toBe(true);
    await account.update(principal({ customerRecordId: IMPOSTOR }), { emailMarketing: false, smsMarketing: false, postalMarketing: false, preferredAirports: [], preferredMonths: [] });
    expect(airtable.updateRecord.mock.calls.map((call) => call[2])).toEqual([IMPOSTOR]);
  });

  it('groups records only through an explicit Customer Account ID in the same base', async () => {
    const tables = world();
    tables[BASE_A].Customers[GRACE]['Customer Account ID'] = 'acct-grace';
    tables[BASE_A].Customers[TWIN] = { 'Primary Email': 'grace.old@example.com', 'Customer Account ID': 'acct-grace', 'Preferred Travel Month(s)': ['July'], Trips: [TWIN_TRIP] };
    tables[BASE_A].Bookings[TWIN_TRIP] = booking('Twin trip', [TWIN]);
    tables[BASE_B].Customers.recCUSTOMEROTHERB = { 'Customer Account ID': 'acct-grace', Trips: [] };
    const { account, airtable } = setup(tables);
    const result = await account.account(principal());
    expect(result.trips.map((trip) => trip.name)).toContain('Twin trip');
    expect(result.trips.map((trip) => trip.name)).not.toContain('Impostor trip');
    expect(result.preferences.preferredMonths).toEqual(['July']);
    const saved = await account.update(principal(), { emailMarketing: true, smsMarketing: false, postalMarketing: false, preferredAirports: [], preferredMonths: [] });
    expect(saved.updatedRecords).toBe(2);
    expect(airtable.updateRecord.mock.calls.map((call) => [call[0], call[2]]).sort((x, y) => x.join().localeCompare(y.join()))).toEqual([[BASE_A, GRACE], [BASE_A, TWIN]]);
  });

  it('opens an account trip as a booking-scoped session for the same verified Customer, base and assurance', async () => {
    const { account, sessions } = setup();
    const japan = (await account.account(principal())).trips.find((trip) => trip.name === 'Japan')!;
    const opened = await account.open(principal({ assurance: 'trusted_device' }), japan.accountTripId);
    expect(opened.snapshot.tripId).toBe(japan.tripId);
    expect(sessions.validateAccess(`Bearer ${opened.session.accessToken}`)).toMatchObject({ baseId: BASE_A, recordId: JAPAN, customerRecordId: GRACE, assurance: 'trusted_device', fellowTraveller: false });
  });

  it('keeps the verified Customer as the new session identity on a booking that also links a same-email Customer', async () => {
    const { account, sessions } = setup();
    const lisbon = (await account.account(principal({ recordId: JAPAN }))).trips.find((trip) => trip.name === 'Lisbon')!;
    const opened = await account.open(principal({ recordId: JAPAN }), lisbon.accountTripId);
    expect(sessions.validateAccess(`Bearer ${opened.session.accessToken}`).customerRecordId).toBe(GRACE);
    expect(opened.session.identityKey).toBe((await account.open(principal(), lisbon.accountTripId)).session.identityKey);
  });

  it('refuses to open a booking linked only to another Customer with the same email', async () => {
    const { account } = setup();
    const impostorTrip = (await account.account(principal({ customerRecordId: IMPOSTOR }))).trips.find((trip) => trip.name === 'Impostor trip')!;
    await expect(account.open(principal(), impostorTrip.accountTripId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stops opening a booking once it is unlinked, even if the Customer’s Trips field still lists it', async () => {
    const tables = world();
    const { account } = setup(tables);
    const japan = (await account.account(principal())).trips.find((trip) => trip.name === 'Japan')!;
    tables[BASE_A].Bookings[JAPAN].Customers = []; // Agent unlinks the Customer on the Booking side.
    await expect(account.open(principal(), japan.accountTripId)).rejects.toBeInstanceOf(NotFoundException);
    expect((await account.account(principal())).trips.map((trip) => trip.name)).not.toContain('Japan');
    tables[BASE_A].Bookings[JAPAN].Customers = [GRACE];
    tables[BASE_A].Customers[GRACE].Trips = [LISBON]; // …or on the Customer side.
    await expect(account.open(principal(), japan.accountTripId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('leaves soft-deleted bookings out', async () => {
    const tables = world();
    tables[BASE_A].Bookings[JAPAN]['Soft Delete'] = true;
    const { account } = setup(tables);
    expect((await account.account(principal())).trips.map((trip) => trip.name)).not.toContain('Japan');
  });

  it('keeps two bases with identical record IDs and emails completely separate', async () => {
    const { account, airtable } = setup();
    const a = await account.account(principal());
    airtable.record.mockClear(); airtable.records.mockClear();
    const b = await account.account(principal({ baseId: BASE_B }));
    expect(b.trips.map((trip) => trip.name)).toEqual(['Branch B Lisbon']);
    expect(b.preferences).toMatchObject({ emailMarketing: false, postalMarketing: true });
    expect(basesTouched(airtable)).toEqual(new Set([BASE_B])); // Branch B discovery never queries Branch A.
    expect(b.trips[0].tripId).not.toBe(a.trips[0].tripId);
    expect(b.trips[0].accountTripId).not.toBe(a.trips[0].accountTripId);
    await account.update(principal({ baseId: BASE_B }), { emailMarketing: true, smsMarketing: false, postalMarketing: false, preferredAirports: [], preferredMonths: [] });
    expect(airtable.updateRecord.mock.calls.map((call) => call[0])).toEqual([BASE_B]);
  });

  it('cannot open another base’s account trip', async () => {
    const { account } = setup();
    const fromA = (await account.account(principal())).trips.find((trip) => trip.name === 'Lisbon')!;
    await expect(account.open(principal({ baseId: BASE_B }), fromA.accountTripId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('asks a session without a verified Customer to verify instead of guessing from the email', async () => {
    const { account, airtable } = setup();
    const failure = await account.account(principal({ customerRecordId: null })).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ForbiddenException);
    expect(((failure as HttpException).getResponse() as { code: string }).code).toBe('verification_required');
    expect(airtable.record).not.toHaveBeenCalled();
  });

  it('reports a removed Customer profile without falling back to other records', async () => {
    const tables = world();
    delete tables[BASE_A].Customers[GRACE];
    const { account, airtable } = setup(tables);
    await expect(account.account(principal())).rejects.toBeInstanceOf(NotFoundException);
    expect(airtable.list).not.toHaveBeenCalled();
  });

  it('blocks fellow travellers before reading any customer record', async () => {
    const { account, airtable } = setup();
    await expect(account.account(principal({ fellowTraveller: true }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(airtable.record).not.toHaveBeenCalled();
  });
});

describe('RelatedQuotationsService identity', () => {
  beforeEach(() => { process.env.VISION_LINK_SECRET = 'test-secret-at-least-32-characters'; });
  afterEach(() => { delete process.env.VISION_LINK_SECRET; });

  it('lists quotations of the verified Customer only and opens them for that Customer', async () => {
    const { quotations, sessions } = setup();
    const list = await quotations.list(principal());
    expect(list.quotations.map((quote) => quote.name)).toEqual(['Quote']);
    const opened = await quotations.open(principal(), list.quotations[0].comparisonId);
    expect(sessions.validateAccess(`Bearer ${opened.session.accessToken}`)).toMatchObject({ baseId: BASE_A, recordId: QUOTE, customerRecordId: GRACE });
  });

  it('shows nothing to a session without a verified Customer, and never searches by email', async () => {
    const { quotations, airtable } = setup();
    expect((await quotations.list(principal({ customerRecordId: null, assurance: 'legacy' }))).quotations).toEqual([]);
    expect(airtable.list).not.toHaveBeenCalled();
    expect(airtable.record).not.toHaveBeenCalled();
  });
});
