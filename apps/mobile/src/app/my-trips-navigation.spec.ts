import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';
import { VisionApiService } from './core/api/vision-api.service';
import { parseTripSnapshot } from './core/api/trip-schema';

/** My Trips opens over the current trip; there is always a visible way back to it, on the tab the traveller left. */
describe('My Trips navigation', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    const api = TestBed.inject(VisionApiService);
    vi.spyOn(api, 'externalContent').mockReturnValue(new Promise(() => undefined));
  });
  afterEach(() => vi.restoreAllMocks());

  type Signal<T> = { (): T; set: (value: T) => void };
  async function render() {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as { trip: Signal<unknown>; activeView: Signal<string>; showTripLibrary: Signal<boolean>; handleAndroidBack: () => void };
    app.trip.set(parseTripSnapshot({ schemaVersion: 3, tripId: 'trp_1', stage: 'confirmed', accessScope: 'primary_customer', summary: { name: 'Lisbon Escape', reference: 'R' } }));
    app.activeView.set('payments');
    app.showTripLibrary.set(true);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    return { fixture, app, element, back: () => element.querySelector<HTMLButtonElement>('.vt-trip-library__back') };
  }

  it('offers a way back to the open trip, returning to the same tab', async () => {
    const { fixture, app, element, back } = await render();
    expect(back()?.textContent).toContain('Back to Lisbon Escape');
    back()!.click(); fixture.detectChanges();
    expect(app.showTripLibrary()).toBe(false);
    expect(app.activeView()).toBe('payments');
    expect(element.querySelector('.vt-trip-library')).toBeNull();
  });

  it('leaves My Trips with the Android back button instead of reopening it', async () => {
    const { app } = await render();
    app.handleAndroidBack();
    expect(app.showTripLibrary()).toBe(false);
  });

  it('has no back link when no trip is open', async () => {
    const { fixture, app, back } = await render();
    app.trip.set(null); fixture.detectChanges();
    expect(back()).toBeNull();
  });
});
