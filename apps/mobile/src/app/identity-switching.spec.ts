import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import type { MobileSession, TripSnapshot } from '@vision-trips/contracts';
import { App, switchMessage } from './app';
import { VisionApiService } from './core/api/vision-api.service';
import { parseTripSnapshot } from './core/api/trip-schema';
import { CustomerNotificationsStore } from './core/storage/customer-notifications.store';
import { SavedTripsStore } from './core/storage/saved-trips.store';

/**
 * App-level identity scenarios: Branch A and Branch B on one device, a second Customer on the same Booking, warm deep
 * links, and the scope of each sign-out action.
 */
const INVITE_A = 'vt_abcdefghijklmnopqrstuvwxyzABCDEF';
const INVITE_B = 'vt_ZYXWVUTSRQPONMLKJIHGFEDCBAzyxwvu';
const future = () => new Date(Date.now() + 86_400_000).toISOString();
const trip = (tripId: string, brand: string, name = tripId): TripSnapshot => parseTripSnapshot({ schemaVersion: 3, tripId, stage: 'confirmed', accessScope: 'primary_customer', summary: { name, reference: tripId.toUpperCase() }, brand: { name: brand } });
const session = (name: string, identityKey: string): MobileSession => ({ accessToken: `${name}-access`, accessExpiresAt: future(), refreshToken: `${name}-refresh`, refreshExpiresAt: future(), identityKey });

type Internals = {
  trip: { set: (value: TripSnapshot | null) => void; (): TripSnapshot | null };
  session: { set: (value: MobileSession | null) => void; (): MobileSession | null };
  invitationToken: { set: (value: string | null) => void; (): string | null };
  showTripLibrary: { (): boolean };
  switchNotice: () => string;
  savedTripList: () => Array<{ snapshot: TripSnapshot; identityKey: string | null }>;
  multipleBrands: () => boolean;
  online: { set: (value: boolean) => void };
  handleOpenedUrl: (url: string) => void;
  invitationAuthorized: (value: unknown) => Promise<void>;
  invitationCancelled: () => void;
  openSavedTrip: (saved: unknown) => Promise<void>;
  signOutAccount: () => Promise<void>;
  signOutDevice: () => Promise<void>;
  openCustomerAccountTrip: (id: string) => Promise<void>;
};

