import { Injectable } from '@angular/core';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

/** A page slot reserved during a tap, filled once the destination URL is known. */
export interface PendingExternalPage {
  /** Opens the URL. Resolves false when the browser blocked the page, so the caller can offer a link instead. */
  open(url: string): Promise<boolean>;
  /** Closes the reserved slot when there turned out to be nothing to open. */
  cancel(): void;
}

/**
 * Opens third-party pages (payment providers) outside the app.
 *
 * Native: uses the in-app browser sheet (SFSafariViewController / Custom Tabs), which works where window.open does not.
 * Web: browsers only allow window.open during the user's tap, so `reserve()` must be called before any await;
 * it opens a placeholder tab that is pointed at the real URL once the server returns it.
 */
@Injectable({ providedIn: 'root' })
export class ExternalPages {
  reserve(): PendingExternalPage {
    if (Capacitor.isNativePlatform()) return { open: (url) => this.openNative(url), cancel: () => undefined };

    let placeholder: Window | null = null;
    try { placeholder = window.open('', '_blank'); } catch { placeholder = null; }
    if (placeholder) {
      try {
        placeholder.document.title = 'Opening secure page…';
        placeholder.document.body.style.cssText = 'font: 16px system-ui, sans-serif; padding: 24px; color: #1b1d1f;';
        placeholder.document.body.textContent = 'Opening secure page…';
      } catch { /* Cosmetic only. */ }
    }

    return {
      open: async (url) => {
        if (placeholder && !placeholder.closed) {
          placeholder.opener = null;
          placeholder.location.replace(url);
          return true;
        }
        return this.openWeb(url);
      },
      cancel: () => { if (placeholder && !placeholder.closed) placeholder.close(); },
    };
  }

  /** Opens a URL without a reserved slot. On the web this may be blocked if called after an await. */
  open(url: string): Promise<boolean> {
    return Capacitor.isNativePlatform() ? this.openNative(url) : Promise.resolve(this.openWeb(url));
  }

  /** Fires when the user closes the native browser sheet. No-op on the web. */
  onClosed(listener: () => void): Promise<{ remove: () => Promise<void> }> {
    if (!Capacitor.isNativePlatform()) return Promise.resolve({ remove: async () => undefined });
    return Browser.addListener('browserFinished', listener);
  }

  private async openNative(url: string): Promise<boolean> {
    await Browser.open({ url, presentationStyle: 'fullscreen' });
    return true;
  }

  private openWeb(url: string): boolean {
    // Without "noopener" so we can tell whether it was blocked; the opener link is cut straight away.
    const page = window.open(url, '_blank');
    if (!page) return false;
    page.opener = null;
    return true;
  }
}
