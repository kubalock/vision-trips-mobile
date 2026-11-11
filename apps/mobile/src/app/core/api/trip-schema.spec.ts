import { TripDataError, decodeTripSnapshot, parseExternalContent, parseStoredSession, parseTripSnapshot } from './trip-schema';

const minimal = (extra: Record<string, unknown> = {}) => ({
  schemaVersion: 3, tripId: 'trp_1', stage: 'confirmed', accessScope: 'primary_customer',
  summary: { name: 'Lisbon', reference: 'REF-1' }, ...extra,
});

describe('trip snapshot schema', () => {
  it('fills missing sections with safe defaults instead of leaving them undefined', () => {
    const trip = parseTripSnapshot(minimal());

    expect(trip.itinerary).toEqual([]);
    expect(trip.documents).toEqual([]);
    expect(trip.brand.profile.gallery).toEqual([]);
    expect(trip.bookingJourney.steps).toEqual([]);
    expect(trip.payments).toBeUndefined();
    expect(trip.capabilities).toEqual({ acceptQuotation: false, makePayment: false, shareWithTraveller: false, sendMessage: false });
    expect(trip.freshness.status).toBe('stale');
  });

  it('repairs fields the UI calls methods on and drops list items it cannot use', () => {
    const trip = parseTripSnapshot(minimal({
      itinerary: [{ id: 'itm_1', title: 'Flight', kind: 'rocket', images: 'nope' }, { title: 'No id' }, null],
      documents: [{ id: 'doc_1', kind: 'invoice' }, { id: 'doc_2', kind: 'mystery' }],
      summary: { name: 'Lisbon', reference: 'REF-1', countries: ['PT', 7], durationDays: 'ten' },
    }));

    expect(trip.itinerary).toHaveLength(1);
    expect(trip.itinerary[0]).toMatchObject({ id: 'itm_1', kind: 'misc', typeLabel: '', images: [], passengers: [], supplier: null });
    expect(trip.documents.map((document) => [document.id, document.mimeType, document.status])).toEqual([['doc_1', '', 'unavailable']]);
    expect(trip.summary.countries).toEqual(['PT']);
    expect(trip.summary.durationDays).toBeNull();
  });

  it('never shows payments in a currency it cannot read', () => {
    const noCurrency = parseTripSnapshot(minimal({ payments: { total: 500, items: [] } }));
    expect(noCurrency.payments).toBeUndefined();

    const trip = parseTripSnapshot(minimal({ payments: { currency: 'EUR', total: 500, paid: 'x', items: [{ id: 'p1', currency: 'EUR', amount: 100 }, { id: 'p2', currency: '', amount: 50 }] } }));
    expect(trip.payments).toMatchObject({ currency: 'EUR', total: 500, paid: null, customPayments: { enabled: false } });
    expect(trip.payments?.items.map((item) => item.id)).toEqual(['p1']);
  });

  it('accepts images with and without size information', () => {
    const trip = parseTripSnapshot(minimal({ summary: { name: 'Lisbon', reference: 'REF-1', heroImageUrl: 'https://cdn/h.jpg', heroImage: { url: 'https://cdn/h.jpg', alt: '', width: 4000, height: 3000, variants: [{ url: 'https://cdn/l.jpg', width: 683 }, { url: '', width: 10 }] }, gallery: [{ url: 'https://cdn/g.jpg', alt: 'Beach' }] } }));
    expect(trip.summary.heroImage).toEqual({ url: 'https://cdn/h.jpg', alt: '', width: 4000, height: 3000, variants: [{ url: 'https://cdn/l.jpg', width: 683 }] });
    expect(trip.summary.gallery[0]).toEqual({ url: 'https://cdn/g.jpg', alt: 'Beach', width: null, height: null, variants: [] });
  });

  it('drops fields the app does not know about', () => {
    const trip = parseTripSnapshot(minimal({ airtableBaseId: 'appSECRET', summary: { name: 'Lisbon', reference: 'REF-1', internalNotes: 'x' } }));
    expect(JSON.stringify(trip)).not.toContain('SECRET');
    expect(JSON.stringify(trip)).not.toContain('internalNotes');
  });

  it('rejects trips that cannot be trusted or shown', () => {
    for (const bad of [null, 'trip', minimal({ tripId: '' }), minimal({ stage: 'teleporting' }), minimal({ accessScope: 'admin' }), minimal({ summary: {} })]) {
      expect(() => parseTripSnapshot(bad)).toThrow(TripDataError);
    }
  });

  it('rejects schema versions it does not support', () => {
    for (const schemaVersion of [4, 0, undefined, '3']) {
      expect(() => parseTripSnapshot(minimal({ schemaVersion }))).toThrow(expect.objectContaining({ reason: 'unsupported_version' }));
    }
  });

  it('migrates older snapshots and marks them for refreshing', () => {
    const { snapshot, migrated } = decodeTripSnapshot(minimal({ schemaVersion: 1, freshness: { status: 'fresh', sourceUpdatedAt: '2026-01-01T00:00:00Z', nextRefreshAfter: '2030-01-01T00:00:00Z' } }));

    expect(migrated).toBe(true);
    expect(snapshot.schemaVersion).toBe(3);
    expect(snapshot.freshness).toEqual({ status: 'stale', sourceUpdatedAt: '2026-01-01T00:00:00Z', nextRefreshAfter: null });
    expect(snapshot.quotation.reviewSections).toEqual([]);
  });
});

describe('stored session schema', () => {
  it('treats a damaged session as signed out', () => {
    expect(parseStoredSession({ accessToken: '', accessExpiresAt: 'x', refreshToken: 'web:abc', refreshExpiresAt: 'y' })).not.toBeNull();
    expect(parseStoredSession({ refreshToken: 'web:abc' })).toBeNull();
    expect(parseStoredSession(null)).toBeNull();
  });
});

describe('extra trip content schema', () => {
  it('gives every provider a state even when the payload leaves it out', () => {
    const content = parseExternalContent({ providers: { flights: { state: 'ready', source: 'x' } }, flights: [{ itineraryItemId: 'itm_1', status: 'teleported' }, {}] });

    expect(content.providers.ai.state).toBe('unavailable');
    expect(content.providers.flights.state).toBe('ready');
    expect(content.flights).toHaveLength(1);
    expect(content.flights[0]).toMatchObject({ status: 'unknown', departure: { gate: null } });
    expect(content.weather).toEqual([]);
    expect(content.refreshAfterSeconds).toBe(300);
  });

  it('rejects a payload that is not an object', () => {
    expect(() => parseExternalContent('oops')).toThrow(TripDataError);
  });
});
