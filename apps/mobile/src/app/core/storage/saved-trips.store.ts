import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import type { MobileSession, TripSnapshot } from '@vision-trips/contracts';
import { isWebSessionHandle } from '../api/web-client.interceptor';
import { BrowserTripDb } from './browser-trip-db';
import { decodeTripSnapshot, isTripDataError, parseStoredSession } from '../api/trip-schema';

export interface SavedTrip {
  snapshot: TripSnapshot;
  /** Null once the customer is signed out (session expired or ended): the trip stays readable offline, but
   *  refreshing it or acting on it needs the trip link again. */
  session: MobileSession | null;
  savedAt: string;
  /**
   * Who saved this copy (the session's opaque, base-scoped identity key). Kept after sign-out, so a late write from
   * another identity can be recognised. Null for trips saved by older versions.
   */
  identityKey: string | null;
}

/** Outcome of saving a trip; `replacedIdentity` is set when a different verified identity took over the trip's slot. */
export interface SaveResult { saved: boolean; replacedIdentity: boolean }

/** A trusted-device token and the identity it was issued to (null for tokens saved by older versions). */
interface TrustEntry { token: string; identityKey: string | null }

const MAX_TRUSTED_BOOKINGS = 20;
/** Keys an older version kept in localStorage, tokens included; removed on first use. */
const LEGACY_WEB_KEY = /^vision-trips:(trip:|device-trust$)/;

/**
 * Trips saved for offline use.
 * - Installed app: the snapshot and its session (refresh and trusted-device tokens included) go into the device's
 *   secure storage.
 * - Browser: only the snapshot goes into IndexedDB, labelled "saved in this browser". The refresh and
 *   trusted-device tokens live in the API's HttpOnly cookies (the session holds a `web:` handle in their place),
 *   and the access token is never written down.
 */
@Injectable({ providedIn: 'root' })
export class SavedTripsStore {
  readonly native = Capacitor.isNativePlatform();
  private readonly browserDb = new BrowserTripDb();
  /** The installed app's secure storage (replaceable in tests: the plugin proxy cannot be spied on). */
  private readonly secure: Pick<typeof SecureStorage, 'get' | 'set' | 'remove'> = SecureStorage;
  private legacyCleared = false;
  /** Trips removed during this visit (tombstones), so late writes cannot bring them back. */
  private readonly removed = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Trusted-device tokens, one per base, booking and Customer, so remembering a second booking — or a second person
   * on a shared device — does not forget the first. Browsers keep these in cookies.
   */
  async deviceTrusts(now = Date.now()): Promise<string[]> {
    return (await this.trustEntries(now)).map((entry) => entry.token);
  }

  async saveDeviceTrust(token: string, identityKey: string | null = null): Promise<void> {
    if (!this.native) return;
    const payload = trustPayload(token);
    const others = (await this.trustEntries()).filter((existing) => {
      const current = trustPayload(existing.token);
      return existing.token !== token && !(payload && current && current.b === payload.b && current.r === payload.r && current.c === payload.c);
    });
    await this.secure.set('device:trust', [{ token, identityKey }, ...others].slice(0, MAX_TRUSTED_BOOKINGS) as unknown as Record<string, unknown>);
  }

  /** Forgets every trusted-device token, or only those issued to one identity ("sign out of this account"). */
  async clearDeviceTrust(identityKey?: string): Promise<void> {
    if (!this.native) return;
    if (!identityKey) { await this.secure.remove('device:trust'); return; }
    const keep = (await this.trustEntries()).filter((entry) => entry.identityKey !== identityKey);
    await this.secure.set('device:trust', keep as unknown as Record<string, unknown>);
  }

  /** The identity that saved a trip on this device, if any. */
  async identityFor(tripId: string): Promise<string | null> {
    return this.exclusive(async () => (await this.readOne(tripId))?.identityKey ?? null);
  }

