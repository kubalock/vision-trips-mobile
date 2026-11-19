import { describe, expect, it } from 'vitest';
import { buildAtolCertificate, inclusions, keyInformation, legalLine, legalNotice, protectionParagraphs } from './document-content.js';
import { documentSnapshot, item } from './document-content.fixture.js';

describe('ATOL certificate (PHP Domain/Atol parity)', () => {
  it('dates the certificate from the first customer payment, not from when it is downloaded', () => {
    expect(buildAtolCertificate(documentSnapshot()).issueDate).toBe('04/10/2026');
  });

  it('falls back to the booking creation date when nothing has been paid', () => {
    const snapshot = documentSnapshot();
    snapshot.payments!.items = snapshot.payments!.items.filter((payment) => payment.status !== 'paid');
    expect(buildAtolCertificate(snapshot).issueDate).toBe('01/10/2026');
  });

  it('builds journeys, passengers, protector, issuer and package type', () => {
    const certificate = buildAtolCertificate(documentSnapshot());
    expect(certificate.flightDetails).toBe('Flights from London Gatwick to Lisbon, departing 01/03/2027 with British Airways; Lisbon to London Gatwick, returning 08/03/2027 with British Airways.');
    expect(certificate.whatsCovered).toBe('Package holiday to Portugal for 7 nights.');
    expect(certificate.passengerCount).toBe(2);
    expect(certificate.passengerNames).toBe('Alex Traveller, Sam Traveller, Baby Traveller (infant)');
    expect(certificate.protectorName).toBe('The Global Travel Group Ltd');
    expect(certificate.issuerName).toBe('The Global Travel Group Ltd');
    expect(certificate.bookingRef).toBe('VT-100');
    expect(certificate.packageLabel).toBe('Package (Single-Contract)');
    expect(certificate.parts).toEqual([]);
  });

  it('groups a connection within 24 hours at the same airport into one journey', () => {
    const snapshot = documentSnapshot({ itinerary: [
      item({ kind: 'flight', from: 'London Heathrow', to: 'Dubai', fromCountry: 'GB', toCountry: 'AE', startDate: '2027-03-01', startTime: '09:00', endDate: '2027-03-01', endTime: '19:00', carrier: 'Emirates' }),
      item({ kind: 'flight', from: 'Dubai', to: 'Male', fromCountry: 'AE', toCountry: 'MV', startDate: '2027-03-02', startTime: '02:00', endDate: '2027-03-02', endTime: '07:00', carrier: 'Emirates' }),
    ] });
    const certificate = buildAtolCertificate(snapshot);
    expect(certificate.flightDetails).toBe('Flight from London Heathrow to Male via Dubai, departing 01/03/2027 with Emirates.');
    expect(certificate.whatsCovered).toBe('Flight to Portugal.');
  });

  it('lists every part of a multi-contract package and names the retailer as issuer for an agent sale', () => {
    const snapshot = documentSnapshot();
    snapshot.protection = { ...snapshot.protection, mode: 'agent_multi_contract', holderName: 'Big Tour Operator Ltd', atolNumber: '1234', certificateIssuer: 'Sunny Days Ltd' };
    const certificate = buildAtolCertificate(snapshot);
    expect(certificate.packageLabel).toBe('Package (Multi-Contract)');
    expect(certificate.issuerName).toBe('Sunny Days Ltd');
    expect(certificate.protectorName).toBe('Big Tour Operator Ltd');
    expect(certificate.parts).toEqual([
      { type: 'Flight', details: certificate.flightDetails, provider: 'British Airways, Ref: PNR123' },
      { type: 'Accommodation', details: 'Stay at Avenida Palace', provider: 'Hotel Partners, Ref: HP-77' },
    ]);
  });

  it('labels a flight-only certificate with return flights', () => {
    const snapshot = documentSnapshot();
    snapshot.protection = { ...snapshot.protection, mode: 'principal_flight_only', contractType: 'flight_only' };
    snapshot.itinerary = snapshot.itinerary.filter((entry) => entry.kind === 'flight');
    const certificate = buildAtolCertificate(snapshot);
    expect(certificate.packageLabel).toBe('Flight-Only');
    expect(certificate.whatsCovered).toBe('Return flights to Portugal.');
    expect(certificate.totalCost).toBe('£2,500.00');
  });
});

