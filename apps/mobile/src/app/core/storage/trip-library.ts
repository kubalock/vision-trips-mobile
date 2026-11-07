import type { SavedTrip } from './saved-trips.store';

export interface TripGroups {
  upcoming: SavedTrip[];
  past: SavedTrip[];
}

export function groupSavedTrips(trips: SavedTrip[], now = new Date()): TripGroups {
  const today = localDate(now);
  const past = trips.filter((trip) => isPastTrip(trip, today)).sort(comparePast);
  const upcoming = trips.filter((trip) => !isPastTrip(trip, today)).sort(compareUpcoming);
  return { upcoming, past };
}

function isPastTrip(trip: SavedTrip, today: string): boolean {
  if (trip.snapshot.stage === 'cancelled') return true;
  const endDate = trip.snapshot.summary.returnDate || trip.snapshot.summary.departureDate;
  return Boolean(endDate && endDate < today);
}

function compareUpcoming(left: SavedTrip, right: SavedTrip): number {
  const leftDate = left.snapshot.summary.departureDate || '9999-12-31';
  const rightDate = right.snapshot.summary.departureDate || '9999-12-31';
  return leftDate.localeCompare(rightDate) || right.savedAt.localeCompare(left.savedAt);
}

function comparePast(left: SavedTrip, right: SavedTrip): number {
  const leftDate = left.snapshot.summary.returnDate || left.snapshot.summary.departureDate || '';
  const rightDate = right.snapshot.summary.returnDate || right.snapshot.summary.departureDate || '';
  return rightDate.localeCompare(leftDate) || right.savedAt.localeCompare(left.savedAt);
}

function localDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
