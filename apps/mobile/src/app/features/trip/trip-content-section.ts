import { Component, computed, input, output } from '@angular/core';
import { formatPoints, type TripSnapshot, type TripVideo } from '@vision-trips/contracts';
import { VtIcon } from '../../shared/lucide-icon';

/**
 * Quotation and booking content from PHP 2.0: the agent's walkthrough and video message as compact cards (nothing
 * loads until Watch), what's included and not included, a quick way to message the agent near the top of a
 * quotation, and a second "Accept and pay deposit" beside the price so nobody has to scroll back up.
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
        <button type="button" class="vt-video-card__watch" (click)="watch.emit(video)">Watch</button>
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
            @if (content.includedSource === 'itinerary') { <p class="vt-inclusions__note">Based on the items in your itinerary. Your quotation document has the full details.</p> }
          }
          @if (content.notIncluded.length) {
            <h3>Not included</h3>
            <ul class="vt-inclusions__list vt-inclusions__list--out">@for (item of content.notIncluded; track item.text) { <li>{{ item.text }}</li> }</ul>
          }
        </details>
      }
    }

    @if (trip().quotation.canAccept && trip().payments; as payments) {
      <section class="vt-accept-strip" aria-label="Price and acceptance">
        <div>
          <span>Total price</span>
          <strong>{{ money(payments.total, payments.currency) }}</strong>
          @if (perPerson() !== null) { <small>{{ money(perPerson(), payments.currency) }} per person</small> }
          @if (loyaltyLine(); as line) { <small class="vt-accept-strip__loyalty">★ {{ line }}</small> }
        </div>
        <div class="vt-accept-strip__actions">
          <button type="button" class="vt-primary-action" (click)="accept.emit()">Accept and pay deposit</button>
          <button type="button" class="vt-link-button" (click)="message.emit()">Ask a question</button>
        </div>
      </section>
    }
  `,
})
export class TripContentSection {
  readonly trip = input.required<TripSnapshot>();
  readonly watch = output<TripVideo>();
  readonly message = output<void>();
  readonly accept = output<void>();

  protected readonly isQuote = computed(() => this.trip().stage === 'quote');
  protected readonly videos = computed(() => [this.trip().content?.walkthrough, this.trip().content?.videoMessage].filter((video): video is TripVideo => Boolean(video)));
  protected readonly agentLabel = computed(() => this.trip().agent?.name?.split(' ')[0] || this.trip().experience.agentName?.split(' ')[0] || null);
  /** Shown only with more than one traveller; the booking's own figure first, never an invented 0. */
  protected readonly perPerson = computed(() => {
    const payments = this.trip().payments;
    const travellers = this.trip().summary.totalTravellers;
    if (!payments || travellers < 2) return null;
    if (payments.perPerson !== null && payments.perPerson !== undefined) return payments.perPerson;
    return payments.total !== null && payments.total > 0 ? Math.round(payments.total / travellers * 100) / 100 : null;
  });
  protected readonly loyaltyLine = computed(() => {
    const loyalty = this.trip().loyalty;
    return loyalty?.pointsEarned ? `Book with us and earn ${formatPoints(loyalty.pointsEarned)}` : null;
  });

  protected money(amount: number | null | undefined, currency: string): string {
    if (amount === null || amount === undefined) return 'Unavailable';
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount); } catch { return `${amount.toFixed(2)} ${currency}`; }
  }
}
