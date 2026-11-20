import { Injectable, inject } from '@angular/core';
import { BackgroundRunner } from '@capacitor/background-runner';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { notificationBasis } from '@vision-trips/contracts';
import { VisionApiService } from '../api/vision-api.service';
import type { SavedTrip } from '../storage/saved-trips.store';
import { CustomerNotificationsStore } from '../storage/customer-notifications.store';
import type { ShownNotification, WatchConfiguration } from '../../../background/trip-watch';

/** Must match `plugins.BackgroundRunner.label` in capacitor.config.ts. */
export const TRIP_WATCH_LABEL = 'uk.co.visiontrips.app.trip-check';
const TOKENS_KEY = 'trip-watch:tokens';
/** The runner normally answers at once; never let a stuck call hold up the app. */
const DISPATCH_TIMEOUT_MS = 3_000;

/**
 * The app's side of the background check (src/background/trip-watch.ts): it gives each signed-in saved trip a
 * read-only watch token, tells the runner which trips to follow and what they looked like when last seen, and
 * collects the notifications the runner showed so they appear in each trip's list too.
 */
@Injectable({ providedIn: 'root' })
export class BackgroundWatch {
  private readonly api = inject(VisionApiService);
  private readonly notifications = inject(CustomerNotificationsStore);
  private readonly native = Capacitor.isNativePlatform();
  /** Updates run one after another, so a slow registration never lets an older trip list overwrite a newer one. */
  private queue: Promise<void> = Promise.resolve();

  /** Call whenever the saved trips change (saved, refreshed, signed out, removed) or the notification setting does. */
  update(saved: SavedTrip[]): Promise<void> {
    if (!this.native) return Promise.resolve();
    this.queue = this.queue.then(() => this.apply(saved)).catch(() => undefined);
    return this.queue;
  }

  /**
   * Adds what the background check showed since the app last asked to each trip's notification list (without
   * showing it again) and returns the trips that got new notifications.
   */
  async collect(): Promise<string[]> {
    if (!this.native) return [];
    const result = await dispatch<{ notifications?: ShownNotification[] }>('drain', {});
    const shown = Array.isArray(result?.notifications) ? result.notifications : [];
    const byTrip = new Map<string, ShownNotification[]>();
    for (const item of shown) if (item && typeof item.tripId === 'string' && typeof item.id === 'string') byTrip.set(item.tripId, [...(byTrip.get(item.tripId) ?? []), item]);
    for (const [tripId, items] of byTrip) this.notifications.recordShown(tripId, items);
    return [...byTrip.keys()];
  }

  private async apply(saved: SavedTrip[]): Promise<void> {
    const tokens = await readTokens();
    const signedIn = saved.filter((trip) => trip.session);
    for (const trip of signedIn) {
      const session = trip.session!;
      const sessionId = session.accessToken.split('.').pop() ?? '';
      if (tokens[trip.snapshot.tripId]?.startsWith(`vtw_${sessionId}.`)) continue;
      // Only with an access token that is still valid: otherwise the next refresh saves a new one and calls this again.
      if (Date.parse(session.accessExpiresAt) < Date.now() + 30_000) continue;
      try { tokens[trip.snapshot.tripId] = await this.api.registerWatch(session.accessToken); }
      catch { /* Offline or the API is unavailable: tried again on the next change. */ }
    }
    const followed = new Set(signedIn.map((trip) => trip.snapshot.tripId));
    for (const tripId of Object.keys(tokens)) if (!followed.has(tripId)) delete tokens[tripId];
    await Preferences.set({ key: TOKENS_KEY, value: JSON.stringify(tokens) });

    const configuration: WatchConfiguration = {
      enabled: this.notifications.deviceEnabled(),
      trips: signedIn.filter((trip) => tokens[trip.snapshot.tripId]).map((trip) => ({
        tripId: trip.snapshot.tripId,
        apiBase: this.api.apiBaseUrl,
        watchToken: tokens[trip.snapshot.tripId],
        basis: notificationBasis(trip.snapshot),
        knownIds: this.notifications.ids(trip.snapshot.tripId),
      })),
    };
    await dispatch('configure', configuration as unknown as Record<string, unknown>);
  }
}

async function readTokens(): Promise<Record<string, string>> {
  try {
    const value = JSON.parse((await Preferences.get({ key: TOKENS_KEY })).value || '{}') as unknown;
    return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {};
  } catch { return {}; }
}

async function dispatch<T>(event: string, details: Record<string, unknown>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      BackgroundRunner.dispatchEvent<T>({ label: TRIP_WATCH_LABEL, event, details }) as Promise<T>,
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), DISPATCH_TIMEOUT_MS); }),
    ]);
  } catch { return null; }
  finally { if (timer) clearTimeout(timer); }
}
