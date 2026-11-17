import { CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { Observable, catchError, from, of, switchMap, tap, throwError } from 'rxjs';
import { DurableAuthStore } from '../sessions/durable-auth.store.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { IDEMPOTENT } from './idempotent.js';
import { NO_STORED_REPLAY } from './no-stored-replay.js';

/** `Idempotency-Key` replay for routes marked `@Idempotent()` (see there); every other request passes straight through. */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly store: DurableAuthStore, private readonly reflector: Reflector, private readonly sessions: SessionsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const targets = [context.getHandler(), context.getClass()];
    if (!this.reflector.getAllAndOverride<boolean>(IDEMPOTENT, targets) || this.reflector.getAllAndOverride<boolean>(NO_STORED_REPLAY, targets)) return next.handle();
    if (!['POST', 'PATCH', 'DELETE'].includes(request.method)) return next.handle();
    const key = request.get('idempotency-key');
    if (!key) return next.handle();
    if (!/^[A-Za-z0-9._:-]{8,120}$/.test(key)) throw new ConflictException('The Idempotency-Key header is not valid.');
    const authorization = request.get('authorization');
    // Authenticate first: no stored response is even looked up for a missing, expired or revoked session.
    return from(this.sessions.authorize(authorization)).pipe(switchMap((principal) => {
      // Without a session ID there is nothing safe to tie a stored response to: run the request without replay.
      if (!principal.sessionId) return next.handle();
      const scope = [request.method, request.route?.path || request.path, principal.baseId, principal.recordId, `session:${principal.sessionId}`].join(':');
      // Path parameters and query are part of the request: /payments/pay_1/link and /payments/pay_2/link share a route.
      const requestHash = createHash('sha256').update(JSON.stringify({ params: request.params ?? {}, query: request.query ?? {}, body: request.body ?? null })).digest('base64url');
      const existing = this.store.idempotency(scope, key);
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ConflictException('This idempotency key was already used for a different request.');
        if (existing.status !== 'complete' || existing.responseJson === null) throw inProgress();
        const stored = JSON.parse(existing.responseJson) as unknown;
        // Replaying skips the controller and its own checks, so re-check Airtable now, as a fresh request would.
        return from(this.sessions.authorize(authorization, { fresh: true })).pipe(switchMap(() => of(stored)));
      }
      if (!this.store.beginIdempotency(scope, key, requestHash)) throw inProgress();
      return next.handle().pipe(
        tap((response) => this.store.completeIdempotency(scope, key, response)),
        catchError((error: unknown) => { this.store.releaseIdempotency(scope, key); return throwError(() => error); }),
      );
    }));
  }
}

/**
 * The same operation is still running. Not a refusal: the client keeps its key and tries again with it, so it gets
 * the stored reply once the work finishes instead of starting it a second time.
 */
function inProgress(): ConflictException {
  return new ConflictException({ statusCode: 409, code: 'idempotency_in_progress', message: 'An identical request is already being processed.' });
}
