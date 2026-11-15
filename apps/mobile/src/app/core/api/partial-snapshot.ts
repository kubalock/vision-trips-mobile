import type { TripSection, TripSnapshot } from '@vision-trips/contracts';

/**
 * A `partial` refresh left some optional sections out because Airtable couldn't return them, not because they're
 * empty. Where the app holds an earlier copy of the same trip, it keeps that copy's version of those sections so a
 * refresh never wipes extras, messages or destination guides the traveller could already see.
 */
export function withLastKnownGood(next: TripSnapshot, previous: TripSnapshot | null | undefined): TripSnapshot {
  const missing = next.freshness.status === 'partial' ? next.freshness.incompleteSections ?? [] : [];
  if (!missing.length || !previous || previous.tripId !== next.tripId || previous.accessScope !== next.accessScope) return next;
  const kept = { ...next };
  if (missing.includes('extras') && !next.extras.length) kept.extras = previous.extras;
  if (missing.includes('messages') && !next.communications.length) kept.communications = previous.communications;
  if (missing.includes('destinations') && !next.destinations.length) kept.destinations = previous.destinations;
  return kept;
}

const SECTION_LABELS: Record<TripSection, string> = {
  itinerary_details: 'some itinerary details', destinations: 'destination guides', extras: 'extras', messages: 'messages',
  agent: 'your travel expert’s details', letters: 'letters',
};

/** "Some itinerary details and messages couldn’t be refreshed." — or null when the trip refreshed completely. */
export function incompleteSectionsText(snapshot: TripSnapshot): string | null {
  const missing = snapshot.freshness.status === 'partial' ? snapshot.freshness.incompleteSections ?? [] : [];
  if (!missing.length) return null;
  const labels = missing.map((section) => SECTION_LABELS[section]);
  const joined = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `${joined[0].toUpperCase()}${joined.slice(1)} couldn’t be refreshed. We’ll try again shortly.`;
}
