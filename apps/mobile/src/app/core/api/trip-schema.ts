import { tripStages, type ExternalTripContent, type MobileSession, type TripSnapshot } from '@vision-trips/contracts';
// zod/mini: the same checks as `zod`, but tree-shakable (full zod added ~470 kB to the app bundle).
import * as z from 'zod/mini';

/**
 * Runtime checks for trip data arriving from the API or read back from storage. TypeScript types are only a
 * compile-time promise; this is what actually stands between a partial payload or an old cached trip and a
 * rendering crash.
 *
 * Policy:
 * - Reject what cannot be trusted or shown at all: an unsupported schema version, a missing trip ID, an unknown
 *   stage or access scope, a missing trip name or reference.
 * - Repair everything else: missing text becomes '' or null, missing lists become [], unknown labels fall back to
 *   a neutral value, and a malformed list item is dropped rather than failing the whole trip.
 * - Unknown fields are dropped, so the app only ever holds the shape it was built for.
 */

export const CURRENT_SCHEMA_VERSION = 4;

export class TripDataError extends Error {
  override readonly name = 'TripDataError';
  constructor(readonly reason: 'unsupported_version' | 'invalid', detail: string) {
    super(detail);
  }
}

export function isTripDataError(error: unknown): error is TripDataError {
  return error instanceof TripDataError;
}

// ---------------------------------------------------------------------------------------------------------------
// Building blocks

const text = z.catch(z.string(), '');
const nonEmpty = z.string().check(z.minLength(1));
const optText = z.catch(z.nullable(z.string()), null);
const flag = z.catch(z.boolean(), false);
const count = z.catch(z.number(), 0);
const optNumber = z.catch(z.nullable(z.number()), null);
const currencyCode = z.string().check(z.regex(/^[A-Z]{3}$/));
/** Video and affiliate links must be https; anything else is dropped (never opened). */
const httpsText = z.string().check(z.refine((value) => { try { return new URL(value).protocol === 'https:'; } catch { return false; } }, 'Expected an https URL.'));
const optHttps = z.catch(z.nullable(httpsText), null);

function oneOf<const T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) {
  return z.catch(z.enum(values), fallback);
}

/** An object whose fields each repair themselves; a missing or non-object value becomes all-defaults. */
function record<S extends z.core.$ZodLooseShape>(shape: S) {
  return z.pipe(z.transform((value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {})), z.object(shape));
}

/** A list that keeps its valid items and drops the rest; a missing or non-list value becomes []. */
function list<T extends z.ZodMiniType>(item: T) {
  return z.pipe(z.catch(z.array(z.unknown()), []), z.transform((items: unknown[]) => items.flatMap((value) => {
    const parsed = item.safeParse(value);
    return parsed.success ? [parsed.data as z.output<T>] : [];
  })));
}

const strings = list(z.string());
const imageVariant = z.object({ url: nonEmpty, width: z.number().check(z.positive()) });
const image = z.object({ url: nonEmpty, alt: text, width: optNumber, height: optNumber, variants: list(imageVariant) });
const coordinates = z.object({ latitude: z.number(), longitude: z.number() });

// ---------------------------------------------------------------------------------------------------------------
// Trip snapshot

const theme = record({
  key: text, primaryColor: text, secondaryColor: text, displayFont: text, bodyFont: text,
  overlay: oneOf(['deep', 'soft', 'warm', 'cool', 'dusk'], 'deep'),
  radius: oneOf(['crisp', 'soft', 'round'], 'soft'),
  motif: text,
  spacingScale: z.catch(z.number().check(z.positive()), 1),
});

const brandProfile = record({
  slogan: optText, about: optText, address: optText, openingHours: optText,
  socialLinks: list(z.object({ network: z.enum(['instagram', 'facebook', 'linkedin', 'x']), url: nonEmpty })),
  reviewLinks: list(z.object({ provider: z.enum(['trustpilot', 'google']), url: nonEmpty })),
  privacyUrl: optText, complaintsUrl: optText,
  whyBook: list(z.object({ title: z.string(), text: optText })),
  teamPhotoUrl: optText,
  gallery: list(image),
  mapUrl: optText,
  reassurance: list(z.object({ title: z.string(), text: z.string() })),
  footerImages: strings,
  footerText: optText,
  letterTemplates: list(z.object({ id: nonEmpty, name: z.string(), subject: optText, body: z.string() })),
  whyChooseHeader: optText, whyChooseSubheader: optText,
});

