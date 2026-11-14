import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';
import { VisionApiService } from './core/api/vision-api.service';
import { parseTripSnapshot } from './core/api/trip-schema';

/** Notifications open as a panel over the current screen, from the bell in the sticky header. */
describe('notifications panel', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    const api = TestBed.inject(VisionApiService);
    vi.spyOn(api, 'externalContent').mockReturnValue(new Promise(() => undefined));
  });
  afterEach(() => vi.restoreAllMocks());

  async function render() {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as { trip: { set: (value: unknown) => void }; activeView: { set: (value: string) => void; (): string }; showTripLibrary: { set: (value: boolean) => void; (): boolean } };
    app.trip.set(parseTripSnapshot({ schemaVersion: 3, tripId: 'trp_1', stage: 'confirmed', accessScope: 'primary_customer', summary: { name: 'Lisbon', reference: 'R' } }));
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const bell = () => element.querySelector<HTMLButtonElement>('[aria-controls="customer-notifications"]')!;
    const panel = () => element.querySelector('#customer-notifications');
    return { fixture, app, element, bell, panel };
  }

  it('opens in the header, over the screen the traveller is on, without changing it', async () => {
    const { fixture, app, bell, panel } = await render();
    app.activeView.set('documents'); fixture.detectChanges();
    bell().click(); fixture.detectChanges();
    expect(panel()?.closest('header.vt-top')).not.toBeNull();
    expect(panel()?.getAttribute('role')).toBe('dialog');
    expect(bell().getAttribute('aria-expanded')).toBe('true');
    expect(app.activeView()).toBe('documents');
  });

  it('closes with Escape, an outside click, the close button or the bell', async () => {
    const { fixture, element, bell, panel } = await render();
    const open = () => { bell().click(); fixture.detectChanges(); expect(panel()).not.toBeNull(); };
    open(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); fixture.detectChanges();
    expect(panel()).toBeNull();
    open(); element.querySelector<HTMLElement>('.vt-notifications-backdrop')!.click(); fixture.detectChanges();
    expect(panel()).toBeNull();
    open(); element.querySelector<HTMLButtonElement>('.vt-notifications__close')!.click(); fixture.detectChanges();
    expect(panel()).toBeNull();
    open(); bell().click(); fixture.detectChanges();
    expect(panel()).toBeNull();
  });

  it('closes when the traveller moves to another tab', async () => {
    const { fixture, element, bell, panel } = await render();
    bell().click(); fixture.detectChanges();
    [...element.querySelectorAll<HTMLButtonElement>('.vt-nav button')].find((button) => button.textContent?.includes('Itinerary'))!.click();
    fixture.detectChanges();
    expect(panel()).toBeNull();
  });
});
