import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';
import { VisionApiService } from './core/api/vision-api.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the trip entry screen', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Where are you heading?');
    expect(compiled.querySelector('label[for="base-id"]')?.textContent).toContain('Airtable base ID');
    expect(compiled.querySelector('label[for="record-id"]')?.textContent).toContain('Booking record ID');
  });

  it('should switch between trip views', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      activeView: () => string;
      selectView: (view: 'home' | 'itinerary' | 'payments' | 'documents' | 'help') => void;
    };
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

    app.selectView('itinerary');

    expect(app.activeView()).toBe('itinerary');
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('should preserve and mark the saved snapshot when refreshing offline', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      online: { set: (value: boolean) => void };
      session: { set: (value: unknown) => void };
      trip: { set: (value: unknown) => void; (): { freshness: { status: string } } };
      refreshCurrentTrip: () => Promise<void>;
    };
    app.online.set(false);
    app.session.set({ accessToken: 'offline', refreshToken: 'offline' });
    app.trip.set({ freshness: { status: 'fresh', sourceUpdatedAt: '2026-11-01T10:00:00Z', nextRefreshAfter: null } });

    await app.refreshCurrentTrip();

    expect(app.trip().freshness.status).toBe('offline');
  });

  it('shares one token rotation between concurrent refreshes', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      refreshSession: (session: { accessToken: string; refreshToken: string }) => Promise<unknown>;
    };
    const api = TestBed.inject(VisionApiService);
    const refreshed = {
      accessToken: 'new-access',
      accessExpiresAt: '2026-11-07T22:15:00Z',
      refreshToken: 'new-refresh',
      refreshExpiresAt: '2026-12-07T22:00:00Z',
    };
    const refresh = vi.spyOn(api, 'refreshSession').mockResolvedValue(refreshed);
    const expired = { accessToken: 'old-access', refreshToken: 'old-refresh' };

    const [first, second] = await Promise.all([
      app.refreshSession(expired),
      app.refreshSession(expired),
    ]);

    expect(refresh).toHaveBeenCalledOnce();
    expect(first).toBe(refreshed);
    expect(second).toBe(refreshed);
  });
});
