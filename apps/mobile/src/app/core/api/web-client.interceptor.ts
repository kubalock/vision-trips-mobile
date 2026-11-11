import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { API_BASE_URL } from '../config/api-base-url';

/** Prefix of the stand-in the API returns to browsers instead of a refresh token (the real one is an HttpOnly cookie). */
export const WEB_SESSION_HANDLE_PREFIX = 'web:';

export function isWebSessionHandle(refreshToken: string): boolean { return refreshToken.startsWith(WEB_SESSION_HANDLE_PREFIX); }

/**
 * In a browser, marks API calls as coming from the web app and lets them carry the API's HttpOnly cookies,
 * which hold the refresh and trusted-device tokens. The installed app keeps those tokens in secure storage instead.
 */
export const webClientInterceptor: HttpInterceptorFn = (request, next) => {
  const baseUrl = inject(API_BASE_URL);
  if (Capacitor.isNativePlatform() || !request.url.startsWith(baseUrl)) return next(request);
  return next(request.clone({ withCredentials: true, setHeaders: { 'X-Vision-Client': 'web' } }));
};
