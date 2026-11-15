import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';
import { VisionApiService } from './core/api/vision-api.service';
import { parseTripSnapshot } from './core/api/trip-schema';
import { CustomerNotificationsStore, type CustomerNotification } from './core/storage/customer-notifications.store';
import { SavedTripsStore } from './core/storage/saved-trips.store';

/** Work for a trip that finishes after the traveller switched to another trip must not land on the new trip's screen. */
describe('switching trip while the previous one is still loading', () => {
  const snapshot = (tripId: string) => parseTripSnapshot({ schemaVersion: 3, tripId, stage: 'confirmed', accessScope: 'primary_customer', summary: { name: tripId, reference: tripId } });
  const notification = (tripId: string): CustomerNotification => ({ id: `n_${tripId}`, tripId, kind: 'trip_update' as CustomerNotification['kind'], title: tripId, body: '', createdAt: '2026-11-15T10:00:00Z', readAt: null });
  function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

  type Internals = {
    trip: () => { tripId: string } | null; notifications: () => CustomerNotification[];
    activateSavedTrip: (saved: unknown, refresh: boolean) => Promise<void>;
    acceptAuthorized: (response: unknown) => Promise<void>;
  };

  async function render() {
    await TestBed.configureTestingModule({ imports: [App], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    vi.spyOn(TestBed.inject(VisionApiService), 'externalContent').mockReturnValue(new Promise(() => undefined));
    const notifications = TestBed.inject(CustomerNotificationsStore);
    vi.spyOn(notifications, 'list').mockImplementation((tripId) => [notification(tripId)]);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    return { app: fixture.componentInstance as unknown as Internals, notifications, savedTrips: TestBed.inject(SavedTripsStore) };
  }
  afterEach(() => vi.restoreAllMocks());

  it('a late notification sync never fills the newly opened trip with the previous trip’s notifications', async () => {
    const { app, notifications } = await render();
    const slow = deferred();
    vi.spyOn(notifications, 'sync').mockImplementation((_previous, next) => next.tripId === 'trp_A' ? slow.promise : Promise.resolve());

    const openingA = app.activateSavedTrip({ snapshot: snapshot('trp_A'), session: null, savedAt: '2026-11-15T10:00:00Z' }, false);
    await vi.waitFor(() => expect(notifications.sync).toHaveBeenCalledTimes(1));
    await app.activateSavedTrip({ snapshot: snapshot('trp_B'), session: null, savedAt: '2026-11-15T10:00:00Z' }, false);
    slow.resolve();
    await openingA;

    expect(app.trip()?.tripId).toBe('trp_B');
    expect(app.notifications().map((item) => item.tripId)).toEqual(['trp_B']);
  });

  it('a trip authorised after the traveller opened another one is saved but does not take over the screen', async () => {
    const { app, savedTrips } = await render();
    const slow = deferred();
    vi.spyOn(savedTrips, 'identityFor').mockImplementation(async () => { await slow.promise; return null; });
    const save = vi.spyOn(savedTrips, 'save').mockResolvedValue(true);
    const session = { accessToken: 'a', refreshToken: 'r', accessExpiresAt: '2099-01-01T00:00:00Z', refreshExpiresAt: '2099-01-01T00:00:00Z' };

    const authorising = app.acceptAuthorized({ status: 'authorized', exchangeId: 'x', expiresAt: session.refreshExpiresAt, snapshot: snapshot('trp_A'), session });
    await app.activateSavedTrip({ snapshot: snapshot('trp_B'), session: null, savedAt: '2026-11-15T10:00:00Z' }, false);
    slow.resolve();
    await authorising;

    expect(app.trip()?.tripId).toBe('trp_B');
    expect(app.notifications().map((item) => item.tripId)).toEqual(['trp_B']);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ tripId: 'trp_A' }), session, { reopened: true });
  });
});
