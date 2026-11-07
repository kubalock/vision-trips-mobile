import { Injectable, Logger } from '@nestjs/common';
import type { CruiseProfile, EnrichedDestinationGuide, ExternalProviderStatus, ExternalTripContent, ItineraryItem, LiveFlightStatus, PlaceProfile, PracticalGuide, TripSnapshot, WeatherForecast } from '@vision-trips/contracts';
import { ExternalCacheService } from './external-cache.service.js';

@Injectable()
export class ExternalContentService {
  private readonly logger = new Logger(ExternalContentService.name);
  private readonly pendingAi = new Set<string>();
  constructor(private readonly cache: ExternalCacheService) {}

  async content(snapshot: TripSnapshot): Promise<ExternalTripContent> {
    const [flights, weather, stays, cruises, destinations, guides] = await Promise.all([
      this.flights(snapshot), this.weather(snapshot), this.stays(snapshot), this.cruises(snapshot), this.destinations(snapshot), this.guides(snapshot),
    ]);
    const aiPending = [...stays, ...destinations, ...guides].some((item) => 'aiPending' in item ? item.aiPending : 'pending' in item && item.pending);
    const aiReady = stays.some((item) => item.aiDescription) || destinations.some((item) => item.overview) || guides.some((item) => item.sections.length);
    return {
      generatedAt: new Date().toISOString(), refreshAfterSeconds: snapshot.itinerary.some((item) => item.kind === 'flight' && item.startDate && withinHours(item.startDate, item.startTime, Number(process.env.FLIGHT_WINDOW_HOURS || 48))) ? 180 : 1800,
      providers: {
        flights: provider(Boolean(process.env.FLIGHT_API_KEY), snapshot.itinerary.some((item) => item.kind === 'flight'), flights.length, process.env.FLIGHT_PROVIDER || 'aerodatabox'),
        weather: provider(process.env.WEATHER_ENABLED !== 'false', snapshot.destinations.length > 0, weather.length, 'Open-Meteo'),
        places: provider(Boolean(process.env.GOOGLE_PLACES_API_KEY), snapshot.itinerary.some((item) => item.kind === 'stay'), stays.length, 'Google Places'),
        widgety: provider(Boolean(process.env.WIDGETY_APP_ID && process.env.WIDGETY_TOKEN), snapshot.itinerary.some((item) => item.kind === 'cruise') || snapshot.destinations.length > 0, cruises.length || destinations.some((destination) => destination.images.some((image) => image.attribution === 'Widgety')), 'Widgety'),
        ai: aiPending ? { state: 'pending', source: 'Anthropic', message: 'Content is being prepared.' } : provider(Boolean(process.env.AI_API_KEY), snapshot.itinerary.some((item) => ['flight', 'stay'].includes(item.kind)) || snapshot.destinations.length > 0, aiReady, 'Anthropic'),
      },
      flights, weather, stays, cruises, destinations, guides,
    };
  }

  private async flights(snapshot: TripSnapshot): Promise<LiveFlightStatus[]> {
    const key = process.env.FLIGHT_API_KEY?.trim();
    if (!key) return [];
    const windowHours = Number(process.env.FLIGHT_WINDOW_HOURS || 48);
    const candidates = snapshot.itinerary.filter((item) => item.kind === 'flight' && item.flightNumber && item.startDate && withinHours(item.startDate, item.startTime, windowHours));
    return compact(await Promise.all(candidates.map(async (item) => {
      const cacheKey = `flight:${process.env.FLIGHT_PROVIDER}:${item.flightNumber}:${item.startDate}`;
      const cached = this.cache.get<LiveFlightStatus | null>(cacheKey);
      if (cached !== undefined) return cached;
      try {
        const result = process.env.FLIGHT_PROVIDER === 'aviationstack' ? await this.aviationStack(item, key) : await this.aeroDataBox(item, key);
        return this.cache.set(cacheKey, result, result ? 120_000 : 600_000);
      } catch (error) { this.warn('Flight provider', error); return null; }
    })));
  }