describe('identity switching', () => {
  let secure: Map<string, unknown>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    secure = new Map();
    Object.assign(TestBed.inject(SavedTripsStore), {
      native: true,
      secure: { get: async (key: string) => secure.get(key) ?? null, set: async (key: string, value: unknown) => { secure.set(key, value); }, remove: async (key: string) => secure.delete(key) },
    });
    const api = TestBed.inject(VisionApiService);
    vi.spyOn(api, 'externalContent').mockReturnValue(new Promise(() => undefined));
    vi.spyOn(api, 'relatedQuotations').mockReturnValue(new Promise(() => undefined));
    vi.spyOn(api, 'resolveInvitation').mockReturnValue(new Promise(() => undefined));
    vi.spyOn(api, 'revokeSession').mockResolvedValue(undefined);
    vi.spyOn(api, 'forgetDeviceTrust').mockResolvedValue(undefined);
  });
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  const create = () => TestBed.createComponent(App).componentInstance as unknown as Internals;
  const authorize = (app: Internals, snapshot: TripSnapshot, value: MobileSession) => app.invitationAuthorized({ status: 'authorized', snapshot, session: value });

  it('keeps Branch A saved after verifying Branch B, lists both, and labels them by branch', async () => {
    const app = create();
    await authorize(app, trip('trp_A', 'Branch A Travel', 'Lisbon'), session('a', 'idk_branchA'));
    expect(app.multipleBrands()).toBe(false);
    await authorize(app, trip('trp_B', 'Branch B Travel', 'Lisbon'), session('b', 'idk_branchB'));

    expect(app.trip()?.tripId).toBe('trp_B');
    expect(app.savedTripList().map((saved) => [saved.snapshot.tripId, saved.identityKey]).sort()).toEqual([['trp_A', 'idk_branchA'], ['trp_B', 'idk_branchB']]);
    expect(app.multipleBrands()).toBe(true);
    expect(app.switchNotice()).toContain('from Branch B Travel');
    expect(app.switchNotice()).toContain('Branch A Travel trips are still saved');
  });

  it('switches cleanly back and forth between branches with the right brand and session', async () => {
    const app = create();
    app.online.set(false);
    await authorize(app, trip('trp_A', 'Branch A Travel'), session('a', 'idk_branchA'));
    await authorize(app, trip('trp_B', 'Branch B Travel'), session('b', 'idk_branchB'));
    for (const [tripId, brand, refresh] of [['trp_A', 'Branch A Travel', 'a-refresh'], ['trp_B', 'Branch B Travel', 'b-refresh'], ['trp_A', 'Branch A Travel', 'a-refresh']]) {
      await app.openSavedTrip(app.savedTripList().find((saved) => saved.snapshot.tripId === tripId));
      expect(app.trip()?.brand.name).toBe(brand);
      expect(app.session()?.refreshToken).toBe(refresh);
    }
  });

  it('does not interrupt when another trip of the same Customer in the same branch opens', async () => {
    const app = create();
    await authorize(app, trip('trp_1', 'Branch A Travel'), session('a1', 'idk_grace'));
    await authorize(app, trip('trp_2', 'Branch A Travel'), session('a2', 'idk_grace'));
    expect(app.switchNotice()).toBe('');
  });

  it('a second Customer on the same Booking replaces the first one’s copy with a clear message and clears its local data', async () => {
    const app = create();
    const notifications = TestBed.inject(CustomerNotificationsStore);
    await authorize(app, trip('trp_shared', 'Branch A Travel', 'Shared trip'), session('grace', 'idk_grace'));
    const clear = vi.spyOn(notifications, 'clear');
    localStorage.setItem('vision-trips:checklist', JSON.stringify(['trp_shared:passport', 'trp_other:visa']));

    await authorize(app, trip('trp_shared', 'Branch A Travel', 'Shared trip'), session('alan', 'idk_alan'));

    expect(app.savedTripList()).toHaveLength(1);
    expect(app.savedTripList()[0].identityKey).toBe('idk_alan');
    expect(app.session()?.refreshToken).toBe('alan-refresh');
    expect(app.switchNotice()).toContain('as a different customer');
    expect(clear).toHaveBeenCalledWith('trp_shared');
    expect(JSON.parse(localStorage.getItem('vision-trips:checklist')!)).toEqual(['trp_other:visa']);
  });

  it('shows an invitation that arrives while a trip is open without losing that trip, and “Not now” returns to it', async () => {
    const app = create();
    await authorize(app, trip('trp_A', 'Branch A Travel'), session('a', 'idk_branchA'));
    app.handleOpenedUrl(`https://trips.example.com/trip/${INVITE_B}`);
    expect(app.invitationToken()).toBe(INVITE_B);
    expect(app.trip()?.tripId).toBe('trp_A'); // Still there underneath.
    app.invitationCancelled();
    expect(app.invitationToken()).toBeNull();
    expect(app.trip()?.tripId).toBe('trp_A');
    expect(app.session()?.refreshToken).toBe('a-refresh');
  });

  it('takes the latest of two links that arrive rapidly, and ignores invalid ones', () => {
    const app = create();
    app.handleOpenedUrl(`https://trips.example.com/trip/${INVITE_A}`);
    app.handleOpenedUrl(`https://trips.example.com/trip/${INVITE_B}`);
    expect(app.invitationToken()).toBe(INVITE_B);
    app.handleOpenedUrl('https://trips.example.com/somewhere-else');
    app.handleOpenedUrl(`visiontrips://trip/${INVITE_A}`);
    expect(app.invitationToken()).toBe(INVITE_B);
  });

  it('drops an older legacy-link exchange when a newer link arrives first', async () => {
    const api = TestBed.inject(VisionApiService);
    let finish!: (value: unknown) => void;
    vi.spyOn(api, 'exchangeLink').mockReturnValue(new Promise((resolve) => { finish = resolve; }) as never);
    const app = create();
    app.handleOpenedUrl('https://trips.example.com/trip/eyJ2IjoxfQ.c2lnbmF0dXJl');
    app.handleOpenedUrl(`https://trips.example.com/trip/${INVITE_B}`);
    finish({ status: 'invitation_required', invitationToken: INVITE_A });
    await new Promise((resolve) => setTimeout(resolve));
    expect(app.invitationToken()).toBe(INVITE_B);
  });

  it('“Sign out of this account” removes only that identity’s trips and trust', async () => {
    const app = create();
    app.online.set(false);
    const store = TestBed.inject(SavedTripsStore);
    await authorize(app, trip('trp_A1', 'Branch A Travel'), session('a1', 'idk_branchA'));
    await authorize(app, trip('trp_A2', 'Branch A Travel'), session('a2', 'idk_branchA'));
    await authorize(app, trip('trp_B', 'Branch B Travel'), session('b', 'idk_branchB'));
    await store.saveDeviceTrust('trust-a', 'idk_branchA');
    await store.saveDeviceTrust('trust-b', 'idk_branchB');
    await app.openSavedTrip(app.savedTripList().find((saved) => saved.snapshot.tripId === 'trp_A1'));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    await app.signOutAccount();

    expect(confirm.mock.calls[0][0]).toContain('Sign out of your Branch A Travel account');
    expect(confirm.mock.calls[0][0]).toContain('Your 1 other saved trip stays');
    expect(app.savedTripList().map((saved) => saved.snapshot.tripId)).toEqual(['trp_B']);
    expect(await store.deviceTrusts()).toEqual(['trust-b']);
    expect(TestBed.inject(VisionApiService).forgetDeviceTrust).not.toHaveBeenCalled(); // Installed app: secure storage only.
    expect(app.trip()).toBeNull();
    expect(app.showTripLibrary()).toBe(true);
  });

  it('“Remove all data from this device” removes every branch and says so', async () => {
    const app = create();
    await authorize(app, trip('trp_A', 'Branch A Travel'), session('a', 'idk_branchA'));
    await authorize(app, trip('trp_B', 'Branch B Travel'), session('b', 'idk_branchB'));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await app.signOutDevice();
    expect(confirm.mock.calls[0][0]).toContain('every travel company and account');
    expect(await TestBed.inject(SavedTripsStore).all()).toEqual([]);
  });

  it('opening an account trip after the customer switched away saves it without switching under them', async () => {
    const api = TestBed.inject(VisionApiService);
    const app = create();
    await authorize(app, trip('trp_A', 'Branch A Travel'), session('a', 'idk_grace'));
    let finish!: (value: unknown) => void;
    vi.spyOn(api, 'openCustomerAccountTrip').mockReturnValue(new Promise((resolve) => { finish = resolve; }) as never);
    const opening = app.openCustomerAccountTrip('acct-trip');
    await authorize(app, trip('trp_B', 'Branch B Travel'), session('b', 'idk_branchB'));
    finish({ snapshot: trip('trp_A2', 'Branch A Travel'), session: session('a2', 'idk_grace') });
    await opening;
    expect(app.trip()?.tripId).toBe('trp_B');
    expect(app.savedTripList().map((saved) => saved.snapshot.tripId)).toContain('trp_A2');
  });
});

describe('switchMessage', () => {
  const a = trip('trp_A', 'Branch A Travel', 'Lisbon');
  it('is silent on first open and for the same Customer in the same branch', () => {
    expect(switchMessage({ trip: null, identityKey: null }, a, 'idk_1', false)).toBe('');
    expect(switchMessage({ trip: a, identityKey: 'idk_1' }, trip('trp_2', 'Branch A Travel'), 'idk_1', false)).toBe('');
  });
  it('names the branch when it changes, and the account when the Customer changes', () => {
    expect(switchMessage({ trip: a, identityKey: 'idk_1' }, trip('trp_B', 'Branch B Travel', 'Rome'), 'idk_2', false)).toContain('Rome from Branch B Travel');
    expect(switchMessage({ trip: a, identityKey: 'idk_1' }, trip('trp_2', 'Branch A Travel', 'Rome'), 'idk_2', false)).toContain('different customer account');
  });
});
