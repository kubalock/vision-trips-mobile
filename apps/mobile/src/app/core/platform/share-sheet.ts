import { Injectable } from '@angular/core';
import { Share, type ShareOptions } from '@capacitor/share';

/** Thin wrapper over the Capacitor share sheet, so the app can be tested without the native plugin. */
@Injectable({ providedIn: 'root' })
export class ShareSheet {
  async available(): Promise<boolean> {
    try { return (await Share.canShare()).value; } catch { return false; }
  }

  async share(options: ShareOptions): Promise<void> {
    await Share.share(options);
  }
}
