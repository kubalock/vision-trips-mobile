import { Component, computed, input, output, signal } from '@angular/core';
import type { BookingJourney, RelatedQuotationSummary, TripStage } from '@vision-trips/contracts';
import { VtIcon } from '../../shared/lucide-icon';
import { EuropeanDatePipe } from '../../shared/european-date.pipe';

export type BookingJourneyBlock = 'journey' | 'tailor' | 'compare' | 'faq';

@Component({
  selector: 'app-booking-journey-section',
  imports: [EuropeanDatePipe, VtIcon],
  template: `
    @if (has('journey') && journey().steps.length) {
    <section class="vt-booking-journey-card" aria-labelledby="booking-journey-title">
      <header class="vt-booking-journey-card__header"><p>Your booking journey</p><h2 id="booking-journey-title">{{ returned() ? 'From booking to home' : 'What happens next' }}</h2></header>
      <ol class="vt-booking-timeline">
        @for (step of journey().steps; track step.id) {
          <li class="vt-booking-step" [class.is-complete]="step.status === 'complete'" [class.is-current]="step.status === 'current'" [class.is-upcoming]="step.status === 'upcoming'">
            <span class="vt-booking-step__node">@if (step.status === 'complete') { <vt-icon name="check" [size]="18" /> } @else { {{ $index + 1 }} }</span>
            <div class="vt-booking-step__content">
              <div class="vt-booking-step__title"><h3>{{ step.title }}</h3>@if (showDate(step)) { <time>{{ step.date | europeanDate }}</time> }</div>
              <p>{{ step.description }}</p>
            </div>
          </li>
        }
      </ol>
    </section>
    }

    @if (has('tailor') && journey().suggestedExtras.length) {
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

    @if (has('compare') && related().length > 1) {
      <section class="vt-quotation-compare" aria-labelledby="quotation-compare-title">
        <header class="vt-quotation-compare__header">
          <p class="vt-quotation-compare__eyebrow">Your quotations</p>
          <h2 id="quotation-compare-title">Compare your options</h2>
          <p class="vt-quotation-compare__intro">These quotations were found securely through the email verified for this booking.</p>
        </header>
        @if (layout() === 'rows') {
          <!-- Four or more alternatives: compact comparison rows that stack on a phone. -->
          <ul class="vt-quotation-rows" role="list">
            @for (quote of visibleQuotes(); track quote.comparisonId) {
              <li class="vt-quotation-row" [class.is-current]="quote.current">
                <div class="vt-quotation-row__name"><strong>{{ quote.name }}</strong>@if (quote.current) { <span class="vt-quotation-card__current">Open now</span> }</div>
                <span>{{ (quote.departureDate | europeanDate) || 'Dates to be confirmed' }}@if (nights(quote) !== null) { · {{ nights(quote) }} {{ nights(quote) === 1 ? 'night' : 'nights' }} }</span>
                <span class="vt-quotation-row__price"><strong>{{ money(quote) }}</strong>@if (quote.perPerson !== null && quote.perPerson !== undefined) { <small>{{ perPerson(quote) }} pp</small> }</span>
                @if (!quote.current) {
                  <button type="button" class="vt-quotation-card__action" [disabled]="openingId() !== null" (click)="open.emit(quote.comparisonId)">{{ openingId() === quote.comparisonId ? 'Opening…' : 'View' }}</button>
                }
              </li>
            }
          </ul>
          @if (visibleQuotes().length < related().length) {
            <button type="button" class="vt-quotation-compare__more" (click)="showAllQuotes.set(true)">Show all {{ related().length }} quotations <vt-icon name="chevron-down" [size]="16" /></button>
          }
        } @else {
        <div class="vt-quotation-grid" [class.vt-quotation-grid--pair]="layout() === 'pair'">
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
                    <dd>{{ (quote.departureDate | europeanDate) || 'To be confirmed' }}@if (nights(quote) !== null) { <span>· {{ nights(quote) }} {{ nights(quote) === 1 ? 'night' : 'nights' }}</span> }</dd>
                  </div>
                  <div class="vt-quotation-card__total">
                    <dt>Total price</dt>
                    <dd>{{ money(quote) }}@if (quote.perPerson !== null && quote.perPerson !== undefined) { <small> · {{ perPerson(quote) }} per person</small> }</dd>
                  </div>
                </dl>
                @if (!quote.current) {
                  <button type="button" class="vt-quotation-card__action" [disabled]="openingId() !== null" (click)="open.emit(quote.comparisonId)">
                    <span>{{ openingId() === quote.comparisonId ? 'Opening…' : 'View' }}</span>
                    @if (openingId() !== quote.comparisonId) { <vt-icon name="arrow-right" [size]="17" /> }
                  </button>
                }
              </div>
            </article>
          }
        </div>
        }
      </section>
    }

    @if (has('faq') && journey().faqs.length) {
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
  /** Which of the four blocks this instance draws, so Home can place each where it fits the story. All by default. */
  readonly blocks = input<readonly BookingJourneyBlock[]>(['journey', 'tailor', 'compare', 'faq']);
  protected has(block: BookingJourneyBlock): boolean { return this.blocks().includes(block); }
  readonly journey = input.required<BookingJourney>();
  /** The trip's stage; after return the card looks back ("From booking to home") instead of ahead. */
  readonly stage = input<TripStage | null>(null);
  protected readonly returned = computed(() => ['home', 'past', 'closed'].includes(this.stage() ?? ''));
  readonly related = input<RelatedQuotationSummary[]>([]);
  /** One alternative: side by side with this quotation; two or three: cards; four or more: comparison rows. */
  protected readonly showAllQuotes = signal(false);
  /** A long list of quotations starts with the open one and two others, so it doesn't take over Home. */
  protected readonly visibleQuotes = computed(() => {
    const all = this.related();
    if (this.showAllQuotes() || this.layout() !== 'rows') return all;
    const others = all.filter((quote) => !quote.current).slice(0, 2);
    return all.filter((quote) => quote.current || others.includes(quote));
  });
  protected readonly layout = computed(() => { const others = this.related().filter((quote) => !quote.current).length; return others <= 1 ? 'pair' : others <= 3 ? 'cards' : 'rows'; });
  /**
   * A planned date that has already passed on a step that isn't done yet (a late quotation, an unticked task) would
   * read as missed and appear out of order, so only upcoming or completed steps show their date.
   */
  protected showDate(step: BookingJourney['steps'][number]): boolean {
    if (!step.date) return false;
    if (step.status === 'complete') return true;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return step.date.slice(0, 10) >= today;
  }
  protected nights(quote: RelatedQuotationSummary): number | null { return quote.nights ?? quote.durationDays ?? null; }
  protected perPerson(quote: RelatedQuotationSummary): string {
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: quote.currency }).format(quote.perPerson ?? 0); } catch { return `${quote.perPerson} ${quote.currency}`; }
  }
  readonly openingId = input<string | null>(null);
  readonly enquire = output<string>();
  readonly open = output<string>();
  money(quote: RelatedQuotationSummary): string { if (quote.total === null) return 'Price to be confirmed'; try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: quote.currency, maximumFractionDigits: 0 }).format(quote.total); } catch { return `${quote.currency} ${quote.total.toFixed(0)}`; } }
}
