import type { ContentListItem, ItineraryItem, LoyaltyTripState, TravellerSummary, TripAgent, TripContent, TripLoyalty, TripSnapshot, TripVideo } from '@vision-trips/contracts';
import { maskDocumentNumber, normalizeTerminal, passportExpiresTooSoon, terminalFromNotes } from '@vision-trips/contracts';
import type { AirtableRecord } from '../airtable/airtable.service.js';
import { bookingFields, brandFields, customerFields, dateString, firstString, loyaltyTransactionFields, memberFields, moneyValue, personFields, pick, strings, truthy } from './field-map.js';

/*
 * Snapshot pieces added for PHP plugin 2.0 parity. Each is a pure function of Airtable records, tolerant of missing
 * fields (older bases), and never turns a missing number into 0.
 */

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function clean(value: unknown, max = 500): string {
  const text = firstString(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(rec|usr|app|tbl|fld)[A-Za-z0-9]{14}$/.test(text) ? '' : text.slice(0, max);
}

/** A whole number of points, or null when the field is empty or unreadable (never 0 by default). */
export function points(value: unknown): number | null {
  const amount = moneyValue(value);
  return amount === null ? null : Math.round(amount);
}

// --- Agent -------------------------------------------------------------------------------------------------------

interface Collaborator { id?: unknown; name?: unknown; email?: unknown }

/**
 * The booking's agent from the first collaborator field that holds a collaborator ({ id: usr…, name, email }), with
 * the branch's name and phone. The collaborator ID is never returned; the email and phone are validated first.
 */
export function mapAgent(booking: AirtableRecord, brand: AirtableRecord, fallbackName: string | null): TripAgent | null {
  let collaborator: Collaborator | null = null;
  for (const field of bookingFields.agentUser) {
    const raw = booking.fields[field];
    const value = (Array.isArray(raw) ? raw[0] : raw) as Collaborator | undefined;
    if (value && typeof value === 'object' && typeof value.id === 'string' && value.id.startsWith('usr')) { collaborator = value; break; }
  }
  const email = typeof collaborator?.email === 'string' ? collaborator.email.trim().toLowerCase() : '';
  const name = (typeof collaborator?.name === 'string' ? clean(collaborator.name, 80) : '') || fallbackName || null;
  const branchName = clean(pick(brand.fields, brandFields.name), 120) || null;
  const agent: TripAgent = { name, email: email.length <= 254 && EMAIL.test(email) ? email : null, branchName, branchPhone: telLink(pick(brand.fields, brandFields.phone)) };
  return agent.name || agent.email || agent.branchPhone ? agent : null;
}

/** `tel:` link with digits and a leading + only, or null. */
export function telLink(value: unknown): string | null {
  const raw = firstString(value).replace(/[^0-9+]/g, '');
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `tel:${raw.startsWith('+') ? '+' : ''}${digits}`;
}

// --- Quotation content ------------------------------------------------------------------------------------------

/** One item per line (or bullet), trimmed, de-duplicated, at most 30 items of 200 characters. */
export function contentList(value: unknown): ContentListItem[] {
  const text = Array.isArray(value) ? value.map((item) => firstString(item)).join('\n') : typeof value === 'string' ? value : '';
  const seen = new Set<string>();
  return text.split(/\r?\n|•|•/).map((line) => clean(line.replace(/^[-*✓✔]\s*/, ''), 200)).filter((line) => {
    if (!line || seen.has(line.toLowerCase())) return false;
    seen.add(line.toLowerCase());
    return true;
  }).slice(0, 30).map((text) => ({ text }));
}

/**
 * Conservative inclusions from the booked items when the agent wrote none: only what the itinerary states plainly
 * (a flight with its class, a named stay with its nights and board, a named cruise, transfers, car hire). Nothing
 * ambiguous is claimed, and exclusions are never invented.
 */
export function derivedInclusions(itinerary: ItineraryItem[]): ContentListItem[] {
  const items: string[] = [];
  const flights = itinerary.filter((item) => item.kind === 'flight');
  if (flights.length) {
    const classes = [...new Set(flights.flatMap((item) => item.details.filter((detail) => /class/i.test(detail.label)).map((detail) => detail.value)))];
    items.push(`Flights as listed in your itinerary${classes.length === 1 ? ` (${classes[0]})` : ''}`);
  }
  for (const stay of itinerary.filter((item) => item.kind === 'stay' && item.title)) {
    const nights = stay.details.find((detail) => /^nights$/i.test(detail.label))?.value;
    const board = stay.rooms.map((room) => room.board).find(Boolean);
    items.push(`${nights ? `${nights} night${nights === '1' ? '' : 's'} at ` : 'Accommodation at '}${stay.title}${board ? `, ${board}` : ''}`);
  }
  for (const cruise of itinerary.filter((item) => item.kind === 'cruise' && item.title)) {
    const cabin = cruise.cabins.map((entry) => entry.grade || entry.name).find(Boolean);
    items.push(`${cruise.title}${cabin ? ` (${cabin})` : ''}`);
  }
  if (itinerary.some((item) => item.kind === 'transfer')) items.push('Transfers as listed in your itinerary');
  if (itinerary.some((item) => item.kind === 'carhire')) items.push('Car hire as listed in your itinerary');
  return items.slice(0, 30).map((text) => ({ text }));
}

const VIDEO_FILE = /^video\/(mp4|quicktime|webm|ogg|x-m4v)$/i;

/**
 * The agent's walkthrough: only an actual video attachment counts (a photo or PDF in the field is ignored). The
 * poster is Airtable's own thumbnail when it has one, never the trip's hero image.
 */
export function walkthroughVideo(value: unknown, agentName: string | null): TripVideo | null {
  if (!Array.isArray(value)) return null;
  for (const file of value as Array<{ url?: unknown; type?: unknown; thumbnails?: { large?: { url?: unknown } } }>) {
    const type = typeof file?.type === 'string' ? file.type : '';
    const url = typeof file?.url === 'string' ? file.url : '';
    if (!VIDEO_FILE.test(type) || !isHttps(url)) continue;
    const poster = typeof file.thumbnails?.large?.url === 'string' && isHttps(file.thumbnails.large.url) ? file.thumbnails.large.url : null;
    return { kind: 'file', url, mimeType: type.toLowerCase(), posterUrl: poster, title: agentName ? `${agentName} walks you through your trip` : 'A walkthrough of your trip' };
  }
  return null;
}

/**
 * The agent's video message: a direct https video file, or YouTube/Vimeo turned into a privacy-friendly embed. Any
 * other link is ignored (the app never loads an arbitrary page).
 */
export function videoMessage(value: unknown, agentName: string | null): TripVideo | null {
  const raw = firstString(value);
  if (!isHttps(raw)) return null;
  const url = new URL(raw);
  const title = agentName ? `A message from ${agentName}` : 'A message from your travel expert';
  const host = url.hostname.replace(/^www\.|^m\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') id = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1] ?? null;
  if (id !== null) return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? { kind: 'youtube', url: `https://www.youtube-nocookie.com/embed/${id}?rel=0`, mimeType: null, posterUrl: null, title } : null;
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const vimeo = url.pathname.match(/(\d{6,12})/)?.[1];
    return vimeo ? { kind: 'vimeo', url: `https://player.vimeo.com/video/${vimeo}?dnt=1`, mimeType: null, posterUrl: null, title } : null;
  }
  return /\.(mp4|m4v|webm|mov)$/i.test(url.pathname) ? { kind: 'file', url: url.toString(), mimeType: null, posterUrl: null, title } : null;
}

export function mapContent(booking: AirtableRecord, itinerary: ItineraryItem[], agentName: string | null): TripContent {
  const included = contentList(pick(booking.fields, bookingFields.included));
  const derived = included.length ? [] : derivedInclusions(itinerary);
  return {
    included: included.length ? included : derived,
    notIncluded: contentList(pick(booking.fields, bookingFields.notIncluded)),
    includedSource: included.length ? 'booking' : derived.length ? 'itinerary' : 'none',
    videoMessage: videoMessage(pick(booking.fields, bookingFields.videoMessage), agentName),
    walkthrough: walkthroughVideo(pick(booking.fields, bookingFields.videoWalkthrough), agentName),
  };
}

// --- Affiliate links --------------------------------------------------------------------------------------------

/**
 * An upsell's affiliate link: https only, no credentials, and on an allowed host when `AFFILIATE_HOSTS` lists any
 * (comma-separated; a host also allows its subdomains). Customer details are never added to it.
 */
export function affiliateUrl(value: unknown, allowedHosts = process.env.AFFILIATE_HOSTS ?? ''): string | null {
  const raw = firstString(value);
  if (!isHttps(raw) || raw.length > 2000) return null;
  const url = new URL(raw);
  if (url.username || url.password) return null;
  const hosts = allowedHosts.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (hosts.length && !hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
  return url.toString();
}

// --- Terminals --------------------------------------------------------------------------------------------------

/** Explicit Airtable terminal fields win; text in the element's own notes is only a fallback. */
export function terminals(explicitDeparture: unknown, explicitArrival: unknown, notes: string | null): Pick<ItineraryItem, 'departureTerminal' | 'arrivalTerminal' | 'terminalSource'> {
  const departure = normalizeTerminal(explicitDeparture);
  const arrival = normalizeTerminal(explicitArrival);
  if (departure || arrival) return { departureTerminal: departure, arrivalTerminal: arrival, terminalSource: 'booking' };
  const fromNotes = { departureTerminal: terminalFromNotes(notes, 'departure'), arrivalTerminal: terminalFromNotes(notes, 'arrival') };
  return { ...fromNotes, terminalSource: fromNotes.departureTerminal || fromNotes.arrivalTerminal ? 'notes' : null };
}

// --- Travellers -------------------------------------------------------------------------------------------------

/** Age in whole years on `on` (the departure date, or today). */
export function ageOn(dateOfBirth: string | null, on: string | null, today = new Date()): number | null {
  if (!dateOfBirth) return null;
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  const at = on ? new Date(`${on}T00:00:00Z`) : today;
  let age = at.getUTCFullYear() - birth.getUTCFullYear();
  if (at.getUTCMonth() < birth.getUTCMonth() || (at.getUTCMonth() === birth.getUTCMonth() && at.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/**
 * Extra "Who's travelling" detail for the lead customer's view only: age, DOB (only when TRAVELLER_DOB_VISIBLE is
 * on; the API also removes it for sessions not verified by email), the passport's last three characters and the
 * six-month warning. Fellow travellers get none of it.
 */
export function travellerDetails(person: AirtableRecord, departure: string | null, returns: string | null): Partial<TravellerSummary> {
  const dateOfBirth = dateString(pick(person.fields, personFields.dateOfBirth));
  const explicitAge = moneyValue(pick(person.fields, personFields.age));
  const expiry = dateString(pick(person.fields, personFields.passportExpiry));
  return {
    age: ageOn(dateOfBirth, departure) ?? (explicitAge !== null && explicitAge >= 0 && explicitAge < 130 ? Math.floor(explicitAge) : null),
    dateOfBirth: process.env.TRAVELLER_DOB_VISIBLE === 'true' ? dateOfBirth : null,
    passportEnding: maskDocumentNumber(firstString(pick(person.fields, personFields.passportNumber))),
    passportWarning: passportExpiresTooSoon(expiry, returns ?? departure),
  };
}

// --- Loyalty ----------------------------------------------------------------------------------------------------

/**
 * Loyalty for the trip, only when the member's scheme is enabled and the booking takes part. The balance comes from
 * the booking's own linked Customer in this base (primary customer only); nothing is matched by email.
 */
export function mapTripLoyalty(input: {
  booking: AirtableRecord; member: AirtableRecord | undefined; customer: AirtableRecord | undefined; stage: TripSnapshot['stage']; returns: string | null; currency: string; today?: Date;
}): TripLoyalty | null {
  if (!input.member || !truthy(pick(input.member.fields, memberFields.loyaltyEnabled))) return null;
  const bookingFlag = pick(input.booking.fields, bookingFields.loyaltyEnabled);
  if (bookingFlag !== undefined && !truthy(bookingFlag)) return null;
  if (['closed', 'cancelled', 'quote_expired'].includes(input.stage)) return null;
  const eligibleFrom = dateString(pick(input.booking.fields, bookingFields.loyaltyReturnDate)) ?? input.returns;
  const today = (input.today ?? new Date()).toISOString().slice(0, 10);
  const state: LoyaltyTripState = input.stage === 'quote' ? 'quote'
    : truthy(pick(input.booking.fields, bookingFields.loyaltyAwarded)) ? 'awarded'
      : eligibleFrom && eligibleFrom <= today ? 'post_return' : 'pending';
  const customer = input.customer?.fields ?? {};
  return {
    pointsEarned: points(pick(input.booking.fields, bookingFields.loyaltyPoints)),
    state, eligibleFrom,
    available: points(pick(customer, customerFields.pointsAvailable)),
    availableValue: moneyValue(pick(customer, customerFields.pointsValue)),
    currency: 'GBP',
    vip: truthy(pick(customer, customerFields.vip)),
  };
}

/** A Bookings [Payments] row of Payment Type "Loyalty Redemption" is the scheme funding the member: never customer-facing. */
export function isSchemeFunding(type: unknown): boolean {
  return /^\s*loyalty\s+redemption\s*$/i.test(firstString(type));
}

/** A customer payment receipted by the method "Loyalty Redemption": shown as points, never as money. */
export function isPointsPayment(method: unknown): boolean {
  return strings(method).some((value) => /loyalty\s+redemption/i.test(value));
}

/** Points redeemed per Loyalty Transaction ID (Redeem rows only). */
export function redeemedPoints(transactions: AirtableRecord[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const record of transactions) {
    if (!/^redeem/i.test(firstString(pick(record.fields, loyaltyTransactionFields.type)))) continue;
    const value = points(pick(record.fields, loyaltyTransactionFields.points));
    if (value !== null) result.set(record.id, Math.abs(value));
  }
  return result;
}

function isHttps(value: string): boolean {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}
