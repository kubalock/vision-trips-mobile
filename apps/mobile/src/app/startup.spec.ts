import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import type { MobileSession } from '@vision-trips/contracts';
import { App } from './app';
import { VisionApiService } from './core/api/vision-api.service';
import { parseTripSnapshot } from './core/api/trip-schema';
import { SavedTripsStore } from './core/storage/saved-trips.store';

/** The first screen is chosen before anything is drawn, so the entry screen or a trip never flashes on the way. */
describe('start-up', () => {
  const future = () => new Date(Date.now() + 86_400_000).toISOString();
  const session = (name: string): MobileSession => ({ accessToken: '', accessExpiresAt: new Date(0).toISOString(), refreshToken: `web:${name}-handle-0000000000`, refreshExpiresAt: future() });
  const trip = (tripId: string) => parseTripSnapshot({ schemaVersion: 3, tripId, stage: 'confirmed', accessScope: 'primary_customer', summary: { name: tripId, reference: tripId } });

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    const api = TestBed.inject(VisionApiService);
    vi.spyOn(api, 'devInvitationStatus').mockRejectedValue(new Error('not in tests'));
    vi.spyOn(api, 'externalContent').mockReturnValue(new Promise(() => undefined));
    vi.spyOn(api, 'relatedQuotations').mockReturnValue(new Promise(() => undefined));
  });
  afterEach(() => vi.restoreAllMocks());

  /** Records every top-level screen the app draws, from the very first change detection. */
  async function screensSeen(): Promise<string[]> {
    const fixture = TestBed.createComponent(App);
    const element = fixture.nativeElement as HTMLElement;
    const seen: string[] = [];
    const record = () => {
      const name = element.querySelector('.vt-boot') ? 'loading' : element.querySelector('.vt-trip-library') ? 'my-trips' : element.querySelector('.vt-entry') ? 'entry' : element.querySelector('.vt-hero') ? 'trip' : 'other';
      if (seen.at(-1) !== name) seen.push(name);
    };
    const observer = new MutationObserver(record);
    observer.observe(element, { childList: true, subtree: true });
    fixture.detectChanges(); record();
    await fixture.whenStable(); fixture.detectChanges(); record();
    observer.disconnect();
    return seen;
  }

  it('goes from loading straight to My Trips when several trips are saved', async () => {
    const store = TestBed.inject(SavedTripsStore);
    await store.save(trip('trp_a'), session('a'));
    await store.save(trip('trp_b'), session('b'));
    expect(await screensSeen()).toEqual(['loading', 'my-trips']);
  });

  it('brings stale signed-in trips up to date behind My Trips, one at a time, and leaves fresh or signed-out ones', async () => {
    const store = TestBed.inject(SavedTripsStore);
    const fresh = parseTripSnapshot({ schemaVersion: 3, tripId: 'trp_fresh', stage: 'confirmed', accessScope: 'primary_customer', summary: { name: 'trp_fresh', reference: 'trp_fresh' }, freshness: { status: 'fresh', sourceUpdatedAt: null, nextRefreshAfter: future() } });
    await store.save(trip('trp_a'), session('a'));
    await store.save(fresh, session('fresh'));
    await store.save(trip('trp_b'), session('b'));
    await store.save(trip('trp_signed_out'), session('signed-out'));
    await store.signOut('trp_signed_out');
    let running = 0;
    let overlapped = false;
    const refreshed: string[] = [];
    vi.spyOn(App.prototype as unknown as { refreshSavedTrip: (saved: { snapshot: { tripId: string } }) => Promise<void> }, 'refreshSavedTrip').mockImplementation(async (saved) => {
      running += 1; overlapped ||= running > 1;
      refreshed.push(saved.snapshot.tripId);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
    });

    expect(await screensSeen()).toEqual(['loading', 'my-trips']);
    await vi.waitFor(() => expect(refreshed.sort()).toEqual(['trp_a', 'trp_b']));
    expect(overlapped).toBe(false);
  });

  it('goes from loading straight to the entry screen when nothing is saved', async () => {
    expect(await screensSeen()).toEqual(['loading', 'entry']);
  });
});
