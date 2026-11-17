import { beforeAll, describe, expect, it } from 'vitest';
import type { ItineraryItem } from '@vision-trips/contracts';
import { affiliateUrl, ageOn, contentList, derivedInclusions, mapAgent, mapContent, mapTripLoyalty, telLink, terminals, travellerDetails, videoMessage, walkthroughVideo } from './trip-extras.js';
import { TripsService } from './trips.service.js';

const record = (fields: Record<string, unknown>, id = 'recABCDEFGHIJKLMN') => ({ id, fields });

describe('terminals', () => {
  it('normalises explicit fields, which win over the element notes', () => {
    expect(terminals('5', 'Terminal 2a', 'Check in at Terminal 3')).toEqual({ departureTerminal: 'T5', arrivalTerminal: 'T2A', terminalSource: 'booking' });
  });
  it('falls back to the notes only when no explicit field is set', () => {
    expect(terminals(undefined, '', 'Please check in at Terminal 3. Arrives Terminal 1.')).toEqual({ departureTerminal: 'T3', arrivalTerminal: 'T1', terminalSource: 'notes' });
    expect(terminals(undefined, undefined, 'Check in three hours before')).toEqual({ departureTerminal: null, arrivalTerminal: null, terminalSource: null });
  });
});

describe('quotation content', () => {
  const stay = { kind: 'stay', title: 'Hotel Avenida', details: [{ label: 'Nights', value: '7' }], rooms: [{ type: 'Double', board: 'Half board', view: null, requests: null }], cabins: [] } as unknown as ItineraryItem;
  const flight = { kind: 'flight', title: 'London Heathrow to Lisbon', details: [{ label: 'Class', value: 'Economy' }], rooms: [], cabins: [] } as unknown as ItineraryItem;

  it('splits the agent lists one item per line, de-duplicated', () => {
    expect(contentList('Flights\n• Transfers\n- Flights\n\n')).toEqual([{ text: 'Flights' }, { text: 'Transfers' }]);
  });

  it('derives conservative inclusions only when the lists are missing, and never invents exclusions', () => {
    const content = mapContent(record({}), [flight, stay], 'Sarah');
    expect(content.includedSource).toBe('itinerary');
    expect(content.included.map((item) => item.text)).toEqual(['Flights as listed in your itinerary (Economy)', '7 nights at Hotel Avenida, Half board']);
    expect(content.notIncluded).toEqual([]);
    expect(mapContent(record({}), [], null)).toMatchObject({ included: [], includedSource: 'none' });
    expect(mapContent(record({ "What's Included": 'Spa access' }), [flight], null)).toMatchObject({ included: [{ text: 'Spa access' }], includedSource: 'booking' });
  });

  it('does not claim a stay without a name or ambiguous items', () => {
    expect(derivedInclusions([{ ...stay, title: '' } as ItineraryItem, { kind: 'misc', title: 'Something', details: [], rooms: [], cabins: [] } as unknown as ItineraryItem])).toEqual([]);
  });
});

describe('videos', () => {
  it('accepts only real video attachments for the walkthrough, with Airtable’s own poster', () => {
    expect(walkthroughVideo([{ url: 'https://dl.airtable.com/a.pdf', type: 'application/pdf' }, { url: 'https://dl.airtable.com/p.jpg', type: 'image/jpeg' }], 'Sarah')).toBeNull();
    expect(walkthroughVideo([{ url: 'http://dl.airtable.com/v.mp4', type: 'video/mp4' }], 'Sarah')).toBeNull();
    expect(walkthroughVideo([{ url: 'https://dl.airtable.com/v.mp4', type: 'video/mp4', thumbnails: { large: { url: 'https://dl.airtable.com/t.jpg' } } }], 'Sarah'))
      .toEqual({ kind: 'file', url: 'https://dl.airtable.com/v.mp4', mimeType: 'video/mp4', posterUrl: 'https://dl.airtable.com/t.jpg', title: 'Sarah walks you through your trip' });
    expect(walkthroughVideo('not a list', null)).toBeNull();
  });

  it('turns YouTube and Vimeo into privacy-friendly embeds and ignores other pages', () => {
    expect(videoMessage('https://www.youtube.com/watch?v=dQw4w9WgXcQ', null)?.url).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0');
    expect(videoMessage('https://vimeo.com/123456789', null)?.url).toBe('https://player.vimeo.com/video/123456789?dnt=1');
    expect(videoMessage('https://example.com/promo.html', null)).toBeNull();
    expect(videoMessage('javascript:alert(1)', null)).toBeNull();
  });
});

describe('affiliate links', () => {
  it('allows https only, without credentials, and only on listed hosts when a list is set', () => {
    expect(affiliateUrl('https://partner.example/book?id=1', '')).toBe('https://partner.example/book?id=1');
    expect(affiliateUrl('http://partner.example/book', '')).toBeNull();
    expect(affiliateUrl('javascript:alert(1)', '')).toBeNull();
    expect(affiliateUrl('https://user:pw@partner.example/', '')).toBeNull();
    expect(affiliateUrl('https://evil.example/', 'partner.example')).toBeNull();
    expect(affiliateUrl('https://www.partner.example/x', 'partner.example')).toBe('https://www.partner.example/x');
  });
});

