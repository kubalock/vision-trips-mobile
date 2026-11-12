import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { MobileSession } from '@vision-trips/contracts';
import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import { Observable, map } from 'rxjs';

/**
 * Browser clients (header `X-Vision-Client: web`) never see refresh or trusted-device tokens.
 *
 * - A refresh token goes into an HttpOnly, SameSite=Strict cookie scoped to /v1/sessions. The response carries a
 *   `web:<id>` handle in its place, which only says which cookie to use and is worthless on its own. The handle
 *   stays the same across renewals, so every tab keeps working with the latest cookie.
 * - A trusted-device token goes into an HttpOnly cookie scoped to /v1/link-exchanges (which includes the invitation
 *   endpoints), and is added to any request there that carries a `deviceTrustTokens` array.
 *
 * The installed app does not send the header and keeps its tokens in the device's secure storage.
 */
export const WEB_CLIENT_HEADER = 'x-vision-client';
export const WEB_HANDLE_PREFIX = 'web:';
const API_PREFIX = '/v1';
const SESSION_COOKIE = 'vt_rt_';
const TRUST_COOKIE = 'vt_dt_';
const HANDLE_ID = /^[A-Za-z0-9_-]{16,64}$/;

@Injectable()
export class WebSessionCookiesInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.get(WEB_CLIENT_HEADER) !== 'web') return next.handle();
    const response = context.switchToHttp().getResponse<Response>();
    const cookies = parseCookies(request.headers.cookie);
    const secure = process.env.NODE_ENV === 'production' || request.secure;
    const body = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : null;

    // A handle in place of a refresh token: swap in the cookie's token before the controller sees it.
    let handleId: string | undefined;
    if (body && typeof body.refreshToken === 'string' && body.refreshToken.startsWith(WEB_HANDLE_PREFIX)) {
      const id = body.refreshToken.slice(WEB_HANDLE_PREFIX.length);
      handleId = HANDLE_ID.test(id) ? id : undefined;
      body.refreshToken = handleId ? cookies.get(SESSION_COOKIE + handleId) : undefined;
    }
    if (body && Array.isArray(body.deviceTrustTokens)) {
      const fromCookies = [...cookies].filter(([name]) => name.startsWith(TRUST_COOKIE)).map(([, value]) => value);
      body.deviceTrustTokens = [...body.deviceTrustTokens, ...fromCookies].slice(0, 25);
    }

    const forgetTrust = request.method === 'DELETE' && request.path === `${API_PREFIX}/link-exchanges/device-trust`;
    const revoking = request.method === 'DELETE' && request.path === `${API_PREFIX}/sessions/current`;

    return next.handle().pipe(
      map((result: unknown) => {
        if (forgetTrust) for (const name of cookies.keys()) if (name.startsWith(TRUST_COOKIE)) response.clearCookie(name, cookieOptions('link-exchanges', secure));
        if (revoking && handleId) response.clearCookie(SESSION_COOKIE + handleId, cookieOptions('sessions', secure));
        return this.secureResult(result, response, secure, handleId);
      }),
      // A refused refresh leaves the cookie alone: when two tabs renew at once, the late tab is refused, and clearing
      // the cookie then would delete the one the other tab has just received. Expired cookies lapse on their own.
    );
  }

  private secureResult(result: unknown, response: Response, secure: boolean, handleId: string | undefined): unknown {
    if (!result || typeof result !== 'object') return result;
    if (isSession(result)) return this.cookieSession(result, response, secure, handleId);
    const record = result as Record<string, unknown>;
    if (!isSession(record.session) && typeof record.trustedDeviceToken !== 'string') return result;
    const { trustedDeviceToken, ...rest } = record;
    if (typeof trustedDeviceToken === 'string') this.cookieTrust(trustedDeviceToken, response, secure);
    return isSession(rest.session) ? { ...rest, session: this.cookieSession(rest.session, response, secure) } : rest;
  }

  private cookieSession(session: MobileSession, response: Response, secure: boolean, handleId = randomBytes(18).toString('base64url')): MobileSession {
    response.cookie(SESSION_COOKIE + handleId, session.refreshToken, { ...cookieOptions('sessions', secure), expires: new Date(session.refreshExpiresAt) });
    return { ...session, refreshToken: WEB_HANDLE_PREFIX + handleId };
  }

  private cookieTrust(token: string, response: Response, secure: boolean): void {
    const payload = trustPayload(token);
    if (!payload) return;
    // One cookie per booking and customer, so a renewed trust replaces the old one.
    const name = TRUST_COOKIE + createHash('sha256').update(`${payload.b}:${payload.r}:${payload.c ?? ''}`).digest('base64url').slice(0, 16);
    response.cookie(name, token, { ...cookieOptions('link-exchanges', secure), expires: new Date(payload.e) });
  }
}

function cookieOptions(area: 'sessions' | 'link-exchanges', secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'strict', path: `${API_PREFIX}/${area}` };
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    try { cookies.set(name, decodeURIComponent(part.slice(index + 1).trim())); } catch { /* ignore a malformed cookie */ }
  }
  return cookies;
}

function isSession(value: unknown): value is MobileSession {
  const session = value as Partial<MobileSession> | null;
  return Boolean(session && typeof session === 'object' && typeof session.refreshToken === 'string' && typeof session.accessToken === 'string');
}

function trustPayload(token: string): { b: string; r: string; c?: string; e: number } | null {
  try {
    const value = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()) as { b?: unknown; r?: unknown; c?: unknown; e?: unknown };
    return typeof value.b === 'string' && typeof value.r === 'string' && typeof value.e === 'number' ? { b: value.b, r: value.r, ...(typeof value.c === 'string' ? { c: value.c } : {}), e: value.e } : null;
  } catch { return null; }
}

