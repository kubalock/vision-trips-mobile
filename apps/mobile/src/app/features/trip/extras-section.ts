import { Component, input } from '@angular/core';
import type { TripExtra } from '@vision-trips/contracts';

@Component({
  selector: 'app-extras-section',
  template: `
    @if (extras().length) {
      <section class="vt-section" aria-labelledby="extras-title">
        <h2 id="extras-title" class="vt-h2">Make it even better</h2>
        <div class="vt-extras">
          @for (extra of extras(); track extra.id) {
            <article class="vt-extra vt-extra--idea" [class.no-image]="!extra.imageUrl">
              @if (extra.imageUrl) { <img [src]="extra.imageUrl" [alt]="extra.name" loading="lazy" /> }
              <div><h3 class="vt-h3">{{ extra.name }}</h3>@if (extra.description) { <p class="vt-extra__text">{{ extra.description }}</p> }@if (extra.supplierName) { <p class="vt-small">Provided by {{ extra.supplierName }}</p> }<p class="vt-link">Ask your travel expert</p>
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
}
