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
    // Innermost, so session responses are turned into web handles and cookies last (none of them is replayable).
    { provide: APP_INTERCEPTOR, useClass: WebSessionCookiesInterceptor },
  ],
})
export class OperationsModule {}
