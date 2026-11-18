import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AirtableRecord } from '../airtable/airtable.service.js';
import { mapPayments } from './trips.service.js';

const booking = { id: 'recBooking', fields: { Currency: 'GBP' } } as unknown as AirtableRecord;
const deposit = { id: 'recDeposit', fields: { 'Customer Payment Type': 'Deposit Payment', Amount: 120, Status: 'Outstanding', 'Date Due': '2020-01-01' } } as unknown as AirtableRecord;

describe('mapPayments on a quotation', () => {
  const original = process.env.VISION_LINK_SECRET;
  beforeAll(() => { process.env.VISION_LINK_SECRET = 'test-secret-for-payment-ids-0123456789'; });
  afterAll(() => { if (original === undefined) delete process.env.VISION_LINK_SECRET; else process.env.VISION_LINK_SECRET = original; });

  it('never marks a past due date overdue before the quotation is accepted', () => {
    expect(mapPayments(booking, [deposit], 'quote', 'trp_1', false, false).items[0].status).toBe('outstanding');
  });

  it('marks it overdue once the quotation is accepted, and on a confirmed booking', () => {
    expect(mapPayments(booking, [deposit], 'quote', 'trp_1', false, false, true).items[0].status).toBe('overdue');
    expect(mapPayments(booking, [deposit], 'confirmed', 'trp_1', false, false).items[0].status).toBe('overdue');
  });
});
