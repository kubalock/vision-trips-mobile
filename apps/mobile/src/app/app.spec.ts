import { SavedTripsStore } from './core/storage/saved-trips.store';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { App, customerErrorMessage, engagementLabel, isShareCancelled } from './app';
import { VisionApiService } from './core/api/vision-api.service';
import { ShareSheet } from './core/platform/share-sheet';

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

  it('can go back to following the device theme', () => {
    localStorage.setItem('vision-trips:appearance', 'dark');
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as { appearancePreference: () => string; setAppearancePreference: (value: string) => void };
    expect(app.appearancePreference()).toBe('dark');

    app.setAppearancePreference('system');

    expect(app.appearancePreference()).toBe('system');
    expect(localStorage.getItem('vision-trips:appearance')).toBeNull();
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

    /** Switches saved trips to the installed app's secure storage (backed by a map), which keeps whole sessions. */
    function nativeStorage(): Map<string, unknown> {
      const values = new Map<string, unknown>();
      Object.assign(TestBed.inject(SavedTripsStore), {
        native: true,
        secure: {
          get: async (key: string) => values.get(key) ?? null,
          set: async (key: string, value: unknown) => { values.set(key, value); },
          remove: async (key: string) => values.delete(key),
        },
      });
      return values;
    }

    it('signs out of a trip whose session cannot be renewed, keeps the saved copy and stops retrying', async () => {
      const { app, api, fixture } = setup();
      nativeStorage();
      const store = TestBed.inject(SavedTripsStore);
      const trip = { ...(minimalTrip() as object), tripId: 'trip-1', payments: { paid: 0, items: [] } };
      app.trip.set(trip);
      await store.save(trip as never, app.session() as never);
      app.savedTripList.set(await store.all());
      const refresh = vi.spyOn(api, 'refreshSession').mockRejectedValue(unauthorized());
      const link = vi.spyOn(api, 'paymentLink').mockRejectedValue(unauthorized());
      vi.spyOn(window, 'open').mockImplementation(() => null);

      await app.openPayment('pay-1');
      await app.openPayment('pay-1');

      const view = app as unknown as { signedOut: () => boolean };
      expect(view.signedOut()).toBe(true);
      expect(app.session()).toBeNull();
      expect(app.error()).toBe('');
      expect(refresh).toHaveBeenCalledOnce();
      expect(link).toHaveBeenCalledOnce();
      const [saved] = await store.all();
      expect(saved.snapshot.tripId).toBe('trip-1');
      expect(saved.session).toBeNull();
      expect(app.savedTripList()[0].session).toBeNull();
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('.vt-signed-out')?.textContent).toContain('signed out of this trip');
    });

    it('does not bring back a trip that was removed while it was refreshing', async () => {
      const { app, api } = setup();
      nativeStorage();
      const store = TestBed.inject(SavedTripsStore);
      const tripB = { ...(minimalTrip() as object), tripId: 'trip-B' };
      await store.save(tripB as never, app.session() as never);
      app.savedTripList.set(await store.all());
      const [saved] = app.savedTripList();
      let finishRefresh!: (value: unknown) => void;
      vi.spyOn(api, 'refreshTrip').mockReturnValue(new Promise((resolve) => { finishRefresh = resolve; }) as never);
      vi.spyOn(api, 'revokeSession').mockResolvedValue(undefined);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const view = app as unknown as { refreshSavedTrip: (trip: unknown) => Promise<void>; removeSavedTrip: (trip: unknown) => Promise<void>; tripBusy: (trip: unknown) => boolean; tripRefreshStates: () => Record<string, string> };

      const refreshing = view.refreshSavedTrip(saved);
      await Promise.resolve();
      expect(view.tripBusy(saved)).toBe(true);
      await view.removeSavedTrip(saved); // Locked while refreshing: nothing happens.
      expect(app.savedTripList()).toHaveLength(1);

      await store.remove('trip-B'); // Removed some other way (another screen or tab) while the refresh is in flight.
      finishRefresh({ ...tripB, summary: { ...(minimalTrip() as { summary: object }).summary, name: 'Late' } });
      await refreshing;

      expect(await store.all()).toEqual([]);
      expect(view.tripRefreshStates()['trip-B']).toBeUndefined();
    });

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

    describe('failures shown beside what failed', () => {
      type Retry = {
        calendarError: () => string; documentFailure: () => { id: string; message: string } | null; accountError: () => string;
        customerAccount: { set: (value: unknown) => void; (): unknown }; retryAccount: () => void; accountLoading: () => boolean;
        downloadDocument: (value: unknown) => Promise<void>; online: { set: (value: boolean) => void };
      };
      const serverError = () => new HttpErrorResponse({ status: 503 });

      it('keeps a calendar failure beside the button, and clears it when the retry works', async () => {
        const { app, api } = setup();
        const view = app as unknown as Retry;
        app.trip.set({ tripId: 'trip-1', summary: { reference: 'REF-1' } });
        vi.spyOn(api, 'downloadCalendar').mockRejectedValueOnce(serverError()).mockResolvedValueOnce(new Blob(['x']));
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

        await app.downloadCalendar();
        expect(view.calendarError()).toContain('busy');
        expect(app.error()).toBe('');

        await app.downloadCalendar();
        expect(view.calendarError()).toBe('');
      });

      it('shows a failed document download on that document, not in the global banner', async () => {
        const { app, api } = setup();
        const view = app as unknown as Retry;
        const document = { id: 'doc-1', title: 'Invoice', downloadAction: 'invoice', mimeType: 'application/pdf', version: '1' };
        app.trip.set({ tripId: 'trip-1', summary: { reference: 'REF-1' }, documents: [document] });
        vi.spyOn(api, 'downloadDocument').mockRejectedValueOnce(serverError());

        await view.downloadDocument(document);

        expect(view.documentFailure()).toEqual({ id: 'doc-1', message: expect.stringContaining('busy') });
        expect(app.error()).toBe('');
      });

      it('leaves the saved preferences alone and reports inline when saving fails', async () => {
        const { app, api } = setup();
        const view = app as unknown as Retry & { accountSaveError: () => string; saveCustomerPreferences: (value: unknown) => Promise<void> };
        app.trip.set({ tripId: 'trip-1', accessScope: 'primary_customer' });
        const saved = { emailMarketing: false, smsMarketing: false, postalMarketing: false, preferredAirports: [], preferredMonths: [] };
        view.customerAccount.set({ emailHint: 'a***@x.com', preferences: saved, airportOptions: [], monthOptions: [], trips: [] });
        vi.spyOn(api, 'updateCustomerPreferences').mockRejectedValueOnce(serverError());

        await view.saveCustomerPreferences({ ...saved, emailMarketing: true });

        expect((view.customerAccount() as { preferences: unknown }).preferences).toBe(saved);
        expect(view.accountSaveError()).toContain('busy');
        expect(app.error()).toBe('');
      });

      it('keeps an account already on screen when reloading it fails, and offers a retry', async () => {
        const { app, api } = setup();
        const view = app as unknown as Retry;
        app.trip.set({ tripId: 'trip-1', accessScope: 'primary_customer' });
        const account = { emailHint: 'a***@x.com', preferences: {}, airportOptions: [], monthOptions: [], trips: [] };
        view.customerAccount.set(account);
        const load = vi.spyOn(api, 'customerAccount').mockRejectedValueOnce(serverError()).mockResolvedValueOnce(account as never);

        view.retryAccount(); await vi.waitFor(() => expect(view.accountLoading()).toBe(false));
        expect(view.customerAccount()).toBe(account);
        expect(view.accountError()).toContain('busy');

        view.retryAccount(); await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(view.accountError()).toBe(''));
      });
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
      const trip = { ...(minimalTrip() as object), payments: { paid: 0, balance: 2, total: 2, items: [{ id: 'pay-1', status: 'outstanding', canPay: true }] } };
      app.trip.set(trip);
      const status = (paid: number, itemStatus: string) => ({ tripId: 'trip-1', checkedAt: '', currency: 'GBP', total: 2, paid, balance: 2 - paid, items: [{ id: 'pay-1', status: itemStatus, completedDate: null }] });
      const poll = vi.spyOn(api, 'paymentStatus').mockResolvedValue(status(0, 'outstanding') as never);
      const fullReload = vi.spyOn(api, 'refreshTrip').mockResolvedValue(trip as never);
      internals.paymentAwaitingReturn = true; internals.paymentOpenedAt = Date.now() - 5_000; internals.paymentPaidBefore = 0;

      await internals.checkPaymentReturn();
      expect(poll).toHaveBeenCalledTimes(2);
      expect(fullReload).not.toHaveBeenCalled(); // Cheap checks only while unconfirmed.
      expect(internals.paymentReturnState()).toBe('unchanged');
      expect(internals.paymentAwaitingReturn).toBe(true);

      poll.mockResolvedValue(status(1, 'paid') as never);
      fullReload.mockRejectedValue(new Error('Airtable busy'));
      await internals.checkPaymentReturn();
      expect(fullReload).toHaveBeenCalledOnce();
      expect(internals.paymentReturnState()).toBe('updated');
      // The confirmed payment shows even though the full reload failed.
      const shown = (app as unknown as { trip: () => { payments: { paid: number; items: Array<{ status: string; canPay: boolean }> } } }).trip();
      expect(shown.payments.paid).toBe(1);
      expect(shown.payments.items[0]).toMatchObject({ status: 'paid', canPay: false });
      expect(internals.paymentAwaitingReturn).toBe(false);
    });

    it('does not treat a newly known paid total as a confirmed payment when it was unknown before', async () => {
      const { app, api } = setup();
      const internals = app as unknown as { paymentPollDelaysMs: number[]; paymentAwaitingReturn: boolean; paymentOpenedAt: number; paymentPaidBefore: number | null; paymentIdAwaiting: string | null; paymentReturnState: () => string; checkPaymentReturn: () => Promise<void> };
      internals.paymentPollDelaysMs = [0];
      app.trip.set({ ...(minimalTrip() as object), payments: { paid: null, balance: null, total: null, items: [{ id: 'pay-1', status: 'outstanding' }] } });
      vi.spyOn(api, 'paymentStatus').mockResolvedValue({ tripId: 'trip-1', checkedAt: '', currency: 'GBP', total: 500, paid: 2, balance: 498, items: [{ id: 'pay-1', status: 'outstanding', completedDate: null }] });
      internals.paymentAwaitingReturn = true; internals.paymentOpenedAt = Date.now() - 5_000; internals.paymentPaidBefore = null; internals.paymentIdAwaiting = 'pay-1';

      await internals.checkPaymentReturn();

      expect(internals.paymentReturnState()).toBe('unchanged');
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

    it('does nothing when the traveller cancels the share sheet', async () => {
      const { app, api } = setup();
      app.trip.set({ tripId: 'trip-1', summary: { name: 'Trip' }, capabilities: { shareWithTraveller: true } });
      vi.spyOn(api, 'fellowTravellerLink').mockResolvedValue({ url: 'https://trips.example/trip/abc', expiresAt: '2026-11-18T00:00:00Z' });
      vi.spyOn(TestBed.inject(ShareSheet), 'available').mockResolvedValue(true);
      vi.spyOn(TestBed.inject(ShareSheet), 'share').mockRejectedValue(new Error('Share canceled'));
      const copy = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });

      await (app as unknown as { shareWithTraveller: () => Promise<void> }).shareWithTraveller();

      expect(copy).not.toHaveBeenCalled();
      expect((app as unknown as { shareResult: () => string }).shareResult()).toBe('');
      expect(app.error()).toBe('');
    });

    it('shows the link to copy by hand when neither sharing nor the clipboard is available', async () => {
      const { app, api } = setup();
      app.trip.set({ tripId: 'trip-1', summary: { name: 'Trip' }, capabilities: { shareWithTraveller: true } });
      vi.spyOn(api, 'fellowTravellerLink').mockResolvedValue({ url: 'https://trips.example/trip/abc', expiresAt: '2026-11-18T00:00:00Z' });
      vi.spyOn(TestBed.inject(ShareSheet), 'available').mockResolvedValue(false);
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });

      await (app as unknown as { shareWithTraveller: () => Promise<void> }).shareWithTraveller();

      expect((app as unknown as { shareFallbackUrl: () => string | null }).shareFallbackUrl()).toBe('https://trips.example/trip/abc');
    });

    it('does not re-open a saved trip when the app was launched from a booking link', async () => {
      const { app } = setup();
      app.trip.set(null); app.session.set(null);
      const future = new Date(Date.now() + 86_400_000).toISOString();
      await TestBed.inject(SavedTripsStore).save({ ...(minimalTrip() as object), tripId: 'trip-saved' } as never, { accessToken: 'a', accessExpiresAt: future, refreshToken: 'web:saved-trip-handle', refreshExpiresAt: future });

      await (app as unknown as { initializeOfflineState: (activate: boolean) => Promise<void> }).initializeOfflineState(false);

      expect(app.savedTripList()).toHaveLength(1);
      expect((app as unknown as { trip: () => unknown }).trip()).toBeNull();
    });

    it('adopts a session another tab already renewed instead of re-using the old token', async () => {
      const { app, api } = setup();
      const future = new Date(Date.now() + 10 * 60_000).toISOString();
      app.trip.set({ ...(minimalTrip() as object), tripId: 'trip-1' });
      const renewedElsewhere = { accessToken: 'tab-b-access', accessExpiresAt: future, refreshToken: 'tab-b-refresh', refreshExpiresAt: future };
      // Installed app: another copy of the app may have renewed and saved the session (browsers share one cookie instead).
      nativeStorage();
      await TestBed.inject(SavedTripsStore).save({ ...(minimalTrip() as object), tripId: 'trip-1' } as never, renewedElsewhere);
      const refresh = vi.spyOn(api, 'refreshSession');

      const result = await app.refreshSession(app.session());

      expect(refresh).not.toHaveBeenCalled();
      expect(result).toEqual(renewedElsewhere);
      expect(app.session()?.refreshToken).toBe('tab-b-refresh');
    });

    describe('switching trips', () => {
      const future = () => new Date(Date.now() + 86_400_000).toISOString();
      const saved = (tripId: string) => ({ snapshot: { ...(minimalTrip() as object), tripId }, session: { accessToken: `${tripId}-a`, accessExpiresAt: future(), refreshToken: `${tripId}-r`, refreshExpiresAt: future() }, savedAt: '2026-11-01T00:00:00Z' });
      const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
      type Switching = {
        online: { set: (v: boolean) => void };
        messageSent: { set: (v: boolean) => void; (): boolean };
        acceptanceComplete: { set: (v: boolean) => void; (): boolean };
        customerAccount: { set: (v: unknown) => void; (): unknown };
        relatedQuotations: { set: (v: unknown[]) => void; (): unknown[] };
        externalContent: () => unknown;
        paymentAwaitingReturn: boolean;
        paymentReturnState: { set: (v: string) => void; (): string };
        openSavedTrip: (trip: unknown) => Promise<void>;
        loadExternalContent: () => Promise<void>;
        refreshCurrentTrip: (showError?: boolean) => Promise<void>;
      };

      it('clears everything that belonged to the previous trip', async () => {
        const { app } = setup();
        const view = app as unknown as Switching;
        app.trip.set({ ...(minimalTrip() as object), tripId: 'trip-A' });
        view.messageSent.set(true); view.acceptanceComplete.set(true); view.customerAccount.set({ preferences: {} });
        view.relatedQuotations.set([{ id: 'q' }]); view.paymentAwaitingReturn = true; view.paymentReturnState.set('unchanged');
        view.online.set(false); // Opening offline avoids network calls; the reset is the same.

        await view.openSavedTrip(saved('trip-B'));

        expect((app as unknown as { trip: () => { tripId: string } }).trip().tripId).toBe('trip-B');
        expect(view.messageSent()).toBe(false);
        expect(view.acceptanceComplete()).toBe(false);
        expect(view.customerAccount()).toBeNull();
        expect(view.relatedQuotations()).toEqual([]);
        expect(view.paymentAwaitingReturn).toBe(false);
        expect(view.paymentReturnState()).toBe('idle');
      });

      it('drops extra content that arrives after switching to another trip', async () => {
        const { app, api } = setup();
        const view = app as unknown as Switching;
        app.trip.set({ ...(minimalTrip() as object), tripId: 'trip-A' });
        const late = deferred<unknown>();
        vi.mocked(api.externalContent).mockReturnValueOnce(late.promise as never);
        const loading = view.loadExternalContent();

        view.online.set(false);
        await view.openSavedTrip(saved('trip-B'));
        late.resolve({ providers: { ai: { state: 'ready' } }, refreshAfterSeconds: 60 });
        await loading;

        expect(view.externalContent()).toBeNull();
      });

      it('keeps a late refresh of the previous trip out of view but saves it', async () => {
        const { app, api } = setup();
        nativeStorage();
        const view = app as unknown as Switching;
        app.trip.set({ ...(minimalTrip() as object), tripId: 'trip-A' });
        const late = deferred<unknown>();
        vi.spyOn(api, 'refreshTrip').mockReturnValueOnce(late.promise as never);
        const refreshing = view.refreshCurrentTrip(false);

        view.online.set(false);
        await view.openSavedTrip(saved('trip-B'));
        late.resolve({ ...(minimalTrip() as object), tripId: 'trip-A', summary: { ...(minimalTrip() as { summary: object }).summary, name: 'Updated A' } });
        await refreshing;

        expect((app as unknown as { trip: () => { tripId: string } }).trip().tripId).toBe('trip-B');
        const stored = (await TestBed.inject(SavedTripsStore).all()).find((trip) => trip.snapshot.tripId === 'trip-A');
        expect(stored?.snapshot.summary.name).toBe('Updated A');
      });
    });

    it('forgets the trusted-device cookies on sign-out in a browser', async () => {
      const { app, api } = setup();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.spyOn(api, 'revokeSession').mockResolvedValue(undefined);
      const forget = vi.spyOn(api, 'forgetDeviceTrust').mockResolvedValue(undefined);

      await app.signOutDevice();

      expect(forget).toHaveBeenCalledOnce();
      expect(app.session()).toBeNull();
    });

    it('forgets the trusted-device token on sign-out in the installed app', async () => {
      const { app, api } = setup();
      const secure = nativeStorage();
      secure.set('device:trust', ['trust-token']);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.spyOn(api, 'revokeSession').mockResolvedValue(undefined);

      await app.signOutDevice();

      expect(secure.has('device:trust')).toBe(false);
      expect(app.session()).toBeNull();
    });
  });
});