const summary = z.object({
  reference: z.string(), name: z.string(),
  departureDate: optText, returnDate: optText, heroImageUrl: optText,
  heroImage: z.catch(z.nullable(image), null),
  gallery: list(image),
  durationDays: optNumber,
  countries: strings, holidayTypes: strings,
  travellerType: optText, sector: optText,
  totalTravellers: count, groupBooking: flag, giftVoucher: flag,
});

const destinationShape = {
  id: nonEmpty, name: text, country: optText, overview: optText, attractions: strings,
  practicalInformation: optText, culturalInformation: optText, travelAdviceUrl: optText, imageUrl: optText,
  coordinates: z.catch(z.nullable(coordinates), null),
  directionsUrl: z.catch(z.optional(z.string()), undefined),
};

const cruisePort = z.object({ day: text, port: text, arrivalTime: optText, departureTime: optText, description: optText });

const itineraryItem = z.object({
  id: nonEmpty,
  kind: oneOf(['flight', 'stay', 'cruise', 'transfer', 'carhire', 'parking', 'train', 'attraction', 'misc'], 'misc'),
  typeLabel: text, title: text, status: text,
  startDate: optText, endDate: optText, startTime: optText, endTime: optText,
  from: optText, to: optText, carrier: optText, flightNumber: optText, reference: optText, address: optText, notes: optText,
  supplier: z.catch(z.nullable(z.object({ name: z.string(), logoUrl: optText, termsUrl: optText })), null),
  images: list(image),
  rooms: list(z.object({ type: text, board: optText, view: optText, requests: optText })),
  cabins: list(z.object({ name: text, grade: optText, number: optText, deck: optText, side: optText, position: optText, bed: optText, dining: optText })),
  passengers: list(z.object({ name: text, bookingReference: optText, travelClass: optText, seat: optText, cabinBaggage: optText, checkedBaggage: optText, extras: optText, meal: optText, assistance: optText })),
  cruisePorts: list(cruisePort),
  emergencyContact: z.catch(z.nullable(z.object({ name: z.string(), phone: nonEmpty })), null),
  details: list(z.object({ label: z.string(), value: z.string() })),
  fromCode: optText, toCode: optText, carrierCode: optText, carrierLogoUrl: optText,
  arrivesNextDay: flag, packageIncluded: flag,
  departureTerminal: optText, arrivalTerminal: optText,
  terminalSource: z.catch(z.nullable(z.enum(['booking', 'notes'])), null), termsUrl: optText, confirmationReceived: flag, ticketsReceived: flag,
});

const paymentItem = z.object({
  id: nonEmpty, label: text, amount: optNumber, currency: currencyCode,
  status: oneOf(['outstanding', 'paid', 'overdue', 'local', 'refund'], 'outstanding'),
  dueDate: optText, completedDate: optText,
  canPay: flag, actionUrl: optText,
  kind: oneOf(['money', 'points'], 'money'), points: optNumber,
});

/** A payment summary without a readable currency is left out entirely rather than shown in the wrong currency. */
const payments = z.catch(z.optional(z.object({
  currency: currencyCode,
  total: optNumber, paid: optNumber, balance: optNumber,
  items: list(paymentItem),
  totalIncludingResort: optNumber, nextDueAmount: optNumber, nextDueDate: optText, balanceDueDate: optText,
  alternativeCurrency: z.catch(z.nullable(z.object({ currency: currencyCode, amount: z.number() })), null),
  customPayments: record({ enabled: flag, minimum: count, maximum: count }),
  perPerson: optNumber,
})), undefined);

const video = z.object({
  kind: z.enum(['file', 'youtube', 'vimeo']), url: httpsText, mimeType: optText, posterUrl: optText, title: text,
});
const contentItem = z.object({ text: nonEmpty });

const tripDocument = z.object({
  id: nonEmpty, title: text, description: text,
  kind: z.enum(['confirmation', 'invoice', 'receipt', 'atol', 'front_file', 'guarantee', 'letter', 'supplier']),
  url: optText, offlineAvailable: flag,
  status: oneOf(['ready', 'pending', 'unavailable'], 'unavailable'),
  downloadAction: optText, version: text, updatedAt: text, mimeType: text,
});

const snapshotSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  tripId: nonEmpty,
  version: text, serverTime: text,
  stage: z.enum(tripStages),
  accessScope: z.enum(['primary_customer', 'fellow_traveller']),
  freshness: record({
    status: oneOf(['fresh', 'stale', 'offline', 'partial'], 'stale'), sourceUpdatedAt: text, nextRefreshAfter: optText,
    incompleteSections: z.optional(list(z.enum(['itinerary_details', 'destinations', 'extras', 'messages', 'agent', 'letters', 'brand', 'loyalty']))),
  }),
  brand: record({ name: text, logoUrl: optText, theme, profile: brandProfile }),
  summary,
  experience: record({
    overview: optText, personalisedMessage: optText, agentName: optText,
    surprise: record({ enabled: flag, concealed: flag, revealAt: optText }),
  }),
  support: record({
    companyName: text, phone: optText, email: optText, websiteUrl: optText, emergencyPhone: optText,
    outOfHoursUrl: optText, outOfHoursEmail: optText, whatsappUrl: optText,
  }),
  protection: record({
    scheme: oneOf(['atol', 'non_air_package', 'not_applicable', 'unknown'], 'unknown'),
    atolNumber: optText, licensing: optText, summary: text, mode: text,
    contractType: oneOf(['package', 'package_no_flight', 'flight_only', 'accommodation_only', 'agent_services', 'ticket_agent', 'unknown'], 'unknown'),
    holderName: optText, organiserName: optText, hasFlight: flag, guaranteeAvailable: flag,
  }),
  bookingStatus: record({
    sourceStatus: text, cancellationDate: optText, cancellationReason: optText,
    supplierTicketsReceived: flag, supplierConfirmationsReceived: flag,
    tasks: record({ confirmation: flag, reconfirmed: flag, travelDocuments: flag, preDepartureCall: flag, followUp: flag }),
  }),
  quotation: record({
    status: oneOf(['available', 'expired', 'not_applicable'], 'not_applicable'),
    expiresAt: optText, canAccept: flag, requiredConfirmations: strings, accepted: flag,
    reviewSections: list(z.object({
      id: z.enum(['package', 'names', 'important', 'protection', 'terms']),
      title: text, introduction: text, items: strings,
      links: list(z.object({ label: z.string(), url: nonEmpty })),
    })),
  }),
  timeline: record({ daysUntilDeparture: optNumber, nextItemId: optText, nextItemTitle: optText, nextItemDate: optText, nextItemTime: optText }),
  bookingJourney: record({
    steps: list(z.object({
      id: z.enum(['confirmation', 'balance', 'reconfirmation', 'documents', 'pre_departure_call', 'post_trip_follow_up']),
      title: text, description: text, date: optText,
      status: oneOf(['complete', 'current', 'upcoming'], 'upcoming'),
    })),
    faqs: list(z.object({ id: nonEmpty, question: z.string(), answer: z.string() })),
    suggestedExtras: list(z.object({
      id: z.enum(['transfers', 'airport', 'flight_upgrade', 'room_upgrade', 'experiences', 'cruise_packages', 'instalments', 'insurance', 'extra_nights']),
      title: text, description: text, enquiry: text,
    })),
  }),
  destinations: list(z.object(destinationShape)),
  extras: list(z.object({ id: nonEmpty, name: text, description: optText, imageUrl: optText, supplierName: optText, affiliateUrl: optHttps })),
  communications: list(z.object({ id: nonEmpty, type: text, subject: text, content: optText, sentAt: optText })),
  integrations: record({
    liveFlightStatus: oneOf(['available', 'not_configured', 'not_applicable'], 'not_configured'),
    weather: oneOf(['available', 'not_configured', 'not_applicable'], 'not_configured'),
    destinationGuides: oneOf(['available', 'not_available'], 'not_available'),
  }),
  travellers: list(z.object({
    name: text, firstName: text, isLead: flag, assistance: strings, meals: strings,
    nationality: optText, passportExpiry: optText, insuranceStatus: optText,
    age: optNumber, dateOfBirth: optText, passportEnding: optText, passportWarning: flag,
  })),
  itinerary: list(itineraryItem),
  payments,
  documents: list(tripDocument),
  // Anything not explicitly allowed stays switched off.
  capabilities: record({ acceptQuotation: flag, makePayment: flag, shareWithTraveller: flag, sendMessage: flag }),
  agent: z.catch(z.nullable(z.object({ name: optText, email: optText, branchName: optText, branchPhone: optText })), null),
  loyalty: z.catch(z.nullable(z.object({
    pointsEarned: optNumber, state: oneOf(['quote', 'pending', 'post_return', 'awarded'], 'pending'), eligibleFrom: optText,
    available: optNumber, availableValue: optNumber, currency: z.catch(currencyCode, 'GBP'), vip: flag,
  })), null),
  content: record({
    included: list(contentItem), notIncluded: list(contentItem),
    includedSource: oneOf(['booking', 'itinerary', 'none'], 'none'),
    videoMessage: z.catch(z.nullable(video), null), walkthrough: z.catch(z.nullable(video), null),
  }),
});

