import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { SNAPSHOT_VERSION_HEADER, TRIP_SNAPSHOT_SCHEMA_VERSION } from '@vision-trips/contracts';
import type { Request } from 'express';
import { Observable, map } from 'rxjs';

/**
 * Snapshot v4 only adds optional fields, so a v4 snapshot is a valid v3 one. App builds released before v4 reject
 * any version they don't know, so unless the client says it understands v4 (`X-Vision-Snapshot-Version: 4`) every
 * snapshot in the response — the trip itself, or one nested under `snapshot` — is labelled 3. Older clients drop the
 * fields they don't know.
 */
@Injectable()
export class SnapshotVersionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<Request>();
    const supported = Number(request.get?.(SNAPSHOT_VERSION_HEADER) ?? 3);
    if (Number.isFinite(supported) && supported >= TRIP_SNAPSHOT_SCHEMA_VERSION) return next.handle();
    return next.handle().pipe(map(downgradeSnapshots));
  }
}

export function downgradeSnapshots(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const value = body as Record<string, unknown>;
  if (value['schemaVersion'] === TRIP_SNAPSHOT_SCHEMA_VERSION && typeof value['tripId'] === 'string') return { ...value, schemaVersion: 3 };
  const nested = value['snapshot'];
  if (nested && typeof nested === 'object' && (nested as Record<string, unknown>)['schemaVersion'] === TRIP_SNAPSHOT_SCHEMA_VERSION) {
    return { ...value, snapshot: { ...(nested as Record<string, unknown>), schemaVersion: 3 } };
  }
  return body;
}
