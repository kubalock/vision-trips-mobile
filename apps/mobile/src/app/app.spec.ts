import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { App, customerErrorMessage, isShareCancelled } from './app';
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

  it('presents internal trip stages with customer-friendly labels', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as { stageLabel: (stage: string) => string };

    expect(app.stageLabel('countdown')).toBe('Confirmed');
    expect(app.stageLabel('prep')).toBe('Confirmed');
    expect(app.stageLabel('departure')).toBe('Departure day');
  });

  it('persists an explicit appearance choice', () => {
    localStorage.setItem('vision-trips:appearance', 'light');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const app = fixture.componentInstance as unknown as { appearance: () => string; toggleAppearance: () => void };

    app.toggleAppearance();

    expect(app.appearance()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.getItem('vision-trips:appearance')).toBe('dark');
    localStorage.removeItem('vision-trips:appearance');
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

  describe('session handling for trip actions', () => {
    const future = () => new Date(Date.now() + 10 * 60_000).toISOString();
    const refreshed = () => ({ accessToken: 'new-access', accessExpiresAt: future(), refreshToken: 'new-refresh', refreshExpiresAt: future() });
    const unauthorized = () => new HttpErrorResponse({ status: 401 });

    type Internals = {
      session: { set: (value: unknown) => void; (): { accessToken: string; refreshToken: string } | null };
      trip: { set: (value: unknown) => void };
      savedTripList: { set: (value: unknown) => void; (): Array<{ session: { refreshToken: string } }> };
      error: { set: (value: string) => void; (): string };
      activeView: { set: (value: string) => void };
      openPayment: (id: string) => Promise<void>;
      downloadCalendar: () => Promise<void>;
      refreshSession: (session: unknown) => Promise<unknown>;
      signOutDevice: () => Promise<void>;
    };

    function setup(): { app: Internals; api: VisionApiService; fixture: ReturnType<typeof TestBed.createComponent<App>> } {
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance as unknown as Internals;
      app.session.set({ accessToken: 'old-access', accessExpiresAt: future(), refreshToken: 'old-refresh', refreshExpiresAt: future() });
      app.activeView.set('documents'); // Lightest tab to render with the minimal snapshot used here.
      const api = TestBed.inject(VisionApiService);
      vi.spyOn(api, 'externalContent').mockReturnValue(new Promise(() => undefined)); // Background refresh not under test.
      vi.spyOn(api, 'relatedQuotations').mockReturnValue(new Promise(() => undefined));
      return { app, api, fixture };
    }

    afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

    it('retries a payment link with a renewed token after a 401', async () => {
      const { app, api } = setup();
      app.trip.set({ tripId: 'trip-1', payments: { paid: 0, items: [] } });
      vi.spyOn(api, 'refreshSession').mockResolvedValue(refreshed());
      const link = vi.spyOn(api, 'paymentLink').mockRejectedValueOnce(unauthorized()).mockResolvedValueOnce({ url: 'https://pay.example/x' } as never);
      vi.spyOn(window, 'open').mockImplementation(() => null);

      await app.openPayment('pay-1');

      expect(link).toHaveBeenNthCalledWith(1, 'pay-1', 'old-access');
      expect(link).toHaveBeenNthCalledWith(2, 'pay-1', 'new-access');
      expect(app.error()).toBe('');
    });

    it('retries a calendar download with a renewed token after a 401', async () => {
      const { app, api } = setup();
      app.trip.set({ tripId: 'trip-1', summary: { reference: 'REF-1' } });
      vi.spyOn(api, 'refreshSession').mockResolvedValue(refreshed());
      const calendar = vi.spyOn(api, 'downloadCalendar').mockRejectedValueOnce(unauthorized()).mockResolvedValueOnce(new Blob(['x']));
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

      await app.downloadCalendar();

      expect(calendar).toHaveBeenLastCalledWith('new-access');
      expect(app.error()).toBe('');
    });

    it('updates the saved-trip list when a token is renewed', async () => {
      const { app, api } = setup();
      app.savedTripList.set([{ snapshot: { tripId: 'trip-1' }, session: { refreshToken: 'old-refresh' }, savedAt: '2026-11-01T00:00:00Z' }]);
      vi.spyOn(api, 'refreshSession').mockResolvedValue(refreshed());

      await app.refreshSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

      expect(app.savedTripList()[0].session.refreshToken).toBe('new-refresh');
    });

    it('shows trip errors on every trip tab', () => {
      const { app, fixture } = setup();
      app.trip.set(minimalTrip());
      // The banner sits outside the per-tab @if blocks; these tabs render with a minimal snapshot.
      for (const view of ['itinerary', 'payments', 'documents']) {
        app.activeView.set(view);
        app.error.set(`problem on ${view}`);
        fixture.detectChanges();
        const alert = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
        expect(alert?.textContent, view).toContain(`problem on ${view}`);
      }
    });

    it('opens a stored payment link straight from the tap without calling the API', async () => {
      const { app, api } = setup();
      app.trip.set({ tripId: 'trip-1', payments: { paid: 0, items: [{ id: 'pay-1', actionUrl: 'https://pay.example/balance' }] } });
      const link = vi.spyOn(api, 'paymentLink');
      const page = { opener: {} as unknown };
      const open = vi.spyOn(window, 'open').mockReturnValue(page as unknown as Window);

      await app.openPayment('pay-1');

      expect(link).not.toHaveBeenCalled();
      expect(open).toHaveBeenCalledWith('https://pay.example/balance', '_blank');
      expect(page.opener).toBeNull();
    });

    it('offers a direct link when the browser blocks the payment page', async () => {
      const { app, api } = setup();
      app.trip.set({ tripId: 'trip-1', payments: { paid: 0, items: [] } });
      vi.spyOn(api, 'paymentLink').mockResolvedValue({ url: 'https://pay.example/x' } as never);
      vi.spyOn(window, 'open').mockReturnValue(null);

      await app.openPayment('pay-1');

      expect((app as unknown as { blockedPageUrl: () => string | null }).blockedPageUrl()).toBe('https://pay.example/x');
    });

    it('keeps checking for an unconfirmed payment the next time the app is opened', async () => {
      const { app, api } = setup();
      const internals = app as unknown as {
        paymentPollDelaysMs: number[]; paymentAwaitingReturn: boolean; paymentOpenedAt: number; paymentPaidBefore: number;
        paymentReturnState: () => string; checkPaymentReturn: () => Promise<void>;
      };
      internals.paymentPollDelaysMs = [0, 0];
      const unpaid = { ...(minimalTrip() as object), payments: { paid: 0, items: [] } };
      const paid = { ...(minimalTrip() as object), payments: { paid: 100, items: [] } };
      app.trip.set(unpaid);
      const refresh = vi.spyOn(api, 'refreshTrip').mockResolvedValue(unpaid as never);
      internals.paymentAwaitingReturn = true; internals.paymentOpenedAt = Date.now() - 5_000; internals.paymentPaidBefore = 0;

      await internals.checkPaymentReturn();
      expect(refresh).toHaveBeenCalledTimes(2);
      expect(internals.paymentReturnState()).toBe('unchanged');
      expect(internals.paymentAwaitingReturn).toBe(true);

      refresh.mockResolvedValue(paid as never);
      await internals.checkPaymentReturn();
      expect(internals.paymentReturnState()).toBe('updated');
      expect(internals.paymentAwaitingReturn).toBe(false);
    });

    it('stops re-checking a payment opened more than 30 minutes ago', async () => {
      const { app, api } = setup();
      const internals = app as unknown as { paymentAwaitingReturn: boolean; paymentOpenedAt: number; checkPaymentReturn: () => Promise<void> };
      const refresh = vi.spyOn(api, 'refreshTrip');
      internals.paymentAwaitingReturn = true; internals.paymentOpenedAt = Date.now() - 31 * 60_000;

      await internals.checkPaymentReturn();

      expect(refresh).not.toHaveBeenCalled();
      expect(internals.paymentAwaitingReturn).toBe(false);
    });

    it('forgets the trusted-device token on sign-out', async () => {
      const { app, api } = setup();
      localStorage.setItem('vision-trips:device-trust', 'trust-token');
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.spyOn(api, 'revokeSession').mockResolvedValue(undefined);

      await app.signOutDevice();

      expect(localStorage.getItem('vision-trips:device-trust')).toBeNull();
      expect(app.session()).toBeNull();
    });
  });
});