  private async aeroDataBox(item: ItineraryItem, key: string): Promise<LiveFlightStatus | null> {
    const url = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(item.flightNumber!)}/${item.startDate}?withAircraftImage=false&withLocation=false`;
    const data = await json(url, { 'x-rapidapi-key': key, 'x-rapidapi-host': 'aerodatabox.p.rapidapi.com' });
    const flight = array(data)[0]; if (!object(flight)) return null;
    const departure = obj(flight.departure); const arrival = obj(flight.arrival);
    const scheduled = nestedString(departure, 'scheduledTime', 'local'); const revised = nestedString(departure, 'revisedTime', 'local') || nestedString(departure, 'runwayTime', 'local');
    const delay = scheduled && revised ? Math.round((Date.parse(revised.replace(' ', 'T')) - Date.parse(scheduled.replace(' ', 'T'))) / 60_000) : 0;
    return flightStatus(item, text(flight.status), delay, departure, arrival, text(obj(flight.aircraft).model));
  }

  private async aviationStack(item: ItineraryItem, key: string): Promise<LiveFlightStatus | null> {
    const data = await json(`https://api.aviationstack.com/v1/flights?access_key=${encodeURIComponent(key)}&flight_iata=${encodeURIComponent(item.flightNumber!)}&flight_date=${item.startDate}&limit=1`);
    const flight = array(obj(data).data)[0]; if (!object(flight)) return null;
    const departure = obj(flight.departure); const arrival = obj(flight.arrival); const delay = number(departure.delay);
    return flightStatus(item, text(flight.flight_status), delay, departure, arrival, text(obj(flight.aircraft).iata));
  }

  private async weather(snapshot: TripSnapshot): Promise<WeatherForecast[]> {
    if (process.env.WEATHER_ENABLED === 'false') return [];
    return compact(await Promise.all(snapshot.destinations.slice(0, 4).map(async (destination) => {
      const coordinates = destination.coordinates ?? await this.geocode(destination.name);
      if (!coordinates) return null;
      const cacheKey = `weather:${coordinates.latitude.toFixed(2)}:${coordinates.longitude.toFixed(2)}`;
      const cached = this.cache.get<WeatherForecast | null>(cacheKey); if (cached !== undefined) return cached;
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${coordinates.latitude}&longitude=${coordinates.longitude}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=6`;
        const data = obj(await json(url)); const current = obj(data.current); const daily = obj(data.daily); const dates = strings(daily.time);
        if (!dates.length) return this.cache.set(cacheKey, null, 600_000);
        const days = dates.map((date, index) => { const code = numberAt(daily.weather_code, index); return { date, high: Math.round(numberAt(daily.temperature_2m_max, index)), low: Math.round(numberAt(daily.temperature_2m_min, index)), label: weatherLabel(code), icon: weatherIcon(code) }; });
        return this.cache.set(cacheKey, { destinationId: destination.id, place: destination.name, temperature: Math.round(number(current.temperature_2m)), label: weatherLabel(number(current.weather_code)), icon: weatherIcon(number(current.weather_code)), high: days[0].high, low: days[0].low, days }, 1_800_000);
      } catch (error) { this.warn('Weather provider', error); return null; }
    })));
  }

  private async geocode(place: string): Promise<{ latitude: number; longitude: number } | null> {
    const key = `geocode:${entityKey(place)}`; const cached = this.cache.get<{ latitude: number; longitude: number } | null>(key); if (cached !== undefined) return cached;
    try { const data = obj(await json(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=${encodeURIComponent(place)}`)); const row = array(data.results)[0]; return this.cache.set(key, object(row) ? { latitude: number(row.latitude), longitude: number(row.longitude) } : null, 2_592_000_000); }
    catch { return null; }
  }

  private async stays(snapshot: TripSnapshot): Promise<PlaceProfile[]> {
    const key = process.env.GOOGLE_PLACES_API_KEY?.trim(); if (!key) return [];
    return compact(await Promise.all(snapshot.itinerary.filter((item) => item.kind === 'stay').map(async (item) => {
      const cacheKey = `place:${entityKey(item.title)}:${entityKey(item.address || '')}`; let profile = this.cache.get<PlaceProfile | null>(cacheKey);
      if (profile === undefined) {
        try { profile = await this.googlePlace(item, key); this.cache.set(cacheKey, profile, profile ? 604_800_000 : 1_800_000); }
        catch (error) { this.warn('Google Places', error); profile = null; }
      }
      if (!profile) return null;
      const ai = this.aiText(`property:${entityKey(profile.name)}`, propertyPrompt(profile), 'brochure');
      return { ...profile, aiDescription: ai.text || profile.summary, aiPending: ai.pending };
    })));
  }

  private async googlePlace(item: ItineraryItem, key: string): Promise<PlaceProfile | null> {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.websiteUri,places.internationalPhoneNumber,places.editorialSummary,places.googleMapsUri,places.location,places.photos,places.types' }, body: JSON.stringify({ textQuery: [item.title, item.address].filter(Boolean).join(', '), maxResultCount: 1, languageCode: 'en-GB' }), signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`Google Places ${response.status}`); const place = array(obj(await response.json()).places)[0]; if (!object(place)) return null;
    const name = text(obj(place.displayName).text); const address = text(place.formattedAddress);
    if (!safePlaceMatch(item.title, item.address, name, address)) return null;
    const location = obj(place.location); const placeId = text(place.id); const photos = array(place.photos).flatMap((photo) => { if (!object(photo) || !text(photo.name)) return []; const attribution = text(array(photo.authorAttributions)[0] && obj(array(photo.authorAttributions)[0]).displayName) || null; return [{ url: `https://places.googleapis.com/v1/${text(photo.name)}/media?maxWidthPx=1400&key=${encodeURIComponent(key)}`, attribution, official: Boolean(attribution && entityKey(attribution).includes(entityKey(name))) }]; }).sort((left, right) => Number(right.official) - Number(left.official)).slice(0, 6);
    const lat = number(location.latitude); const lng = number(location.longitude); const query = encodeURIComponent(`${name}, ${address}`);
    return { itineraryItemId: item.id, placeId, name, address: address || null, rating: place.rating === undefined ? null : number(place.rating), ratingCount: number(place.userRatingCount), websiteUrl: httpUrl(place.websiteUri), phone: text(place.internationalPhoneNumber) || null, summary: text(obj(place.editorialSummary).text) || null, mapsUrl: httpUrl(place.googleMapsUri), directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${query}${placeId ? `&destination_place_id=${encodeURIComponent(placeId)}` : ''}`, coordinates: { latitude: lat, longitude: lng }, images: photos, aiDescription: null, aiPending: false };
  }

  private async cruises(snapshot: TripSnapshot): Promise<CruiseProfile[]> {
    if (!process.env.WIDGETY_APP_ID || !process.env.WIDGETY_TOKEN) return [];
    return compact(await Promise.all(snapshot.itinerary.filter((item) => item.kind === 'cruise').map(async (item) => {
      const voyage = item.details.find((detail) => detail.label === 'Voyage')?.value || item.reference || '';
      const cacheKey = `widgety:${entityKey(item.title)}:${voyage}`; const cached = this.cache.get<CruiseProfile | null>(cacheKey); if (cached !== undefined) return cached;
      try { const result = await this.widgety(item, voyage); return this.cache.set(cacheKey, result, result ? 604_800_000 : 1_800_000); }
      catch (error) { this.warn('Widgety', error); return null; }
    })));
  }

  private async widgety(item: ItineraryItem, voyageReference: string): Promise<CruiseProfile | null> {
    const shipPath = process.env.WIDGETY_SHIP_PATH || '/api/ships/{slug}.json'; const base = (process.env.WIDGETY_BASE_URL || 'https://www.widgety.co.uk').replace(/\/$/, '');
    const auth = `app_id=${encodeURIComponent(process.env.WIDGETY_APP_ID!)}&token=${encodeURIComponent(process.env.WIDGETY_TOKEN!)}`;
    const shipData = obj(await json(`${base}${shipPath.replace('{slug}', encodeURIComponent(entityKey(item.title).replaceAll(' ', '-')))}?${auth}&images_geometry=1200x`, { Accept: process.env.WIDGETY_ACCEPT_HEADER || 'application/json' }));
    const ship = object(shipData.ship) ? obj(shipData.ship) : shipData; if (!Object.keys(ship).length) return null;
    let voyage: CruiseProfile['voyage'] = null;
    if (voyageReference) { try { const path = (process.env.WIDGETY_HOLIDAY_LOOKUP || '/api/cruises.json?reference={ref}').replace('{ref}', encodeURIComponent(voyageReference)); const separator = path.includes('?') ? '&' : '?'; voyage = normaliseVoyage(obj(await json(`${base}${path}${separator}${auth}`)), voyageReference); } catch { /* ship content remains useful */ } }
    return { itineraryItemId: item.id, name: text(ship.title) || text(ship.name) || item.title, operator: nestedText(ship, 'operator', 'title') || text(ship.operator) || null, introduction: text(ship.introduction) || text(ship.teaser) || null, coverImageUrl: urlFrom(ship.cover_image_href || ship.cover_image), profileImageUrl: urlFrom(ship.profile_image_href || ship.profile_image), facts: shipFacts(ship), sections: shipSections(ship), voyage };
  }

  private async destinations(snapshot: TripSnapshot): Promise<EnrichedDestinationGuide[]> {
    return Promise.all(snapshot.destinations.map(async (destination) => {
      const widgety = await this.widgetyDestination(destination.name, destination.country).catch(() => null);
      const ai = this.aiText(`destination:${entityKey(destination.name)}:${entityKey(destination.country || '')}`, destinationPrompt(destination), 'brochure');
      const imageUrls = [destination.imageUrl, ...(widgety?.images ?? [])].filter((url): url is string => Boolean(url));
      return { ...destination, overview: ai.text || destination.overview || widgety?.description || null, images: [...new Set(imageUrls)].map((url) => ({ url, attribution: widgety?.images.includes(url) ? 'Widgety' : null, official: destination.imageUrl === url })), mapUrl: mapEmbed(destination.name, destination.coordinates), aiPending: ai.pending };
    }));
  }

  private async widgetyDestination(name: string, country: string | null): Promise<{ description: string | null; images: string[] } | null> {
    if (!process.env.WIDGETY_APP_ID || !process.env.WIDGETY_TOKEN) return null;
    const cacheKey = `widgety-destination:${entityKey(name)}:${entityKey(country || '')}`; const cached = this.cache.get<{ description: string | null; images: string[] } | null>(cacheKey); if (cached !== undefined) return cached;
    const base = (process.env.WIDGETY_BASE_URL || 'https://www.widgety.co.uk').replace(/\/$/, ''); const path = (process.env.WIDGETY_DESTINATION_LOOKUP || '/api/destinations.json?q={name}').replace('{name}', encodeURIComponent(name)); const separator = path.includes('?') ? '&' : '?';
    const data = await json(`${base}${path}${separator}app_id=${encodeURIComponent(process.env.WIDGETY_APP_ID)}&token=${encodeURIComponent(process.env.WIDGETY_TOKEN)}&images_geometry=1400x`, { Accept: process.env.WIDGETY_ACCEPT_HEADER || 'application/json' });
    const target = entityKey(name); const match = rowsFrom(data).find((row) => { const candidate = entityKey(text(row.title) || text(row.name)); return candidate === target || candidate.startsWith(target) || target.startsWith(candidate); });
    if (!match) return this.cache.set(cacheKey, null, 86_400_000);
    return this.cache.set(cacheKey, { description: text(match.description) || text(match.introduction) || text(match.overview) || null, images: [...new Set([...urls(match.images || match.gallery || match.photos), ...urls(match.image_href || match.cover_image_href || match.profile_image_href)])] }, 604_800_000);
  }

  private async guides(snapshot: TripSnapshot): Promise<PracticalGuide[]> {
    const inputs = new Map<string, { kind: 'airline' | 'airport'; name: string; code: string; logo: string | null }>();
    for (const item of snapshot.itinerary.filter((row) => row.kind === 'flight')) {
      if (item.carrier) inputs.set(`airline:${item.carrierCode || item.carrier}`, { kind: 'airline', name: item.carrier, code: item.carrierCode || '', logo: item.carrierLogoUrl || airlineLogo(item.carrierCode) });
      for (const [name, code] of [[item.from, item.fromCode], [item.to, item.toCode]] as const) if (name) inputs.set(`airport:${code || name}`, { kind: 'airport', name, code: code || '', logo: null });
    }
    return [...inputs.entries()].map(([id, input]) => { const ai = this.aiText(`guide:${id}`, guidePrompt(input.kind, input.name, input.code), 'guide'); return { id, kind: input.kind, name: input.name, logoUrl: input.logo, sections: parseGuide(ai.text), pending: ai.pending }; });
  }

  private aiText(key: string, prompt: string, mode: 'brochure' | 'guide'): { text: string | null; pending: boolean } {
    const apiKey = process.env.AI_API_KEY?.trim(); if (!apiKey) return { text: null, pending: false };
    const cached = this.cache.get<string | null>(`ai:${key}`); if (cached !== undefined) return { text: cached, pending: false };
    if (!this.pendingAi.has(key)) { this.pendingAi.add(key); void this.generateAi(key, prompt, mode).finally(() => this.pendingAi.delete(key)); }
    return { text: null, pending: true };
  }

  private async generateAi(key: string, prompt: string, mode: 'brochure' | 'guide'): Promise<void> {
    try {
      const body: Record<string, unknown> = { model: process.env.AI_MODEL || 'claude-sonnet-4-5', max_tokens: mode === 'guide' ? 900 : 650, system: mode === 'guide' ? GUIDE_SYSTEM : BROCHURE_SYSTEM, messages: [{ role: 'user', content: prompt }] };
      if (process.env.AI_RESEARCH !== 'false') body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
      let response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.AI_API_KEY!, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
      if (!response.ok && body.tools && [400, 403].includes(response.status)) { delete body.tools; response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.AI_API_KEY!, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) }); }
      if (!response.ok) throw new Error(`Anthropic ${response.status}`); const content = array(obj(await response.json()).content).filter(object).filter((block) => block.type === 'text').map((block) => text(block.text)).join('\n');
      const copy = extractCopy(content); this.cache.set(`ai:${key}`, safeAi(copy, mode) ? copy : null, safeAi(copy, mode) ? 2_592_000_000 : 3_600_000);
    } catch (error) { this.warn('AI provider', error); this.cache.set(`ai:${key}`, null, 3_600_000); }
  }

  private warn(providerName: string, error: unknown): void { this.logger.warn(`${providerName} failed: ${error instanceof Error ? error.message : 'unknown error'}`); }
}

const BROCHURE_SYSTEM = `Write warm, factual British-English copy for a UK travel agent's customer brochure. Never mention reviews, ratings, sources, research, AI, instructions, warnings, prices or competitors. Do not use markdown, headings, URLs, superlatives or guarantees. Put only finished copy between <copy> and </copy>.`;
const GUIDE_SYSTEM = `Write calm, practical British-English travel guidance. Do not mention sources, research, AI, instructions, prices or changing allowances. Do not sell direct. Return a JSON array of {"title","text"} between <copy> and </copy>.`;

function provider(configured: boolean, applicable: boolean, hasContent: number | boolean, source: string, pending = false): ExternalProviderStatus { return !applicable ? { state: 'not_applicable', source, message: null } : !configured ? { state: 'not_configured', source, message: null } : pending && hasContent ? { state: 'pending', source, message: 'Content is being prepared.' } : hasContent ? { state: 'ready', source, message: null } : { state: 'unavailable', source, message: 'No matching content was returned.' }; }
function flightStatus(item: ItineraryItem, rawStatus: string, delay: number, dep: Record<string, unknown>, arr: Record<string, unknown>, aircraft: string): LiveFlightStatus { const status = normaliseFlight(rawStatus, delay); return { itineraryItemId: item.id, flightNumber: item.flightNumber!, route: `${item.fromCode || item.from || ''} → ${item.toCode || item.to || ''}`, carrier: item.carrier, airlineLogoUrl: item.carrierLogoUrl || airlineLogo(item.carrierCode), status, statusLabel: flightLabel(status, delay), departure: { scheduled: clock(nestedString(dep, 'scheduledTime', 'local') || text(dep.scheduled)), actual: clock(nestedString(dep, 'revisedTime', 'local') || nestedString(dep, 'runwayTime', 'local') || text(dep.estimated) || text(dep.actual)), terminal: text(dep.terminal) || null, gate: text(dep.gate) || null }, arrival: { scheduled: clock(nestedString(arr, 'scheduledTime', 'local') || text(arr.scheduled)), actual: clock(nestedString(arr, 'revisedTime', 'local') || nestedString(arr, 'predictedTime', 'local') || text(arr.estimated) || text(arr.actual)), terminal: text(arr.terminal) || null, gate: text(arr.gate) || null, baggageBelt: text(arr.baggageBelt) || text(arr.baggage) || null }, aircraft: aircraft || null, delayMinutes: delay, updatedAt: new Date().toISOString() }; }
function normaliseFlight(value: string, delay: number): LiveFlightStatus['status'] { const s = value.toLowerCase().replace(/[^a-z]/g, ''); if (s.includes('cancel')) return 'cancelled'; if (s.includes('divert') || s.includes('incident')) return 'diverted'; if (s.includes('arrived') || s.includes('landed')) return 'arrived'; if (s.includes('approach')) return 'approaching'; if (/(enroute|active|airborne|inflight|inair)/.test(s)) return 'en_route'; if (/(departed|takenoff|takeoff)/.test(s)) return 'departed'; if (s.includes('gateclosed')) return 'gate_closed'; if (s.includes('boarding')) return 'boarding'; if (s.includes('gate')) return 'go_to_gate'; if (s.includes('checkin')) return 'checkin'; if (delay >= 15 || s.includes('delay')) return 'delayed'; if (/(expected|scheduled|ontime)/.test(s)) return 'on_time'; return 'unknown'; }
function flightLabel(status: LiveFlightStatus['status'], delay: number): string { return ({ checkin: 'Check-in open', on_time: 'On time', delayed: `Delayed${delay > 0 ? ` by ${delay} min` : ''}`, go_to_gate: 'Go to gate', boarding: 'Boarding', gate_closed: 'Gate closed', departed: 'Departed', en_route: 'In the air', approaching: 'Approaching', arrived: 'Landed', cancelled: 'Cancelled — contact your travel agent', diverted: 'Diverted — contact your travel agent', unknown: 'Scheduled' })[status]; }
function weatherLabel(code: number): string { return code === 0 ? 'Clear' : code <= 2 ? 'Mostly sunny' : code === 3 ? 'Overcast' : code <= 48 ? 'Foggy' : code <= 57 ? 'Drizzle' : code <= 67 ? 'Rain' : code <= 77 ? 'Snow' : code <= 82 ? 'Showers' : code <= 86 ? 'Snow showers' : 'Thunderstorms'; }
function weatherIcon(code: number): string { return code === 0 ? 'sun' : code <= 2 ? 'sun-cloud' : code === 3 ? 'cloud' : code <= 48 ? 'fog' : code <= 67 || code <= 82 ? 'rain' : code <= 86 ? 'snow' : 'storm'; }
function withinHours(date: string, time: string | null, hours: number): boolean { const at = Date.parse(`${date}T${time || '12:00'}:00`); return Number.isFinite(at) && at - Date.now() <= hours * 3_600_000 && at - Date.now() >= -24 * 3_600_000; }
function safePlaceMatch(wanted: string, wantedAddress: string | null, result: string, resultAddress: string): boolean { const a = entityKey(wanted); const b = entityKey(result); const namesMatch = a === b || a.includes(b) || b.includes(a) || tokenOverlap(a, b) >= 0.6; if (!namesMatch) return false; if (!wantedAddress) return true; return tokenOverlap(entityKey(wantedAddress), entityKey(resultAddress)) >= 0.2; }
function tokenOverlap(a: string, b: string): number { const left = new Set(a.split(' ').filter((x) => x.length > 2)); if (!left.size) return 0; const right = new Set(b.split(' ')); return [...left].filter((x) => right.has(x)).length / left.size; }
function airlineLogo(code: string | null): string | null { if (!code) return null; return (process.env.AIRLINE_LOGO_CDN || 'https://pics.avs.io/120/60/{iata}@2x.png').replace('{iata}', encodeURIComponent(code)); }
function mapEmbed(name: string, coordinates: { latitude: number; longitude: number } | null): string | null { const key = process.env.GOOGLE_MAPS_EMBED_KEY; if (!key) return null; const query = coordinates ? `${coordinates.latitude},${coordinates.longitude}` : name; return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}`; }
function propertyPrompt(profile: PlaceProfile): string { return `Write 120-170 words about ${profile.name} in ${profile.address || 'its destination'}. Verified facts: ${profile.summary || 'No additional facts supplied'}.`; }
function destinationPrompt(destination: TripSnapshot['destinations'][number]): string { return `Write 130-190 words about ${destination.name}, ${destination.country || ''}. Facts: ${[destination.overview, ...destination.attractions, destination.practicalInformation, destination.culturalInformation].filter(Boolean).join(' ')}`; }
function guidePrompt(kind: string, name: string, code: string): string { return `Create 3-5 practical good-to-know sections for the ${kind} ${name}${code ? ` (${code})` : ''}. Cover stable, useful information only.`; }
function parseGuide(value: string | null): Array<{ title: string; text: string }> { if (!value) return []; try { const parsed = JSON.parse(value) as unknown; return array(parsed).flatMap((row) => object(row) && text(row.title) && text(row.text) ? [{ title: text(row.title), text: text(row.text) }] : []); } catch { return []; } }
function extractCopy(value: string): string { return (value.match(/<copy>([\s\S]*?)<\/copy>/gi)?.at(-1)?.replace(/<\/?copy>/gi, '') || value).replace(/https?:\/\/\S+/g, '').replace(/\*\*|```/g, '').trim(); }
function safeAi(value: string, mode: 'brochure' | 'guide'): boolean { if (value.length < 30 || /\b(as an ai|sources?|research|instructions?|tripadvisor|trustpilot)\b/i.test(value) || /https?:\/\//i.test(value)) return false; return mode === 'guide' || !/\b(dirty|poor|negative|warning|best|finest|world-class|guarantee)\b/i.test(value); }
function normaliseVoyage(data: Record<string, unknown>, reference: string): CruiseProfile['voyage'] { const rows = rowsFrom(data); const row = rows.find((item) => ['reference', 'code', 'voyage_code'].some((key) => text(item[key]).toLowerCase() === reference.toLowerCase())) || rows[0] || data; if (!object(row)) return null; const days = rowsFrom(row.itinerary || row.days || row.ports).flatMap((day, index) => { const port = object(day.port) ? text(obj(day.port).title) || text(obj(day.port).name) : text(day.port) || text(day.title) || text(day.name); return port ? [{ day: text(day.day) || String(index + 1), port, arrivalTime: text(day.arrive) || text(day.arrival) || null, departureTime: text(day.depart) || text(day.departure) || null, description: text(day.description) || null }] : []; }); return { reference, name: text(row.title) || text(row.name) || null, description: text(row.description) || null, highlights: text(row.highlights) || null, included: text(row.whats_included) || text(row.included) || null, images: urls(row.images || row.gallery), days }; }
function shipFacts(ship: Record<string, unknown>): Array<{ label: string; value: string }> { const fields: Record<string, string> = { ship_class: 'Class', style: 'Style', launch_year: 'Launched', refit_year: 'Refurbished', gross_tonnage: 'Tonnage', length: 'Length', capacity: 'Guests', crew: 'Crew', decks: 'Decks', cabins: 'Cabins', currency: 'Onboard currency' }; return Object.entries(fields).flatMap(([key, label]) => text(ship[key]) ? [{ label, value: text(ship[key]) }] : []); }
function shipSections(ship: Record<string, unknown>): CruiseProfile['sections'] { const fields: Record<string, string> = { accommodation_types: 'Accommodation', dining_options: 'Dining', entertainment_types: 'Entertainment', enrichment_types: 'Enrichment', health_fitness_types: 'Health & fitness', kids_and_teens_types: 'Kids & teens', deckplans: 'Deck plans', useful_types: 'Useful to know' }; return Object.entries(fields).flatMap(([key, title]) => { const items = rowsFrom(ship[key]).map((row) => ({ name: text(row.title) || text(row.name), text: text(row.description) || text(row.introduction) || null, images: urls(row.images || row.gallery || row.image_href), videoUrl: httpUrl(row.video_url) })).filter((item) => item.name); return items.length ? [{ title, items }] : []; }); }
async function json(url: string, headers: Record<string, string> = {}): Promise<unknown> { let last: unknown; for (let attempt = 0; attempt < 2; attempt++) { try { const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) }); if (!response.ok) throw new Error(`${response.status}`); return await response.json(); } catch (error) { last = error; } } throw last; }
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function obj(value: unknown): Record<string, unknown> { return object(value) ? value : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function rowsFrom(value: unknown): Record<string, unknown>[] { const source = obj(value); const rows = Array.isArray(value) ? value : array(source.items || source.records || source.results || source.data); return rows.filter(object); }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''; }
function number(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0; }
function strings(value: unknown): string[] { return array(value).map(text).filter(Boolean); }
function numberAt(value: unknown, index: number): number { return number(array(value)[index]); }
function nestedString(value: Record<string, unknown>, key: string, child: string): string { return text(obj(value[key])[child]); }
function nestedText(value: Record<string, unknown>, key: string, child: string): string { return nestedString(value, key, child); }
function clock(value: string): string | null { return value.match(/[T ](\d{2}:\d{2})/)?.[1] || null; }
function compact<T>(values: Array<T | null>): T[] { return values.filter((value): value is T => value !== null); }
function entityKey(value: string): string { return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s*[-–—(].*$/, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function httpUrl(value: unknown): string | null { const url = text(value); return /^https:\/\//i.test(url) ? url : null; }
function urlFrom(value: unknown): string | null { if (typeof value === 'string') return httpUrl(value); if (object(value)) return httpUrl(value.href || value.url || value.src || value.large || value.original); return null; }
function urls(value: unknown): string[] { return (Array.isArray(value) ? value : [value]).flatMap((item) => { const url = urlFrom(item); return url ? [url] : []; }); }
