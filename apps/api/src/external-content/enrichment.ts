import type { DestinationClimate, DestinationFacts, ItineraryItem } from '@vision-trips/contracts';

/*
 * Optional enrichment from PHP plugin 1.16–1.18, as pure functions. Everything here is indicative: it never blocks the
 * trip, fails on its own, and states that it is approximate in the app.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Generated text must never stray into advice we can't stand behind. */
const UNSAFE = /\b(visa|vaccin\w*|malaria|medical|medicine|safe|safety|danger\w*|crime|terror\w*|insurance|refund|guarantee\w*|https?:|www\.)/i;

/** The last `<facts>…</facts>` block of a model reply, or null. */
function factsBlock(reply: string): string | null {
  const match = reply.match(/<facts>([\s\S]*?)<\/facts>/gi)?.at(-1);
  return match ? match.replace(/<\/?facts>/gi, '').trim() : null;
}

function plain(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/<[^>]*>/g, '').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
  return text && text.length <= max && !UNSAFE.test(text) ? text : null;
}

/** Up to eight short facility labels ("Outdoor pool", "Spa"): plain labels of 40 characters at most, nothing else. */
export function parseFacilities(reply: string): string[] {
  const block = factsBlock(reply);
  if (!block) return [];
  try {
    const parsed = JSON.parse(block) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.flatMap((item) => {
      const label = plain(item, 40);
      if (!label || /[.!?:;]/.test(label) || seen.has(label.toLowerCase())) return [];
      seen.add(label.toLowerCase());
      return [label];
    }).slice(0, 8);
  } catch { return []; }
}

/** Currency, language, time difference, flight time from London, plugs and best time to go: each short and plain. */
export function parseDestinationFacts(reply: string): DestinationFacts | null {
  const block = factsBlock(reply);
  if (!block) return null;
  try {
    const parsed = JSON.parse(block) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const facts: DestinationFacts = {
      currency: plain(parsed['currency'], 60), language: plain(parsed['language'], 60), timeDifference: plain(parsed['timeDifference'], 60),
      flightTimeFromLondon: plain(parsed['flightTimeFromLondon'], 60), plugs: plain(parsed['plugs'], 60), bestTime: plain(parsed['bestTime'], 80),
    };
    return Object.values(facts).some(Boolean) ? facts : null;
  } catch { return null; }
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (degrees: number) => degrees * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude); const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "About 25 km": whole kilometres under 10, nearest 5 above; null when implausibly far for an airport transfer. */
export function roundedDistance(km: number): number | null {
  if (!Number.isFinite(km) || km <= 0 || km > 300) return null;
  return km < 10 ? Math.max(1, Math.round(km)) : Math.round(km / 5) * 5;
}

/** The flight that lands before this stay begins (the latest one on or before its start date). */
export function arrivalFlightFor(stay: ItineraryItem, itinerary: ItineraryItem[]): ItineraryItem | null {
  if (!stay.startDate) return null;
  const flights = itinerary.filter((item) => item.kind === 'flight' && (item.to || item.toCode) && (item.endDate ?? item.startDate) && (item.endDate ?? item.startDate)! <= stay.startDate!);
  return flights.sort((a, b) => `${a.endDate ?? a.startDate}${a.endTime ?? ''}`.localeCompare(`${b.endDate ?? b.startDate}${b.endTime ?? ''}`)).at(-1) ?? null;
}

/** The travel month and the date range of the same month over the previous `years` years (Open-Meteo archive). */
export function climateWindow(departure: string | null, years = 3, today = new Date()): { month: number; start: string; end: string } | null {
  if (!departure || !/^\d{4}-\d{2}/.test(departure)) return null;
  const month = Number(departure.slice(5, 7));
  const lastFull = today.getUTCFullYear() - 1;
  const first = lastFull - years + 1;
  const end = new Date(Date.UTC(lastFull, month, 0)).toISOString().slice(0, 10);
  return { month, start: `${first}-${String(month).padStart(2, '0')}-01`, end };
}

/** Averages daily archive data for one calendar month across years. Null when there isn't enough data. */
export function climateFromArchive(daily: { time?: unknown; temperature_2m_max?: unknown; temperature_2m_min?: unknown; sunshine_duration?: unknown; precipitation_sum?: unknown }, month: number): DestinationClimate | null {
  const times = Array.isArray(daily.time) ? daily.time.filter((value): value is string => typeof value === 'string') : [];
  const at = (field: unknown, index: number) => { const value = Array.isArray(field) ? field[index] : undefined; return typeof value === 'number' && Number.isFinite(value) ? value : null; };
  const rows = times.map((time, index) => ({ time, high: at(daily.temperature_2m_max, index), low: at(daily.temperature_2m_min, index), sun: at(daily.sunshine_duration, index), rain: at(daily.precipitation_sum, index) }))
    .filter((row) => Number(row.time.slice(5, 7)) === month && row.high !== null && row.low !== null);
  const years = new Set(rows.map((row) => row.time.slice(0, 4))).size;
  if (rows.length < 20 || !years) return null;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const sun = rows.flatMap((row) => (row.sun === null ? [] : [row.sun]));
  const rain = rows.flatMap((row) => (row.rain === null ? [] : [row.rain]));
  return {
    month: MONTHS[month - 1]!,
    highC: Math.round(mean(rows.map((row) => row.high!))), lowC: Math.round(mean(rows.map((row) => row.low!))),
    // Open-Meteo gives sunshine in seconds per day.
    sunshineHours: sun.length >= rows.length / 2 ? Math.round(mean(sun) / 3600) : null,
    rainyDays: rain.length >= rows.length / 2 ? Math.round(rain.filter((value) => value >= 1).length / years) : null,
    years,
  };
}

/** Every stay and cruise port, in trip order, on one Maps Embed map (flying lines between them). */
export function routeMapUrl(itinerary: ItineraryItem[], key: string | undefined): string | null {
  if (!key) return null;
  const places: string[] = [];
  for (const item of itinerary) {
    const names = item.kind === 'stay' ? [[item.title, item.address].filter(Boolean).join(', ')]
      : item.kind === 'cruise' ? item.cruisePorts.map((port) => port.port).filter((port) => port && !/at sea|sea day|cruising/i.test(port)) : [];
    for (const name of names) if (name && places.at(-1) !== name) places.push(name.slice(0, 120));
  }
  if (places.length < 2) return null;
  const route = places.slice(0, 22);
  const waypoints = route.slice(1, -1);
  const params = new URLSearchParams({ key, origin: route[0]!, destination: route.at(-1)!, mode: 'flying' });
  if (waypoints.length) params.set('waypoints', waypoints.join('|'));
  return `https://www.google.com/maps/embed/v1/directions?${params.toString()}`;
}

/** The agency rating is only shown when it is genuinely reassuring. */
export function reassuringRating(rating: number | null, count: number): boolean {
  return rating !== null && rating >= 4.3 && count >= 10;
}
