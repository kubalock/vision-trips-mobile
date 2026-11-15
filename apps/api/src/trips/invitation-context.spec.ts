import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
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

describe('TripsService.invitationContext and the Brand', () => {
  const brandId = 'recBRANDAAAAAAAAA';
  const brandRecords: Record<string, Record<string, unknown>> = {
    recBOOKINGBRAND01: { Customers: ['recCUSTOMERGRACE1'], 'Brands & Branches': [brandId] },
    recCUSTOMERGRACE1: { 'Primary Email': 'grace@example.com', Trips: ['recBOOKINGBRAND01'] },
  };
  const service = (brand: () => Promise<{ id: string; fields: Record<string, unknown> }>) => new TripsService({
    record: vi.fn(async (_base: string, table: string, id: string) => table === 'Brands & Branches' ? brand() : { id, fields: brandRecords[id] }),
  } as never);

  it('fails, rather than sending default branding, when the Brand cannot be read', async () => {
    const unavailable = service(async () => { throw new ServiceUnavailableException('Airtable is temporarily unavailable.'); });
    await expect(unavailable.invitationContext(BASE, 'recBOOKINGBRAND01', 'recCUSTOMERGRACE1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('uses default branding only when the Brand record no longer exists', async () => {
    const missing = service(async () => { throw new NotFoundException(); });
    await expect(missing.invitationContext(BASE, 'recBOOKINGBRAND01', 'recCUSTOMERGRACE1')).resolves.toMatchObject({ brand: { name: 'Your travel company' } });
    const found = service(async () => ({ id: brandId, fields: { 'Brand Name': 'Sunway Travel' } }));
    await expect(found.invitationContext(BASE, 'recBOOKINGBRAND01', 'recCUSTOMERGRACE1')).resolves.toMatchObject({ tenantId: brandId });
  });
});
