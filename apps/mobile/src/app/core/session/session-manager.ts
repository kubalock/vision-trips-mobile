import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type { MobileSession } from '@vision-trips/contracts';
import { VisionApiService } from '../api/vision-api.service';
import { isWebSessionHandle } from '../api/web-client.interceptor';
import { SavedTripsStore } from '../storage/saved-trips.store';

/** Emitted after a refresh token has been replaced, so holders of the old session can update their copies. */
export interface SessionRenewal {
  previousRefreshToken: string;
  session: MobileSession;
  /** False when a newer session saved by another tab was adopted instead of calling the server. */
  fromServer: boolean;
}

/**
 * The session can no longer be renewed (expired, revoked or ended by the server). Retrying will not help: the
 * customer has to open their trip link again. Thrown by every call that needed the session.
 */
export class SessionExpiredError extends Error {
  override readonly name = 'SessionExpiredError';
  constructor(readonly refreshToken: string, cause?: unknown) {
    super('The trip session has expired.', { cause });
  }
}

export function isTerminalSessionError(error: unknown): error is SessionExpiredError {
  return error instanceof SessionExpiredError;
}

export interface SessionHooks {
  /** Which saved trip a refresh token belongs to, used to look for a newer copy in storage. */
  tripIdFor(refreshToken: string): string | undefined;
  /** Runs before the renewed session is handed back to callers. */
  renewed(renewal: SessionRenewal): Promise<void> | void;
  /** Runs once when a session turns out to be unusable, before callers receive `SessionExpiredError`. */
  expired(refreshToken: string): Promise<void> | void;
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
  private hooks: SessionHooks = { tripIdFor: () => undefined, renewed: () => undefined, expired: () => undefined };

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
      const newer = await this.newerStoredSession(refreshToken, expired.identityKey);
      const fromServer = !newer || isAccessExpiring(newer);
      const current = newer ?? expired;
      if (fromServer && isRefreshExpired(current)) return this.expire(refreshToken, null);
      let session: MobileSession;
      try {
        session = fromServer ? await this.refreshFromServer(current.refreshToken) : current;
      } catch (error) {
        if (isRefusal(error)) return this.expire(refreshToken, error);
        throw error; // Offline or a server fault: the session may still be fine.
      }
      if (this.session()?.refreshToken === refreshToken) this.session.set(session);
      await this.hooks.renewed({ previousRefreshToken: refreshToken, session, fromServer });
      return session;
    })().finally(() => this.inFlight.delete(refreshToken));
    this.inFlight.set(refreshToken, request);
    return request;
  }

  private async expire(refreshToken: string, cause: unknown): Promise<never> {
    await this.hooks.expired(refreshToken);
    if (this.session()?.refreshToken === refreshToken) this.session.set(null);
    throw new SessionExpiredError(refreshToken, cause);
  }

  /**
   * Browsers share one refresh cookie between tabs. When two tabs renew at once, the second sends the cookie the
   * first has just replaced and is refused; by then the browser holds the new cookie, so one retry succeeds.
   */
  private async refreshFromServer(refreshToken: string): Promise<MobileSession> {
    try {
      return await this.api.refreshSession(refreshToken);
    } catch (error) {
      if (!isWebSessionHandle(refreshToken) || !(error instanceof HttpErrorResponse) || error.status !== 401) throw error;
      await new Promise((resolve) => setTimeout(resolve, WEB_REFRESH_RETRY_MS));
      return this.api.refreshSession(refreshToken);
    }
  }

  private async newerStoredSession(refreshToken: string, identityKey: string | undefined): Promise<MobileSession | null> {
    const tripId = this.hooks.tripIdFor(refreshToken);
    if (!tripId) return null;
    const stored = (await this.savedTrips.all()).find((trip) => trip.snapshot.tripId === tripId)?.session;
    if (!stored || stored.refreshToken === refreshToken) return null;
    // Another Customer may have taken this trip's slot on the device: never adopt their session as ours.
    return identityKey && stored.identityKey && stored.identityKey !== identityKey ? null : stored;
  }
}

const WEB_REFRESH_RETRY_MS = 400;

/** The server refused the refresh token itself (as opposed to being unreachable or failing). */
function isRefusal(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 401;
}

function isRefreshExpired(session: MobileSession): boolean {
  const expiresAt = Date.parse(session.refreshExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

export function isAccessExpiring(session: MobileSession): boolean {
  const expiresAt = Date.parse(session.accessExpiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 30_000;
}
