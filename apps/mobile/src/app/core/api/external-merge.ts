import type { ExternalTripContent } from '@vision-trips/contracts';

/**
 * Enrichment is fetched again regularly and any provider can fail on a given refresh. When a refresh comes back
 * without a piece the app already had for the same trip (facility chips, airport distance, destination facts or
 * climate, ship film, route map, agency rating), the earlier value is kept instead of disappearing.
 */
export function withEarlierEnrichment(next: ExternalTripContent, previous: ExternalTripContent | null): ExternalTripContent {
  if (!previous) return next;
  const stays = new Map(previous.stays.map((stay) => [stay.itineraryItemId, stay]));
  const destinations = new Map(previous.destinations.map((destination) => [destination.id, destination]));
  const cruises = new Map(previous.cruises.map((cruise) => [cruise.itineraryItemId, cruise]));
  return {
    ...next,
    stays: next.stays.map((stay) => {
      const earlier = stays.get(stay.itineraryItemId);
      return earlier ? { ...stay, facilities: stay.facilities?.length ? stay.facilities : earlier.facilities ?? [], airportDistance: stay.airportDistance ?? earlier.airportDistance ?? null } : stay;
    }),
    destinations: next.destinations.map((destination) => {
      const earlier = destinations.get(destination.id);
      return earlier ? { ...destination, facts: destination.facts ?? earlier.facts ?? null, climate: destination.climate ?? earlier.climate ?? null } : destination;
    }),
    cruises: next.cruises.map((cruise) => {
      const earlier = cruises.get(cruise.itineraryItemId);
      return earlier ? { ...cruise, video: cruise.video ?? earlier.video ?? null } : cruise;
    }),
    routeMapUrl: next.routeMapUrl ?? previous.routeMapUrl ?? null,
    agencyRating: next.agencyRating ?? previous.agencyRating ?? null,
  };
}
