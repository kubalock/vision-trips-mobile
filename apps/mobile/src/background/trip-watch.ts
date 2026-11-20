import { notificationNumber, tripNotifications, type NotificationBasis, type NotificationDraft } from '@vision-trips/contracts';

/*
 * The background check. It runs in @capacitor/background-runner's own JavaScript engine (no web view, no Angular, no
 * secure storage), woken by the OS roughly every 15 minutes or more while the app isn't open (see
 * runner/trip-watch.runner.ts, which connects these functions to the runner's globals).
 *
 * For each saved trip the app has registered, it asks the API for the trip's `NotificationBasis`, compares it with the
 * last one seen, and shows what changed using the same rules as the app. What it showed is kept for the app, which
 * adds it to the trip's notification list when it next opens (`drain`) without showing it a second time.
 *
 * Its state lives in the runner's key/value store (Shared Preferences / UserDefaults), so it holds only read-only
 * watch tokens, never the session's tokens.
 */

export interface WatchedTrip {
  tripId: string;
  apiBase: string;
  /** `vtw_…` from `POST /v1/trips/current/watch`; read-only and ends with the session. */
  watchToken: string;
  /** The last version of the trip the app or this check has seen. */
  basis: NotificationBasis;
  /** Notification ids already recorded for this trip (by the app or by this check), never shown again. */
  knownIds: string[];
}

export interface ShownNotification extends NotificationDraft {
  tripId: string;
  createdAt: string;
}

export interface WatchConfiguration {
  /** The customer's "Notifications on this device" choice. Off: trips are still followed, but nothing is shown. */
  enabled: boolean;
  trips: WatchedTrip[];
  /** The installed app's version headers (`X-Vision-App-Version`, `X-Vision-Platform`), sent with every check. */
  client?: Record<string, string>;
}

export interface WatchHost {
  get(key: string): string | null;
  set(key: string, value: string): void;
  fetch(url: string, init: { method: string; headers: Record<string, string> }): Promise<{ status: number; json(): Promise<unknown> }>;
  notify(notifications: Array<{ id: number; title: string; body: string; tripId: string }>): void;
  now(): Date;
}

const CONFIGURATION_KEY = 'trip-watch:configuration';
const PENDING_KEY = 'trip-watch:pending';
const MAX_KNOWN_IDS = 300;
const MAX_PENDING = 100;

/** From the app: which trips to follow, as they are now. Replaces the previous list. */
export function configure(host: WatchHost, details: unknown): void {
  const value = details as Partial<WatchConfiguration> | null;
  const trips = Array.isArray(value?.trips) ? value.trips.filter(isWatchedTrip) : [];
  const client = Object.fromEntries(Object.entries(value?.client ?? {}).filter(([name, item]) => /^X-Vision-(App-Version|Platform)$/.test(name) && typeof item === 'string'));
  host.set(CONFIGURATION_KEY, JSON.stringify({ enabled: value?.enabled === true, trips, client } satisfies WatchConfiguration));
}

/** For the app: notifications this check showed since the app last asked. Each is handed over once. */
export function drain(host: WatchHost): ShownNotification[] {
  const pending = readJson<ShownNotification[]>(host, PENDING_KEY, []);
  host.set(PENDING_KEY, '[]');
  return pending;
}

/** The scheduled check. One trip failing (offline, API down) never stops the others. */
export async function checkTrips(host: WatchHost): Promise<void> {
  const configuration = readJson<WatchConfiguration>(host, CONFIGURATION_KEY, { enabled: false, trips: [] });
  const shown: ShownNotification[] = [];
  const ended = new Set<string>();
  const updated = new Map<string, WatchedTrip>();

  for (const trip of configuration.trips) {
    let response: { status: number; json(): Promise<unknown> };
    try {
      response = await host.fetch(`${trip.apiBase}/trips/current/watch`, { method: 'GET', headers: { ...configuration.client, Authorization: `Watch ${trip.watchToken}`, Accept: 'application/json' } });
    } catch { continue; } // Offline: try again next time.
    // The session ended or the customer was unlinked: stop following the trip until the app registers it again.
    if (response.status === 401 || response.status === 403) { ended.add(trip.watchToken); continue; }
    // Anything else (including 426 "update the app") means try again next time.
    if (response.status !== 200) continue;
    let next: unknown;
    try { next = await response.json(); } catch { continue; }
    if (!isBasis(next) || next.tripId !== trip.tripId) continue;

    const known = new Set(trip.knownIds);
    const createdAt = host.now().toISOString();
    const fresh = tripNotifications(trip.basis, next, host.now()).filter((draft) => !known.has(draft.id));
    for (const draft of fresh) shown.push({ ...draft, tripId: trip.tripId, createdAt });
    updated.set(trip.watchToken, { ...trip, basis: next, knownIds: [...trip.knownIds, ...fresh.map((draft) => draft.id)].slice(-MAX_KNOWN_IDS) });
  }

  // The app may have sent a new list while this ran: apply results only to trips it still lists with the same token.
  const latest = readJson<WatchConfiguration>(host, CONFIGURATION_KEY, configuration);
  const trips = latest.trips.filter((trip) => !ended.has(trip.watchToken)).map((trip) => updated.get(trip.watchToken) ?? trip);
  host.set(CONFIGURATION_KEY, JSON.stringify({ ...latest, trips } satisfies WatchConfiguration));

  if (!shown.length) return;
  host.set(PENDING_KEY, JSON.stringify([...readJson<ShownNotification[]>(host, PENDING_KEY, []), ...shown].slice(-MAX_PENDING)));
  if (latest.enabled) host.notify(shown.map((item) => ({ id: notificationNumber(item.id), title: item.title, body: item.body, tripId: item.tripId })));
}

function readJson<T>(host: WatchHost, key: string, fallback: T): T {
  try { const value = host.get(key); return value ? JSON.parse(value) as T : fallback; }
  catch { return fallback; }
}

function isWatchedTrip(value: unknown): value is WatchedTrip {
  const trip = value as Partial<WatchedTrip> | null;
  return Boolean(trip && typeof trip.tripId === 'string' && typeof trip.apiBase === 'string' && /^https?:\/\//.test(trip.apiBase)
    && typeof trip.watchToken === 'string' && trip.watchToken.startsWith('vtw_') && isBasis(trip.basis) && Array.isArray(trip.knownIds));
}

function isBasis(value: unknown): value is NotificationBasis {
  const basis = value as Partial<NotificationBasis> | null;
  return Boolean(basis && typeof basis.tripId === 'string' && typeof basis.version === 'string' && typeof basis.tripName === 'string'
    && Array.isArray(basis.documents) && (basis.payments === null || (typeof basis.payments === 'object' && Array.isArray(basis.payments?.items))));
}
