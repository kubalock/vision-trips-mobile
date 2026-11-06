import { Component, input } from '@angular/core';
import type { DestinationGuide } from '@vision-trips/contracts';

@Component({
  selector: 'app-destinations-section',
  template: `
    @if (destinations().length) {
      <section class="vt-section" aria-labelledby="destinations-title">
        <h2 id="destinations-title" class="vt-h2">Your destinations</h2>
        <div class="vt-dests">
          @for (destination of destinations(); track destination.id) {
            <article class="vt-dest">
              @if (destination.imageUrl) { <span class="vt-dest__img"><img [src]="destination.imageUrl" [alt]="destination.name" loading="lazy" /></span> }
              <div class="vt-dest__body"><h3 class="vt-h3">{{ destination.name }}<span class="vt-dest__country">{{ destination.country || 'Destination guide' }}</span></h3>
                @if (destination.overview) { <p class="vt-dest__overview">{{ destination.overview }}</p> }
                @if (destination.attractions.length) {
                  <div class="mt-4 flex flex-wrap gap-2">
                    @for (attraction of destination.attractions; track attraction) { <span class="vt-chip">{{ attraction }}</span> }
                  </div>
                }
                @if (destination.practicalInformation || destination.culturalInformation) {
                  <details class="mt-4 border-t border-slate-100 pt-4 text-sm"><summary class="cursor-pointer font-semibold">Useful to know</summary>
                    @if (destination.practicalInformation) { <p class="mt-3 leading-6 text-slate-600">{{ destination.practicalInformation }}</p> }
                    @if (destination.culturalInformation) { <p class="mt-3 leading-6 text-slate-600">{{ destination.culturalInformation }}</p> }
                  </details>
                }
                @if (destination.travelAdviceUrl) { <a class="vt-link" [href]="destination.travelAdviceUrl" target="_blank" rel="noopener">Official travel advice ↗</a> }
              </div>
            </article>
          }
        </div>
      </section>
    }
  `,
})
export class DestinationsSection {
  readonly destinations = input.required<DestinationGuide[]>();
}
