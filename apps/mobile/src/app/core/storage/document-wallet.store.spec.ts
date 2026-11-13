import { WALLET_CHUNK_BYTES, writeInChunks } from './document-wallet.store';

function fakeFiles() {
  const writes: Array<{ kind: 'write' | 'append'; data: string }> = [];
  return {
    writes,
    deleted: [] as string[],
    files: {
      writeFile: vi.fn(async ({ data }: { data: string }) => { writes.push({ kind: 'write', data }); return { uri: 'file://x' }; }),
      appendFile: vi.fn(async ({ data }: { data: string }) => { writes.push({ kind: 'append', data }); }),
      deleteFile: vi.fn(async () => undefined),
    },
  };
}

const decode = (chunks: string[]) => new Uint8Array(chunks.flatMap((chunk) => [...atob(chunk)].map((char) => char.charCodeAt(0))));

describe('writeInChunks', () => {
  it('writes a large file in slices that decode back to the original bytes', async () => {
    const bytes = new Uint8Array(WALLET_CHUNK_BYTES * 2 + 1234).map((_, index) => index % 251);
    const fake = fakeFiles();

    await writeInChunks('document-wallet/t/d.pdf', new Blob([bytes]), fake.files as never);

    expect(fake.writes.map((write) => write.kind)).toEqual(['write', 'append', 'append']);
    expect(Math.max(...fake.writes.map((write) => write.data.length))).toBeLessThanOrEqual(Math.ceil(WALLET_CHUNK_BYTES / 3) * 4);
    expect(decode(fake.writes.map((write) => write.data))).toEqual(bytes);
  }, 30_000); // Encodes and compares ~1.5 MB in the DOM test environment; slow when the whole suite runs in parallel.

  it('still creates the file for an empty document', async () => {
    const fake = fakeFiles();
    await writeInChunks('empty.pdf', new Blob([]), fake.files as never);
    expect(fake.writes).toEqual([{ kind: 'write', data: '' }]);
  });

  it('removes a half-written file when a write fails', async () => {
    const fake = fakeFiles();
    fake.files.appendFile.mockRejectedValueOnce(new Error('disk full'));

    await expect(writeInChunks('partial.pdf', new Blob([new Uint8Array(WALLET_CHUNK_BYTES + 1)]), fake.files as never)).rejects.toThrow('disk full');
    expect(fake.files.deleteFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'partial.pdf' }));
  });
});
