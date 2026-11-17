import { NotFoundException } from '@nestjs/common';
import type { AirtableRecord } from '../airtable/airtable.service.js';
import { DurableAuthStore } from '../sessions/durable-auth.store.js';
import type { SessionPrincipal } from '../sessions/sessions.service.js';
import { CustomerAccountService } from './customer-account.service.js';
import { PROFILE_UPDATES_PER_HOUR, TravellerProfilesService, validate } from './traveller-profiles.service.js';

const BASE_A = 'appBRANCHAAAAAAAA';
const BASE_B = 'appBRANCHBBBBBBBB';
const GRACE = 'recCUSTOMERGRACE1';
const STRANGER = 'recCUSTOMERSTRANG';
const GRACE_PERSON = 'recPERSONGRACE001';
const CHILD = 'recPERSONCHILD001';
const NOT_LINKED_BACK = 'recPERSONOTHER001';

type Tables = Record<string, Record<string, Record<string, Record<string, unknown>>>>;
function fakeAirtable(tables: Tables) {
  const table = (base: string, name: string) => tables[base]?.[name] ?? {};
  const toRecord = (id: string, fields: Record<string, unknown>): AirtableRecord => ({ id, fields: structuredClone(fields) } as AirtableRecord);
  return {
    record: vi.fn(async (base: string, name: string, id: string) => { const fields = table(base, name)[id]; if (!fields) throw new NotFoundException('missing'); return toRecord(id, fields); }),
    records: vi.fn(async (base: string, name: string, ids: string[]) => ids.filter((id) => table(base, name)[id]).map((id) => toRecord(id, table(base, name)[id]))),
    list: vi.fn(async () => { throw new Error('No searches allowed'); }),
    updateRecord: vi.fn(async (base: string, name: string, id: string, fields: Record<string, unknown>) => { Object.assign(table(base, name)[id]!, fields); return {}; }),
    addComment: vi.fn().mockResolvedValue(undefined),
  };
}

function world(): Tables {
  return {
    [BASE_A]: {
      Customers: {
        [GRACE]: { 'Primary Email': 'grace@example.com', 'Customers [People]': [GRACE_PERSON, CHILD, NOT_LINKED_BACK], 'Loyalty Transactions': ['recLOYALTY0000001', 'recLOYALTY0000002', 'recLOYALTY0000003'], 'Available Points': 2500, 'Loyalty Value (£)': 25, 'Lifetime Points': 4000, 'VIP Status': true },
        [STRANGER]: { 'Primary Email': 'grace@example.com', 'Customers [People]': [NOT_LINKED_BACK] },
      },
      'Customers [People]': {
        [GRACE_PERSON]: { 'Full Name': 'Grace Hopper', Customers: [GRACE], 'Passport Number': '123456876', 'Expiry Date': '2030-01-01', 'Date of Birth': '1960-12-09' },
        [CHILD]: { 'Full Name': 'Ada Hopper', Customers: [GRACE] },
        [NOT_LINKED_BACK]: { 'Full Name': 'Someone Else', Customers: [STRANGER], 'Passport Number': 'ZZ9999999' },
      },
      Bookings: { recBOOKINGAAAAAAA: { Members: ['recMEMBERAAAAAAAA'], Customers: [GRACE], 'Trip Name': 'Lisbon' } },
      Members: { recMEMBERAAAAAAAA: { 'Loyalty Scheme Enabled': true } },
      'Loyalty Transactions': {
        recLOYALTY0000001: { 'Transaction Type': 'Earn', Points: 1500, Date: '2026-05-01', Booking: ['recBOOKINGAAAAAAA'], Customer: [GRACE] },
        recLOYALTY0000002: { 'Transaction Type': 'Redeem', Points: -500, Date: '2026-07-01', Customer: [GRACE] },
        // Linked from Grace's record but belonging to someone else: never shown.
        recLOYALTY0000003: { 'Transaction Type': 'Earn', Points: 9999, Date: '2026-08-01', Customer: [STRANGER] },
      },
    },
    // Branch B: the same record IDs mean a different customer.
    [BASE_B]: {
      Customers: { [GRACE]: { 'Primary Email': 'grace@example.com', 'Customers [People]': [GRACE_PERSON] } },
      'Customers [People]': { [GRACE_PERSON]: { 'Full Name': 'Branch B Grace', Customers: [GRACE], 'Passport Number': 'BBBBBB111' } },
      Bookings: { recBOOKINGAAAAAAA: { Members: ['recMEMBERBBBBBBBB'], Customers: [GRACE] } },
      Members: { recMEMBERBBBBBBBB: { 'Loyalty Scheme Enabled': false } },
    },
  };
}

