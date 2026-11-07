import { ForbiddenException } from '@nestjs/common';
import { CustomerAccountService } from './customer-account.service.js';

describe('CustomerAccountService', () => {
  beforeEach(() => { process.env.VISION_LINK_SECRET = 'test-secret-at-least-32-characters'; });
  afterEach(() => { delete process.env.VISION_LINK_SECRET; });

  it('discovers linked trips and merges preferences for the verified email', async () => {
    const customers = [
      { id: 'recCUSTOMERAAAAAA', fields: { 'Email Marketing': true, 'SMS Marketing': false, 'Preferred Departure Airport(s)': ['Bristol Airport'], Trips: ['recBOOKINGAAAAAAA'] } },
      { id: 'recCUSTOMERBBBBBB', fields: { 'Postal Marketing': true, 'Preferred Travel Month(s)': ['June'], Trips: ['recBOOKINGBBBBBBB'] } },
    ];
    const airtable = { list: vi.fn().mockResolvedValue(customers), records: vi.fn().mockResolvedValue([
      { id: 'recBOOKINGAAAAAAA', fields: { Status: 'Confirmed', 'Trip Name': 'Lisbon', 'Booking Reference': 'VT-1', 'Departure Date': '2027-04-01' } },
      { id: 'recBOOKINGBBBBBBB', fields: { Status: 'Quotation', 'Trip Name': 'Japan', 'Booking Reference': 'VT-2', 'Departure Date': '2028-03-01' } },
    ]) };
    const trips = { verificationProfile: vi.fn().mockResolvedValue({ email: 'alex@example.com' }) };
    const service = new CustomerAccountService(airtable as never, trips as never, {} as never);
    const account = await service.account({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recBOOKINGAAAAAAA', fellowTraveller: false });
    expect(account.emailHint).toBe('al**@example.com');
    expect(account.preferences).toMatchObject({ emailMarketing: true, smsMarketing: false, postalMarketing: true, preferredAirports: ['Bristol Airport'], preferredMonths: ['June'] });
    expect(account.trips).toHaveLength(2);
    expect(account.trips[0].current).toBe(true);
    expect(account.trips[0].accountTripId).not.toContain('rec');
  });

  it('writes only the preference fields to every matching customer record', async () => {
    const airtable = { list: vi.fn().mockResolvedValue([{ id: 'recCUSTOMERAAAAAA', fields: {} }]), records: vi.fn(), updateRecord: vi.fn().mockResolvedValue({}), addComment: vi.fn().mockResolvedValue(undefined) };
    const trips = { verificationProfile: vi.fn().mockResolvedValue({ email: 'alex@example.com' }) };
    const service = new CustomerAccountService(airtable as never, trips as never, {} as never);
    const result = await service.update({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recBOOKINGAAAAAAA', fellowTraveller: false }, { emailMarketing: true, smsMarketing: false, postalMarketing: true, preferredAirports: ['Manchester Airport'], preferredMonths: ['May', 'June'] });
    expect(result.updatedRecords).toBe(1);
    expect(airtable.updateRecord).toHaveBeenCalledWith('appABCDEFGHIJKLMN', 'Customers', 'recCUSTOMERAAAAAA', {
      'Email Marketing': true, 'Email Marketing Unsubscribe': false, 'SMS Marketing': false, 'Postal Marketing': true,
      'Preferred Departure Airport(s)': ['Manchester Airport'], 'Preferred Travel Month(s)': ['May', 'June'],
    });
  });

  it('blocks fellow travellers before searching customer records', async () => {
    const airtable = { list: vi.fn() }; const trips = { verificationProfile: vi.fn() };
    const service = new CustomerAccountService(airtable as never, trips as never, {} as never);
    await expect(service.account({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recBOOKINGAAAAAAA', fellowTraveller: true })).rejects.toBeInstanceOf(ForbiddenException);
    expect(airtable.list).not.toHaveBeenCalled();
  });
});
