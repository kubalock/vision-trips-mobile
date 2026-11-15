import type { ItineraryItem, TripDocument, TripSection, TripSnapshot } from '@vision-trips/contracts';

/**
 * A `partial` refresh leaves out each section Airtable couldn't return in full (the API never sends half a section).
 * Where the app holds an earlier copy of the same trip, it keeps that copy's version of those sections, so a refresh
 * never shortens messages or drops extras, destination guides, letters or travel-expert details the traveller could
 * already see:
 *
 * - extras, messages, destinations: the earlier section as a whole;
 * - agent (it shapes financial protection): the earlier protection details and certificates;
 * - letters: the earlier letter templates and letter documents;
 * - itinerary details (supplier, airport, airline, ship and port names): the core itinerary is always fresh, so
 *   each item keeps the details it had before wherever this refresh left them blank.
 *
 * Document versions were computed by the server from the incomplete data, so a document already held keeps its
 * earlier version until a complete refresh: no false "document updated" notices or wallet badges in the meantime.
 */
export function withLastKnownGood(next: TripSnapshot, previous: TripSnapshot | null | undefined): TripSnapshot {
  const missing = next.freshness.status === 'partial' ? next.freshness.incompleteSections ?? [] : [];
  if (!missing.length || !previous || previous.tripId !== next.tripId || previous.accessScope !== next.accessScope) return next;
  const has = (section: TripSection) => missing.includes(section);
  const kept: TripSnapshot = { ...next };
  if (has('extras')) kept.extras = previous.extras;
  if (has('messages')) kept.communications = previous.communications;
  if (has('destinations')) kept.destinations = previous.destinations;
  if (has('itinerary_details')) kept.itinerary = withEarlierDetails(next.itinerary, previous.itinerary);
  if (has('agent')) kept.protection = previous.protection;
  if (has('letters')) kept.brand = { ...next.brand, profile: { ...next.brand.profile, letterTemplates: previous.brand.profile.letterTemplates } };
  kept.documents = keptDocuments(next.documents, previous.documents, {
    letters: has('letters'),
    // Protection certificates depend on the agent's licensing, which wasn't read this time.
    certificates: has('agent'),
  });
  return kept;
}

const CERTIFICATE_KINDS: ReadonlyArray<TripDocument['kind']> = ['atol', 'guarantee'];

function keptDocuments(next: TripDocument[], previous: TripDocument[], replace: { letters: boolean; certificates: boolean }): TripDocument[] {
  const fromPrevious = (document: TripDocument) => (replace.letters && document.kind === 'letter') || (replace.certificates && CERTIFICATE_KINDS.includes(document.kind));
  const earlier = new Map(previous.map((document) => [document.id, document]));
  const current = next.filter((document) => !fromPrevious(document)).map((document) => {
    const before = earlier.get(document.id);
    return before ? { ...document, version: before.version } : document;
  });
  return [...current, ...previous.filter(fromPrevious)];
}

/** Each item's blank fields (null, empty text or empty list) are filled from the same item in the earlier copy. */
function withEarlierDetails(next: ItineraryItem[], previous: ItineraryItem[]): ItineraryItem[] {
  const earlier = new Map(previous.map((item) => [item.id, item]));
  return next.map((item) => {
    const before = earlier.get(item.id);
    if (!before) return item;
    const filled: Record<string, unknown> = { ...item };
    for (const [key, value] of Object.entries(before)) {
      if (isBlank(filled[key]) && !isBlank(value)) filled[key] = value;
    }
    return filled as unknown as ItineraryItem;
  });
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
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
