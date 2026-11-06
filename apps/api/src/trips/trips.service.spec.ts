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
          'MS Outstanding': 3200,
          'Internal Notes': 'must never leave the API',
        },
      },
      {
        id: 'recBRANDABCDEFGHI',
        fields: {
          'Trading Name': 'Example Travel',
          'Primary Colour': '#155b75',
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
        airlines: [{ id: 'recAIRLINEABCDEFG', fields: { Airline: 'British Airways' } }],
        passengers: [{ id: 'recPAXABCDEFGHIJK', fields: { Passenger: 'Alex Traveller', 'Seat Number': '12A', 'Checked Baggage Allowance': '23kg' } }],
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
    expect(snapshot.documents[1]).toMatchObject({ title: 'Flight ticket.pdf', kind: 'supplier' });
    expect(JSON.stringify(snapshot)).not.toContain('recABCDEFGHIJKLMN');
    expect(JSON.stringify(snapshot)).not.toContain('Internal Notes');
    expect(JSON.stringify(snapshot)).not.toContain('secret');
    expect(JSON.stringify(snapshot)).not.toContain('Net');
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

  it('redacts supplier identity and references from quotations and fellow-traveller links', () => {
    const service = new TripsService({} as never);
    const element = { id: 'recELEMENTABCDEFG', fields: { Type: 'Accommodation', Supplier: ['recSUPPLIERABCDEF'], 'Supplier Reference': 'PRIVATE-REF' } };
    const supplier = { id: 'recSUPPLIERABCDEF', fields: { Name: 'Private Supplier' } };
    const quote = service.mapSnapshot('appABCDEFGHIJKLMN', { id: 'recABCDEFGHIJKLMN', fields: { Status: 'Quotation' } }, { id: '', fields: {} }, 'primary_customer', { elements: [element], suppliers: [supplier] });
    const traveller = service.mapSnapshot('appABCDEFGHIJKLMN', { id: 'recABCDEFGHIJKLMN', fields: { Status: 'Confirmed' } }, { id: '', fields: {} }, 'fellow_traveller', { elements: [element], suppliers: [supplier] });
    for (const snapshot of [quote, traveller]) {
      expect(snapshot.itinerary[0]?.supplier).toBeNull();
      expect(snapshot.itinerary[0]?.reference).toBeNull();
      expect(JSON.stringify(snapshot)).not.toContain('Private Supplier');
      expect(JSON.stringify(snapshot)).not.toContain('PRIVATE-REF');
    }
  });
});
