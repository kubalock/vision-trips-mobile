import { parseTripSnapshot } from './trip-schema';
import { incompleteSectionsText, withLastKnownGood } from './partial-snapshot';

describe('partial snapshots', () => {
  const snapshot = (freshness: Record<string, unknown>, extra: Record<string, unknown> = {}) => parseTripSnapshot({
    schemaVersion: 3, tripId: 'trp_1', stage: 'confirmed', accessScope: 'primary_customer', summary: { name: 'Lisbon', reference: 'R' },
    freshness: { sourceUpdatedAt: '2026-11-15T10:00:00Z', nextRefreshAfter: null, ...freshness }, ...extra,
  });
  const extras = [{ id: 'ext_1', name: 'Airport lounge', description: null, imageUrl: null, supplierName: null }];

  it('keeps the incomplete sections from the earlier copy, and only those', () => {
    const previous = snapshot({ status: 'fresh' }, { extras });
    const next = snapshot({ status: 'partial', incompleteSections: ['extras'] });
    expect(next.freshness.incompleteSections).toEqual(['extras']);
    const merged = withLastKnownGood(next, previous);
    expect(merged.extras.length).toBe(previous.extras.length);
    expect(merged.extras.length).toBeGreaterThan(0);
    expect(merged.freshness.status).toBe('partial');
  });

  it('never keeps sections from another trip or from a complete refresh', () => {
    const previous = snapshot({ status: 'fresh' }, { extras });
    expect(withLastKnownGood(snapshot({ status: 'fresh' }), previous).extras).toEqual([]);
    expect(withLastKnownGood(snapshot({ status: 'partial', incompleteSections: ['extras'] }, { tripId: 'trp_2' }), previous).extras).toEqual([]);
  });

  it('says what could not be refreshed', () => {
    expect(incompleteSectionsText(snapshot({ status: 'partial', incompleteSections: ['itinerary_details', 'messages'] }))).toBe('Some itinerary details and messages couldn’t be refreshed. We’ll try again shortly.');
    expect(incompleteSectionsText(snapshot({ status: 'fresh' }))).toBeNull();
  });

  it('reads older snapshots without the new fields', () => {
    expect(snapshot({ status: 'fresh' }).freshness.incompleteSections).toBeUndefined();
    expect(snapshot({ status: 'partial', incompleteSections: ['extras', 'bogus'] }).freshness.incompleteSections).toEqual(['extras']);
  });
});
