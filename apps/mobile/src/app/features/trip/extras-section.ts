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
              <div class="vt-upsell-card__body"><h3>{{ extra.name }}</h3>@if (extra.description) { <p>{{ extra.description }}</p> }@if (extra.supplierName) { <small>Provided by {{ extra.supplierName }}</small> }<button type="button" (click)="enquire.emit()">Ask your travel expert <vt-icon name="arrow-right" [size]="15" /></button>
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
  readonly enquire = output<void>();
}
