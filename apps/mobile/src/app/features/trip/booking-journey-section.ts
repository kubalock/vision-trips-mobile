import { Component, input, output } from '@angular/core';
import type { BookingJourney, RelatedQuotationSummary } from '@vision-trips/contracts';
import { VtIcon } from '../../shared/lucide-icon';
import { EuropeanDatePipe } from '../../shared/european-date.pipe';

@Component({
  selector: 'app-booking-journey-section',
  imports: [EuropeanDatePipe, VtIcon],
  template: `
    <section class="vt-booking-journey-card" aria-labelledby="booking-journey-title">
      <header class="vt-booking-journey-card__header"><p>Your booking journey</p><h2 id="booking-journey-title">What happens next</h2></header>
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

    @if (related().length > 1) { <section class="vt-section overflow-hidden"><p class="text-xs font-semibold uppercase tracking-widest text-teal-700">Your quotations</p><h2 class="vt-h2">Compare your options</h2><p class="mt-2 text-sm leading-6 text-slate-600">These quotations were found securely through the email verified for this booking.</p><div class="mt-5 overflow-x-auto pb-2"><div class="grid min-w-[42rem] auto-cols-[minmax(13rem,1fr)] grid-flow-col gap-3">@for (quote of related(); track quote.comparisonId) { <article class="flex flex-col overflow-hidden rounded-2xl bg-white ring-1" [class.ring-2]="quote.current" [class.ring-teal-600]="quote.current" [class.ring-slate-200]="!quote.current">@if (quote.heroImageUrl) { <img class="h-28 w-full object-cover" [src]="quote.heroImageUrl" alt="" /> }<div class="flex flex-1 flex-col p-4">@if (quote.current) { <span class="mb-2 self-start rounded-full bg-teal-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-teal-800">Open now</span> }<h3 class="font-semibold">{{ quote.name }}</h3><p class="mt-1 text-xs text-slate-500">{{ quote.reference }}</p><dl class="mt-4 grid gap-2 text-sm"><div><dt class="text-xs text-slate-500">Dates</dt><dd>{{ (quote.departureDate | europeanDate) || 'To be confirmed' }}@if (quote.durationDays !== null) { · {{ quote.durationDays }} nights }</dd></div><div><dt class="text-xs text-slate-500">Total</dt><dd class="text-lg font-bold">{{ money(quote) }}</dd></div></dl><div class="mt-auto pt-4">@if (!quote.current) { <button type="button" class="vt-btn vt-btn--ghost vt-btn--sm w-full" [disabled]="openingId() === quote.comparisonId" (click)="open.emit(quote.comparisonId)">{{ openingId() === quote.comparisonId ? 'Opening…' : 'Open quotation' }}</button> }</div></div></article> }</div></div></section> }

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
  readonly related = input<RelatedQuotationSummary[]>([]);
  readonly openingId = input<string | null>(null);
  readonly enquire = output<string>();
  readonly open = output<string>();
  money(quote: RelatedQuotationSummary): string { try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: quote.currency, maximumFractionDigits: 0 }).format(quote.total); } catch { return `${quote.currency} ${quote.total.toFixed(0)}`; } }
}
