import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { TRIP_SNAPSHOT_SCHEMA_VERSION } from '@vision-trips/contracts';
import { API_BASE_URL } from '../config/api-base-url';
import { AppUpdate, appClientHeaders } from '../platform/app-update';

/** Prefix of the stand-in the API returns to browsers instead of a refresh token (the real one is an HttpOnly cookie). */
export const WEB_SESSION_HANDLE_PREFIX = 'web:';

export function isWebSessionHandle(refreshToken: string): boolean { return refreshToken.startsWith(WEB_SESSION_HANDLE_PREFIX); }

/**
 * The installed app sends its version and platform with every API call, so the API can ask outdated apps to update
 * (426 `app_update_required`, reported to AppUpdate; the error still reaches the caller, which treats it as a failed
 * request). In a browser, marks API calls as coming from the web app and lets them carry the API's HttpOnly cookies,
 * which hold the refresh and trusted-device tokens. The installed app keeps those tokens in secure storage instead.
 */
export const webClientInterceptor: HttpInterceptorFn = (request, next) => {
  const baseUrl = inject(API_BASE_URL);
  if (!request.url.startsWith(baseUrl)) return next(request);
  // Every build of this app understands trip snapshot v4; without the header the API labels snapshots v3.
  const versioned = { 'X-Vision-Snapshot-Version': String(TRIP_SNAPSHOT_SCHEMA_VERSION) };
  if (Capacitor.isNativePlatform()) {
    const update = inject(AppUpdate);
    return from(appClientHeaders()).pipe(
      switchMap((client) => next(request.clone({ setHeaders: { ...versioned, ...client } }))),
      catchError((error: unknown) => { update.report(error); return throwError(() => error); }),
    );
  }
  return next(request.clone({ withCredentials: true, setHeaders: { 'X-Vision-Client': 'web', ...versioned } }));
};
