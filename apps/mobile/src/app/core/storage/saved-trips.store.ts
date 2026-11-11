import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import type { MobileSession, TripSnapshot } from '@vision-trips/contracts';

export interface SavedTrip {
  snapshot: TripSnapshot;
  session: MobileSession;
  savedAt: string;
}

const WEB_INDEX_KEY = 'vision-trips:trip:index';
const MAX_TRUSTED_BOOKINGS = 20;

@Injectable({ providedIn: 'root' })
export class SavedTripsStore {
  /** Trusted-device tokens, one per booking, so remembering a second booking does not forget the first. */
  async deviceTrusts(now = Date.now()): Promise<string[]> {
    const value = Capacitor.isNativePlatform() ? await SecureStorage.get('device:trust') : parseJson(localStorage.getItem('vision-trips:device-trust')) ?? localStorage.getItem('vision-trips:device-trust');
    const tokens = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : typeof value === 'string' ? [value] : [];
    return tokens.filter((token) => { const payload = trustPayload(token); return !payload || payload.e > now; });
  }

  async saveDeviceTrust(token: string): Promise<void> {
    const payload = trustPayload(token);
    const others = (await this.deviceTrusts()).filter((existing) => {
      const current = trustPayload(existing);
      return existing !== token && !(payload && current && current.b === payload.b && current.r === payload.r);
    });
    const tokens = [token, ...others].slice(0, MAX_TRUSTED_BOOKINGS);
    if (Capacitor.isNativePlatform()) await SecureStorage.set('device:trust', tokens);
    else localStorage.setItem('vision-trips:device-trust', JSON.stringify(tokens));
  }

  async clearDeviceTrust(): Promise<void> {
    if (Capacitor.isNativePlatform()) await SecureStorage.remove('device:trust');
    else localStorage.removeItem('vision-trips:device-trust');
  }

  async save(snapshot: TripSnapshot, session: MobileSession): Promise<boolean> {
    const key = `trip:${snapshot.tripId}`;
    const saved: SavedTrip = { snapshot, session, savedAt: new Date().toISOString() };
    if (Capacitor.isNativePlatform()) await SecureStorage.set(key, saved as unknown as Record<string, unknown>);
    else localStorage.setItem(`vision-trips:${key}`, JSON.stringify(saved));
    const ids = await this.ids();
    if (!ids.includes(snapshot.tripId)) await this.saveIds([...ids, snapshot.tripId]);
    return true;
  }

  async all(): Promise<SavedTrip[]> {
    const saved = Capacitor.isNativePlatform()
      ? await Promise.all((await this.ids()).map((id) => SecureStorage.get(`trip:${id}`)))
      : (await this.ids()).map((id) => parseJson(localStorage.getItem(`vision-trips:trip:${id}`)));
    return saved.flatMap((value) => isSavedTrip(value) ? [value as unknown as SavedTrip] : []);
  }

  async pruneExpired(now = Date.now()): Promise<SavedTrip[]> {
    const saved = await this.all();
    const valid: SavedTrip[] = [];
    for (const trip of saved) {
      if (isSessionExpired(trip.session, now)) await this.remove(trip.snapshot.tripId);
      else valid.push(trip);
    }
    return valid;
  }

  async remove(tripId: string): Promise<void> {
    if (Capacitor.isNativePlatform()) await SecureStorage.remove(`trip:${tripId}`);
    else localStorage.removeItem(`vision-trips:trip:${tripId}`);
    await this.saveIds((await this.ids()).filter((id) => id !== tripId));
  }

  private async ids(): Promise<string[]> {
    const value = Capacitor.isNativePlatform()
      ? await SecureStorage.get('trip:index')
      : parseJson(localStorage.getItem(WEB_INDEX_KEY));
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private async saveIds(ids: string[]): Promise<void> {
    if (Capacitor.isNativePlatform()) await SecureStorage.set('trip:index', ids);
    else localStorage.setItem(WEB_INDEX_KEY, JSON.stringify(ids));
  }
}

export function isSessionExpired(session: MobileSession, now = Date.now()): boolean {
  const expiresAt = Date.parse(session.refreshExpiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

function isSavedTrip(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SavedTrip>;
  return Boolean(candidate.snapshot?.tripId && candidate.session?.refreshToken);
}

/** Reads the booking and expiry from a trust token (`payload.signature`); the server still verifies the signature. */
function trustPayload(token: string): { b: string; r: string; e: number } | null {
  try {
    const encoded = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const value = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))) as { b?: unknown; r?: unknown; e?: unknown };
    return typeof value.b === 'string' && typeof value.r === 'string' && typeof value.e === 'number' ? { b: value.b, r: value.r, e: value.e } : null;
  } catch { return null; }
}
