import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { SessionsModule } from '../sessions/sessions.module.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { PersistentRateLimitGuard } from './persistent-rate-limit.guard.js';
import { RequestLoggingInterceptor } from './request-logging.interceptor.js';
import { WebSessionCookiesInterceptor } from '../security/web-session-cookies.interceptor.js';

@Module({
  imports: [SessionsModule],
  providers: [
    { provide: APP_GUARD, useClass: PersistentRateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    // Innermost, so stored idempotent replies hold the web handle rather than the refresh token.
    { provide: APP_INTERCEPTOR, useClass: WebSessionCookiesInterceptor },
  ],
})
export class OperationsModule {}
