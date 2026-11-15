import type { AirtableRecord } from '../airtable/airtable.service.js';
import { TripsService } from './trips.service.js';

/** Versions must follow linked-record changes (not only the Booking), and only the documents a change affects. */
describe('snapshot and document versions', () => {
  const base = 'appABCDEFGHIJKLMN';
  const id = (n: number) => `rec${String(n).padStart(14, '0')}`;
  beforeEach(() => { process.env.VISION_LINK_SECRET = 'snapshot-secret'; });

  const booking = (url = 'https://v5.airtableusercontent.com/a/hero.jpg?sig=1'): AirtableRecord => ({
    id: id(1), createdTime: '2026-10-01T09:00:00.000Z',
    fields: { Status: 'Confirmed', 'Departure Date': '2027-05-01', 'Return Date': '2027-05-08', 'Last modified time': '2026-11-01T10:00:00.000Z', 'Hero Image': [{ id: 'att1', url, filename: 'hero.jpg' }] },
  });
  const flight = (flightNumber = 'TP1331', modified = '2026-11-01T10:00:00.000Z', docUrl = 'https://v5.airtableusercontent.com/a/eticket.pdf?sig=1'): AirtableRecord => ({
    id: id(2), createdTime: '2026-10-01T09:00:00.000Z',
    fields: { Type: 'Flight', Status: 'Confirmed', 'Trip Element Heading': 'Flight to Lisbon', 'Flight No.': flightNumber, 'Pick Up Date': '2027-05-01', 'Last modified time': modified, 'Customer Documentation': [{ id: 'attTicket', url: docUrl, filename: 'eticket.pdf', size: 1000, type: 'application/pdf' }] },
  });
  const payment = (status = 'Outstanding', modified = '2026-11-01T10:00:00.000Z'): AirtableRecord => ({
    id: id(3), createdTime: '2026-10-01T09:00:00.000Z',
    fields: { Amount: 500, Status: status, 'Customer Payment Type': 'Deposit Payment', ...(status === 'Complete' ? { 'Payment Complete': '2026-11-10' } : {}), 'Last modified time': modified },
  });
  const map = (records: { booking?: AirtableRecord; elements?: AirtableRecord[]; payments?: AirtableRecord[] } = {}) =>
    new TripsService({} as never).mapSnapshot(base, records.booking ?? booking(), { id: id(9), fields: {} }, 'primary_customer', { elements: records.elements ?? [flight()], payments: records.payments ?? [payment()] });
  const docVersion = (snapshot: ReturnType<typeof map>, kind: string) => snapshot.documents.find((document) => document.kind === kind)?.version;

  it('is stable for the same source data', () => {
    expect(map().documents.map((document) => document.kind)).toEqual(expect.arrayContaining(['confirmation', 'invoice', 'front_file', 'supplier']));
    expect(map().version).toBe(map().version);
    expect(map().documents.map((document) => document.version)).toEqual(map().documents.map((document) => document.version));
  });

  it('changes when a linked flight changes although the Booking record did not', () => {
    const before = map(); const after = map({ elements: [flight('TP1333', '2026-11-12T08:30:00.000Z')] });
    expect(after.version).not.toBe(before.version);
    expect(after.freshness.sourceUpdatedAt).toBe('2026-11-12T08:30:00.000Z');
    expect(docVersion(after, 'confirmation')).not.toBe(docVersion(before, 'confirmation'));
    expect(docVersion(after, 'front_file')).not.toBe(docVersion(before, 'front_file'));
    // The invoice doesn't show flights, so it isn't flagged as updated.
    expect(docVersion(after, 'invoice')).toBe(docVersion(before, 'invoice'));
  });

  it('changes the invoice, not the confirmation, when only a payment changes', () => {
    const before = map(); const after = map({ payments: [payment('Complete', '2026-11-10T12:00:00.000Z')] });
    expect(after.version).not.toBe(before.version);
    expect(docVersion(after, 'invoice')).not.toBe(docVersion(before, 'invoice'));
    expect(docVersion(after, 'confirmation')).toBe(docVersion(before, 'confirmation'));
    expect(after.documents.some((document) => document.kind === 'receipt')).toBe(true);
  });

  it('ignores rotating Airtable attachment links', () => {
    const before = map();
    const after = map({ booking: booking('https://v5.airtableusercontent.com/b/hero.jpg?sig=2'), elements: [flight('TP1331', '2026-11-01T10:00:00.000Z', 'https://v5.airtableusercontent.com/b/eticket.pdf?sig=2')] });
    expect(after.version).toBe(before.version);
    expect(docVersion(after, 'supplier')).toBe(docVersion(before, 'supplier'));
  });
});
