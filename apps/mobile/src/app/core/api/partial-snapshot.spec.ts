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

  it('never brings back a value the agent cleared on the itinerary element itself', () => {
    const item = { id: 'itm_1', kind: 'flight', typeLabel: 'Flight', title: 'London Heathrow to Lisbon', status: 'Confirmed', from: 'London Heathrow', to: 'Lisbon', carrier: 'TAP Air Portugal',
      notes: 'Window seats requested', reference: 'ABC123', address: 'Terminal 2', emergencyContact: { name: 'Desk', phone: '+44 20 0000 0000' },
      passengers: [{ name: 'Grace Hopper', checkedBaggage: '23kg' }] };
    const previous = snapshot({ status: 'fresh' }, { itinerary: [item] });
    // Airports failed this time (so the title fell back), and the agent cleared the notes, reference, address, status, contact and passengers.
    const next = snapshot({ status: 'partial', incompleteSections: ['itinerary_details'] }, { itinerary: [{ ...item, title: 'Flight', from: null, to: null, notes: null, reference: null, address: null, status: '', emergencyContact: null, passengers: [] }] });
    const [merged] = withLastKnownGood(next, previous).itinerary;
    expect(merged).toMatchObject({ from: 'London Heathrow', to: 'Lisbon', title: 'London Heathrow to Lisbon', notes: null, reference: null, address: null, status: '', emergencyContact: null, passengers: [] });
  });

  it('keeps earlier letters and certificates, and earlier document versions, until a complete refresh', () => {
    const previous = snapshot({ status: 'fresh' }, { documents: [doc('confirmation', 'confirmation', 'v1'), doc('letter_1', 'letter', 'l1'), doc('atol', 'atol', 'a1')] });
    // Without the agent or letter templates, the server sent no letter or certificate, and a confirmation version computed from less data.
    const next = snapshot({ status: 'partial', incompleteSections: ['agent', 'letters'] }, { documents: [doc('confirmation', 'confirmation', 'v2-incomplete'), doc('invoice', 'invoice', 'i1')] });
    const merged = withLastKnownGood(next, previous).documents;
    expect(merged.map((document) => [document.id, document.version])).toEqual([['confirmation', 'v1'], ['invoice', 'i1'], ['letter_1', 'l1'], ['atol', 'a1']]);
    expect(withLastKnownGood(next, previous).protection).toEqual(previous.protection);
  });

  it('keeps the earlier Brand, its contacts, protection and pay settings when the Brand could not be read', () => {
    const pay = (id: string, status: string, canPay: boolean) => ({ id, label: id, amount: 100, currency: 'GBP', status, dueDate: null, completedDate: null, canPay, actionUrl: null });
    const previous = snapshot({ status: 'fresh' }, {
      brand: { name: 'Sunway Travel', logoUrl: 'https://cdn.example/logo.png' },
      support: { companyName: 'Sunway Travel', phone: '+44 20 0000 0000', email: 'help@sunway.example', emergencyPhone: '+44 20 1111 1111' },
      protection: { scheme: 'atol', atolNumber: '12345' },
      payments: { currency: 'GBP', total: 300, paid: 100, items: [pay('pay_1', 'outstanding', true), pay('pay_2', 'outstanding', true), pay('pay_3', 'paid', false)], customPayments: { enabled: true, minimum: 1, maximum: 200 } },
    });
    const next = snapshot({ status: 'partial', incompleteSections: ['brand', 'letters'] }, {
      brand: { name: 'Your travel company', logoUrl: null },
      support: { companyName: 'Your travel company', phone: null, email: null, emergencyPhone: '+44 20 2222 2222' },
      payments: { currency: 'GBP', total: 300, paid: 200, items: [pay('pay_1', 'outstanding', false), pay('pay_2', 'paid', false), pay('pay_3', 'paid', false)], customPayments: { enabled: false, minimum: 0, maximum: 0 } },
    });

    const merged = withLastKnownGood(next, previous);

    expect(merged.brand).toEqual(previous.brand);
    expect(merged.support).toMatchObject({ companyName: 'Sunway Travel', phone: '+44 20 0000 0000', email: 'help@sunway.example', emergencyPhone: '+44 20 2222 2222' });
    expect(merged.protection).toEqual(previous.protection);
    // Statuses and amounts stay fresh: only a payment still unpaid keeps its earlier "can pay in the app".
    expect(merged.payments?.paid).toBe(200);
    expect(merged.payments?.items.map((item) => [item.id, item.status, item.canPay])).toEqual([['pay_1', 'outstanding', true], ['pay_2', 'paid', false], ['pay_3', 'paid', false]]);
    expect(merged.payments?.customPayments.enabled).toBe(true);
    expect(incompleteSectionsText(next)).toBe('Your travel company’s details and letters couldn’t be refreshed. We’ll try again shortly.');
  });
});