describe('customerErrorMessage', () => {
  const http = (status: number, message?: string) => new HttpErrorResponse({ status, error: message ? { message } : null });

  it('never shows infrastructure or configuration details to travellers', () => {
    expect(customerErrorMessage(http(503, 'The Airtable token does not have access to this base or table.'), 'fallback')).toBe('Our booking system is busy right now. Please try again in a minute.');
    expect(customerErrorMessage(http(404, 'Airtable could not find the Bookings record.'), 'Fallback copy.')).toBe('Fallback copy.');
  });

  it('keeps customer-facing validation messages from the API', () => {
    expect(customerErrorMessage(http(400, 'Enter an amount between 0.01 and 498.00.'), 'fallback')).toBe('Enter an amount between 0.01 and 498.00.');
  });

  it('explains offline and expired-session cases plainly', () => {
    expect(customerErrorMessage(http(0), 'fallback')).toContain('Check your connection');
    expect(customerErrorMessage(http(401), 'fallback')).toContain('open your trip link again');
    expect(customerErrorMessage(new Error('boom'), 'Fallback copy.')).toBe('Fallback copy.');
  });
});

describe('isShareCancelled', () => {
  it('treats a dismissed share sheet as a non-error', () => {
    expect(isShareCancelled(new Error('Share canceled'))).toBe(true);
    expect(isShareCancelled(new DOMException('aborted', 'AbortError'))).toBe(true);
    expect(isShareCancelled(new Error('Network failure'))).toBe(false);
  });
});

function minimalTrip(): unknown {
  return {
    tripId: 'trip-1', stage: 'countdown', accessScope: 'primary_customer', version: '1',
    freshness: { status: 'fresh', sourceUpdatedAt: '2026-11-01T10:00:00Z', nextRefreshAfter: null },
    summary: { name: 'Test trip', reference: 'REF-1', departureDate: null, returnDate: null, heroImageUrl: null },
    brand: { name: 'Brand', logoUrl: null, theme: {}, profile: { whyBook: [], socialLinks: [], reviewLinks: [] } },
    support: {}, capabilities: {}, quotation: { canAccept: false, reviewSections: [] },
    experience: {}, itinerary: [], documents: [], payments: null, destinations: [], travellers: [], communications: [], extras: [],
  };
}
