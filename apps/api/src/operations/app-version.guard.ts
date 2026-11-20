import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AppUpdateRequired } from '@vision-trips/contracts';

/**
 * Refuses installed apps older than the minimum version with 426 `app_update_required`, so a change the old app
 * can't handle shows "Update the app" instead of failing in some other way. The installed app sends
 * `X-Vision-App-Version` and `X-Vision-Platform` (ios | android) on every request; requests without them (the web
 * app, automations, images) and sign-outs are never refused.
 *
 * VISION_MIN_APP_VERSION (both platforms), or VISION_MIN_APP_VERSION_IOS / _ANDROID, e.g. "1.2.0". Unset: no minimum.
 * VISION_APP_STORE_URL_IOS / _ANDROID: where "Update" goes (Android defaults to the Play Store listing).
 */
@Injectable()
export class AppVersionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<Request>();
    const platform = request.get('x-vision-platform')?.trim().toLowerCase();
    const version = parseVersion(request.get('x-vision-app-version'));
    if ((platform !== 'ios' && platform !== 'android') || !version) return true;
    // Signing out (ending the session, forgetting a trusted device) always works, even from an old app.
    if (request.method === 'DELETE') return true;
    const minimum = minimumVersion(platform);
    if (!minimum || compareVersions(version, minimum.parts) >= 0) return true;
    const body: AppUpdateRequired = {
      statusCode: UPGRADE_REQUIRED,
      code: 'app_update_required',
      message: 'Please update the Vision Trips app to continue.',
      minimumVersion: minimum.text,
      updateUrl: storeUrl(platform),
    };
    throw new HttpException(body, UPGRADE_REQUIRED);
  }
}

/** HTTP 426 Upgrade Required (Nest's HttpStatus has no name for it). */
const UPGRADE_REQUIRED = 426;

type Version = [number, number, number];

export function parseVersion(value: unknown): Version | null {
  const match = typeof value === 'string' ? /^\s*(\d{1,4})\.(\d{1,4})\.(\d{1,4})\s*$/.exec(value) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function compareVersions(left: Version, right: Version): number {
  for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index] - right[index];
  return 0;
}

function minimumVersion(platform: 'ios' | 'android'): { text: string; parts: Version } | null {
  const text = (process.env[`VISION_MIN_APP_VERSION_${platform.toUpperCase()}`] || process.env.VISION_MIN_APP_VERSION || '').trim();
  const parts = parseVersion(text);
  return parts ? { text, parts } : null;
}

function storeUrl(platform: 'ios' | 'android'): string | null {
  const configured = process.env[`VISION_APP_STORE_URL_${platform.toUpperCase()}`]?.trim();
  if (configured && /^https:\/\//.test(configured)) return configured;
  return platform === 'android' ? 'https://play.google.com/store/apps/details?id=uk.co.visiontrips.app' : null;
}
