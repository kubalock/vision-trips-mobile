import { CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Observable, catchError, of, tap, throwError } from 'rxjs';
import type { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { DurableAuthStore } from '../sessions/durable-auth.store.js';
import { NO_STORED_REPLAY } from './no-stored-replay.js';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly store: DurableAuthStore, private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    if (!['POST', 'PATCH', 'DELETE'].includes(request.method)) return next.handle();
    if (this.reflector.getAllAndOverride<boolean>(NO_STORED_REPLAY, [context.getHandler(), context.getClass()])) return next.handle();
    const key = request.get('idempotency-key');
    if (!key) return next.handle();
    if (!/^[A-Za-z0-9._:-]{8,120}$/.test(key)) throw new ConflictException('The Idempotency-Key header is not valid.');
    const scope = `${request.method}:${request.route?.path || request.path}`;
    const requestHash = createHash('sha256').update(JSON.stringify(request.body ?? null)).digest('base64url');
    const existing = this.store.idempotency(scope, key);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new ConflictException('This idempotency key was already used for a different request.');
      if (existing.status === 'complete' && existing.responseJson !== null) return of(JSON.parse(existing.responseJson) as unknown);
      throw new ConflictException('An identical request is already being processed.');
    }
    if (!this.store.beginIdempotency(scope, key, requestHash)) throw new ConflictException('An identical request is already being processed.');
    return next.handle().pipe(
      tap((response) => this.store.completeIdempotency(scope, key, response)),
      catchError((error: unknown) => { this.store.releaseIdempotency(scope, key); return throwError(() => error); }),
    );
  }
}
