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

  const doc = (id: string, kind: string, version: string) => ({ id, title: id, description: '', kind, url: null, offlineAvailable: true, status: 'ready', downloadAction: id, version, updatedAt: '2026-11-15T10:00:00Z', mimeType: 'application/pdf' });

  it('keeps a whole earlier section, never a shortened one', () => {
    const messages = Array.from({ length: 20 }, (_, index) => ({ id: `com_${index}`, type: 'Update', subject: `Update ${index}`, content: null, sentAt: null }));
    const previous = snapshot({ status: 'fresh' }, { communications: messages });
    const merged = withLastKnownGood(snapshot({ status: 'partial', incompleteSections: ['messages'] }, { communications: messages.slice(0, 5) }), previous);
    expect(merged.communications).toHaveLength(20);
  });

  it('fills itinerary details left blank by a partial refresh from the same item, keeping fresh core details', () => {
    const item = { id: 'itm_1', kind: 'flight', title: 'Flight', status: 'Confirmed', startDate: '2027-05-01', from: 'London Heathrow', to: 'Lisbon', carrier: 'TAP Air Portugal' };
    const previous = snapshot({ status: 'fresh' }, { itinerary: [item] });
    const next = snapshot({ status: 'partial', incompleteSections: ['itinerary_details'] }, { itinerary: [{ ...item, startDate: '2027-05-02', from: null, to: null, carrier: null }] });
    const [merged] = withLastKnownGood(next, previous).itinerary;
    expect(merged).toMatchObject({ startDate: '2027-05-02', from: 'London Heathrow', to: 'Lisbon', carrier: 'TAP Air Portugal' });
  });

  it('keeps earlier letters and certificates, and earlier document versions, until a complete refresh', () => {
    const previous = snapshot({ status: 'fresh' }, { documents: [doc('confirmation', 'confirmation', 'v1'), doc('letter_1', 'letter', 'l1'), doc('atol', 'atol', 'a1')] });
    // Without the agent or letter templates, the server sent no letter or certificate, and a confirmation version computed from less data.
    const next = snapshot({ status: 'partial', incompleteSections: ['agent', 'letters'] }, { documents: [doc('confirmation', 'confirmation', 'v2-incomplete'), doc('invoice', 'invoice', 'i1')] });
    const merged = withLastKnownGood(next, previous).documents;
    expect(merged.map((document) => [document.id, document.version])).toEqual([['confirmation', 'v1'], ['invoice', 'i1'], ['letter_1', 'l1'], ['atol', 'a1']]);
    expect(withLastKnownGood(next, previous).protection).toEqual(previous.protection);
  });
});
