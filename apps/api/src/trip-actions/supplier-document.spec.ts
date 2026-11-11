import { describe, expect, it, vi } from 'vitest';
import { openSupplierDocument, SupplierDocumentError } from './supplier-document.js';

function respond(chunks: Uint8Array[], headers: Record<string, string> = {}, status = 200) {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { if (pulled < chunks.length) controller.enqueue(chunks[pulled++]); else controller.close(); },
  });
  return { fetch: vi.fn(async () => new Response(body, { status, headers })), pulled: () => pulled };
}

async function read(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(parts);
}

const bytes = (size: number) => new Uint8Array(size).fill(65);

describe('supplier document streaming', () => {
  it('streams the document through unchanged with its type and size', async () => {
    const supplier = respond([bytes(4), bytes(6)], { 'content-type': 'application/pdf', 'content-length': '10' });
    const document = await openSupplierDocument('https://supplier.example/doc.pdf', supplier.fetch as never, 100);

    expect(document).toMatchObject({ contentType: 'application/pdf', length: 10 });
    expect((await read(document.stream)).length).toBe(10);
  });

  it('refuses a declared size over the limit without reading the body', async () => {
    const supplier = respond([bytes(50), bytes(50)], { 'content-length': '101' });

    await expect(openSupplierDocument('https://supplier.example/big.pdf', supplier.fetch as never, 100)).rejects.toMatchObject({ reason: 'too_large' });
    expect(supplier.pulled()).toBeLessThanOrEqual(1);
  });

  it('cuts off a body that grows past the limit when no size was declared', async () => {
    const supplier = respond(Array.from({ length: 20 }, () => bytes(60)));
    const document = await openSupplierDocument('https://supplier.example/stream.pdf', supplier.fetch as never, 100);

    await expect(read(document.stream)).rejects.toBeInstanceOf(SupplierDocumentError);
    expect(supplier.pulled()).toBeLessThan(20); // Stopped early rather than reading everything.
  });

  it('reports a failed supplier response as unavailable', async () => {
    const supplier = respond([], {}, 404);
    await expect(openSupplierDocument('https://supplier.example/missing.pdf', supplier.fetch as never)).rejects.toMatchObject({ reason: 'unavailable' });
  });
});
