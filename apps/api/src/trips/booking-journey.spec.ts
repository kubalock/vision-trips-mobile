import { beforeAll, describe, expect, it } from 'vitest';
import type { TripSnapshot } from '@vision-trips/contracts';
import { TripsService } from './trips.service.js';

const brand = { id: 'recBRANDABCDEFGHI', fields: {} };
function snapshot(fields: Record<string, unknown>): TripSnapshot {
  const booking = { id: 'recABCDEFGHIJKLMN', createdTime: '2025-01-01T10:00:00.000Z', fields: { Status: 'Confirmed', Currency: 'GBP', 'Total Price': 1000, 'MS Paid': 1000, 'MS Outstanding': 0, ...fields } };
  return new TripsService({} as never).mapSnapshot('appABCDEFGHIJKLMN', booking as never, brand as never, 'primary_customer', {} as never);
}
const statuses = (trip: TripSnapshot) => Object.fromEntries(trip.bookingJourney.steps.map((step) => [step.id, step.status]));
const isoDaysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe('booking journey', () => {
  beforeAll(() => { process.env.VISION_LINK_SECRET ??= 'booking-journey-test'; });

  it('treats the before-travel steps as done once the customer has travelled, even if the tasks were never ticked', () => {
    const trip = snapshot({ 'Departure Date': '2025-08-06', 'Return Date': '2025-08-06' });
    expect(['home', 'past', 'closed']).toContain(trip.stage);
    expect(statuses(trip)).toMatchObject({ confirmation: 'complete', reconfirmation: 'complete', documents: 'complete', pre_departure_call: 'complete' });
  });

  it('keeps the post-trip follow-up driven by the agent’s task', () => {
    expect(statuses(snapshot({ 'Departure Date': '2025-08-06', 'Return Date': '2025-08-06' })).post_trip_follow_up).toBe('current');
  });

  it('offers no add-ons and only relevant questions after the trip', () => {
    const trip = snapshot({ 'Departure Date': '2025-08-06', 'Return Date': '2025-08-06' });
    expect(trip.bookingJourney.suggestedExtras).toEqual([]);
    expect(trip.bookingJourney.faqs).toEqual([]);
  });

  it('still follows the agent’s tasks before departure', () => {
    const trip = snapshot({ 'Departure Date': isoDaysFromNow(60), 'Return Date': isoDaysFromNow(67) });
    expect(statuses(trip)).toMatchObject({ confirmation: 'complete', reconfirmation: 'current', documents: 'upcoming', pre_departure_call: 'upcoming' });
    expect(trip.bookingJourney.suggestedExtras.length).toBeGreaterThan(0);
  });

  it('still shows an outstanding balance after the trip', () => {
    const trip = snapshot({ 'Departure Date': '2025-08-06', 'Return Date': '2025-08-06', 'MS Paid': 600, 'MS Outstanding': 400 });
    expect(statuses(trip).balance).toBe('current');
    expect(trip.bookingJourney.faqs.map((faq) => faq.id)).toEqual(['balance']);
  });
});
