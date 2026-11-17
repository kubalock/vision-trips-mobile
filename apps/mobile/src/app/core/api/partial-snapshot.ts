import type { ItineraryItem, PaymentSummary, TripDocument, TripSection, TripSnapshot } from '@vision-trips/contracts';

/**
 * A `partial` refresh leaves out each section Airtable couldn't return in full (the API never sends half a section).
 * Where the app holds an earlier copy of the same trip, it keeps that copy's version of those sections, so a refresh
 * never shortens messages or drops extras, destination guides, letters or travel-expert details the traveller could
 * already see:
 *
 * - extras, messages, destinations: the earlier section as a whole;
 * - agent (it shapes financial protection): the earlier protection details and certificates;
 * - letters: the earlier letter templates and letter documents;
 * - brand (the travel company's record couldn't be read, so the server fell back to defaults): the earlier branding,
 *   theme, profile and support contacts, the protection details and certificates (which name the company), and
 *   whether each still-unpaid payment can be paid in the app (that depends on the Brand's payment settings);
 * - itinerary details (supplier, airport, airline, ship and port names): the core itinerary is always fresh, so
 *   each item keeps only those names (and the titles built from them) where this refresh left them blank.
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
  if (has('agent')) {
    kept.protection = previous.protection;
    // The member record (which says whether its loyalty scheme is on) wasn't read: keep the earlier loyalty state.
    kept.loyalty = previous.loyalty ?? null;
  }
  if (has('loyalty') && next.payments && previous.payments) {
    // Points behind loyalty payments couldn't be read: keep the earlier figures rather than showing none.
    const earlier = new Map(previous.payments.items.map((item) => [item.id, item.points]));
    kept.payments = { ...(kept.payments ?? next.payments), items: (kept.payments ?? next.payments).items.map((item) => item.kind === 'points' && (item.points === null || item.points === undefined) ? { ...item, points: earlier.get(item.id) ?? null } : item) };
  }
  if (has('letters')) kept.brand = { ...next.brand, profile: { ...next.brand.profile, letterTemplates: previous.brand.profile.letterTemplates } };
  if (has('brand')) {
    kept.brand = previous.brand;
    // Booking-level contacts (emergency phone, out-of-hours) were read fresh; only the Brand's fallbacks are missing.
    kept.support = { ...previous.support, ...withoutBlanks(next.support), companyName: previous.support.companyName };
    kept.protection = previous.protection;
    if (next.payments && previous.payments) kept.payments = withEarlierPaySettings(next.payments, previous.payments);
  }
  kept.documents = keptDocuments(next.documents, previous.documents, {
    letters: has('letters') || has('brand'),
    // Protection certificates depend on the agent's licensing and the company, which weren't read this time.
    certificates: has('agent') || has('brand'),
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

/**
 * Fields built from the optional linked tables (airports, airlines, suppliers, cruise ships and port locations). Only
 * these are filled from the earlier copy: everything read from the itinerary element itself (notes, references,
 * address, status, emergency contact, rooms, cabins, passengers and their baggage, …) is authoritative, including a
 * value the agent has just cleared.
 */
const ENRICHMENT_FIELDS = ['from', 'to', 'fromCode', 'toCode', 'carrier', 'carrierCode', 'carrierLogoUrl', 'supplier', 'cruisePorts'] as const satisfies ReadonlyArray<keyof ItineraryItem>;

/** Each item's blank enrichment fields are filled from the same item in the earlier copy. */
function withEarlierDetails(next: ItineraryItem[], previous: ItineraryItem[]): ItineraryItem[] {
  const earlier = new Map(previous.map((item) => [item.id, item]));
  return next.map((item) => {
    const before = earlier.get(item.id);
    if (!before) return item;
    const filled: Record<string, unknown> = { ...item };
    const restored = new Set<string>();
    for (const key of ENRICHMENT_FIELDS) {
      if (isBlank(item[key]) && !isBlank(before[key])) { filled[key] = before[key]; restored.add(key); }
    }
    // Titles are built from airport and ship names ("London to Lisbon", the ship's name): without those names the
    // server fell back to a generic title, so the earlier one is kept with the names it was built from.
    const placeNamesRestored = restored.has('from') || restored.has('to');
    const cruiseUnnamed = item.kind === 'cruise' && item.title === item.typeLabel;
    if ((placeNamesRestored || cruiseUnnamed) && before.title !== item.title) filled['title'] = before.title;
    return filled as unknown as ItineraryItem;
  });
}

function withoutBlanks<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => !isBlank(field))) as Partial<T>;
}

/** Payment amounts and statuses are fresh; only "can this be paid in the app" came from the Brand's settings. */
function withEarlierPaySettings(next: PaymentSummary, previous: PaymentSummary): PaymentSummary {
  const earlier = new Map(previous.items.map((item) => [item.id, item]));
  return {
    ...next,
    customPayments: previous.customPayments,
    items: next.items.map((item) => {
      const before = earlier.get(item.id);
      return before && before.status === item.status && (item.status === 'outstanding' || item.status === 'overdue') ? { ...item, canPay: before.canPay } : item;
    }),
  };
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

const SECTION_LABELS: Record<TripSection, string> = {
  itinerary_details: 'some itinerary details', destinations: 'destination guides', extras: 'extras', messages: 'messages',
  agent: 'your travel expert’s details', letters: 'letters', brand: 'your travel company’s details', loyalty: 'loyalty points',
};

/** "Some itinerary details and messages couldn’t be refreshed." — or null when the trip refreshed completely. */
export function incompleteSectionsText(snapshot: TripSnapshot): string | null {
  const missing = snapshot.freshness.status === 'partial' ? snapshot.freshness.incompleteSections ?? [] : [];
  if (!missing.length) return null;
  const labels = missing.map((section) => SECTION_LABELS[section]);
  const joined = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `${joined[0].toUpperCase()}${joined.slice(1)} couldn’t be refreshed. We’ll try again shortly.`;
}