describe('agent', () => {
  it('reads the collaborator without exposing its ID, validating email and phone', () => {
    const agent = mapAgent(record({ 'Travel Agent': { id: 'usrAbc123', name: 'Sarah Jones', email: 'Sarah@Example.com' } }), record({ 'Trading Name': 'Sunny Travel', 'Customer | Telephone': '+44 (0)20 7946 0000' }), null);
    expect(agent).toEqual({ name: 'Sarah Jones', email: 'sarah@example.com', branchName: 'Sunny Travel', branchPhone: 'tel:+440207946 0000'.replace(/\s/g, '') });
    expect(JSON.stringify(agent)).not.toContain('usr');
    expect(mapAgent(record({ Agent: [{ id: 'usrX', name: 'Tom', email: 'nope' }] }), record({}), null)).toMatchObject({ name: 'Tom', email: null });
    expect(telLink('call us')).toBeNull();
  });
});

describe('travellers', () => {
  it('masks the passport, works out the age on departure and warns within six months of return', () => {
    delete process.env.TRAVELLER_DOB_VISIBLE;
    const details = travellerDetails(record({ 'Passport Number': '123456876', 'Date of Birth': '1990-06-15', 'Expiry Date': '2027-08-01' }), '2027-05-01', '2027-05-08');
    expect(details).toEqual({ age: 36, dateOfBirth: null, passportEnding: '···876', passportWarning: true });
    expect(JSON.stringify(details)).not.toContain('123456');
    expect(ageOn('2000-05-02', '2027-05-01')).toBe(26);
  });
});

describe('trip loyalty', () => {
  const member = (enabled: boolean) => record({ 'Loyalty Scheme Enabled': enabled });
  it('is absent unless the member scheme is enabled', () => {
    expect(mapTripLoyalty({ booking: record({ 'Loyalty_Total Points': 500 }), member: member(false), customer: undefined, stage: 'countdown', returns: '2027-05-08', currency: 'GBP' })).toBeNull();
    expect(mapTripLoyalty({ booking: record({ 'Loyalty_Total Points': 500 }), member: undefined, customer: undefined, stage: 'countdown', returns: '2027-05-08', currency: 'GBP' })).toBeNull();
  });
  it('distinguishes quote, pending, post-return and awarded, and never turns missing points into 0', () => {
    const base = { member: member(true), customer: undefined, returns: '2027-05-08', currency: 'GBP', today: new Date('2027-01-01T00:00:00Z') };
    expect(mapTripLoyalty({ ...base, booking: record({ 'Loyalty_Total Points': 500 }), stage: 'quote' })?.state).toBe('quote');
    expect(mapTripLoyalty({ ...base, booking: record({ 'Loyalty_Total Points': 500 }), stage: 'countdown' })).toMatchObject({ state: 'pending', pointsEarned: 500, available: null });
    expect(mapTripLoyalty({ ...base, today: new Date('2027-06-01T00:00:00Z'), booking: record({}), stage: 'home' })).toMatchObject({ state: 'post_return', pointsEarned: null });
    expect(mapTripLoyalty({ ...base, booking: record({ 'Loyalty Points Awarded': true, 'Loyalty_Total Points': 1 }), stage: 'past' })).toMatchObject({ state: 'awarded', pointsEarned: 1 });
  });
});

describe('loyalty in the payment schedule', () => {
  beforeAll(() => { process.env.VISION_LINK_SECRET ??= 'loyalty-test'; });
  const map = (payments: Array<{ id: string; fields: Record<string, unknown> }>, loyaltyTransactions: Array<{ id: string; fields: Record<string, unknown> }> = []) => new TripsService({} as never).mapSnapshot('appABCDEFGHIJKLMN',
    { id: 'recBOOKINGAAAAAAA', fields: { Status: 'Confirmed', 'Departure Date': '2027-05-01', 'Return Date': '2027-05-08', 'Total Price': 1000, 'MS Paid': 500, 'MS Outstanding': 500 } } as never,
    { id: 'recBRANDAAAAAAAAA', fields: {} } as never, 'primary_customer', { payments, loyaltyTransactions } as never);

  it('never shows scheme-funding rows, and shows customer points payments as points', () => {
    const snapshot = map([
      { id: 'recPAYSCHEMEAAAAA', fields: { 'Payment Type': 'Loyalty Redemption', Amount: 25, Status: 'Complete' } },
      { id: 'recPAYPOINTSAAAAA', fields: { 'Payment Type': 'Customer Payment', Method: ['Loyalty Redemption'], Amount: 25, Status: 'Complete', 'Customer Payment Type': 'Points', 'Loyalty Transactions': ['recLOYALTYTXAAAAA'] } },
      { id: 'recPAYCARDAAAAAAA', fields: { 'Payment Type': 'Customer Payment', Amount: 475, Status: 'Complete', 'Customer Payment Type': 'Deposit' } },
    ], [{ id: 'recLOYALTYTXAAAAA', fields: { 'Transaction Type': 'Redeem', Points: -2500 } }]);
    expect(snapshot.payments?.items).toHaveLength(2);
    expect(snapshot.payments?.items.find((item) => item.kind === 'points')).toMatchObject({ points: 2500, canPay: false });
    expect(JSON.stringify(snapshot)).not.toContain('recPAYSCHEME');
    expect(snapshot.loyalty).toBeNull();
  });

  it('keeps a points payment with unreadable points as points, without a number', () => {
    const snapshot = map([{ id: 'recPAYPOINTSAAAAA', fields: { 'Payment Type': 'Customer Payment', Method: 'Loyalty Redemption', Amount: 25, Status: 'Complete' } }]);
    expect(snapshot.payments?.items[0]).toMatchObject({ kind: 'points', points: null });
  });
});
