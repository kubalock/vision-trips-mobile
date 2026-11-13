import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import type { TripSnapshot } from '@vision-trips/contracts';
import { App, isReturnedStage, nightsText, tripDateRange } from './app';
import { VisionApiService } from './core/api/vision-api.service';
import { parseTripSnapshot } from './core/api/trip-schema';

const trip = (stage: TripSnapshot['stage'], summary: Record<string, unknown> = {}) => parseTripSnapshot({
  schemaVersion: 3, tripId: 'trp_1', stage, accessScope: 'primary_customer',
  freshness: { status: 'fresh', sourceUpdatedAt: '2026-11-04T11:34:00Z', nextRefreshAfter: null },
  summary: { name: 'New Mint Test', reference: 'TTA-1', departureDate: '2026-08-06', returnDate: '2026-08-06', durationDays: 0, holidayTypes: ['City'], ...summary },
});

describe('returned-trip helpers', () => {
  it('shows a single date for a day trip and a range otherwise', () => {
    expect(tripDateRange('2026-08-06', '2026-08-06')).toBe('06/08/2026');
    expect(tripDateRange('2026-08-06', '2026-08-13')).toBe('06/08/2026 — 13/08/2026');
    expect(tripDateRange('2026-08-06', null)).toBe('06/08/2026');
    expect(tripDateRange(null, null)).toBe('Dates to be confirmed');
    expect(tripDateRange(null, null, 'Date unavailable')).toBe('Date unavailable');
  });

  it('never says “0 nights”', () => {
    expect(nightsText(0)).toBeNull();
    expect(nightsText(null)).toBeNull();
    expect(nightsText(1)).toBe('1 night');
    expect(nightsText(7)).toBe('7 nights');
  });

  it('treats home, past and closed as returned', () => {
    expect(['home', 'past', 'closed'].every((stage) => isReturnedStage(stage as TripSnapshot['stage']))).toBe(true);
    expect(['quote', 'confirmed', 'countdown', 'travelling', 'cancelled'].some((stage) => isReturnedStage(stage as TripSnapshot['stage']))).toBe(false);
  });
});

describe('returned-trip home screen', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    const api = TestBed.inject(VisionApiService);
    vi.spyOn(api, 'externalContent').mockReturnValue(new Promise(() => undefined));
  });
  afterEach(() => vi.restoreAllMocks());

  async function render(snapshot: TripSnapshot) {
    const fixture = TestBed.createComponent(App);
    (fixture.componentInstance as unknown as { trip: { set: (value: TripSnapshot) => void } }).trip.set(snapshot);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows a compact look-back header without countdown-era clutter', async () => {
    const element = await render(trip('past'));
    const hero = element.querySelector('.vt-hero')!;
    expect(hero.classList).toContain('vt-hero--returned');
    expect(hero.querySelector('.vt-hero__kicker')?.textContent?.trim()).toBe('Travelled August 2026');
    expect(hero.querySelector('.vt-hero__sub')?.textContent).toContain('TTA-1 · 06/08/2026');
    expect(hero.textContent).not.toContain('—');
    expect(hero.textContent).not.toContain('0 nights');
    expect(hero.textContent).not.toContain('Add to calendar');
    expect(element.querySelector('.vt-freshness--quiet')?.textContent).toContain('Updated');
    expect(element.textContent).not.toContain('Trip up to date');
    expect(element.textContent).toContain('Plan your next trip');
  });

  it('says “Welcome home” straight after the trip, once', async () => {
    const element = await render(trip('home'));
    expect(element.querySelector('.vt-hero__kicker')?.textContent?.trim()).toBe('Travelled August 2026');
    expect(element.textContent?.match(/Welcome home/g)).toHaveLength(1);
  });

  it('drops the forward-looking cards and says “Travelled” after the trip', async () => {
    const past = parseTripSnapshot({
      schemaVersion: 3, tripId: 'trp_1', stage: 'past', accessScope: 'primary_customer',
      summary: { name: 'Lisbon', reference: 'R', departureDate: '2026-08-06', returnDate: '2026-08-06' },
      timeline: { nextItemTitle: null, daysUntilDeparture: -99 },
      travellers: [{ name: 'Mr. Grzegorz Kubala' }],
      support: { email: 'grzegorz.kubala@thetravelnetworkgroup.co.uk' },
      brand: { name: 'GREGG TTA Test', profile: { reassurance: [{ title: 'With you while away', description: 'Out-of-hours support' }] } },
    });
    const element = await render(past);
    expect(element.querySelector('.vt-home-up-next')).toBeNull();
    expect(element.textContent).not.toContain('Your trip is coming up');
    expect(element.querySelector('#travellers-title')?.textContent?.trim()).toBe('Travelled');
    expect(element.querySelector('.vt-value-props')).toBeNull();
    const email = element.querySelector('.vt-email')!;
    expect(email.textContent).toBe('grzegorz.kubala@thetravelnetworkgroup.co.uk'); // No stray spaces from the break points.
    expect(email.querySelectorAll('wbr').length).toBeGreaterThan(0);
  });

  it('keeps the full hero, calendar and status card before travel', async () => {
    const element = await render(trip('countdown', { departureDate: '2027-04-01', returnDate: '2027-04-08', durationDays: 7 }));
    expect(element.querySelector('.vt-hero')?.classList).not.toContain('vt-hero--returned');
    expect(element.textContent).toContain('Add to calendar');
    expect(element.textContent).toContain('7 nights');
    expect(element.textContent).toContain('Trip up to date');
  });
});

describe('My trips cards', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
  });

  it('shows a day trip’s date once on its card', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as { savedTripList: { set: (value: unknown) => void }; showTripLibrary: { set: (value: boolean) => void } };
    app.savedTripList.set([{ snapshot: trip('past'), session: null, savedAt: '2026-11-01T00:00:00Z', identityKey: null }]);
    app.showTripLibrary.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('.vt-saved-trip__dates')?.textContent?.trim()).toBe('06/08/2026');
  });
});
