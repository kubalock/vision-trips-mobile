import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, map } from 'rxjs';
import { publicApiBase } from '../external-content/external-content.service.js';
import { resolveMediaMarkers } from '../media/attachment-media.js';

/**
 * Cached snapshots carry `vt-media:` markers instead of host-specific links (see attachment-media.ts); this turns
 * them into absolute media URLs for the API address the request came to (or PUBLIC_API_URL when set).
 */
@Injectable()
export class MediaUrlInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<Request>();
    const base = publicApiBase(`${request.protocol}://${request.get?.('host') ?? 'localhost'}`);
    return next.handle().pipe(map((body: unknown) => (body && typeof body === 'object' && !(body instanceof StreamableFile) && !Buffer.isBuffer(body) ? resolveMediaMarkers(body, base) : body)));
  }
}
