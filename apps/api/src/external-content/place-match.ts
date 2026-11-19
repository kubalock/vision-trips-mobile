import { haversineKm } from './enrichment.js';

/*
 * Google Places match checking and presentation rules, ported from the PHP plugin (Integrations/Places.php and
 * Rest/Api.php) so the app never shows the wrong hotel, a poor score or a link back to the property's own website.
 */

export type PlaceMatchMode = 'balanced' | 'strict' | 'off';

export interface PlaceCandidate {
  name: string;
  address: string;
  types: string[];
  coordinates: { latitude: number; longitude: number } | null;
}

export interface PlaceMatchVerdict { ok: boolean; reason: string }

const STOP_WORDS = new Set(['the', 'hotel', 'hotels', 'resort', 'resorts', 'spa', 'and', 'by', 'of', 'at', 'in', 'a', 'an', 'suites', 'apartments', 'apartment', 'villa', 'villas', 'beach', 'club', 'collection', 'inn', 'lodge', 'palace', 'grand', 'boutique', 'luxury', 'all', 'inclusive']);
const LODGING_TYPES = new Set(['lodging', 'hotel', 'resort_hotel', 'bed_and_breakfast', 'guest_house', 'inn', 'motel', 'hostel', 'extended_stay_hotel', 'cottage', 'villa', 'apartment_complex', 'vacation_rental', 'campground', 'rv_park', 'private_guest_room', 'farmstay', 'japanese_inn']);

/** The minimum Google rating ever shown to a customer (PHP `reviews_min_rating`, default 4). */
export function minimumPlaceRating(): number {
  const configured = Number(process.env.PLACES_MIN_RATING);
  return Number.isFinite(configured) && configured >= 1 ? configured : 4;
}

/** A rating worth showing, or null: never surface a poor score. */
export function shownPlaceRating(rating: number | null, minimum = minimumPlaceRating()): number | null {
  return rating !== null && rating > 0 && rating >= minimum ? rating : null;
}

export function placeMatchMode(): PlaceMatchMode {
  const mode = process.env.PLACES_MATCH_MODE?.trim().toLowerCase();
  return mode === 'strict' || mode === 'off' ? mode : 'balanced';
}

/**
 * The text search for a stay: its title plus the address, or the location name when there is no address. A generic
 * title ("Hotel", "Accommodation") can only be looked up safely with an address, so it gives no query.
 */
export function placeSearchQuery(title: string, address: string | null, locationName: string | null): string {
  const name = title.trim();
  if (!name || (/^(accommodation|hotel|stay|room|apartment|villa|resort)s?$/i.test(name) && !address?.trim())) return '';
  const where = address?.trim() || locationName?.trim() || '';
  return where ? `${name}, ${where}` : name;
}

/**
 * Match confidence between what the booking calls the place (`query`: "Name, address") and what Google returned.
 * balanced (default) rejects only on strong evidence of the wrong place; strict requires a clear name match and a lodging
 * type; off accepts Google's first result. `bias` is the stay's own location, when known.
 */
export function verifyPlaceMatch(query: string, result: PlaceCandidate, bias: { latitude: number; longitude: number } | null, expectLodging = true, mode = placeMatchMode()): PlaceMatchVerdict {
  const queryName = query.replace(/,.*$/s, '');
  const q = tokens(queryName); const r = tokens(result.name);
  const qNames = q.length ? q : tokens(queryName, false); const rNames = r.length ? r : tokens(result.name, false);
  let score = qNames.length && rNames.length ? intersection(qNames, rNames) / Math.max(1, Math.min(qNames.length, rNames.length)) : 0;
  score = Math.max(score, similarTextPercent(queryName.toLowerCase(), result.name.toLowerCase()) / 100);
  const qFull = tokens(queryName, false); const rFull = tokens(result.name, false);
  const scoreFull = qFull.length && rFull.length ? intersection(qFull, rFull) / Math.max(1, Math.min(qFull.length, rFull.length)) : 0;
  const addressPart = query.includes(',') ? query.slice(query.indexOf(',')) : '';
  const resultAddress = result.address.toLowerCase();
  const addressHit = tokens(addressPart, false).some((token) => token.length > 3 && resultAddress.includes(token));
  const km = bias && result.coordinates && (result.coordinates.latitude !== 0 || result.coordinates.longitude !== 0) ? haversineKm(bias, result.coordinates) : null;
  const lodging = !expectLodging || !result.types.length || result.types.some((type) => LODGING_TYPES.has(type));
  const reason = `name ${score.toFixed(2)}${addressHit ? ', address ✓' : ''}${km !== null ? `, ${Math.round(km)} km` : ''}${expectLodging && result.types.length ? (lodging ? ', lodging ✓' : ', not lodging') : ''}`;
  if (mode === 'off') return { ok: true, reason: `accepted (checking off): ${reason}` };
  if (mode === 'strict') {
    const ok = lodging && (km === null || km <= 40) && (score >= 0.5 || (score >= 0.34 && (addressHit || km !== null)));
    return { ok, reason: `${ok ? 'matched' : 'rejected'}: ${reason}` };
  }
  // Balanced: a far-away result needs a near-perfect name; a lodging result a fair name match; anything else the full name.
  if (km !== null && km > 150 && score < 0.8) return { ok: false, reason: `rejected (too far): ${reason}` };
  const ok = lodging ? score >= 0.34 : scoreFull >= 0.75;
  return { ok, reason: `${ok ? 'matched' : 'rejected'}: ${reason}` };
}

function tokens(value: string, stripStopWords = true): string[] {
  const words = value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(' ');
  return [...new Set(words)].filter((word) => word.length > 1 && !(stripStopWords && STOP_WORDS.has(word)));
}

function intersection(left: string[], right: string[]): number {
  const set = new Set(right);
  return left.filter((item) => set.has(item)).length;
}

/** PHP's similar_text() percentage: twice the matched characters over the combined length. */
export function similarTextPercent(left: string, right: string): number {
  const total = left.length + right.length;
  return total ? (similarChars(left, right) * 2 * 100) / total : 0;
}

function similarChars(left: string, right: string): number {
  if (!left.length || !right.length) return 0;
  let max = 0; let leftAt = 0; let rightAt = 0;
  for (let i = 0; i < left.length; i++) {
    for (let j = 0; j < right.length; j++) {
      let k = 0;
      while (i + k < left.length && j + k < right.length && left[i + k] === right[j + k]) k++;
      if (k > max) { max = k; leftAt = i; rightAt = j; }
    }
  }
  if (!max) return 0;
  return max + similarChars(left.slice(0, leftAt), right.slice(0, rightAt)) + similarChars(left.slice(leftAt + max), right.slice(rightAt + max));
}
