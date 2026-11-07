import { describe, expect, it } from 'vitest';
import type { TripSnapshot } from '@vision-trips/contracts';
import { PdfDocumentService } from './pdf-document.service.js';

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
});
