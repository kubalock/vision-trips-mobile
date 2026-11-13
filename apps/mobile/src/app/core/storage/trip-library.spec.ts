import type { MobileSession, TripSnapshot } from '@vision-trips/contracts';
import { isSessionExpired, type SavedTrip } from './saved-trips.store';
import { groupSavedTrips } from './trip-library';

function savedTrip(tripId: string, departureDate: string, returnDate: string | null, savedAt: string, stage: TripSnapshot['stage'] = 'confirmed'): SavedTrip {
  return {
    savedAt,
    identityKey: null,
    session: { accessToken: 'access', refreshToken: 'refresh', refreshExpiresAt: '2027-01-01T00:00:00Z' } as MobileSession,
    snapshot: {
      tripId,
      stage,
      summary: { name: tripId, reference: tripId, departureDate, returnDate },
    } as TripSnapshot,
  };
}

describe('trip library', () => {
  it('groups upcoming and past trips and sorts them by useful travel date', () => {
    const trips = [
      savedTrip('later', '2026-12-10', '2026-12-20', '2026-01-01T00:00:00Z'),
      savedTrip('past-old', '2025-01-01', '2025-01-10', '2026-01-01T00:00:00Z'),
      savedTrip('next', '2026-11-10', '2026-11-15', '2026-01-01T00:00:00Z'),
      savedTrip('past-new', '2026-10-01', '2026-10-10', '2026-01-01T00:00:00Z'),
    ];

    const grouped = groupSavedTrips(trips, new Date(2026, 10, 7));

    expect(grouped.upcoming.map((trip) => trip.snapshot.tripId)).toEqual(['next', 'later']);
    expect(grouped.past.map((trip) => trip.snapshot.tripId)).toEqual(['past-new', 'past-old']);
  });

  it('places cancelled trips in the past group even when their dates are upcoming', () => {
    const cancelled = savedTrip('cancelled', '2026-12-10', '2026-12-20', '2026-01-01T00:00:00Z', 'cancelled');
    expect(groupSavedTrips([cancelled], new Date(2026, 10, 7)).past).toEqual([cancelled]);
  });

  it('treats missing, invalid, and elapsed refresh expiries as expired', () => {
    const now = Date.parse('2026-11-07T12:00:00Z');
    expect(isSessionExpired({ refreshExpiresAt: '2026-11-07T11:59:59Z' } as MobileSession, now)).toBe(true);
    expect(isSessionExpired({ refreshExpiresAt: 'invalid' } as MobileSession, now)).toBe(true);
    expect(isSessionExpired({ refreshExpiresAt: '2026-11-07T12:00:01Z' } as MobileSession, now)).toBe(false);
  });
});
