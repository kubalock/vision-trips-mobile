import { InjectionToken } from '@angular/core';
import { Capacitor } from '@capacitor/core';

/** Set at build time, e.g. `ng build --define VISION_API_URL="'https://api.example.com/v1'"`. */
declare const VISION_API_URL: string | undefined;

export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', { providedIn: 'root', factory: resolveApiBaseUrl });

/**
 * 1. An explicit build-time URL always wins (required for the installed iOS/Android app and production).
 * 2. In a browser, use the host the app was opened from on port 3000, so a phone browsing the dev server
 *    at http://<your-computer's-IP>:4200 talks to the API on the same computer without extra setup.
 * 3. Otherwise fall back to local development.
 */
export function resolveApiBaseUrl(): string {
  if (typeof VISION_API_URL === 'string' && VISION_API_URL.trim()) return VISION_API_URL.trim().replace(/\/+$/, '');
  if (!Capacitor.isNativePlatform() && typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && location.hostname) {
    return `${location.protocol}//${location.hostname}:3000/v1`;
  }
  return 'http://localhost:3000/v1';
}
