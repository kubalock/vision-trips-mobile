import { Component, input, output } from '@angular/core';
import type { TripExtra } from '@vision-trips/contracts';
import { VtIcon } from '../../shared/lucide-icon';

@Component({
  selector: 'app-extras-section',
  imports: [VtIcon],
  template: `
    @if (extras().length) {
      <section class="vt-upsell-section" aria-labelledby="extras-title">
        <header class="vt-lower-section__header"><p>Tailor your trip</p><h2 id="extras-title">Make it even better</h2></header>
        <div class="vt-upsell-grid">
          @for (extra of extras(); track extra.id) {
            <article class="vt-upsell-card" [class.no-image]="!extra.imageUrl">
              @if (extra.imageUrl) { <div class="vt-upsell-card__media"><img [src]="extra.imageUrl" [alt]="extra.name" loading="lazy" decoding="async" /></div> }
              <div class="vt-upsell-card__body"><h3>{{ extra.name }}</h3>@if (extra.description) { <p>{{ extra.description }}</p> }@if (extra.supplierName) { <small>Provided by {{ extra.supplierName }}</small> }@if (safeAffiliate(extra.affiliateUrl); as url) {
                  <div class="vt-upsell-card__actions">
                    <button type="button" class="vt-upsell-card__book" (click)="book.emit({ extra, url })">Book this <vt-icon name="external" [size]="15" /></button>
                    <button type="button" (click)="enquire.emit(extra)">Ask us instead <vt-icon name="arrow-right" [size]="15" /></button>
                  </div>
                } @else {
                  <button type="button" (click)="enquire.emit(extra)">Ask your travel expert <vt-icon name="arrow-right" [size]="15" /></button>
                }
              </div>
            </article>
          }
        </div>
      </section>
    }
  `,
})
export class ExtrasSection {
  readonly extras = input.required<TripExtra[]>();
  /** "Ask us instead" / "Ask your travel expert": a message about this exact extra. */
  readonly enquire = output<TripExtra>();
  /** "Book this": the member's own allow-listed https link (checked again here, never altered). */
  readonly book = output<{ extra: TripExtra; url: string }>();
  protected safeAffiliate(url: string | null | undefined): string | null {
    if (!url) return null;
    try { return new URL(url).protocol === 'https:' ? url : null; } catch { return null; }
  }
}
