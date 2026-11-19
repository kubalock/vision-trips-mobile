import { Component, computed, input, output } from '@angular/core';
import type { TripSnapshot, TripVideo } from '@vision-trips/contracts';
import { VtIcon } from '../../shared/lucide-icon';

/**
 * Quotation and booking content from PHP 2.0: the agent's walkthrough and video message as compact cards (nothing
 * loads until Watch), what's included and not included, and a quick way to message the agent near the top of a
 * quotation. The price and "Accept and pay deposit" live in the Payments section only.
 */
@Component({
  selector: 'app-trip-content-section',
  imports: [VtIcon],
  template: `
    @for (video of videos(); track video.url) {
      <article class="vt-video-card">
        <span class="vt-video-card__thumb" aria-hidden="true">
          @if (video.posterUrl) { <img [src]="video.posterUrl" alt="" loading="lazy" decoding="async" /> }
          <span class="vt-video-card__play"><vt-icon name="play" [size]="18" /></span>
        </span>
        <p class="vt-video-card__title">{{ video.title }}</p>
        <!-- Busy, not disabled: a disabled button drops keyboard focus, and the viewer returns focus to where it was opened from. -->
        <button type="button" class="vt-video-card__watch" [attr.aria-disabled]="opening() !== null ? 'true' : null" [attr.aria-busy]="opening() === video.url" (click)="opening() === null && watch.emit(video)">
          @if (opening() === video.url) { <vt-icon name="loader" [size]="16" class="vt-spin" /> Opening… } @else { Watch }
        </button>
      </article>
    }

    @if (isQuote() && agentLabel()) {
      <section class="vt-quick-message" aria-label="Message your travel expert">
        <p>Questions about this quotation?</p>
        <button type="button" (click)="message.emit()"><vt-icon name="message" [size]="16" /> Message {{ agentLabel() }}</button>
      </section>
    }

    @if (trip().content; as content) {
      @if (content.included.length || content.notIncluded.length) {
        <details class="vt-inclusions" [open]="isQuote()">
          <summary><span>What’s included</span><vt-icon name="chevron-down" [size]="18" /></summary>
          @if (content.included.length) {
            <ul class="vt-inclusions__list vt-inclusions__list--in">@for (item of content.included; track item.text) { <li><vt-icon name="check" [size]="16" /> {{ item.text }}</li> }</ul>
            @if (content.includedSource === 'itinerary') { <p class="vt-inclusions__note">Based on the items in your itinerary. Your {{ isQuote() ? 'quotation document' : 'booking confirmation' }} has the full details.</p> }
          }
          @if (content.notIncluded.length) {
            <h3>Not included</h3>
            <ul class="vt-inclusions__list vt-inclusions__list--out">@for (item of content.notIncluded; track item.text) { <li>{{ item.text }}</li> }</ul>
          }
        </details>
      }
    }
  `,
})
export class TripContentSection {
  readonly trip = input.required<TripSnapshot>();
  /** The URL of the video being fetched after Watch was tapped (a fresh walkthrough link): its button says so. */
  readonly opening = input<string | null>(null);
  readonly watch = output<TripVideo>();
  readonly message = output<void>();

  protected readonly isQuote = computed(() => this.trip().stage === 'quote');
  protected readonly videos = computed(() => [this.trip().content?.walkthrough, this.trip().content?.videoMessage].filter((video): video is TripVideo => Boolean(video)));
  protected readonly agentLabel = computed(() => this.trip().agent?.name?.split(' ')[0] || this.trip().experience.agentName?.split(' ')[0] || null);
}