  private async trustEntries(now = Date.now()): Promise<TrustEntry[]> {
    if (!this.native) { this.clearLegacyWebStorage(); return []; }
    const value = await this.secure.get('device:trust');
    const items: unknown[] = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    const entries = items.flatMap((item): TrustEntry[] => {
      if (typeof item === 'string') return [{ token: item, identityKey: null }]; // Saved by an older version.
      const entry = item as Partial<TrustEntry> | null;
      return entry && typeof entry.token === 'string' ? [{ token: entry.token, identityKey: typeof entry.identityKey === 'string' ? entry.identityKey : null }] : [];
    });
    return entries.filter((entry) => { const payload = trustPayload(entry.token); return !payload || payload.e > now; });
  }

  /**
   * Saves a trip. A trip removed during this visit stays removed: a late refresh, token renewal or background
   * reload that finishes afterwards is ignored. Only opening the trip again (`reopened`, from its link or the
   * customer's account) brings it back.
   *
   * One saved copy per trip (base + booking). If a different verified identity (another Customer on the same
   * Booking) opens it, that identity takes the slot — `replacedIdentity` tells the app to say so and to clear the
   * previous identity's local data. A late, non-reopening write from an identity that no longer owns the slot is
   * refused, so it can never overwrite the new owner's credential.
   */
  save(snapshot: TripSnapshot, session: MobileSession, options: { reopened?: boolean } = {}): Promise<boolean> {
    return this.saveDetailed(snapshot, session, options).then((result) => result.saved);
  }

  saveDetailed(snapshot: TripSnapshot, session: MobileSession, options: { reopened?: boolean } = {}): Promise<SaveResult> {
    return this.exclusive(async () => {
      const tripId = snapshot.tripId;
      const refused = { saved: false, replacedIdentity: false };
      if (this.removed.has(tripId) && !options.reopened) return refused;
      // A raw refresh token must never reach browser storage; only the cookie handle may.
      if (!this.native && !isWebSessionHandle(session.refreshToken)) return refused;
      const identityKey = session.identityKey ?? null;
      const owner = (await this.readOne(tripId))?.identityKey ?? null;
      const differentOwner = Boolean(owner && identityKey && owner !== identityKey);
      if (differentOwner && !options.reopened) return refused;
      this.removed.delete(tripId);
      const savedAt = new Date().toISOString();
      if (this.native) {
        await this.secure.set(`trip:${tripId}`, { snapshot, session, savedAt, identityKey } as unknown as Record<string, unknown>);
        const ids = await this.ids();
        if (!ids.includes(tripId)) await this.secure.set('trip:index', [...ids, tripId]);
      } else {
        await this.browserDb.set(tripId, { snapshot, session: withoutAccessToken(session), savedAt, identityKey });
      }
      return { saved: true, replacedIdentity: differentOwner };
    });
  }

  /** True when the trip was removed during this visit (and not opened again since). */
  wasRemoved(tripId: string): boolean {
    return this.removed.has(tripId);
  }

  /**
   * Every saved trip, checked against the current schema. Older versions are migrated (and saved back, so it
   * happens once); entries that cannot be used — an unsupported version or damaged data — are removed.
   */
  all(): Promise<SavedTrip[]> {
    return this.exclusive(() => this.readAll());
  }

  /** All saved trips, with any credential that has passed its expiry dropped (the trip itself is kept). */
  signOutExpired(now = Date.now()): Promise<SavedTrip[]> {
    return this.exclusive(async () => {
      const trips: SavedTrip[] = [];
      for (const trip of await this.readAll()) {
        if (trip.session && isSessionExpired(trip.session, now)) {
          const signedOut = { ...trip, session: null };
          await this.write(signedOut);
          trips.push(signedOut);
        } else trips.push(trip);
      }
      return trips;
    });
  }

  /** Forgets a trip's unusable credential but keeps the saved trip for offline viewing. */
  signOut(tripId: string): Promise<void> {
    return this.exclusive(async () => {
      const trip = (await this.readAll()).find((saved) => saved.snapshot.tripId === tripId);
      if (trip?.session) await this.write({ ...trip, session: null });
    });
  }

  remove(tripId: string): Promise<void> {
    this.removed.add(tripId); // Before waiting, so a save already queued behind this is refused too.
    return this.exclusive(() => this.deleteNow(tripId));
  }

  // Everything below runs inside `exclusive`, so it must not call the public methods (they would wait on themselves).

