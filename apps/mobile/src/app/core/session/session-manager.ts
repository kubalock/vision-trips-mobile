import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type { MobileSession } from '@vision-trips/contracts';
import { VisionApiService } from '../api/vision-api.service';
import { SavedTripsStore } from '../storage/saved-trips.store';

/** Emitted after a refresh token has been replaced, so holders of the old session can update their copies. */
export interface SessionRenewal {
  previousRefreshToken: string;
  session: MobileSession;
  /** False when a newer session saved by another tab was adopted instead of calling the server. */
  fromServer: boolean;
}

export interface SessionHooks {
  /** Which saved trip a refresh token belongs to, used to look for a newer copy in storage. */
  tripIdFor(refreshToken: string): string | undefined;
  /** Runs before the renewed session is handed back to callers. */
  renewed(renewal: SessionRenewal): Promise<void> | void;
}

/**
 * Owns the open trip's session and every token renewal: renew shortly before the access token expires, retry once
 * on a 401, share one renewal between concurrent callers, and adopt a session another tab already renewed (reusing
 * a replaced refresh token would make the server end the session).
 */
@Injectable({ providedIn: 'root' })
export class SessionManager {
  private readonly api = inject(VisionApiService);
  private readonly savedTrips = inject(SavedTripsStore);
  private readonly inFlight = new Map<string, Promise<MobileSession>>();
  private hooks: SessionHooks = { tripIdFor: () => undefined, renewed: () => undefined };

  /** The open trip's session. */
  readonly session = signal<MobileSession | null>(null);

  connect(hooks: SessionHooks): void {
    this.hooks = hooks;
  }

  /** Returns a session whose access token is good for at least 30 more seconds. */
  forRequest(session: MobileSession): Promise<MobileSession> {
    return isAccessExpiring(session) ? this.renew(session) : Promise.resolve(session);
  }

  /** Runs an authorised request, renewing the token first if needed and once more after a 401. */
  async run<T>(session: MobileSession, request: (accessToken: string) => Promise<T>): Promise<T> {
    return (await this.runWithSession(session, request)).result;
  }

  /** Like `run`, but also returns the session that was finally used (to save alongside the result). */
  async runWithSession<T>(session: MobileSession, request: (accessToken: string) => Promise<T>): Promise<{ result: T; session: MobileSession }> {
    let active = await this.forRequest(session);
    try {
      return { result: await request(active.accessToken), session: active };
    } catch (error) {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) throw error;
      active = await this.renew(active);
      return { result: await request(active.accessToken), session: active };
    }
  }

  renew(expired: MobileSession): Promise<MobileSession> {
    const refreshToken = expired.refreshToken;
    const pending = this.inFlight.get(refreshToken);
    if (pending) return pending;

    const request = (async () => {
      const newer = await this.newerStoredSession(refreshToken);
      const fromServer = !newer || isAccessExpiring(newer);
      const session = fromServer ? await this.api.refreshSession(newer?.refreshToken ?? refreshToken) : newer;
      if (this.session()?.refreshToken === refreshToken) this.session.set(session);
      await this.hooks.renewed({ previousRefreshToken: refreshToken, session, fromServer });
      return session;
    })().finally(() => this.inFlight.delete(refreshToken));
    this.inFlight.set(refreshToken, request);
    return request;
  }

  private async newerStoredSession(refreshToken: string): Promise<MobileSession | null> {
    const tripId = this.hooks.tripIdFor(refreshToken);
    if (!tripId) return null;
    const stored = (await this.savedTrips.all()).find((trip) => trip.snapshot.tripId === tripId)?.session;
    return stored && stored.refreshToken !== refreshToken ? stored : null;
  }
}

export function isAccessExpiring(session: MobileSession): boolean {
  const expiresAt = Date.parse(session.accessExpiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 30_000;
}
