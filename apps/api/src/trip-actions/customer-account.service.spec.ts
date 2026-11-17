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
    expect(result.emailHint).toBe('g•••e@example.com');
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

  it('keeps an existing list of more than ten airports when saving, but never lets it grow or take new ones', async () => {
    const tables = world();
    const many = ['Aberdeen Airport', 'Belfast International Airport', 'Birmingham Airport', 'Bristol Airport', 'Cardiff Airport', 'East Midlands Airport', 'Edinburgh Airport', 'Glasgow Airport', 'Leeds Bradford Airport', 'Liverpool John Lennon Airport', 'London Gatwick', 'London Heathrow'];
    tables[BASE_A]!.Customers![GRACE]!['Preferred Departure Airport(s)'] = many;
    const { account, airtable } = setup(tables);
    const prefs = (preferredAirports: string[]) => ({ emailMarketing: false, smsMarketing: false, postalMarketing: false, preferredAirports, preferredMonths: [] });
    await expect(account.update(principal(), prefs(many))).resolves.toMatchObject({ saved: true });
    await expect(account.update(principal(), prefs(many.slice(1)))).resolves.toMatchObject({ saved: true });
    await expect(account.update(principal(), prefs([...many.slice(1), 'Manchester Airport']))).rejects.toThrow('Remove some before adding another');
    await expect(account.update(principal(), prefs([...many, 'Manchester Airport']))).rejects.toThrow();
    expect(airtable.updateRecord).toHaveBeenCalledTimes(2);
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
    expect(result.preferences.preferredMonths).toEqual([]); // The verified Customer's record is canonical; July lives on the duplicate.
    const saved = await account.update(principal(), { emailMarketing: true, smsMarketing: false, postalMarketing: false, preferredAirports: [], preferredMonths: [] });
    expect(saved.updatedRecords).toBe(2);
    expect(airtable.updateRecord.mock.calls.map((call) => [call[0], call[2]]).sort((x, y) => x.join().localeCompare(y.join()))).toEqual([[BASE_A, GRACE], [BASE_A, TWIN]]);
  });

  describe('grouped duplicates (Customer Account ID)', () => {
    function grouped() {
      const tables = world();
      tables[BASE_A].Customers[GRACE]['Customer Account ID'] = 'acct-grace';
      tables[BASE_A].Customers[TWIN] = { 'Primary Email': 'grace.old@example.com', 'Customer Account ID': 'acct-grace', 'Email Marketing': true, Trips: [TWIN_TRIP] };
      tables[BASE_A].Bookings[TWIN_TRIP] = booking('Twin trip', [TWIN]);
      return tables;
    }

    it('refuses an account grouped over more than 20 Customer records instead of silently leaving one out', async () => {
      const tables = grouped();
      for (let index = 0; index < 19; index += 1) tables[BASE_A].Customers[`recEXTRA${String(index).padStart(9, '0')}`] = { 'Customer Account ID': 'acct-grace', Trips: [] };
      const { account, airtable } = setup(tables);
      // Grace, her twin and 19 more: 21 records under one Customer Account ID.
      await expect(account.account(principal())).rejects.toMatchObject({ response: { code: 'account_group_too_large' } });
      expect(airtable.list.mock.calls[0][2]).toMatchObject({ maxRecords: 21 });
      delete tables[BASE_A].Customers['recEXTRA000000018'];
      await expect(account.account(principal())).resolves.toMatchObject({ emailHint: 'g•••e@example.com' });
    });

    it('opens a duplicate’s trip as the verified Customer, recording the duplicate only as the booking owner', async () => {
      const { account, sessions } = setup(grouped());
      const twin = (await account.account(principal())).trips.find((trip) => trip.name === 'Twin trip')!;
      const lisbon = await account.open(principal(), (await account.account(principal())).trips.find((trip) => trip.name === 'Lisbon')!.accountTripId);
      const opened = await account.open(principal({ assurance: 'trusted_device' }), twin.accountTripId);
      expect(sessions.validateAccess(`Bearer ${opened.session.accessToken}`)).toMatchObject({
        baseId: BASE_A, recordId: TWIN_TRIP, customerRecordId: GRACE, bookingOwnerCustomerRecordId: TWIN, accountKey: 'account:acct-grace', assurance: 'trusted_device',
      });
      // One account on the device: the same identity key for Grace's own trip and the duplicate's trip.
      expect(opened.session.identityKey).toBe(lisbon.session.identityKey);
    });

    it('writes the verified Customer first and says so when only some grouped records saved', async () => {
      const { account, airtable } = setup(grouped());
      airtable.updateRecord.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Airtable is temporarily unavailable.'));
      const saving = account.update(principal(), { emailMarketing: false, smsMarketing: false, postalMarketing: false, preferredAirports: [], preferredMonths: [] });
      await expect(saving).rejects.toMatchObject({ response: { code: 'preferences_partially_saved', savedRecords: 1, totalRecords: 2 } });
      expect(airtable.updateRecord.mock.calls.map((call) => call[2])).toEqual([GRACE, TWIN]);
      // Only the record that changed gets an audit comment, which says the save was partial.
      expect(airtable.addComment.mock.calls.map((call) => call[2])).toEqual([GRACE]);
      expect(airtable.addComment.mock.calls[0][3]).toContain('saved on 1 of 2 grouped records');
    });

    it('reports the original error, with no comments, when nothing saved', async () => {
      const { account, airtable } = setup(grouped());
      const failure = new Error('Airtable is temporarily unavailable.');
      airtable.updateRecord.mockRejectedValueOnce(failure);
      await expect(account.update(principal(), { emailMarketing: true, smsMarketing: false, postalMarketing: false, preferredAirports: [], preferredMonths: [] })).rejects.toBe(failure);
      expect(airtable.updateRecord).toHaveBeenCalledOnce();
      expect(airtable.addComment).not.toHaveBeenCalled();
    });

    it('keeps the account across a further hop and token refresh', async () => {
      const { account, sessions } = setup(grouped());
      const twin = (await account.account(principal())).trips.find((trip) => trip.name === 'Twin trip')!;
      const opened = await account.open(principal(), twin.accountTripId);
      const fromTwin = sessions.validateAccess(`Bearer ${opened.session.accessToken}`);
      const back = (await account.account(fromTwin)).trips.find((trip) => trip.name === 'Japan')!;
      const japan = await account.open(fromTwin, back.accountTripId);
      expect(sessions.validateAccess(`Bearer ${japan.session.accessToken}`)).toMatchObject({ customerRecordId: GRACE, bookingOwnerCustomerRecordId: null, accountKey: 'account:acct-grace' });
      expect((await sessions.refresh(japan.session.refreshToken)).identityKey).toBe(opened.session.identityKey);
    });

    it('never lets an opt-out on any grouped record be hidden by an opt-in on another', async () => {
      const tables = grouped();
      tables[BASE_A].Customers[TWIN]['Email Marketing Unsubscribe'] = true; // Grace opted in; her duplicate unsubscribed.
      const { account } = setup(tables);
      expect((await account.account(principal())).preferences.emailMarketing).toBe(false);
      tables[BASE_A].Customers[TWIN]['Email Marketing Unsubscribe'] = false;
      expect((await account.account(principal())).preferences.emailMarketing).toBe(true); // Both opted in.
    });

    it('does not treat a booking linked to an ungrouped same-email record as a duplicate’s', async () => {
      const { account } = setup(grouped());
      expect((await account.account(principal())).trips.map((trip) => trip.name)).not.toContain('Impostor trip');
    });
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
    // The Quote booking has no Total Price: it stays unknown rather than becoming £0.
    expect(list.quotations[0]).toMatchObject({ total: null, perPerson: null });
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

describe('RelatedQuotationsService rules (PHP 2.0 alignment)', () => {
  beforeEach(() => { process.env.VISION_LINK_SECRET = 'test-secret-at-least-32-characters'; });
  afterEach(() => { delete process.env.VISION_LINK_SECRET; });

  it('lists only real, unexpired Quotation-status bookings of the verified Customer, at most 12, with nights and per person', async () => {
    const tables = world();
    const quoteIds = Array.from({ length: 15 }, (_, index) => `recQUOTEMANY${String(index).padStart(5, '0')}`);
    tables[BASE_A].Customers[GRACE].Trips = [LISBON, 'recQUOTEEXPIRED01', 'recQUOTEBLANK0001', 'recQUOTEIMPOSTOR', ...quoteIds];
    tables[BASE_A].Bookings['recQUOTEEXPIRED01'] = booking('Expired', [GRACE], { Status: 'Quotation', 'Quotation Expiry': '2020-01-01' });
    tables[BASE_A].Bookings['recQUOTEBLANK0001'] = booking('Blank status', [GRACE], { Status: '' });
    tables[BASE_A].Bookings['recQUOTEIMPOSTOR'] = booking('Not linked back', [IMPOSTOR], { Status: 'Quotation' });
    quoteIds.forEach((id, index) => { tables[BASE_A].Bookings[id] = booking(`Option ${index}`, [GRACE], { Status: 'Quotation', 'Quotation Expiry': '2099-01-01', 'Departure Date': `2099-02-${String(index + 1).padStart(2, '0')}`, 'Return Date': `2099-03-${String(index + 1).padStart(2, '0')}`, 'Total Price': 3000, 'Total Passengers': 2 }); });
    const { quotations, airtable } = setup(tables);
    const list = (await quotations.list(principal())).quotations;
    expect(list).toHaveLength(12);
    expect(list.map((quote) => quote.name)).not.toEqual(expect.arrayContaining(['Expired', 'Blank status', 'Not linked back', 'Impostor trip']));
    expect(list[0]).toMatchObject({ name: 'Option 0', nights: 28, perPerson: 1500 });
    expect(basesTouched(airtable)).toEqual(new Set([BASE_A]));
    expect(airtable.list).not.toHaveBeenCalled();
  });

  it('never shows branch A quotations to the same IDs in branch B', async () => {
    const tables = world();
    tables[BASE_B].Bookings[LISBON] = booking('Branch B quote', [GRACE], { Status: 'Quotation', 'Quotation Expiry': '2099-01-01' });
    const { quotations, airtable } = setup(tables);
    const list = await quotations.list(principal({ baseId: BASE_B }));
    expect(list.quotations.map((quote) => quote.name)).toEqual(['Branch B quote']);
    expect(basesTouched(airtable)).toEqual(new Set([BASE_B]));
  });
});

describe('CustomerAccountService trip order', () => {
  beforeEach(() => { process.env.VISION_LINK_SECRET = 'test-secret-at-least-32-characters'; });
  afterEach(() => { delete process.env.VISION_LINK_SECRET; });

  it('lists the open trip, then upcoming (soonest first, undated last), quotations, then past trips (latest first)', async () => {
    const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    const ids = ['recTRIPCURRENT001', 'recTRIPPASTOLD001', 'recTRIPPASTNEW001', 'recTRIPSOON000001', 'recTRIPLATER00001', 'recTRIPUNDATED001', 'recTRIPQUOTE00001'];
    const tables = world();
    tables[BASE_A].Customers[GRACE].Trips = ids;
    tables[BASE_A].Bookings = {
      recTRIPCURRENT001: booking('Current', [GRACE], { 'Departure Date': '2025-01-01', 'Return Date': '2025-01-02' }),
      recTRIPPASTOLD001: booking('Past old', [GRACE], { 'Departure Date': '2024-05-01', 'Return Date': '2024-05-08' }),
      recTRIPPASTNEW001: booking('Past new', [GRACE], { 'Departure Date': '2025-06-01', 'Return Date': '2025-06-08' }),
      recTRIPSOON000001: booking('Soon', [GRACE], { 'Departure Date': future(40), 'Return Date': future(47) }),
      recTRIPLATER00001: booking('Later', [GRACE], { 'Departure Date': future(400), 'Return Date': future(407) }),
      recTRIPUNDATED001: booking('Undated', [GRACE], { 'Departure Date': '' }),
      recTRIPQUOTE00001: booking('Quote', [GRACE], { Status: 'Quotation', 'Departure Date': future(200), 'Quotation Expiry': future(30) }),
    };
    const { account } = setup(tables);
    const result = await account.account(principal({ recordId: 'recTRIPCURRENT001' }));
    expect(result.trips.map((trip) => trip.name)).toEqual(['Current', 'Soon', 'Later', 'Undated', 'Quote', 'Past new', 'Past old']);
  });
});