describe('engagementLabel', () => {
  const element = (html: string) => { const host = document.createElement('div'); host.innerHTML = html; return host.firstElementChild as HTMLElement; };

  it('never sends email addresses or phone numbers', () => {
    expect(engagementLabel(element('<a href="mailto:alex@example.com">Email us alex@example.com</a>'))).toBe('Email link');
    expect(engagementLabel(element('<a href="tel:+441234567890">Call us 01234 567 890</a>'))).toBe('Phone link');
    expect(engagementLabel(element('<button>Contact alex@example.com or 07700 900123</button>'))).toBe('Contact [email] or [number]');
  });

  it('prefers an explicit label and names external sites by host only', () => {
    expect(engagementLabel(element('<button data-engagement="Pay now">Pay £1.00</button>'))).toBe('Pay now');
    expect(engagementLabel(element('<a href="https://wa.me/441234567890?text=hi">WhatsApp us</a>'))).toBe('External link: wa.me');
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
    schemaVersion: 3, tripId: 'trip-1', stage: 'countdown', accessScope: 'primary_customer', version: '1',
    freshness: { status: 'fresh', sourceUpdatedAt: '2026-11-01T10:00:00Z', nextRefreshAfter: null },
    summary: { name: 'Test trip', reference: 'REF-1', departureDate: null, returnDate: null, heroImageUrl: null },
    brand: { name: 'Brand', logoUrl: null, theme: {}, profile: { whyBook: [], socialLinks: [], reviewLinks: [] } },
    support: {}, capabilities: {}, quotation: { canAccept: false, reviewSections: [] },
    experience: {}, itinerary: [], documents: [], payments: null, destinations: [], travellers: [], communications: [], extras: [],
  };
}
