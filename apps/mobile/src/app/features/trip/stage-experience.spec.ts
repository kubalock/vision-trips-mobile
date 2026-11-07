import type { ItineraryItem, TripSnapshot } from '@vision-trips/contracts';
import { buildChecklist, countdownTo, passportNeedsAttention, todayAndUpcoming } from './stage-experience';

describe('stage experience', () => {
  it('separates today from the next two future itinerary items', () => {
    const item = (id: string, date: string, time: string): ItineraryItem => ({ id, startDate: date, startTime: time } as ItineraryItem);
    const result = todayAndUpcoming([item('later', '2026-11-09', '10:00'), item('today', '2026-11-07', '09:00'), item('next', '2026-11-08', '08:00'), item('third', '2026-11-10', '08:00')], new Date(2026, 10, 7, 12));
    expect(result.today.map((entry) => entry.id)).toEqual(['today']);
    expect(result.upcoming.map((entry) => entry.id)).toEqual(['next', 'later']);
  });

  it('calculates a live countdown using the first departure flight', () => {
    const trip = { summary: { departureDate: '2026-11-08' }, itinerary: [{ kind: 'flight', startDate: '2026-11-08', startTime: '12:30' }] } as TripSnapshot;
    expect(countdownTo(trip, new Date(2026, 10, 7, 10, 0))).toEqual({ days: 1, hours: 2, minutes: 30 });
  });

  it('flags passport and insurance preparation problems', () => {
    const trip = { protection: { hasFlight: true }, summary: { returnDate: '2027-01-10', countries: ['Egypt'] }, travellers: [{ name: 'Alex', firstName: 'Alex', passportExpiry: '2027-04-01', insuranceStatus: null }], payments: undefined } as TripSnapshot;
    const checklist = buildChecklist(trip, new Date(2026, 10, 7));
    expect(passportNeedsAttention('2027-04-01', '2027-01-10')).toBe(true);
    expect(checklist.find((item) => item.id === 'passports')?.level).toBe('alert');
    expect(checklist.find((item) => item.id === 'insurance')?.level).toBe('alert');
    expect(checklist.find((item) => item.id === 'entry')?.text).toContain('Egyptian visa');
  });
});
