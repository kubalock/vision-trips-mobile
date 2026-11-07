import { Component, inject, input } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import type { DestinationGuide, EnrichedDestinationGuide } from '@vision-trips/contracts';

@Component({
  selector: 'app-destinations-section',
  template: `
    @if (destinations().length) {
      <section class="vt-section" aria-labelledby="destinations-title">
        <h2 id="destinations-title" class="vt-h2">Your destinations</h2>
        <div class="vt-dests">
          @for (destination of destinations(); track destination.id) {
            <article class="vt-dest">
              @if (images(destination).length) { <div class="flex snap-x gap-1 overflow-x-auto">@for (image of images(destination); track image.url) { <img class="h-52 min-w-full snap-center object-cover sm:min-w-[70%]" [src]="image.url" [alt]="destination.name" loading="lazy" /> }</div> }
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
                @if (mapUrl(destination)) { <details class="mt-4 rounded-xl border border-slate-200 p-3"><summary class="cursor-pointer font-semibold">Map</summary><iframe class="mt-3 h-64 w-full rounded-xl border-0" [src]="mapUrl(destination)" [title]="'Map of ' + destination.name" loading="lazy"></iframe></details> }
                @if (aiPending(destination) && !destination.overview) { <p class="mt-4 animate-pulse text-sm text-slate-500">Preparing your destination guide…</p> }
              </div>
            </article>
          }
        </div>
      </section>
    }
  `,
})
export class DestinationsSection {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly safeMaps = new Map<string, SafeResourceUrl>();
  readonly destinations = input.required<Array<DestinationGuide | EnrichedDestinationGuide>>();
  images(destination: DestinationGuide | EnrichedDestinationGuide) { return 'images' in destination && destination.images.length ? destination.images : destination.imageUrl ? [{ url: destination.imageUrl }] : []; }
  mapUrl(destination: DestinationGuide | EnrichedDestinationGuide): SafeResourceUrl | null {
    const url = 'mapUrl' in destination ? destination.mapUrl : null;
    if (!url) return null;
    const cached = this.safeMaps.get(url); if (cached) return cached;
    const safe = this.sanitizer.bypassSecurityTrustResourceUrl(url); this.safeMaps.set(url, safe); return safe;
  }
  aiPending(destination: DestinationGuide | EnrichedDestinationGuide): boolean { return 'aiPending' in destination && destination.aiPending; }
}
