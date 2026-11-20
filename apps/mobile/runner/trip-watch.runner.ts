/*
 * Entry point of the background runner (bundled by scripts/build-runner.mjs into public/runners/trip-watch.js).
 * It connects the logic in src/background/trip-watch.ts to @capacitor/background-runner's globals. Every handler
 * must call resolve() or reject(), or the OS may kill the task.
 */
import { checkTrips, configure, drain, type WatchHost } from '../src/background/trip-watch';

type Handler = (resolve: (value?: unknown) => void, reject: (reason?: unknown) => void, args: unknown) => void;
declare function addEventListener(event: string, handler: Handler): void;
declare const CapacitorKV: { get(key: string): { value?: string | null } | null | undefined; set(key: string, value: string): void };
declare const CapacitorNotifications: { schedule(notifications: Array<{ id: number; title: string; body: string; scheduleAt: Date; extra?: unknown; autoCancel?: boolean; smallIcon?: string }>): void };

const host: WatchHost = {
  get: (key) => CapacitorKV.get(key)?.value ?? null,
  set: (key, value) => CapacitorKV.set(key, value),
  fetch: (url, init) => fetch(url, init),
  notify: (notifications) => CapacitorNotifications.schedule(notifications.map((item) => ({
    id: item.id, title: item.title, body: item.body, scheduleAt: new Date(Date.now() + 1_000), extra: { tripId: item.tripId }, autoCancel: true,
    // Android status-bar icon (see capacitor.config.ts LocalNotifications.smallIcon); iOS uses the app icon.
    smallIcon: 'ic_stat_vision',
  }))),
  now: () => new Date(),
};

/** Scheduled by the OS (capacitor.config.ts: BackgroundRunner.event). */
addEventListener('checkTrips', (resolve) => {
  checkTrips(host).then(() => resolve(), (error: unknown) => { console.error(`Trip check failed: ${String(error)}`); resolve(); });
});

addEventListener('configure', (resolve, reject, args) => {
  try { configure(host, args); resolve(); } catch (error) { reject(String(error)); }
});

addEventListener('drain', (resolve, reject) => {
  try { resolve({ notifications: drain(host) }); } catch (error) { reject(String(error)); }
});
