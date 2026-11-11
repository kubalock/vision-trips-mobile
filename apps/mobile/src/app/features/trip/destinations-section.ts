import { Component, inject, input, signal } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import type { DestinationGuide, EnrichedDestinationGuide } from '@vision-trips/contracts';
import { PhotoGallery } from '../../shared/photo-gallery';
import { VtIcon } from '../../shared/lucide-icon';

@Component({
  selector: 'app-destinations-section',
  imports: [PhotoGallery, VtIcon],
  template: `
    @if (destinations().length) {
      <section class="vt-destination-section" aria-labelledby="destinations-title">
        <header class="vt-lower-section__header"><p>Explore your trip</p><h2 id="destinations-title">Your destinations</h2></header>
        <div class="vt-destination-grid">
          @for (destination of destinations(); track destination.id) {
            <article class="vt-destination-card">
              @if (images(destination).length) { <div class="vt-destination-card__media"><app-photo-gallery [photos]="images(destination)" [limit]="1" /></div> }
              <div class="vt-destination-card__body">
                <header class="vt-destination-card__header"><span class="vt-destination-card__icon"><vt-icon name="map-pin" [size]="20" /></span><div><p>{{ destination.country || 'Destination guide' }}</p><h3>{{ destination.name }}</h3></div></header>
                @if (overviewIntro(destination)) {
                  <div class="vt-destination-card__overview-wrap" [class.is-truncated]="hasLongOverview(destination) && !isOverviewExpanded(destination.id)" [class.is-expanded]="isOverviewExpanded(destination.id)"><p class="vt-destination-card__overview">{{ overviewIntro(destination) }}</p></div>
                  @if (hasLongOverview(destination)) { <button type="button" class="vt-destination-card__read-more" [attr.aria-expanded]="isOverviewExpanded(destination.id)" (click)="toggleOverview(destination.id)">{{ isOverviewExpanded(destination.id) ? 'Read less' : 'Read more' }} <vt-icon name="chevron-down" [size]="15" /></button> }
                }
                @if (overviewHighlights(destination).length) {
                  <details class="vt-destination-fold"><summary>Highlights <vt-icon name="chevron-down" [size]="18" /></summary><div class="vt-destination-fold__content"><ul>@for (highlight of overviewHighlights(destination); track $index) { <li><strong>{{ highlight.title }}</strong>@if (highlight.text) { <span>{{ highlight.text }}</span> }</li> }</ul></div></details>
                }
                @if (attractionItems(destination).length) {
                  <details class="vt-destination-fold"><summary>Must-see spots <vt-icon name="chevron-down" [size]="18" /></summary><div class="vt-destination-fold__content"><ul>@for (attraction of attractionItems(destination); track $index) { <li><strong>{{ attraction.title }}</strong>@if (attraction.text) { <span>{{ attraction.text }}</span> }</li> }</ul></div></details>
                }
                @if (usefulItems(destination).length) {
                  <details class="vt-destination-fold"><summary>Useful to know <vt-icon name="chevron-down" [size]="18" /></summary><div class="vt-destination-fold__content"><ul>@for (item of usefulItems(destination); track $index) { <li>@if (item.title) { <strong>{{ item.title }}</strong> }@if (item.text) { <span>{{ item.text }}</span> }</li> }</ul></div></details>
                }
                @if (!hasDestinationContent(destination) && !aiPending(destination)) { <p class="vt-destination-empty"><vt-icon name="compass" [size]="17" /> Sights coming soon</p> }
                @if (destination.travelAdviceUrl) { <div class="vt-destination-actions"><a [href]="destination.travelAdviceUrl" target="_blank" rel="noopener">Official travel advice <vt-icon name="external" [size]="14" /></a></div> }
                @if (mapUrl(destination)) { <details class="vt-destination-map"><summary><span><vt-icon name="map-pin" [size]="18" /> Map</span><vt-icon name="chevron-down" [size]="18" /></summary><div class="vt-destination-map__actions"><a [href]="directionsUrl(destination)" target="_blank" rel="noopener">Directions <vt-icon name="arrow-right" [size]="15" /></a><a [href]="mapsUrl(destination)" target="_blank" rel="noopener">Open in Maps <vt-icon name="external" [size]="14" /></a></div><div class="vt-destination-map__frame"><iframe [src]="mapUrl(destination)" [title]="'Map of ' + destination.name" loading="lazy"></iframe></div></details> }
                @if (aiPending(destination) && !destination.overview) { <p class="vt-destination-card__pending">Preparing your destination guide…</p> }
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
  private readonly expandedOverviews = signal<ReadonlySet<string>>(new Set());
  readonly destinations = input.required<Array<DestinationGuide | EnrichedDestinationGuide>>();
  images(destination: DestinationGuide | EnrichedDestinationGuide) { return 'images' in destination && destination.images.length ? destination.images : destination.imageUrl ? [{ url: destination.imageUrl }] : []; }
  mapUrl(destination: DestinationGuide | EnrichedDestinationGuide): SafeResourceUrl | null {
    const query = destination.coordinates ? `${destination.coordinates.latitude},${destination.coordinates.longitude}` : destination.name;
    const url = ('mapUrl' in destination ? destination.mapUrl : null) ?? `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
    if (!url) return null;
    const cached = this.safeMaps.get(url); if (cached) return cached;
    const safe = this.sanitizer.bypassSecurityTrustResourceUrl(url); this.safeMaps.set(url, safe); return safe;
  }
  aiPending(destination: DestinationGuide | EnrichedDestinationGuide): boolean { return 'aiPending' in destination && destination.aiPending; }
  directionsUrl(destination: DestinationGuide): string { return destination.directionsUrl ?? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination.coordinates ? `${destination.coordinates.latitude},${destination.coordinates.longitude}` : destination.name)}`; }
  mapsUrl(destination: DestinationGuide): string { return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination.coordinates ? `${destination.coordinates.latitude},${destination.coordinates.longitude}` : destination.name)}`; }
  overviewIntro(destination: DestinationGuide): string {
    const parts = this.overviewParts(destination.overview);
    return parts.intro;
  }
  overviewHighlights(destination: DestinationGuide): Array<{ title: string; text: string }> {
    return this.overviewParts(destination.overview).highlights;
  }
  hasLongOverview(destination: DestinationGuide): boolean { return this.overviewIntro(destination).length > 220; }
  isOverviewExpanded(id: string): boolean { return this.expandedOverviews().has(id); }
  toggleOverview(id: string): void {
    this.expandedOverviews.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  attractionItems(destination: DestinationGuide): Array<{ title: string; text: string }> {
    return destination.attractions.flatMap((value) => this.textItems(value));
  }
  usefulItems(destination: DestinationGuide): Array<{ title: string; text: string }> {
    return [destination.practicalInformation, destination.culturalInformation].flatMap((value) => this.textItems(value));
  }
  hasDestinationContent(destination: DestinationGuide): boolean {
    return Boolean(this.overviewIntro(destination) || this.overviewHighlights(destination).length || this.attractionItems(destination).length || this.usefulItems(destination).length);
  }
  private overviewParts(value: string | null): { intro: string; highlights: Array<{ title: string; text: string }> } {
    const safeValue = this.customerText(value);
    if (!safeValue) return { intro: '', highlights: [] };
    const chunks = safeValue.split(/\s+(?=[-•]\s+)/).map((part) => part.trim()).filter(Boolean);
    if (chunks.length < 2 && !/^[-•]/.test(chunks[0] ?? '')) return { intro: safeValue, highlights: [] };
    const intro = /^[-•]/.test(chunks[0] ?? '') ? '' : chunks.shift() ?? '';
    const highlights = chunks.map((chunk) => {
      const [title, ...detail] = chunk.replace(/^[-•]\s*/, '').split(/\s+--\s+/);
      return { title: title.trim(), text: detail.join(' — ').trim() };
    }).filter((item) => item.title);
    return { intro, highlights };
  }
  private textItems(value: string | null): Array<{ title: string; text: string }> {
    const safeValue = this.customerText(value);
    if (!safeValue) return [];
    const chunks = safeValue.split(/\n+\s*(?:[-•*]\s*)?|\s+(?=[-•]\s+)/).map((part) => part.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
    return chunks.map((chunk) => {
      const [title, ...detail] = chunk.split(/\s+--\s+/);
      return detail.length ? { title: title.trim(), text: detail.join(' — ').trim() } : { title: '', text: title.trim() };
    });
  }
  private customerText(value: string | null): string {
    const text = value?.trim() ?? '';
    if (!text || /\b(?:i (?:do not|don't) have|no itinerary|itinerary (?:is not|isn't|was not) available|unable to (?:access|find)|no (?:destination|travel) data|not enough information)\b/i.test(text)) return '';
    return text;
  }
}
