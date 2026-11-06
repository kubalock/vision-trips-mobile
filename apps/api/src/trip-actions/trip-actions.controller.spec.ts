import { buildCalendar } from './trip-actions.controller.js';

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