// The parsed shape must satisfy the shared contract (checked at compile time).
const snapshotMatchesContract = (value: z.output<typeof snapshotSchema>): TripSnapshot => value;
void snapshotMatchesContract;

// ---------------------------------------------------------------------------------------------------------------
// Migrations: each step takes the previous version's raw object to the next one. Versions 1 and 2 only lacked
// sections that were added later; the schema fills those with empty defaults. Migrated trips are marked stale so
// they are refreshed from the server as soon as possible.

const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  1: (raw) => ({ ...raw, schemaVersion: 2 }),
  2: (raw) => ({ ...raw, schemaVersion: 3 }),
  // v4 only adds optional fields (the schema fills them). A cached v3 quotation could still carry "Pay now" (the
  // legacy Show Pay Now on Quotation field) or required confirmations: neither survives the upgrade.
  3: (raw) => ({ ...withoutQuotationPayments(raw), schemaVersion: 4 }),
};
/** Steps after which the trip is marked stale and refreshed: v3 → v4 data is still complete and current. */
const REFRESH_AFTER = new Set([1, 2]);

const UNPAYABLE_STAGES = ['quote', 'quote_expired', 'closed', 'cancelled'];
function withoutQuotationPayments(raw: Record<string, unknown>): Record<string, unknown> {
  const quotation = asObject(raw['quotation']);
  const next: Record<string, unknown> = { ...raw, ...(quotation ? { quotation: { ...quotation, requiredConfirmations: [] } } : {}) };
  if (!UNPAYABLE_STAGES.includes(String(raw['stage']))) return next;
  const payments = asObject(raw['payments']);
  if (payments) {
    const items = Array.isArray(payments['items']) ? payments['items'] : [];
    next['payments'] = {
      ...payments,
      items: items.map((item) => (asObject(item) ? { ...(item as Record<string, unknown>), canPay: false, actionUrl: null } : item)),
      customPayments: { ...(asObject(payments['customPayments']) ?? {}), enabled: false },
    };
  }
  next['capabilities'] = { ...(asObject(raw['capabilities']) ?? {}), makePayment: false };
  return next;
}

export function migrateSnapshot(raw: Record<string, unknown>): { value: Record<string, unknown>; migrated: boolean } {
  let value = raw;
  let migrated = false;
  let refresh = false;
  for (let guard = 0; guard < 10; guard += 1) {
    const version = value['schemaVersion'];
    if (version === CURRENT_SCHEMA_VERSION) break;
    const step = typeof version === 'number' ? MIGRATIONS[version] : undefined;
    if (!step) throw new TripDataError('unsupported_version', `Trip schema version ${String(version)} is not supported.`);
    value = step(value);
    migrated = true;
    if (REFRESH_AFTER.has(version as number)) refresh = true;
  }
  if (refresh) value = { ...value, freshness: { ...(asObject(value['freshness']) ?? {}), status: 'stale', nextRefreshAfter: null } };
  return { value, migrated };
}

/** Validates (and if needed migrates) a trip snapshot. Throws `TripDataError` when it cannot be used. */
export function parseTripSnapshot(value: unknown): TripSnapshot {
  return decodeTripSnapshot(value).snapshot;
}

export function decodeTripSnapshot(value: unknown): { snapshot: TripSnapshot; migrated: boolean } {
  const raw = asObject(value);
  if (!raw) throw new TripDataError('invalid', 'Trip data is not an object.');
  const { value: current, migrated } = migrateSnapshot(raw);
  const parsed = snapshotSchema.safeParse(current);
  if (!parsed.success) throw new TripDataError('invalid', `Trip data is not usable: ${describe(parsed.error)}`);
  return { snapshot: parsed.data, migrated };
}

