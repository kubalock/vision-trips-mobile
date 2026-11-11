import { Readable, Transform, type TransformCallback } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

/** Largest supplier document the API will pass on (the app applies the same limit before saving). */
export const MAX_SUPPLIER_DOCUMENT_BYTES = 20_000_000;

export class SupplierDocumentError extends Error {
  constructor(readonly reason: 'unavailable' | 'too_large', message: string) { super(message); }
}

export interface SupplierDocument { stream: Readable; contentType: string | null; length: number | null }

/**
 * Opens a supplier document as a stream instead of buffering it. A declared size over the limit is refused before
 * any of the body is read; a body that turns out larger than declared (or has no declared size) is cut off by a
 * byte-counting transform as soon as it passes the limit.
 */
export async function openSupplierDocument(url: string, fetchImpl: typeof fetch = fetch, maxBytes = MAX_SUPPLIER_DOCUMENT_BYTES): Promise<SupplierDocument> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new SupplierDocumentError('unavailable', `Supplier responded ${response.status}.`);
  }
  const declared = response.headers.get('content-length');
  const length = declared && /^\d+$/.test(declared) ? Number(declared) : null;
  if (length !== null && length > maxBytes) {
    await response.body.cancel().catch(() => undefined);
    throw new SupplierDocumentError('too_large', `Supplier document is ${length} bytes.`);
  }
  const body = Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>);
  const limited = byteLimit(maxBytes);
  body.on('error', (error) => limited.destroy(error));
  limited.on('error', () => body.destroy()); // Stop downloading from the supplier once the limit trips.
  return { stream: body.pipe(limited), contentType: response.headers.get('content-type'), length };
}

/** Passes bytes through, failing the stream once more than `maxBytes` have gone by. */
export function byteLimit(maxBytes: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback) {
      seen += chunk.length;
      if (seen > maxBytes) done(new SupplierDocumentError('too_large', `Supplier document passed ${maxBytes} bytes.`));
      else done(null, chunk);
    },
  });
}
