import { Component, ElementRef, afterNextRender, computed, inject, input, output } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import type { TripVideo } from '@vision-trips/contracts';
import { VtIcon } from './lucide-icon';
import { isPlayableUrl } from '../core/api/trip-schema';

/** Embeds the app will load: the privacy-friendly players only, rebuilt from scratch (never a URL as given). */
export function embedUrl(video: TripVideo): string | null {
  try {
    const url = new URL(video.url);
    if (video.kind === 'file') return isPlayableUrl(video.url) ? url.toString() : null;
    if (url.protocol !== 'https:') return null;
    if (video.kind === 'youtube') {
      const id = url.hostname === 'www.youtube-nocookie.com' ? url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{6,20})$/)?.[1] : null;
      return id ? `https://www.youtube-nocookie.com/embed/${id}?rel=0` : null;
    }
    if (video.kind === 'vimeo') {
      const id = url.hostname === 'player.vimeo.com' ? url.pathname.match(/^\/video\/(\d{6,12})$/)?.[1] : null;
      return id ? `https://player.vimeo.com/video/${id}?dnt=1` : null;
    }
    return url.toString();
  } catch { return null; }
}

/**
 * Full-screen video viewer. Nothing is loaded until it opens (the customer tapped Watch), nothing autoplays, and
 * closing it — close button, backdrop, Escape, or Android back (handled by the app) — removes the player from the
 * page, which stops playback. Focus moves to the close button and returns to the opener afterwards.
 */
@Component({
  selector: 'vt-video-viewer',
  imports: [VtIcon],
  host: { '(document:keydown.escape)': 'close()' },
  template: `
    <div class="vt-video-viewer" role="dialog" aria-modal="true" [attr.aria-label]="video().title">
      <button type="button" class="vt-video-viewer__backdrop" tabindex="-1" aria-hidden="true" (click)="close()"></button>
      <div class="vt-video-viewer__panel">
        <header class="vt-video-viewer__header">
          <h2>{{ video().title }}</h2>
          <button type="button" class="vt-video-viewer__close" (click)="close()" aria-label="Close video"><vt-icon name="close" [size]="22" /></button>
        </header>
        @if (video().kind === 'file') {
          @if (fileUrl(); as src) {
            <!-- preload="metadata": nothing streams until play is pressed; no autoplay. -->
            <video class="vt-video-viewer__media" [src]="src" controls playsinline preload="metadata" [attr.poster]="video().posterUrl"></video>
          } @else { <p class="vt-video-viewer__error">This video can’t be played here.</p> }
        } @else if (frameUrl(); as src) {
          <iframe class="vt-video-viewer__media" [src]="src" [title]="video().title" allow="fullscreen; picture-in-picture; encrypted-media" referrerpolicy="strict-origin" sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>
        } @else { <p class="vt-video-viewer__error">This video can’t be played here.</p> }
      </div>
    </div>
  `,
})
export class VideoViewer {
  readonly video = input.required<TripVideo>();
  readonly closed = output<void>();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly opener = typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null;
  protected readonly fileUrl = computed(() => this.video().kind === 'file' ? embedUrl(this.video()) : null);
  protected readonly frameUrl = computed<SafeResourceUrl | null>(() => {
    if (this.video().kind === 'file') return null;
    const url = embedUrl(this.video());
    // Only the two rebuilt player URLs above can reach this point.
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });

  constructor() {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLButtonElement>('.vt-video-viewer__close')?.focus());
  }

  close(): void {
    this.closed.emit();
    queueMicrotask(() => this.opener?.focus?.());
  }
}