describe('confirmation content (PHP Legal parity)', () => {
  it('builds the pre-contract key information from the booking', () => {
    const rows = Object.fromEntries(keyInformation(documentSnapshot()).map((row) => [row.label, row.text]));
    expect(rows['Destination and dates']).toBe('Portugal. 1 March 2027 to 8 March 2027 (7 nights).');
    expect(rows.Transport).toContain('Flight British Airways BA2662 (Economy): London Gatwick to Lisbon, 1 Mar 2027 07:00 arriving 09:45');
    expect(rows['Accommodation and meals']).toContain('Avenida Palace (5 star), Rua 1º de Dezembro 123, Lisbon: 1 March 2027 to 8 March 2027, 7 nights, Deluxe Double, Bed & breakfast');
    expect(rows['Price and payment']).toContain('Total price £2,500.00');
    expect(rows['Price and payment']).toContain('Local payments of £60.00 are collected by suppliers during your trip, making the total cost of the trip £2,560.00.');
    expect(rows['Price and payment']).toContain('£500.00 deposit (received); £2,000.00 balance due 15 Jan 2027');
    expect(rows['Who you are contracting with']).toBe('Organiser and retailer: Sunny Days Ltd trading as Sunny Days Travel, 1 High Street, Guildford, GU1 1AA. Contact: 01234 567890, hello@sunny.example.');
    expect(rows['Financial protection']).toContain('This flight-inclusive package is ATOL protected under The Global Travel Group Ltd (ATOL 3973).');
    expect(rows['Passports, visas and health']).toContain('Europe: UK passports must be issued less than 10 years before entry');
  });

  it('gives the package notice with the organiser and protection filled in', () => {
    const notice = legalNotice(documentSnapshot());
    expect(notice?.title).toBe('Your rights: this is a package');
    expect(notice?.text).toContain('Sunny Days Ltd is responsible for the proper performance of the package');
    expect(notice?.text).toContain('the ATOL scheme (ATOL holder The Global Travel Group Ltd (ATOL 3973))');
    expect(notice?.text).not.toMatch(/\{[a-z]+\}/);
  });

  it('says who the customer is booking with, including the brand financial template', () => {
    const text = protectionParagraphs(documentSnapshot()).join('\n');
    expect(text).toContain('Sunny Days Ltd (member W1234) is making this booking on your behalf.');
    expect(text).toContain('Sunny Days Ltd (member W1234) · Company no. 01234567 · VAT no. GB123456789 · Registered office: 1 High Street, Guildford, GU1 1AA');
    expect(text).toContain('This flight-inclusive package is protected under The Global Travel Group Ltd (ATOL 3973).');
    expect(text).toContain('Our own protection wording.');
    expect(text).toContain('held in a client trust account');
    // Same wording as the PHP plugin, which fills {protection} with the ATOL scheme on ATOL bookings.
    expect(text).toContain('Money you pay to Sunny Days Ltd for arrangements that are not covered by ATOL is held in the ATOL scheme (ATOL holder The Global Travel Group Ltd (ATOL 3973)) until');
  });

  it('builds the legal line from whatever the member record has', () => {
    const snapshot = documentSnapshot();
    expect(legalLine(snapshot)).toBe('Sunny Days Ltd (member W1234) · Company no. 01234567 · VAT no. GB123456789 · Registered office: 1 High Street, Guildford, GU1 1AA');
    snapshot.protection = { ...snapshot.protection, retailerMemberNumber: null, retailerCompanyNumber: null, retailerVatNumber: null, retailerAddress: [] };
    expect(legalLine(snapshot)).toBe('Sunny Days Ltd');
  });

  it("derives what's included from the itinerary when the agent wrote no list", () => {
    expect(inclusions(documentSnapshot())).toEqual({ included: ['Flights London Gatwick – Lisbon (Economy)', '7 nights at Avenida Palace — Deluxe Double', 'Flights Lisbon – London Gatwick'], excluded: ['Travel insurance'] });
  });
});
