import { TripsService } from './trips.service.js';

describe('TripsService', () => {
  beforeEach(() => {
    process.env.VISION_LINK_SECRET = 'snapshot-secret';
  });

  it('maps an allowlisted snapshot without exposing Airtable ids', () => {
    const service = new TripsService({} as never);
    const snapshot = service.mapSnapshot(
      'appABCDEFGHIJKLMN',
      {
        id: 'recABCDEFGHIJKLMN',
        createdTime: '2026-11-01T10:00:00.000Z',
        fields: {
          'Booking Reference': 'VT-1001',
          'Trip Name': 'Mediterranean Escape',
          Status: 'Confirmed',
          Tags: ['Ocean Cruise'],
          'Departure Date': '2027-03-01',
          'Return Date': '2027-03-12',
          'Trip Duration': 11,
          Countries: ['Portugal'],
          'Holiday Type(s)': ['City Break'],
          'Traveller Type': 'Couple',
          Sector: 'Leisure',
          'Total Passengers & Guests': 2,
          'Group Booking': false,
          'Gift Voucher': true,
          Destinations: ['recLOCATIONABCDEF'],
          Gallery: [{ url: 'https://files.example/trip-gallery.jpg', filename: 'Coastline' }],
          'Customer Communication': ['recCOMMUNICATIONA'],
          'Trip Overview': '<p>A hand-picked Mediterranean journey.</p>',
          'Personalised Message': 'Welcome, Alex — I hope you love it.',
          'SinGS Agent Name': 'Jamie Agent',
          ATOL: 'Single-Contract Package',
          'ATOL No.': ['1234'],
          Licensing: 'Package (Principal)',
          'Supplier Confirmations Received': true,
          'Travel Documents': true,
          'Total Customer Cost including Resort Payments': 5200,
          'Next Customer Payment Amount': 500,
          'Next Customer Payment Due Date': '2027-01-10',
          balanceDueDate: '2027-02-01',
          'Alternative Currency': true,
          'Alternative Currency Type': 'EUR',
          'EUR Amount': 6000,
          'MS Outstanding': 3200,
          'Internal Notes': 'must never leave the API',
        },
      },
      {
        id: 'recBRANDABCDEFGHI',
        fields: {
          'Trading Name': 'Example Travel',
          'Primary Colour': '#155b75',
          'Customer | Telephone': '020 7946 0123',
          'Customer | Email Address': 'help@example.com',
          'Customer | Website': 'example.com',
          'Customer | Emergency Telephone': '07700 900123',
          'Mint | API Key': 'secret',
        },
      },
      'primary_customer',
      {
        elements: [{
          id: 'recELEMENTABCDEFG',
          fields: {
            Type: 'Flight',
            Status: 'Confirmed',
            'Dep. Airport Name': 'London Heathrow',
            'Arr. Airport Name': 'Lisbon',
            'Flight No.': 'BA 500',
            'Dep. IATA Code': 'LHR',
            'Arr. IATA Code': 'LIS',
            Package: true,
            'Customers T&Cs': 'https://example.com/terms',
            'Confirmation Received': true,
            'Tickets Received': true,
            'Start Date': '2027-03-01',
            Carrier: ['recAIRLINEABCDEFG'],
            'Passengers & Guests': ['recPAXABCDEFGHIJK'],
            Supplier: ['recSUPPLIERABCDEF'],
            'Supplier Reference': 'ABC123',
            'Image Gallery': [{ url: 'https://files.example/flight.jpg', filename: 'Flight' }],
            'Emergency Supplier Name': 'Airport team',
            'Emergency Phone Number(s)': '+44 20 1234 5678',
            'Customer Documentation': [{ url: 'https://files.example/ticket.pdf', filename: 'Flight ticket.pdf' }],
            Net: 500,
          },
        }],
        payments: [{ id: 'recPAYMENTABCDEFG', fields: { Amount: 1000, Status: 'Complete', 'Customer Payment Type': 'Deposit Payment' } }],
        customers: [{ id: 'recCUSTOMERABCDEF', fields: { 'Full Name': 'Alex Traveller', 'First Name': 'Alex' } }],
        people: [],
        suppliers: [{ id: 'recSUPPLIERABCDEF', fields: { Name: 'Trusted Air', 'Legal Notices URL': 'https://example.com/terms' } }],
        airlines: [{ id: 'recAIRLINEABCDEFG', fields: { Airline: 'British Airways', iata: 'BA', Logo: [{ url: 'https://files.example/ba.png' }] } }],
        passengers: [{ id: 'recPAXABCDEFGHIJK', fields: { Passenger: 'Alex Traveller', 'Seat Number': '12A', 'Checked Baggage Allowance': '23kg' } }],
        locations: [{ id: 'recLOCATIONABCDEF', fields: { Name: 'Lisbon', Country: 'Portugal', 'Destination Overview': '<p>Hilltop views and tiled streets.</p>', 'Key Attractions/Experiences': ['Tram 28', 'Belém'], Latitude: 38.72, Longitude: -9.14, 'Featured Image': [{ url: 'https://files.example/lisbon.jpg' }] } }],
        upsells: [{ id: 'recUPSELLABCDEFGH', fields: { Name: 'Private city tour', Description: '<p>A half-day private guide.</p>', 'Featured Image': [{ url: 'https://files.example/tour.jpg' }], Supplier: ['recSUPPLIERABCDEF'] } }],
        communications: [{ id: 'recCOMMUNICATIONA', fields: { Type: ['Email'], Subject: 'Your documents are ready', 'Email Template': '<p>Your travel documents are now available.</p>', Sent: true, Date: '2026-11-05T10:00:00Z' } }],
      },
    );

    expect(snapshot.summary.name).toBe('Mediterranean Escape');
    expect(snapshot.stage).toBe('countdown');
    expect(snapshot.brand.theme.key).toBe('Ocean Cruise');
    expect(snapshot.brand.theme.primaryColor).toBe('#155B75');
    expect(snapshot.tripId).toMatch(/^trp_/);
    expect(snapshot.itinerary[0]).toMatchObject({ kind: 'flight', title: 'London Heathrow to Lisbon', flightNumber: 'BA500' });
    expect(snapshot.itinerary[0]).toMatchObject({ carrier: 'British Airways', reference: 'ABC123', supplier: { name: 'Trusted Air' }, emergencyContact: { name: 'Airport team' } });
    expect(snapshot.itinerary[0]?.passengers[0]).toMatchObject({ name: 'Alex Traveller', seat: '12A', checkedBaggage: '23kg' });
    expect(snapshot.itinerary[0]?.images[0]).toMatchObject({ url: 'https://files.example/flight.jpg' });
    expect(snapshot.travellers[0]).toMatchObject({ name: 'Alex Traveller', isLead: true });
    expect(snapshot.payments?.items[0]).toMatchObject({ amount: 1000, status: 'paid' });
    expect(snapshot.documents.find((document) => document.kind === 'supplier')).toMatchObject({ title: 'Flight ticket.pdf', status: 'ready' });
    expect(snapshot.schemaVersion).toBe(3);
    expect(snapshot.experience).toMatchObject({ overview: 'A hand-picked Mediterranean journey.', agentName: 'Jamie Agent' });
    expect(snapshot.support).toMatchObject({ phone: '020 7946 0123', email: 'help@example.com', emergencyPhone: '07700 900123' });
    expect(snapshot.protection).toMatchObject({ scheme: 'atol', atolNumber: '1234' });
    expect(snapshot.bookingStatus.supplierConfirmationsReceived).toBe(true);
    expect(snapshot.bookingStatus.tasks.travelDocuments).toBe(true);
    expect(snapshot.quotation.status).toBe('not_applicable');
    expect(snapshot.timeline).toMatchObject({ nextItemTitle: 'London Heathrow to Lisbon', nextItemDate: '2027-03-01' });
    expect(snapshot.destinations[0]).toMatchObject({ name: 'Lisbon', country: 'Portugal', overview: 'Hilltop views and tiled streets.', coordinates: { latitude: 38.72, longitude: -9.14 } });
    expect(snapshot.summary.gallery[0]).toMatchObject({ url: 'https://files.example/trip-gallery.jpg', alt: 'Coastline' });
    expect(snapshot.extras[0]).toMatchObject({ name: 'Private city tour', description: 'A half-day private guide.', supplierName: 'Trusted Air' });
    expect(snapshot.communications[0]).toMatchObject({ type: 'Email', subject: 'Your documents are ready', content: 'Your travel documents are now available.' });
    expect(snapshot.integrations.destinationGuides).toBe('available');
    expect(snapshot.summary).toMatchObject({ durationDays: 11, countries: ['Portugal'], holidayTypes: ['City Break'], totalTravellers: 2, giftVoucher: true });
    expect(snapshot.itinerary[0]).toMatchObject({ fromCode: 'LHR', toCode: 'LIS', carrierCode: 'BA', packageIncluded: true, confirmationReceived: true, ticketsReceived: true });
    expect(snapshot.payments).toMatchObject({ totalIncludingResort: 5200, nextDueAmount: 500, nextDueDate: '2027-01-10', balanceDueDate: '2027-02-01', alternativeCurrency: { currency: 'EUR', amount: 6000 } });
    expect(JSON.stringify(snapshot)).not.toContain('recABCDEFGHIJKLMN');
    expect(JSON.stringify(snapshot)).not.toContain('Internal Notes');
    expect(JSON.stringify(snapshot)).not.toContain('secret');
    expect(JSON.stringify(snapshot)).not.toContain('Net');
  });

  it('builds the five legal review sections for a quotation', () => {
    const service = new TripsService({} as never);
    const snapshot = service.mapSnapshot(
      'appABCDEFGHIJKLMN',
      { id: 'recABCDEFGHIJKLMN', fields: { Status: 'Quotation', 'Trip Name': 'Lisbon', 'Booking Reference': 'VT-2' } },
      { id: '', fields: { 'Trading Name': 'Example Travel' } },
      'primary_customer',
      { elements: [{ id: 'recELEMENTABCDEFG', fields: { Type: 'Accommodation', Name: 'City Hotel', 'Customers T&Cs': 'https://example.com/terms' } }] },
    );

    expect(snapshot.quotation.reviewSections.map((section) => section.id)).toEqual(['package', 'names', 'important', 'protection', 'terms']);
    expect(snapshot.quotation.reviewSections.find((section) => section.id === 'terms')?.links).toContainEqual({ label: 'Accommodation terms', url: 'https://example.com/terms' });
  });

  it('removes financial capabilities from fellow-traveller snapshots', () => {
    const service = new TripsService({} as never);
    const snapshot = service.mapSnapshot(
      'appABCDEFGHIJKLMN',
      { id: 'recABCDEFGHIJKLMN', fields: { Status: 'Confirmed' } },
      { id: '', fields: {} },
      'fellow_traveller',
    );
    expect(snapshot.capabilities.makePayment).toBe(false);
    expect(snapshot.capabilities.shareWithTraveller).toBe(false);
    expect(snapshot.payments).toBeUndefined();
  });

  it('does not offer quotation acceptance after Airtable records it', () => {
    const service = new TripsService({} as never);
    const snapshot = service.mapSnapshot(
      'appABCDEFGHIJKLMN',
      { id: 'recABCDEFGHIJKLMN', fields: { Status: 'Quotation', 'Quotation Accepted': true } },
      { id: '', fields: {} },
      'primary_customer',
    );

    expect(snapshot.stage).toBe('quote');
    expect(snapshot.quotation.status).toBe('available');
    expect(snapshot.quotation.canAccept).toBe(false);
    expect(snapshot.capabilities.acceptQuotation).toBe(false);
  });

  it('redacts supplier identity and references from quotations and fellow-traveller links', () => {
    const service = new TripsService({} as never);
    const element = { id: 'recELEMENTABCDEFG', fields: { Type: 'Accommodation', Supplier: ['recSUPPLIERABCDEF'], 'Supplier Reference': 'PRIVATE-REF' } };
    const supplier = { id: 'recSUPPLIERABCDEF', fields: { Name: 'Private Supplier' } };
    const upsell = { id: 'recUPSELLABCDEFGH', fields: { Name: 'Optional tour', Supplier: ['recSUPPLIERABCDEF'] } };
    const quote = service.mapSnapshot('appABCDEFGHIJKLMN', { id: 'recABCDEFGHIJKLMN', fields: { Status: 'Quotation' } }, { id: '', fields: {} }, 'primary_customer', { elements: [element], suppliers: [supplier], upsells: [upsell] });
    const traveller = service.mapSnapshot('appABCDEFGHIJKLMN', { id: 'recABCDEFGHIJKLMN', fields: { Status: 'Confirmed' } }, { id: '', fields: {} }, 'fellow_traveller', { elements: [element], suppliers: [supplier], upsells: [upsell] });
    for (const snapshot of [quote, traveller]) {
      expect(snapshot.itinerary[0]?.supplier).toBeNull();
      expect(snapshot.itinerary[0]?.reference).toBeNull();
      expect(snapshot.extras[0]?.supplierName).toBeNull();
      expect(JSON.stringify(snapshot)).not.toContain('Private Supplier');
      expect(JSON.stringify(snapshot)).not.toContain('PRIVATE-REF');
    }
  });
});
