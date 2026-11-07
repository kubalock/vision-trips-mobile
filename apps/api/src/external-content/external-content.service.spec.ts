import type { TripSnapshot } from '@vision-trips/contracts';
import { ExternalCacheService } from './external-cache.service.js';
import { ExternalContentService } from './external-content.service.js';

describe('ExternalContentService', () => {
  it('reports provider configuration and applicability without leaking credentials', async () => {
    const previous = { ...process.env };
    delete process.env.FLIGHT_API_KEY; delete process.env.GOOGLE_PLACES_API_KEY; delete process.env.WIDGETY_APP_ID; delete process.env.WIDGETY_TOKEN; delete process.env.AI_API_KEY; process.env.WEATHER_ENABLED = 'false';
    const service = new ExternalContentService(new ExternalCacheService());
    const snapshot = {
      itinerary: [{ id: 'flight-1', kind: 'flight', flightNumber: 'BA123', startDate: '2026-12-01' }, { id: 'stay-1', kind: 'stay', title: 'Example Hotel' }],
      destinations: [{ id: 'lisbon', name: 'Lisbon', country: 'Portugal', coordinates: null, overview: null, imageUrl: null, attractions: [], practicalInformation: null, culturalInformation: null }],
    } as unknown as TripSnapshot;

    const result = await service.content(snapshot);

    expect(result.providers.flights.state).toBe('not_configured');
    expect(result.providers.weather.source).toBe('Open-Meteo');
    expect(result.providers.places.state).toBe('not_configured');
    expect(result.providers.widgety.state).toBe('not_configured');
    expect(JSON.stringify(result)).not.toContain('API_KEY');
    process.env = previous;
  });
});
