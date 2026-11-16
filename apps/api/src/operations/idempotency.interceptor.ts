import { CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { Observable, catchError, from, of, switchMap, tap, throwError } from 'rxjs';
import { DurableAuthStore } from '../sessions/durable-auth.store.js';
import { SessionsService, type SessionPrincipal } from '../sessions/sessions.service.js';
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
      const scope = [request.method, request.route?.path || request.path, ...owner(principal)].join(':');
      const requestHash = createHash('sha256').update(JSON.stringify(request.body ?? null)).digest('base64url');
      const existing = this.store.idempotency(scope, key);
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ConflictException('This idempotency key was already used for a different request.');
        if (existing.status !== 'complete' || existing.responseJson === null) throw new ConflictException('An identical request is already being processed.');
        const stored = JSON.parse(existing.responseJson) as unknown;
        // Replaying skips the controller and its own checks, so re-check Airtable now, as a fresh request would.
        return from(this.sessions.authorize(authorization, { fresh: true })).pipe(switchMap(() => of(stored)));
      }
      if (!this.store.beginIdempotency(scope, key, requestHash)) throw new ConflictException('An identical request is already being processed.');
      return next.handle().pipe(
        tap((response) => this.store.completeIdempotency(scope, key, response)),
        catchError((error: unknown) => { this.store.releaseIdempotency(scope, key); return throwError(() => error); }),
      );
    }));
  }
}

/** Who a stored response belongs to: the booking and verified Customer, or the session itself when there is none. */
function owner(principal: SessionPrincipal): string[] {
  return [principal.baseId, principal.recordId, principal.customerRecordId ? `customer:${principal.customerRecordId}` : `session:${principal.sessionId ?? 'unknown'}`];
}
