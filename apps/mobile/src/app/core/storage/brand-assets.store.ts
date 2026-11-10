import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';

const WEB_CACHE = 'vision-trips:brand-assets:v1';
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

@Injectable({ providedIn: 'root' })
export class BrandAssetsStore {
  async logo(tripId: string): Promise<string | null> {
    if (Capacitor.isNativePlatform()) {
      const path = (await Preferences.get({ key: preferenceKey(tripId) })).value;
      if (!path) return null;
      try {
        const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
        return Capacitor.convertFileSrc(uri);
      } catch {
        return null;
      }
    }

    if (!('caches' in globalThis)) return null;
    try {
      const response = await (await caches.open(WEB_CACHE)).match(cacheRequest(tripId));
      return response ? URL.createObjectURL(await response.blob()) : null;
    } catch {
      return null;
    }
  }

  async cacheLogo(tripId: string, sourceUrl: string): Promise<string | null> {
    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) return null;
      const blob = await response.blob();
      if (!blob.type.toLowerCase().startsWith('image/') || blob.size > MAX_LOGO_BYTES) return null;

      if (Capacitor.isNativePlatform()) {
        const oldPath = (await Preferences.get({ key: preferenceKey(tripId) })).value;
        const path = `brand-assets/${safe(tripId)}/logo${extension(blob.type)}`;
        await Filesystem.writeFile({ path, directory: Directory.Data, recursive: true, data: await base64(blob) });
        await Preferences.set({ key: preferenceKey(tripId), value: path });
        if (oldPath && oldPath !== path) {
          try { await Filesystem.deleteFile({ path: oldPath, directory: Directory.Data }); } catch { /* Old cache is already absent. */ }
        }
        return this.logo(tripId);
      }

      if (!('caches' in globalThis)) return null;
      await (await caches.open(WEB_CACHE)).put(cacheRequest(tripId), new Response(blob, { headers: { 'Content-Type': blob.type } }));
      return this.logo(tripId);
    } catch {
      return null;
    }
  }

  async remove(tripId: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      const key = preferenceKey(tripId);
      const path = (await Preferences.get({ key })).value;
      if (path) {
        try { await Filesystem.deleteFile({ path, directory: Directory.Data }); } catch { /* File is already absent. */ }
      }
      await Preferences.remove({ key });
      return;
    }

    if (!('caches' in globalThis)) return;
    try { await (await caches.open(WEB_CACHE)).delete(cacheRequest(tripId)); } catch { /* Cache is unavailable. */ }
  }
}

function preferenceKey(tripId: string): string { return `brand-assets:${tripId}:logo`; }
function safe(value: string): string { return value.replace(/[^A-Za-z0-9_-]/g, '-'); }
function cacheRequest(tripId: string): Request { return new Request(new URL(`/__vision-trips-assets/${encodeURIComponent(tripId)}/logo`, location.origin)); }
function extension(mimeType: string): string {
  const type = mimeType.toLowerCase();
  if (type.includes('svg')) return '.svg';
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('gif')) return '.gif';
  return '.jpg';
}

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
