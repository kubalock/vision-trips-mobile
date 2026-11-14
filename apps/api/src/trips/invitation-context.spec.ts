import { NotFoundException } from '@nestjs/common';
import { InvitationTargetError, TripsService } from './trips.service.js';

const BASE = 'appBRANCHAAAAAAAA';
const records: Record<string, Record<string, unknown>> = {
  recBOOKINGTWIN001: { Customers: ['recCUSTOMERTWIN01'] },
  recCUSTOMERGRACE1: { 'Primary Email': 'grace@example.com', 'Customer Account ID': 'acct-grace' },
  recCUSTOMERTWIN01: { 'Primary Email': 'grace.old@example.com', 'Customer Account ID': 'acct-grace' },
  recCUSTOMERSTRANG: { 'Primary Email': 'grace@example.com' },
};
const airtable = { record: vi.fn(async (_base: string, _table: string, id: string) => { if (!records[id]) throw new NotFoundException(); return { id, fields: records[id] }; }) };
const trips = new TripsService(airtable as never);

describe('TripsService.invitationContext with a grouped booking owner', () => {
  it('accepts the verified Customer through an explicitly grouped duplicate, and uses the verified Customer’s email', async () => {
    const context = await trips.invitationContext(BASE, 'recBOOKINGTWIN001', 'recCUSTOMERGRACE1', 'recCUSTOMERTWIN01');
    expect(context.customer).toMatchObject({ email: 'grace@example.com', accountId: 'acct-grace' });
  });

  it('refuses the verified Customer on a booking they are not linked to, without a grouped owner', async () => {
    await expect(trips.invitationContext(BASE, 'recBOOKINGTWIN001', 'recCUSTOMERGRACE1')).rejects.toBeInstanceOf(InvitationTargetError);
  });

  it('refuses an owner that merely shares an email but is not grouped', async () => {
    records.recBOOKINGTWIN001 = { Customers: ['recCUSTOMERSTRANG'] };
    await expect(trips.invitationContext(BASE, 'recBOOKINGTWIN001', 'recCUSTOMERGRACE1', 'recCUSTOMERSTRANG')).rejects.toBeInstanceOf(InvitationTargetError);
  });
});
