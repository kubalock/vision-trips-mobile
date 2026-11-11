import { Component, input, output } from '@angular/core';
import type { ExternalTripContent } from '@vision-trips/contracts';
import { PhotoGallery } from '../../shared/photo-gallery';
import { VtIcon, type VtIconName } from '../../shared/lucide-icon';
import { EuropeanDatePipe } from '../../shared/european-date.pipe';

@Component({
  selector: 'app-external-content-section',
  imports: [EuropeanDatePipe, PhotoGallery, VtIcon],
  template: `
    @if (loading()) {
      <section class="vt-weather-section vt-weather-skeleton" aria-busy="true" aria-label="Loading weather information">
        <header class="vt-lower-section__header"><p>At your destination</p><h2>Weather</h2></header>
        <div class="vt-weather-grid">@for (placeholder of [1, 2]; track placeholder) { <article class="vt-weather-card vt-weather-skeleton__card" aria-hidden="true"><div class="vt-weather-skeleton__top"><div><span class="vt-weather-skeleton__line vt-weather-skeleton__line--place"></span><span class="vt-weather-skeleton__line vt-weather-skeleton__line--temp"></span><span class="vt-weather-skeleton__line vt-weather-skeleton__line--label"></span></div><span class="vt-weather-skeleton__icon"></span></div><div class="vt-weather-skeleton__forecast">@for (day of [1, 2, 3]; track day) { <div><span></span><strong></strong></div> }</div></article> }</div>
      </section>
    } @else if (content(); as external) {
      @if (external.flights.length) {
        <section class="vt-section"><div class="flex items-center justify-between gap-3"><div><p class="text-xs font-semibold uppercase tracking-widest text-teal-700">Airport systems</p><h2 class="vt-h2">Live flights</h2></div><button type="button" class="vt-btn vt-btn--ghost vt-btn--sm" (click)="refresh.emit()">Refresh</button></div>
          <div class="mt-4 grid gap-3">@for (flight of external.flights; track flight.itineraryItemId) { <article class="rounded-3xl bg-slate-900 p-5 text-white"><div class="flex items-start justify-between gap-4"><div class="flex items-center gap-3">@if (flight.airlineLogoUrl) { <span class="vt-logo-tile rounded-xl bg-white p-2"><img class="h-6 w-12 object-contain" [src]="flight.airlineLogoUrl" alt="" loading="lazy" decoding="async" /></span> }<div><p class="text-sm text-slate-300">{{ flight.carrier }} · {{ flight.flightNumber }}</p><h3 class="text-xl font-semibold">{{ flight.route }}</h3></div></div><span class="rounded-full px-3 py-1 text-xs font-semibold" [class.bg-emerald-500]="flight.status === 'on_time' || flight.status === 'arrived'" [class.bg-amber-500]="flight.status === 'delayed'" [class.bg-red-600]="flight.status === 'cancelled' || flight.status === 'diverted'" [class.bg-sky-600]="flight.status !== 'on_time' && flight.status !== 'arrived' && flight.status !== 'delayed' && flight.status !== 'cancelled' && flight.status !== 'diverted'">{{ flight.statusLabel }}</span></div><div class="mt-5 grid grid-cols-2 gap-4 text-sm"><div><p class="text-slate-400">Departure</p><p class="mt-1 text-lg font-semibold">{{ flight.departure.actual || flight.departure.scheduled || '—' }}</p><p class="text-slate-300">{{ flight.departure.terminal ? 'Terminal ' + flight.departure.terminal : '' }} {{ flight.departure.gate ? '· Gate ' + flight.departure.gate : '' }}</p></div><div><p class="text-slate-400">Arrival</p><p class="mt-1 text-lg font-semibold">{{ flight.arrival.actual || flight.arrival.scheduled || '—' }}</p><p class="text-slate-300">{{ flight.arrival.terminal ? 'Terminal ' + flight.arrival.terminal : '' }} {{ flight.arrival.gate ? '· Gate ' + flight.arrival.gate : '' }} {{ flight.arrival.baggageBelt ? '· Belt ' + flight.arrival.baggageBelt : '' }}</p></div></div><p class="mt-4 text-xs text-slate-400">Live provider update {{ flight.updatedAt.slice(11, 16) }}. Always follow airport and airline announcements.</p></article> }</div>
        </section>
      }
      @if (external.weather.length) {
        <section class="vt-weather-section" aria-labelledby="weather-title">
          <header class="vt-lower-section__header"><p>At your destination</p><h2 id="weather-title">Weather</h2></header>
          <div class="vt-weather-grid">@for (weather of external.weather; track weather.destinationId) {
            <article class="vt-weather-card">
              <div class="vt-weather-card__top"><div><p>{{ weather.place }}</p><strong>{{ weather.temperature }}°</strong><span>{{ weather.label }} · {{ weather.low }}–{{ weather.high }}°</span></div><span class="vt-weather-card__icon"><vt-icon [name]="weatherIcon(weather.icon)" [size]="38" /></span></div>
              <div class="vt-weather-card__forecast">@for (day of weather.days.slice(1, 4); track day.date) { <div><p>{{ day.date | europeanDate: 'dayMonth' }}</p><strong>{{ day.low }}–{{ day.high }}°</strong></div> }</div>
            </article>
          }</div>
        </section>
      }
      @if (external.stays.length) {
        <section class="vt-section"><h2 class="vt-h2">Where you're staying</h2><div class="mt-4 grid gap-5">@for (stay of external.stays; track stay.itineraryItemId) { <article class="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200">@if (stay.images.length) { <app-photo-gallery [photos]="stay.images" /> }<div class="p-5"><div class="flex items-start justify-between gap-3"><div><h3 class="text-xl font-semibold">{{ stay.name }}</h3><p class="mt-1 text-sm text-slate-500">{{ stay.address }}</p></div>@if (stay.rating) { <span class="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-900"><vt-icon name="star" [size]="15" /> {{ stay.rating }} <small>({{ stay.ratingCount }})</small></span> }</div>@if (stay.aiDescription || stay.summary) { <p class="mt-4 leading-7 text-slate-600">{{ stay.aiDescription || stay.summary }}</p> } @else if (stay.aiPending) { <p class="mt-4 animate-pulse text-sm text-slate-500">Preparing your property guide…</p> }<div class="mt-5 flex flex-wrap gap-2"><a class="vt-btn vt-btn--ghost vt-btn--sm" [href]="stay.directionsUrl" target="_blank" rel="noopener">Directions <vt-icon name="external" [size]="15" /></a>@if (stay.mapsUrl) { <a class="vt-btn vt-btn--ghost vt-btn--sm" [href]="stay.mapsUrl" target="_blank" rel="noopener">Map <vt-icon name="external" [size]="15" /></a> }@if (stay.websiteUrl) { <a class="vt-btn vt-btn--ghost vt-btn--sm" [href]="stay.websiteUrl" target="_blank" rel="noopener">Official website <vt-icon name="external" [size]="15" /></a> }</div></div></article> }</div></section>
      }
      @if (external.cruises.length) {
        <section class="vt-section"><h2 class="vt-h2">Your ship and voyage</h2><div class="mt-4 grid gap-5">@for (cruise of external.cruises; track cruise.itineraryItemId) { <article class="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200">@if (cruise.coverImageUrl) { <img class="h-56 w-full object-cover" [src]="cruise.coverImageUrl" [alt]="cruise.name" loading="lazy" decoding="async" /> }<div class="p-5"><p class="text-xs font-semibold uppercase tracking-widest text-teal-700">{{ cruise.operator || 'Your cruise' }}</p><h3 class="mt-1 text-2xl font-semibold">{{ cruise.name }}</h3>@if (cruise.introduction) { <p class="mt-3 leading-7 text-slate-600">{{ cruise.introduction }}</p> }@if (cruise.facts.length) { <dl class="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4 text-sm">@for (fact of cruise.facts; track fact.label) { <div><dt class="text-slate-500">{{ fact.label }}</dt><dd class="font-semibold">{{ fact.value }}</dd></div> }</dl> }@if (cruise.voyage; as voyage) { <details class="mt-4 rounded-2xl border border-slate-200 p-4"><summary class="cursor-pointer font-semibold">Voyage itinerary · {{ voyage.days.length }} stops</summary><ol class="mt-4 grid gap-3 border-l border-slate-200 pl-4">@for (day of voyage.days; track day.day + day.port) { <li><strong>{{ day.day ? 'Day ' + day.day + ' · ' : '' }}{{ day.port }}</strong><p class="text-sm text-slate-500">{{ day.arrivalTime }}{{ day.departureTime ? ' – ' + day.departureTime : '' }}</p></li> }</ol></details> }@for (section of cruise.sections; track section.title) { <details class="mt-3 rounded-2xl border border-slate-200 p-4"><summary class="cursor-pointer font-semibold">{{ section.title }}</summary><div class="mt-4 grid gap-4 sm:grid-cols-2">@for (item of section.items; track item.name) { <div>@if (item.images[0]) { <img class="mb-2 h-28 w-full rounded-xl object-cover" [src]="item.images[0]" alt="" loading="lazy" decoding="async" /> }<strong>{{ item.name }}</strong>@if (item.text) { <p class="mt-1 text-sm leading-6 text-slate-600">{{ item.text }}</p> }</div> }</div></details> }</div></article> }</div></section>
      }
      @if (external.guides.length) {
        <section class="vt-guide-section" aria-labelledby="guide-title">
          <header class="vt-lower-section__header"><p>Travel information</p><h2 id="guide-title">Good to know</h2></header>
          <div class="vt-guide-grid">@for (guide of external.guides; track guide.id) {
            <article class="vt-guide-card">
              <header class="vt-guide-card__header"><span class="vt-guide-card__icon">@if (guide.logoUrl) { <img [src]="guide.logoUrl" alt="" loading="lazy" decoding="async" /> } @else { <vt-icon [name]="guide.kind === 'airport' ? 'plane' : 'compass'" [size]="21" /> }</span><div><p>{{ guide.kind }}</p><h3>{{ guide.name }}</h3></div></header>
              @if (guide.sections.length) { <dl class="vt-guide-card__details">@for (section of guide.sections; track section.title) { <div><span class="vt-guide-card__detail-icon"><vt-icon [name]="guideIcon(section.title)" [size]="18" /></span><div><dt>{{ section.title }}</dt><dd>{{ section.text }}</dd></div></div> }</dl> } @else if (guide.pending) { <p class="vt-guide-card__pending">Preparing practical travel notes…</p> }
            </article>
          }</div>
        </section>
      }
      @if (hasPending(external)) { <p class="vt-section rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">Additional guides are being prepared. This page will check again automatically.</p> }
    } @else if (failed()) { <section class="vt-section rounded-2xl bg-slate-100 p-4 text-sm text-slate-600"><strong>Live travel information is temporarily unavailable.</strong><p class="mt-1">Your saved itinerary is unaffected. Try again when you next refresh the trip.</p></section> }
  `,
})
export class ExternalContentSection {
  readonly content = input<ExternalTripContent | null>(null);
  readonly loading = input(false);
  readonly failed = input(false);
  readonly refresh = output<void>();
  weatherIcon(icon: string): VtIconName { return icon === 'sun' ? 'sun' : icon === 'rain' ? 'cloud-rain' : icon === 'snow' ? 'snow' : 'cloud'; }
  guideIcon(title: string): VtIconName { return /arrival|land/i.test(title) ? 'plane-arrival' : /airport|departure|flight|terminal/i.test(title) ? 'plane' : 'circle-dot'; }
  hasPending(content: ExternalTripContent): boolean { return content.destinations.some((destination) => destination.aiPending) || content.stays.some((stay) => stay.aiPending) || content.guides.some((guide) => guide.pending); }
}
