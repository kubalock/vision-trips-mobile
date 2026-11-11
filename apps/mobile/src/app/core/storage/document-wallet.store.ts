import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import type { TripDocument } from '@vision-trips/contracts';

export type WalletStatus = 'not_saved' | 'saved' | 'updated';
interface WalletEntry { documentId: string; tripId: string; version: string; path: string; savedAt: string; mimeType: string }

@Injectable({ providedIn: 'root' })
export class DocumentWalletStore {
  async statuses(tripId: string, documents: TripDocument[]): Promise<Record<string, WalletStatus>> {
    const entries = await this.entries();
    return Object.fromEntries(documents.map((document) => {
      const saved = entries.find((entry) => entry.tripId === tripId && entry.documentId === document.id);
      return [document.id, !saved ? 'not_saved' : saved.version === (document.version || 'legacy') ? 'saved' : 'updated'];
    }));
  }

  async save(tripId: string, document: TripDocument, blob: Blob): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    const mimeType = document.mimeType || 'application/pdf';
    const path = `document-wallet/${safe(tripId)}/${safe(document.id)}${extension(mimeType)}`;
    await writeInChunks(path, blob);
    const entries = (await this.entries()).filter((entry) => !(entry.tripId === tripId && entry.documentId === document.id));
    entries.push({ documentId: document.id, tripId, version: document.version || 'legacy', path, savedAt: new Date().toISOString(), mimeType });
    await Preferences.set({ key: 'document-wallet:index', value: JSON.stringify(entries) });
    return true;
  }

  async uri(tripId: string, documentId: string): Promise<string | null> {
    const entry = (await this.entries()).find((item) => item.tripId === tripId && item.documentId === documentId);
    if (!entry) return null;
    try { return (await Filesystem.getUri({ path: entry.path, directory: Directory.Data })).uri; }
    catch { return null; }
  }

  /** Deletes every saved file for one trip (or all trips when tripId is omitted) and drops their index entries. */
  async remove(tripId?: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    const entries = await this.entries();
    const keep: WalletEntry[] = [];
    for (const entry of entries) {
      if (tripId !== undefined && entry.tripId !== tripId) { keep.push(entry); continue; }
      try { await Filesystem.deleteFile({ path: entry.path, directory: Directory.Data }); } catch { /* File is already absent. */ }
    }
    const folder = tripId === undefined ? 'document-wallet' : `document-wallet/${safe(tripId)}`;
    try { await Filesystem.rmdir({ path: folder, directory: Directory.Data, recursive: true }); } catch { /* Folder is already absent. */ }
    await Preferences.set({ key: 'document-wallet:index', value: JSON.stringify(keep) });
  }

  private async entries(): Promise<WalletEntry[]> {
    if (!Capacitor.isNativePlatform()) return [];
    const value = (await Preferences.get({ key: 'document-wallet:index' })).value;
    if (!value) return [];
    try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed as WalletEntry[] : []; }
    catch { return []; }
  }
}

/**
 * The Filesystem plugin only takes base64 strings, so converting a whole 20 MB file at once would hold several
 * copies of it in memory (bytes, binary string, base64). Writing it in slices keeps that to one slice at a time.
 * The slice size is a multiple of 3, so each slice encodes to base64 without padding in the middle of the file.
 */
export const WALLET_CHUNK_BYTES = 3 * 256 * 1024;

export async function writeInChunks(path: string, blob: Blob, files: Pick<typeof Filesystem, 'writeFile' | 'appendFile' | 'deleteFile'> = Filesystem): Promise<void> {
  try {
    let offset = 0;
    do {
      const data = base64(new Uint8Array(await blob.slice(offset, offset + WALLET_CHUNK_BYTES).arrayBuffer()));
      if (offset === 0) await files.writeFile({ path, directory: Directory.Data, recursive: true, data });
      else await files.appendFile({ path, directory: Directory.Data, data });
      offset += WALLET_CHUNK_BYTES;
    } while (offset < blob.size);
  } catch (error) {
    await files.deleteFile({ path, directory: Directory.Data }).catch(() => undefined); // Never leave half a document behind.
    throw error;
  }
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
function safe(value: string): string { return value.replace(/[^A-Za-z0-9_-]/g, '-'); }
function extension(mimeType: string): string { return mimeType.includes('pdf') ? '.pdf' : mimeType.includes('png') ? '.png' : mimeType.includes('jpeg') ? '.jpg' : '.bin'; }
