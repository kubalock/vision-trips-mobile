import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export interface UpdateRequirement { minimumVersion: string; updateUrl: string | null }

/**
 * The API refuses installed apps older than its minimum version with 426 `app_update_required` (see the API's
 * AppVersionGuard). The interceptor reports it here and the app shows "Update Vision Trips" (vt-update-required).
 * Trips saved on the device stay readable; only refreshing and actions wait for the update.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdate {
  readonly required = signal<UpdateRequirement | null>(null);
  /** "Not now": hidden until the app next starts, so a customer can still read their saved trip. */
  readonly dismissed = signal(false);

  report(error: unknown): void {
    const requirement = updateRequirement(error);
    if (requirement) this.required.set(requirement);
  }
}

export function updateRequirement(error: unknown): UpdateRequirement | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 426) return null;
  const body = error.error as { code?: unknown; minimumVersion?: unknown; updateUrl?: unknown } | null;
  if (body?.code !== 'app_update_required') return null;
  return {
    minimumVersion: typeof body.minimumVersion === 'string' ? body.minimumVersion : '',
    updateUrl: typeof body.updateUrl === 'string' && body.updateUrl.startsWith('https://') ? body.updateUrl : null,
  };
}

let clientHeaders: Promise<Record<string, string>> | null = null;

/**
 * `X-Vision-App-Version` (the installed build's version, from the native project, which takes it from package.json)
 * and `X-Vision-Platform`. Empty in a browser: the web app is always the current version.
 */
export function appClientHeaders(): Promise<Record<string, string>> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve({});
  clientHeaders ??= App.getInfo()
    .then((info) => ({ 'X-Vision-App-Version': info.version, 'X-Vision-Platform': Capacitor.getPlatform() }))
    .catch(() => ({}));
  return clientHeaders;
}
