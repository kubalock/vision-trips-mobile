import { buildCalendar, buildDocument } from './trip-actions.controller.js';

describe('calendar export', () => {
  it('creates an iCalendar event without exposing Airtable ids', () => {
    const calendar = buildCalendar({
      tripId: 'trp_public',
      summary: { name: 'Lisbon Escape' },
      itinerary: [{
        id: 'itm_public', title: 'London to Lisbon', typeLabel: 'Flight', startDate: '2027-03-01', endDate: '2027-03-01',
        startTime: '10:30', endTime: '13:10', from: 'London', to: 'Lisbon', reference: 'ABC123', notes: null, address: null,
      }],
    } as never);
    expect(calendar).toContain('BEGIN:VCALENDAR');
    expect(calendar).toContain('SUMMARY:London to Lisbon');
    expect(calendar).toContain('DTSTART:20270301T103000');
    expect(calendar).not.toContain('recABCDEFGHIJKLMN');
  });
});

describe('generated documents', () => {
  it('escapes customer content in printable confirmation HTML', () => {
    const html = buildDocument({
      summary: { name: '<script>alert(1)</script>', reference: 'VT-1' }, brand: { name: 'Example Travel' }, stage: 'confirmed',
      itinerary: [], protection: { summary: 'See confirmation.' }, serverTime: '2026-11-06T10:00:00Z',
    } as never, 'confirmation');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
