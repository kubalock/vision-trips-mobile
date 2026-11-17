import type { ItineraryItem, TripSnapshot } from '@vision-trips/contracts';
import { arrivalFlightFor, climateFromArchive, climateWindow, haversineKm, parseDestinationFacts, parseFacilities, reassuringRating, roundedDistance, routeMapUrl } from './enrichment.js';
import { ExternalCacheService } from './external-cache.service.js';
import { ExternalContentService } from './external-content.service.js';

describe('facility chips', () => {
  it('keeps only short plain labels, at most eight', () => {
    expect(parseFacilities('Sure! <facts>["Outdoor pool","Spa","<b>Gym</b>","Spa","a label far too long to be a facility chip at all","Free WiFi.","1","2","3","4","5","6"]</facts>'))
      .toEqual(['Outdoor pool', 'Spa', 'Gym', '1', '2', '3', '4', '5']);
    expect(parseFacilities('no block here')).toEqual([]);
    expect(parseFacilities('<facts>not json</facts>')).toEqual([]);
    expect(parseFacilities('<facts>["Safe for children","Visa desk"]</facts>')).toEqual([]);
  });
});

describe('destination facts', () => {
  it('reads the fixed keys only and drops anything unsafe', () => {
    const facts = parseDestinationFacts('<facts>{"currency":"Euro (EUR)","language":"Portuguese","timeDifference":"Same time as the UK","flightTimeFromLondon":"About 2 hours 45 minutes","plugs":"Type C and F","bestTime":"April to October","visa":"No visa needed","extra":"x"}</facts>');
    expect(facts).toEqual({ currency: 'Euro (EUR)', language: 'Portuguese', timeDifference: 'Same time as the UK', flightTimeFromLondon: 'About 2 hours 45 minutes', plugs: 'Type C and F', bestTime: 'April to October' });
    expect(parseDestinationFacts('<facts>{"currency":"See https://example.com","bestTime":"Safe all year"}</facts>')).toBeNull();
  });
});

describe('airport distance', () => {
  const flight = (to: string, date: string) => ({ kind: 'flight', to, toCode: null, startDate: date, endDate: date, endTime: '12:00' } as unknown as ItineraryItem);
  const stay = { kind: 'stay', startDate: '2027-05-01' } as ItineraryItem;
  it('uses the flight that lands before the stay', () => {
    expect(arrivalFlightFor(stay, [flight('Larnaca', '2027-04-20'), flight('Paphos', '2027-05-01'), flight('London', '2027-05-08')])?.to).toBe('Paphos');
    expect(arrivalFlightFor(stay, [flight('London', '2027-05-08')])).toBeNull();
  });
  it('rounds to a plausible approximate distance', () => {
    const km = haversineKm({ latitude: 34.7180, longitude: 32.4857 }, { latitude: 34.7754, longitude: 32.4245 });
    expect(km).toBeGreaterThan(7); expect(km).toBeLessThan(10);
    expect(roundedDistance(23.4)).toBe(25); expect(roundedDistance(4.4)).toBe(4); expect(roundedDistance(800)).toBeNull();
  });
});

describe('climate for the travel month', () => {
  it('averages the same month over past years', () => {
    expect(climateWindow('2027-03-14', 3, new Date('2026-11-17T00:00:00Z'))).toEqual({ month: 3, start: '2023-03-01', end: '2025-03-31' });
    const time: string[] = []; const high: number[] = []; const low: number[] = []; const sun: number[] = []; const rain: number[] = [];
    for (const year of [2023, 2024, 2025]) for (let day = 1; day <= 31; day++) {
      time.push(`${year}-03-${String(day).padStart(2, '0')}`); high.push(24); low.push(13); sun.push(9 * 3600); rain.push(day <= 2 ? 5 : 0);
      time.push(`${year}-04-${String(Math.min(day, 30)).padStart(2, '0')}`); high.push(40); low.push(30); sun.push(0); rain.push(10);
    }
    expect(climateFromArchive({ time, temperature_2m_max: high, temperature_2m_min: low, sunshine_duration: sun, precipitation_sum: rain }, 3))
      .toEqual({ month: 'March', highC: 24, lowC: 13, sunshineHours: 9, rainyDays: 2, years: 3 });
    expect(climateFromArchive({ time: ['2025-03-01'], temperature_2m_max: [20], temperature_2m_min: [10] }, 3)).toBeNull();
    expect(climateWindow(null)).toBeNull();
  });
});

describe('route map and agency rating', () => {
  it('maps every stay and port in order, only with a key and two or more places', () => {
    const items = [
      { kind: 'stay', title: 'Hotel A', address: 'Lisbon', cruisePorts: [] },
      { kind: 'cruise', title: 'Cruise', cruisePorts: [{ port: 'Porto' }, { port: 'At sea' }, { port: 'Vigo' }] },
      { kind: 'stay', title: 'Hotel B', address: 'Madrid', cruisePorts: [] },
    ] as unknown as ItineraryItem[];
    const url = new URL(routeMapUrl(items, 'embed-key')!);
    expect(url.pathname).toBe('/maps/embed/v1/directions');
    expect(url.searchParams.get('origin')).toBe('Hotel A, Lisbon');
    expect(url.searchParams.get('waypoints')).toBe('Porto|Vigo');
    expect(url.searchParams.get('destination')).toBe('Hotel B, Madrid');
    expect(routeMapUrl(items, undefined)).toBeNull();
    expect(routeMapUrl(items.slice(0, 1), 'embed-key')).toBeNull();
  });
  it('shows only a reassuring rating', () => {
    expect(reassuringRating(4.9, 312)).toBe(true);
    expect(reassuringRating(4.2, 312)).toBe(false);
    expect(reassuringRating(5, 4)).toBe(false);
    expect(reassuringRating(null, 100)).toBe(false);
  });
});

describe('enrichment failures never remove the trip content', () => {
  it('returns destinations without climate when the archive and Places fail', async () => {
    const previous = { ...process.env };
    delete process.env.AI_API_KEY; delete process.env.WIDGETY_APP_ID; delete process.env.FLIGHT_API_KEY; process.env.GOOGLE_PLACES_API_KEY = 'k'; delete process.env.WEATHER_ENABLED;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('provider down'));
    const service = new ExternalContentService(new ExternalCacheService());
    const snapshot = {
      summary: { departureDate: '2027-03-10' }, brand: { name: 'Sunny Travel', profile: { address: '1 High St, Bristol' } },
      itinerary: [{ id: 'stay-1', kind: 'stay', title: 'Hotel A', address: 'Lisbon', cruisePorts: [] }],
      destinations: [{ id: 'lisbon', name: 'Lisbon', country: 'Portugal', coordinates: { latitude: 38.7, longitude: -9.1 }, overview: 'Hilly capital.', imageUrl: null, attractions: [], practicalInformation: null, culturalInformation: null }],
    } as unknown as TripSnapshot;
    const result = await service.content(snapshot);
    expect(result.destinations).toEqual([expect.objectContaining({ id: 'lisbon', overview: 'Hilly capital.', climate: null, facts: null })]);
    expect(result.agencyRating).toBeNull();
    fetchSpy.mockRestore();
    process.env = previous;
  });
});