const principal = (overrides: Partial<SessionPrincipal> = {}): SessionPrincipal => ({ baseId: BASE_A, recordId: 'recBOOKINGAAAAAAA', fellowTraveller: false, customerRecordId: GRACE, assurance: 'otp', ...overrides });
const basesTouched = (airtable: ReturnType<typeof fakeAirtable>) => new Set([...airtable.record.mock.calls, ...airtable.records.mock.calls, ...airtable.updateRecord.mock.calls].map((call) => call[0]));

describe('TravellerProfilesService', () => {
  beforeEach(() => { process.env.VISION_LINK_SECRET = 'test-secret-at-least-32-characters'; });
  afterEach(() => { delete process.env.VISION_LINK_SECRET; });
  const setup = (tables = world()) => { const airtable = fakeAirtable(tables); return { airtable, tables, service: new TravellerProfilesService(airtable as never, new DurableAuthStore(':memory:')) }; };

  it('lists only people linked both ways to the verified Customer, masked, without record IDs', async () => {
    const { service, airtable } = setup();
    const { travellers } = await service.list(principal());
    expect(travellers.map((traveller) => traveller.name)).toEqual(['Grace Hopper', 'Ada Hopper']);
    expect(travellers[0]).toMatchObject({ passport: { numberHint: '···876', expiryDate: '2030-01-01' } });
    const serialized = JSON.stringify(travellers);
    for (const secret of ['123456', 'rec', 'ZZ9999999']) expect(serialized).not.toContain(secret);
    expect(airtable.list).not.toHaveBeenCalled();
  });

  it('keeps branches apart: the same IDs in branch B are a different person', async () => {
    const { service, airtable } = setup();
    const { travellers } = await service.list(principal({ baseId: BASE_B }));
    expect(travellers.map((traveller) => traveller.name)).toEqual(['Branch B Grace']);
    const idA = (await service.list(principal())).travellers[0]!.travellerId;
    expect(travellers[0]!.travellerId).not.toBe(idA);
    await expect(service.update(principal({ baseId: BASE_B }), idA, { nationality: 'British' })).rejects.toBeInstanceOf(NotFoundException);
    expect(basesTouched(airtable)).toEqual(new Set([BASE_A, BASE_B]));
  });

  it('writes only allow-listed fields to the owned person, with an audit comment that leaves out the values', async () => {
    const { service, airtable, tables } = setup();
    const id = (await service.list(principal())).travellers[0]!.travellerId;
    const result = await service.update(principal(), id, { passportNumber: 'ab 123 4567', passportExpiryDate: '2034-03-01' });
    expect(airtable.updateRecord).toHaveBeenCalledWith(BASE_A, 'Customers [People]', GRACE_PERSON, { 'Passport Number': 'AB1234567', 'Expiry Date': '2034-03-01' });
    expect(result.traveller.passport.numberHint).toBe('···567');
    const comment = airtable.addComment.mock.calls[0]!;
    expect(comment.slice(0, 3)).toEqual([BASE_A, 'Customers', GRACE]);
    expect(comment[3]).toContain('passport number, passport expiry date');
    expect(comment[3]).not.toContain('AB1234567');
    expect(tables[BASE_A]!['Customers [People]']![GRACE_PERSON]!['Full Name']).toBe('Grace Hopper');
  });

  it('refuses names, dates of birth, unknown or arbitrary Airtable field names, and someone else’s person', async () => {
    const { service, airtable } = setup();
    const id = (await service.list(principal())).travellers[0]!.travellerId;
    for (const body of [{ name: 'New Name' }, { dateOfBirth: '1990-01-01' }, { 'Full Name': 'X' }, { 'Passport Number': 'AB12345' }, { airlineLoyalty: 'BA Gold' }]) {
      await expect(service.update(principal(), id, body)).rejects.toMatchObject({ status: 400 });
    }
    await expect(service.update(principal(), 'tvl_aaaaaaaaaaaaaaaaaaaaaa', { nationality: 'British' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update(principal({ fellowTraveller: true }), id, { nationality: 'British' })).rejects.toMatchObject({ status: 403 });
    expect(airtable.updateRecord).not.toHaveBeenCalled();
  });

  it('validates formats and dates', () => {
    const today = new Date('2026-11-17T00:00:00Z');
    expect(() => validate({ passportNumber: '12' }, today)).toThrow(/5 to 12/);
    expect(() => validate({ nationality: 'Brit1sh' }, today)).toThrow(/letters only/);
    expect(() => validate({ passportIssueDate: '2027-01-01' }, today)).toThrow(/future/);
    expect(() => validate({ passportIssueDate: '2020-01-01', passportExpiryDate: '2019-01-01' }, today)).toThrow(/after its issue date/);
    expect(() => validate({ nextOfKinPhone: '123' }, today)).toThrow(/full phone/);
    expect(validate({ nextOfKinName: 'Mary O’Neil-Smith', nextOfKinPhone: '+44 7700 900123' }, today)).toEqual({ nextOfKinName: 'Mary O’Neil-Smith', nextOfKinPhone: '+44 7700 900123' });
  });

  it('rate-limits profile updates on their own allowance', async () => {
    const { service } = setup();
    const id = (await service.list(principal())).travellers[1]!.travellerId;
    for (let index = 0; index < PROFILE_UPDATES_PER_HOUR; index += 1) await service.update(principal(), id, { nextOfKinName: `Name ${'a'.repeat(index % 3 + 1)}` });
    await expect(service.update(principal(), id, { nextOfKinName: 'One More' })).rejects.toMatchObject({ status: 429 });
  });
});

describe('account loyalty', () => {
  beforeEach(() => { process.env.VISION_LINK_SECRET = 'test-secret-at-least-32-characters'; });
  afterEach(() => { delete process.env.VISION_LINK_SECRET; });
  const account = (tables = world()) => { const airtable = fakeAirtable(tables); return { airtable, service: new CustomerAccountService(airtable as never, { snapshot: vi.fn() } as never, {} as never) }; };

  it('shows the verified Customer’s points, VIP and history, dropping transactions owned by someone else', async () => {
    const { service } = account();
    const result = await service.account(principal());
    expect(result.vip).toBe(true);
    expect(result.loyalty).toMatchObject({ available: 2500, availableValue: 25, lifetime: 4000 });
    expect(result.loyalty?.transactions.map((tx) => [tx.type, tx.points])).toEqual([['redeem', -500], ['earn', 1500]]);
    expect(JSON.stringify(result.loyalty)).not.toContain('9999');
    expect(JSON.stringify(result.loyalty)).not.toContain('rec');
  });

  it('shows no loyalty where the member scheme is off (branch B), and degrades to null on broken links', async () => {
    expect((await account().service.account(principal({ baseId: BASE_B }))).loyalty).toBeNull();
    const tables = world();
    delete tables[BASE_A]!.Members;
    await expect(account(tables).service.account(principal())).resolves.toMatchObject({ loyalty: null });
  });

  it('gives an empty history with unknown balances when the Customer has no loyalty data', async () => {
    const tables = world();
    tables[BASE_A]!.Customers![GRACE] = { 'Primary Email': 'grace@example.com' };
    const result = await account(tables).service.account(principal());
    expect(result.loyalty).toEqual({ available: null, availableValue: null, currency: 'GBP', lifetime: null, expiresAt: null, transactions: [] });
  });
});
