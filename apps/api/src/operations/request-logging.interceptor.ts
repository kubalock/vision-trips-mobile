import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable, catchError, tap, throwError } from 'rxjs';
import type { Request, Response } from 'express';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const requestId = safeRequestId(request.get('x-request-id')) || randomUUID();
    const startedAt = Date.now();
    response.setHeader('X-Request-Id', requestId);
    const write = (status: number, error?: unknown) => this.logger.log(JSON.stringify({
      event: 'http_request', requestId, method: request.method, path: request.path,
      status, durationMs: Date.now() - startedAt,
      ...(error ? { error: error instanceof Error ? error.name : 'UnknownError' } : {}),
    }));
    return next.handle().pipe(
      tap(() => write(response.statusCode)),
      catchError((error: unknown) => { write(httpStatus(error), error); return throwError(() => error); }),
    );
  }
}

function safeRequestId(value: string | undefined): string | null { return value && /^[A-Za-z0-9._:-]{8,100}$/.test(value) ? value : null; }
function httpStatus(error: unknown): number { return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : 500; }