// ---------------------------------------------------------------------------------------------------------------
// Session (as saved on the device)

const sessionSchema = z.object({
  accessToken: z.string(), accessExpiresAt: z.string(),
  refreshToken: nonEmpty, refreshExpiresAt: z.string(),
  identityKey: z.optional(z.string()),
});

/** A stored session that does not look right is treated as signed out rather than sent to the server. */
export function parseStoredSession(value: unknown): MobileSession | null {
  const parsed = sessionSchema.safeParse(value);
  if (!parsed.success) return null;
  const { identityKey, ...session } = parsed.data;
  return identityKey ? { ...session, identityKey } : session;
}

// ---------------------------------------------------------------------------------------------------------------
// Extra trip content (flights, weather, places, cruises, guides)

const providerStatus = record({
  state: oneOf(['ready', 'pending', 'not_configured', 'not_applicable', 'unavailable'], 'unavailable'),
  source: text, message: optText,
});
const externalImage = z.object({ url: nonEmpty, attribution: optText, official: flag, variants: list(imageVariant) });
const flightTimes = { scheduled: optText, actual: optText, terminal: optText, gate: optText };

const externalContentSchema = z.object({
  generatedAt: text,
  refreshAfterSeconds: z.catch(z.number().check(z.positive()), 300),
  providers: record({ flights: providerStatus, weather: providerStatus, places: providerStatus, widgety: providerStatus, ai: providerStatus }),
  diagnostics: record({
    cache: record({ entries: count, hits: count, misses: count, writes: count }),
    sources: list(z.object({ provider: z.string(), configured: flag, source: text })),
  }),
  flights: list(z.object({
    itineraryItemId: nonEmpty, flightNumber: text, route: text, carrier: optText, airlineLogoUrl: optText,
    status: oneOf(['unknown', 'on_time', 'delayed', 'checkin', 'go_to_gate', 'boarding', 'gate_closed', 'departed', 'en_route', 'approaching', 'arrived', 'cancelled', 'diverted'], 'unknown'),
    statusLabel: text,
    departure: record(flightTimes),
    arrival: record({ ...flightTimes, baggageBelt: optText }),
    aircraft: optText, delayMinutes: count, updatedAt: text,
  })),
  weather: list(z.object({
    destinationId: nonEmpty, place: text, temperature: count, label: text, icon: text, high: count, low: count,
    days: list(z.object({ date: z.string(), high: count, low: count, label: text, icon: text })),
  })),
  stays: list(z.object({
    itineraryItemId: nonEmpty, placeId: text, name: text, address: optText, rating: optNumber, ratingCount: count,
    websiteUrl: optText, phone: optText, summary: optText, mapsUrl: optText, directionsUrl: text,
    coordinates, images: list(externalImage), aiDescription: optText, aiPending: flag,
  })),
  cruises: list(z.object({
    itineraryItemId: nonEmpty, name: text, operator: optText, introduction: optText, coverImageUrl: optText, profileImageUrl: optText,
    facts: list(z.object({ label: z.string(), value: z.string() })),
    sections: list(z.object({ title: text, items: list(z.object({ name: text, text: optText, images: strings, videoUrl: optText })) })),
    voyage: z.catch(z.nullable(z.object({
      reference: text, name: optText, description: optText, highlights: optText, included: optText,
      images: strings, days: list(cruisePort),
    })), null),
  })),
  destinations: list(z.object({ ...destinationShape, images: list(externalImage), mapUrl: optText, aiPending: flag })),
  guides: list(z.object({
    id: nonEmpty, kind: z.enum(['airline', 'airport']), name: text, logoUrl: optText,
    sections: list(z.object({ title: z.string(), text: z.string() })), pending: flag,
  })),
});

const externalContentMatchesContract = (value: z.output<typeof externalContentSchema>): ExternalTripContent => value;
void externalContentMatchesContract;

export function parseExternalContent(value: unknown): ExternalTripContent {
  const parsed = externalContentSchema.safeParse(value);
  if (!parsed.success) throw new TripDataError('invalid', `Trip content is not usable: ${describe(parsed.error)}`);
  return parsed.data;
}

// ---------------------------------------------------------------------------------------------------------------

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function describe(error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues.slice(0, 3).map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`).join('; ');
}
