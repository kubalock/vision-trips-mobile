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
    );

    expect(snapshot.summary.name).toBe('Mediterranean Escape');
    expect(snapshot.stage).toBe('countdown');
    expect(snapshot.brand.theme.key).toBe('Ocean Cruise');
    expect(snapshot.brand.theme.primaryColor).toBe('#155B75');
    expect(snapshot.tripId).toMatch(/^trp_/);
    expect(JSON.stringify(snapshot)).not.toContain('recABCDEFGHIJKLMN');
    expect(JSON.stringify(snapshot)).not.toContain('Internal Notes');
    expect(JSON.stringify(snapshot)).not.toContain('secret');
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
  });
});