  /**
   * Runs storage changes one at a time. Without this, a save and a remove of the same trip (or two updates of the
   * native index) can interleave, and a write that lands after a delete brings the trip back.
   */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async readOne(tripId: string): Promise<SavedTrip | null> {
    if (!(await this.ids()).includes(tripId)) return null;
    return decodeSavedTrip(this.native ? await this.secure.get(`trip:${tripId}`) : await this.browserDb.get(tripId))?.trip ?? null;
  }

  private async readAll(): Promise<SavedTrip[]> {
    const ids = await this.ids();
    const stored = await Promise.all(ids.map((id) => this.native ? this.secure.get(`trip:${id}`) : this.browserDb.get(id)));
    const trips: SavedTrip[] = [];
    for (const [index, value] of stored.entries()) {
      const decoded = decodeSavedTrip(value);
      if (!decoded) { await this.deleteNow(ids[index]); continue; }
      if (decoded.migrated) await this.write(decoded.trip);
      trips.push(decoded.trip);
    }
    return trips;
  }

  private async write(trip: SavedTrip): Promise<void> {
    if (this.native) await this.secure.set(`trip:${trip.snapshot.tripId}`, trip as unknown as Record<string, unknown>);
    else await this.browserDb.set(trip.snapshot.tripId, trip);
  }

  private async deleteNow(tripId: string): Promise<void> {
    if (!this.native) { await this.browserDb.delete(tripId); return; }
    await this.secure.remove(`trip:${tripId}`);
    await this.secure.set('trip:index', (await this.ids()).filter((id) => id !== tripId));
  }

  private async ids(): Promise<string[]> {
    if (!this.native) { this.clearLegacyWebStorage(); return this.browserDb.keys(); }
    const value = await this.secure.get('trip:index');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  /** Older versions kept whole sessions in localStorage. Those tokens cannot be moved into cookies, so they are dropped. */
  private clearLegacyWebStorage(): void {
    if (this.legacyCleared) return;
    this.legacyCleared = true;
    try {
      const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((key): key is string => Boolean(key && LEGACY_WEB_KEY.test(key)));
      for (const key of keys) localStorage.removeItem(key);
    } catch { /* storage unavailable */ }
  }
}

/** Browsers keep the access token in memory only; a saved trip renews it through the refresh cookie when reopened. */
function withoutAccessToken(session: MobileSession): MobileSession {
  return { ...session, accessToken: '', accessExpiresAt: new Date(0).toISOString() };
}

export function isSessionExpired(session: MobileSession, now = Date.now()): boolean {
  const expiresAt = Date.parse(session.refreshExpiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

/** Checks a stored trip; null when it cannot be used. A damaged session counts as signed out, not as a reason to drop the trip. */
function decodeSavedTrip(value: unknown): { trip: SavedTrip; migrated: boolean } | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { snapshot?: unknown; session?: unknown; savedAt?: unknown; identityKey?: unknown };
  try {
    const { snapshot, migrated } = decodeTripSnapshot(candidate.snapshot);
    const session = parseStoredSession(candidate.session);
    const savedAt = typeof candidate.savedAt === 'string' && Number.isFinite(Date.parse(candidate.savedAt)) ? candidate.savedAt : new Date(0).toISOString();
    const identityKey = typeof candidate.identityKey === 'string' ? candidate.identityKey : session?.identityKey ?? null;
    return { trip: { snapshot, session, savedAt, identityKey }, migrated };
  } catch (error) {
    console.warn('Removed a saved trip that this version cannot read.', isTripDataError(error) ? error.message : error);
    return null;
  }
}

/** Reads the booking and expiry from a trust token (`payload.signature`); the server still verifies the signature. */
function trustPayload(token: string): { b: string; r: string; c: string | null; e: number } | null {
  try {
    const encoded = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const value = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))) as { b?: unknown; r?: unknown; c?: unknown; e?: unknown };
    return typeof value.b === 'string' && typeof value.r === 'string' && typeof value.e === 'number' ? { b: value.b, r: value.r, c: typeof value.c === 'string' ? value.c : null, e: value.e } : null;
  } catch { return null; }
}
