import { describe, expect, it } from 'vitest';
import type { TripSnapshot } from '@vision-trips/contracts';
import { mergeLetter, PdfDocumentService } from './pdf-document.service.js';

describe('PdfDocumentService', () => {
  it('creates a real PDF booking confirmation', async () => {
    const snapshot = {
      brand: { name: 'Example Travel' }, summary: { reference: 'VT-100', name: 'Lisbon Escape', departureDate: '2027-03-01', returnDate: '2027-03-08' },
      experience: { overview: 'A week in Lisbon.' }, travellers: [{ name: 'Alex Traveller' }],
      itinerary: [{ startDate: '2027-03-01', startTime: '10:00', title: 'London to Lisbon', reference: 'ABC123' }],
      protection: { summary: 'ATOL protected.' }, serverTime: '2026-11-07T12:00:00.000Z',
    } as TripSnapshot;
    const result = await new PdfDocumentService().create(snapshot, 'confirmation');

    expect(result.subarray(0, 5).toString()).toBe('%PDF-');
    expect(result.length).toBeGreaterThan(1_000);
  });

  it.each(['front-file', 'guarantee', 'letter:ltr_public'])('creates the dedicated %s printable PDF', async (action) => {
    const snapshot = richSnapshot();
    const result = await new PdfDocumentService().create(snapshot, action);
    expect(result.subarray(0, 5).toString()).toBe('%PDF-');
    expect(result.length).toBeGreaterThan(1_000);
  });

  it('merges only the supported communication letter fields', () => {
    const merged = mergeLetter('Dear {{first_name}}, {{trip_name}} costs {{total}}. {{unknown}}', richSnapshot());
    expect(merged).toContain('Dear Alex, Lisbon Escape costs £2,500.00.');
    expect(merged).toContain('{{unknown}}');
  });
});

function richSnapshot(): TripSnapshot {
  return {
    brand: { name: 'Example Travel', profile: { letterTemplates: [{ id: 'ltr_public', name: 'Welcome letter', subject: 'Welcome', body: 'Hello {{first_name}},\n\nYour reference is {{booking_ref}}.' }] } },
    summary: { reference: 'VT-100', name: 'Lisbon Escape', departureDate: '2027-03-01', returnDate: '2027-03-08', totalTravellers: 1 },
    experience: { overview: 'A week in Lisbon.', agentName: 'Jamie Agent' }, travellers: [{ name: 'Alex Traveller', firstName: 'Alex', isLead: true }],
    itinerary: [{ startDate: '2027-03-01', startTime: '10:00', title: 'London to Lisbon', typeLabel: 'Flight', reference: 'ABC123', supplier: { name: 'Trusted Air' } }],
    payments: { currency: 'GBP', total: 2500, paid: 1000, balance: 1500, balanceDueDate: '2027-01-15', items: [{ id: 'pay1', label: 'Balance', amount: 1500, currency: 'GBP', status: 'outstanding', dueDate: '2027-01-15' }] },
    bookingStatus: { sourceStatus: 'Confirmed' }, protection: { summary: 'TTA protected.', organiserName: 'Example Travel' }, serverTime: '2026-11-07T12:00:00.000Z', stage: 'confirmed',
  } as TripSnapshot;
}
