import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import type { MobileSession, TripSnapshot } from '@vision-trips/contracts';

export interface SavedTrip {
  snapshot: TripSnapshot;
  session: MobileSession;
  savedAt: string;
}

@Injectable({ providedIn: 'root' })
export class SavedTripsStore {
  async save(snapshot: TripSnapshot, session: MobileSession): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    const key = `trip:${snapshot.tripId}`;
    const saved: SavedTrip = { snapshot, session, savedAt: new Date().toISOString() };
    await SecureStorage.set(key, saved as unknown as Record<string, unknown>);
    const ids = await this.ids();
    if (!ids.includes(snapshot.tripId)) await SecureStorage.set('trip:index', [...ids, snapshot.tripId]);
    return true;
  }

  async all(): Promise<SavedTrip[]> {
    if (!Capacitor.isNativePlatform()) return [];
    const saved = await Promise.all(
      (await this.ids()).map((id) => SecureStorage.get(`trip:${id}`)),
    );
    return saved.flatMap((value) => isSavedTrip(value) ? [value as unknown as SavedTrip] : []);
  }

  async remove(tripId: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    await SecureStorage.remove(`trip:${tripId}`);
    await SecureStorage.set('trip:index', (await this.ids()).filter((id) => id !== tripId));
  }

  private async ids(): Promise<string[]> {
    const value = await SecureStorage.get('trip:index');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }
}

function isSavedTrip(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SavedTrip>;
  return Boolean(candidate.snapshot?.tripId && candidate.session?.refreshToken);
}
