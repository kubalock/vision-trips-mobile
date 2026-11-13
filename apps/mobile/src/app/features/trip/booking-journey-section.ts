import { Component, computed, input, output } from '@angular/core';
import type { BookingJourney, RelatedQuotationSummary, TripStage } from '@vision-trips/contracts';
import { VtIcon } from '../../shared/lucide-icon';
import { EuropeanDatePipe } from '../../shared/european-date.pipe';

@Component({
  selector: 'app-booking-journey-section',
  imports: [EuropeanDatePipe, VtIcon],
  template: `
    <section class="vt-booking-journey-card" aria-labelledby="booking-journey-title">
      <header class="vt-booking-journey-card__header"><p>Your booking journey</p><h2 id="booking-journey-title">{{ returned() ? 'From booking to home' : 'What happens next' }}</h2></header>
      <ol class="vt-booking-timeline">
        @for (step of journey().steps; track step.id) {
          <li class="vt-booking-step" [class.is-complete]="step.status === 'complete'" [class.is-current]="step.status === 'current'" [class.is-upcoming]="step.status === 'upcoming'">
            <span class="vt-booking-step__node">@if (step.status === 'complete') { <vt-icon name="check" [size]="18" /> } @else { {{ $index + 1 }} }</span>
            <div class="vt-booking-step__content">
              <div class="vt-booking-step__title"><h3>{{ step.title }}</h3>@if (step.date) { <time>{{ step.date | europeanDate }}</time> }</div>
              <p>{{ step.description }}</p>
            </div>
          </li>
        }
      </ol>
    </section>

    @if (journey().suggestedExtras.length) {
      <section class="vt-tailor-section" aria-labelledby="tailor-trip-title">
        <header class="vt-lower-section__header"><p>Tailor your trip</p><h2 id="tailor-trip-title">You might also like</h2></header>
        <div class="vt-tailor-grid">
          @for (extra of journey().suggestedExtras; track extra.id) {
            <article class="vt-tailor-card">
              <h3>{{ extra.title }}</h3>
              <p>{{ extra.description }}</p>
              <button type="button" (click)="enquire.emit(extra.enquiry)">Ask my travel expert <vt-icon name="arrow-right" [size]="16" /></button>
            </article>
          }
        </div>
      </section>
    }

    @if (related().length > 1) {
      <section class="vt-quotation-compare" aria-labelledby="quotation-compare-title">
        <header class="vt-quotation-compare__header">
          <p class="vt-quotation-compare__eyebrow">Your quotations</p>
          <h2 id="quotation-compare-title">Compare your options</h2>
          <p class="vt-quotation-compare__intro">These quotations were found securely through the email verified for this booking.</p>
        </header>
        <div class="vt-quotation-grid">
          @for (quote of related(); track quote.comparisonId) {
            <article class="vt-quotation-card" [class.is-current]="quote.current">
              @if (quote.heroImageUrl) {
                <img class="vt-quotation-card__image" [src]="quote.heroImageUrl" alt="" loading="lazy" decoding="async" />
              }
              <div class="vt-quotation-card__body">
                @if (quote.current) { <span class="vt-quotation-card__current">Open now</span> }
                <header class="vt-quotation-card__header">
                  <h3>{{ quote.name }}</h3>
                  <p>{{ quote.reference }}</p>
                </header>
                <dl class="vt-quotation-card__meta">
                  <div>
                    <dt>Dates</dt>
                    <dd>{{ (quote.departureDate | europeanDate) || 'To be confirmed' }}@if (quote.durationDays !== null) { <span>· {{ quote.durationDays }} nights</span> }</dd>
                  </div>
                  <div class="vt-quotation-card__total">
                    <dt>Total price</dt>
                    <dd>{{ money(quote) }}</dd>
                  </div>
                </dl>
                @if (!quote.current) {
                  <button type="button" class="vt-quotation-card__action" [disabled]="openingId() === quote.comparisonId" (click)="open.emit(quote.comparisonId)">
                    <span>{{ openingId() === quote.comparisonId ? 'Opening…' : 'Open quotation' }}</span>
                    @if (openingId() !== quote.comparisonId) { <vt-icon name="arrow-right" [size]="17" /> }
                  </button>
                }
              </div>
            </article>
          }
        </div>
      </section>
    }

    @if (journey().faqs.length) {
      <section class="vt-faq-card" aria-labelledby="trip-faq-title">
        <header class="vt-lower-section__header"><p>Based on this booking</p><h2 id="trip-faq-title">Questions you may have</h2></header>
        <div class="vt-faq-list">
          @for (faq of journey().faqs; track faq.id) {
            <details class="vt-faq-item">
              <summary><span>{{ faq.question }}</span><span class="vt-faq-item__chevron" aria-hidden="true"><vt-icon name="chevron-down" [size]="18" /></span></summary>
              <div class="vt-faq-item__answer"><p>{{ faq.answer }}</p></div>
            </details>
          }
        </div>
      </section>
    }
  `,
})
export class BookingJourneySection {
  readonly journey = input.required<BookingJourney>();
  /** The trip's stage; after return the card looks back ("From booking to home") instead of ahead. */
  readonly stage = input<TripStage | null>(null);
  protected readonly returned = computed(() => ['home', 'past', 'closed'].includes(this.stage() ?? ''));
  readonly related = input<RelatedQuotationSummary[]>([]);
  readonly openingId = input<string | null>(null);
  readonly enquire = output<string>();
  readonly open = output<string>();
  money(quote: RelatedQuotationSummary): string { try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: quote.currency, maximumFractionDigits: 0 }).format(quote.total); } catch { return `${quote.currency} ${quote.total.toFixed(0)}`; } }
}
