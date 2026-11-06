import { Component, input } from '@angular/core';
import type { DestinationGuide } from '@vision-trips/contracts';

@Component({
  selector: 'app-destinations-section',
  template: `
    @if (destinations().length) {
      <section class="mt-8" aria-labelledby="destinations-title">
        <h2 id="destinations-title" class="text-2xl font-semibold tracking-tight">Your destinations</h2>
        <div class="mt-4 grid gap-4">
          @for (destination of destinations(); track destination.id) {
            <article class="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
              @if (destination.imageUrl) { <img class="h-44 w-full object-cover" [src]="destination.imageUrl" [alt]="destination.name" loading="lazy" /> }
              <div class="p-5">
                <p class="text-xs font-semibold uppercase tracking-wider text-teal-700">{{ destination.country || 'Destination guide' }}</p>
                <h3 class="mt-1 text-xl font-semibold">{{ destination.name }}</h3>
                @if (destination.overview) { <p class="mt-3 text-sm leading-6 text-slate-600">{{ destination.overview }}</p> }
                @if (destination.attractions.length) {
                  <div class="mt-4 flex flex-wrap gap-2">
                    @for (attraction of destination.attractions; track attraction) { <span class="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-900">{{ attraction }}</span> }
                  </div>
                }
                @if (destination.practicalInformation || destination.culturalInformation) {
                  <details class="mt-4 border-t border-slate-100 pt-4 text-sm"><summary class="cursor-pointer font-semibold">Useful to know</summary>
                    @if (destination.practicalInformation) { <p class="mt-3 leading-6 text-slate-600">{{ destination.practicalInformation }}</p> }
                    @if (destination.culturalInformation) { <p class="mt-3 leading-6 text-slate-600">{{ destination.culturalInformation }}</p> }
                  </details>
                }
                @if (destination.travelAdviceUrl) { <a class="mt-4 inline-block text-sm font-semibold text-teal-700" [href]="destination.travelAdviceUrl" target="_blank" rel="noopener">Official travel advice ↗</a> }
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
