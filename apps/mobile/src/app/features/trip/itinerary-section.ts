import { Component, input } from '@angular/core';
import type { ItineraryItem } from '@vision-trips/contracts';
import { PhotoGallery } from '../../shared/photo-gallery';
import { VtIcon } from '../../shared/lucide-icon';

@Component({
  selector: 'app-itinerary-section',
  imports: [PhotoGallery, VtIcon],
  template: `
    <section class="vt-section" aria-labelledby="itinerary-title">
      <p class="vt-page-kicker text-sm font-semibold uppercase tracking-widest text-teal-700">Trip plan</p><h1 id="itinerary-title" class="vt-page-title mt-1 text-3xl font-semibold">Your itinerary</h1>
      @if (items().length) {
        <div class="vt-days">
          @for (group of groupedItems(); track group.date) {
            <section class="vt-day-card">
              <div class="vt-day__head">
                <p class="vt-day__n">{{ group.dayLabel }}</p><h2 class="vt-day__label">{{ group.dateLabel }}</h2>
              </div>
              <ol class="vt-day__items">
                @for (item of group.items; track item.id) {
                  <li class="vt-el">
                    @if (item.images.length) { <app-photo-gallery [photos]="item.images" [limit]="4" /> }
                    <div class="vt-el__row">
                      <div class="vt-el__main">
                        <div>@if (showTypeLabel(item)) { <p class="vt-el__kind">{{ item.typeLabel }}</p> }<h3 class="vt-el__title">{{ item.title }}</h3></div>
                        @if (item.startTime) { <time class="vt-chip">{{ item.startTime }}</time> }
                      </div>
                      @if (item.from || item.to) { <p class="vt-el__route flex items-center gap-1">{{ item.from }}@if (item.to) { <vt-icon name="arrow-right" [size]="15" /> {{ item.to }} }</p> }
                      @if (item.carrier || item.flightNumber) { <p class="vt-el__meta">{{ item.carrier }} {{ item.flightNumber }}</p> }
                      @if (item.address) { <p class="vt-el__meta">{{ item.address }}</p> }
                      @if (item.details.length) {
                        <dl class="vt-itinerary-meta">
                          @for (detail of item.details; track detail.label) { <div><dt>{{ detail.label }}</dt><dd>{{ detail.value }}</dd></div> }
                        </dl>
                      }
                      @for (room of item.rooms; track room.type) {
                        <section class="vt-itinerary-detail" aria-label="Accommodation details"><h4>{{ room.type }}</h4><dl>@if (room.board) { <div><dt>Board basis</dt><dd>{{ room.board }}</dd></div> }@if (room.view) { <div><dt>Room view</dt><dd>{{ room.view }}</dd></div> }@if (room.requests) { <div><dt>Requests</dt><dd>{{ room.requests }}</dd></div> }</dl></section>
                      }
                      @for (cabin of item.cabins; track cabin.name + cabin.number) {
                        <section class="vt-itinerary-detail" aria-label="Cabin details"><h4>{{ cabin.name }}</h4><dl>@if (cabin.grade) { <div><dt>Grade</dt><dd>{{ cabin.grade }}</dd></div> }@if (cabin.number) { <div><dt>Cabin</dt><dd>{{ cabin.number }}</dd></div> }@if (cabin.deck) { <div><dt>Deck</dt><dd>{{ cabin.deck }}</dd></div> }@if (cabin.bed) { <div><dt>Bed</dt><dd>{{ cabin.bed }}</dd></div> }@if (cabin.dining) { <div><dt>Dining</dt><dd>{{ cabin.dining }}</dd></div> }</dl></section>
                      }
                      @if (item.passengers.length) {
                        <details class="vt-itinerary-disclosure"><summary><span>Passenger details</span><vt-icon name="chevron-down" [size]="18" /></summary><div class="vt-passenger-list">
                          @for (passenger of item.passengers; track passenger.name) { <div><p>{{ passenger.name }}</p><span>{{ passengerLine(passenger) }}</span></div> }
                        </div></details>
                      }
                      @if (item.cruisePorts.length) {
                        <details class="vt-itinerary-disclosure vt-cruise-stops"><summary><span>Cruise itinerary <em>{{ item.cruisePorts.length }} stops</em></span><vt-icon name="chevron-down" [size]="18" /></summary><ol class="vt-cruise-timeline">
                          @for (port of item.cruisePorts; track port.day + port.port) { <li><span class="vt-cruise-timeline__node" aria-hidden="true"></span><div><p class="vt-cruise-timeline__title">{{ port.day ? 'Day ' + port.day + ' · ' : '' }}{{ port.port }}</p>@if (port.arrivalTime || port.departureTime) { <p class="vt-cruise-timeline__time">{{ port.arrivalTime }}{{ port.departureTime ? ' – ' + port.departureTime : '' }}</p> }@if (port.description) { <p class="vt-cruise-timeline__description">{{ port.description }}</p> }</div></li> }
                        </ol></details>
                      }
                      @if (item.supplier || item.reference) { <dl class="vt-itinerary-reference">@if (item.supplier) { <div><dt>Supplier</dt><dd>{{ item.supplier.name }}</dd></div> }@if (item.reference) { <div><dt>Booking reference</dt><dd>{{ item.reference }}</dd></div> }</dl> }
                      @if (item.emergencyContact; as emergency) { <a class="mt-4 flex items-center justify-between rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-900" [href]="telephoneLink(emergency.phone)"><span>{{ emergency.name }}</span><span>{{ emergency.phone }}</span></a> }
                      @if (item.notes) { <p class="vt-itinerary-notes">{{ item.notes }}</p> }
                    </div>
                  </li>
                }
              </ol>
            </section>
          }
        </div>
      } @else { <p class="mt-3 text-slate-500">Your itinerary will appear here as soon as it is confirmed.</p> }
    </section>
  `,
})
export class ItinerarySection {
  readonly items = input.required<ItineraryItem[]>();

  groupedItems() {
    const groups = new Map<string, ItineraryItem[]>();
    for (const item of [...this.items()].sort((a, b) => `${a.startDate ?? '9999'}${a.startTime ?? ''}`.localeCompare(`${b.startDate ?? '9999'}${b.startTime ?? ''}`))) {
      const key = item.startDate ?? 'To be confirmed';
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    const firstDate = this.items().map((item) => item.startDate).filter((date): date is string => Boolean(date)).sort()[0];
    return [...groups].map(([date, groupItems]) => ({ date, items: groupItems, dateLabel: this.dateLabel(date), dayLabel: firstDate && date !== 'To be confirmed' ? `Day ${this.daysBetween(firstDate, date) + 1}` : 'Trip plan' }));
  }

  joined(values: Array<string | null>): string { return values.filter(Boolean).join(' · '); }
  showTypeLabel(item: ItineraryItem): boolean { return item.typeLabel.trim().toLocaleLowerCase() !== item.title.trim().toLocaleLowerCase(); }
  passengerLine(passenger: ItineraryItem['passengers'][number]): string { return this.joined([passenger.travelClass, passenger.seat ? `Seat ${passenger.seat}` : null, passenger.cabinBaggage, passenger.checkedBaggage, passenger.meal, passenger.assistance]); }
  telephoneLink(phone: string): string { return `tel:${phone.replace(/[^0-9+]/g, '')}`; }

  private dateLabel(date: string): string {
    if (date === 'To be confirmed') return date;
    return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00`));
  }

  private daysBetween(start: string, end: string): number { return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000); }
}
