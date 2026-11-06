import { Component, input } from '@angular/core';
import type { ItineraryItem } from '@vision-trips/contracts';

@Component({
  selector: 'app-itinerary-section',
  template: `
    <section class="mt-8" aria-labelledby="itinerary-title">
      <h2 id="itinerary-title" class="text-2xl font-semibold tracking-tight">Your itinerary</h2>
      @if (items().length) {
        <div class="mt-5 grid gap-8">
          @for (group of groupedItems(); track group.date) {
            <section>
              <div class="mb-3 flex items-baseline gap-3">
                <p class="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">{{ group.dayLabel }}</p>
                <h3 class="text-lg font-semibold">{{ group.dateLabel }}</h3>
              </div>
              <ol class="grid gap-3 border-l-2 border-teal-100 pl-4">
                @for (item of group.items; track item.id) {
                  <li class="relative overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
                    <span class="absolute -left-[1.32rem] top-7 size-2.5 rounded-full bg-teal-700 ring-4 ring-stone-50"></span>
                    @if (item.images[0]; as image) { <img class="h-40 w-full object-cover" [src]="image.url" [alt]="image.alt" loading="lazy" /> }
                    <div class="p-5">
                      <div class="flex items-start justify-between gap-4">
                        <div><p class="text-xs font-semibold uppercase tracking-wider text-teal-700">{{ item.typeLabel }}</p><h4 class="mt-1 text-lg font-semibold">{{ item.title }}</h4></div>
                        @if (item.startTime) { <time class="shrink-0 rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-800">{{ item.startTime }}</time> }
                      </div>
                      @if (item.from || item.to) { <p class="mt-3 text-sm font-medium text-slate-700">{{ item.from }}{{ item.to ? ' → ' + item.to : '' }}</p> }
                      @if (item.carrier || item.flightNumber) { <p class="mt-1 text-sm text-slate-600">{{ item.carrier }} {{ item.flightNumber }}</p> }
                      @if (item.address) { <p class="mt-2 text-sm leading-6 text-slate-600">{{ item.address }}</p> }
                      @if (item.details.length) {
                        <dl class="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm">
                          @for (detail of item.details; track detail.label) { <div><dt class="text-slate-500">{{ detail.label }}</dt><dd class="mt-0.5 font-medium">{{ detail.value }}</dd></div> }
                        </dl>
                      }
                      @for (room of item.rooms; track room.type) {
                        <div class="mt-4 rounded-xl bg-slate-50 p-4 text-sm"><p class="font-semibold">{{ room.type }}</p><p class="mt-1 text-slate-600">{{ joined([room.view, room.board]) }}</p>@if (room.requests) { <p class="mt-2 text-slate-600">{{ room.requests }}</p> }</div>
                      }
                      @for (cabin of item.cabins; track cabin.name + cabin.number) {
                        <div class="mt-4 rounded-xl bg-slate-50 p-4 text-sm"><p class="font-semibold">{{ cabin.name }}</p><p class="mt-1 text-slate-600">{{ joined([cabin.grade, cabin.number ? 'Cabin ' + cabin.number : null, cabin.deck, cabin.bed, cabin.dining]) }}</p></div>
                      }
                      @if (item.passengers.length) {
                        <details class="mt-4 rounded-xl border border-slate-200 p-4 text-sm"><summary class="cursor-pointer font-semibold">Passenger details</summary><div class="mt-3 grid gap-3">
                          @for (passenger of item.passengers; track passenger.name) { <div><p class="font-medium">{{ passenger.name }}</p><p class="text-slate-600">{{ passengerLine(passenger) }}</p></div> }
                        </div></details>
                      }
                      @if (item.cruisePorts.length) {
                        <details class="mt-4 rounded-xl border border-slate-200 p-4 text-sm"><summary class="cursor-pointer font-semibold">Cruise itinerary · {{ item.cruisePorts.length }} stops</summary><ol class="mt-3 grid gap-3 border-l border-slate-200 pl-4">
                          @for (port of item.cruisePorts; track port.day + port.port) { <li><p class="font-medium">{{ port.day ? 'Day ' + port.day + ' · ' : '' }}{{ port.port }}</p><p class="text-slate-500">{{ port.arrivalTime }}{{ port.departureTime ? ' – ' + port.departureTime : '' }}</p>@if (port.description) { <p class="mt-1 leading-5 text-slate-600">{{ port.description }}</p> }</li> }
                        </ol></details>
                      }
                      @if (item.supplier || item.reference) { <p class="mt-4 text-sm text-slate-500">{{ item.supplier?.name }}{{ item.reference ? ' · Reference ' + item.reference : '' }}</p> }
                      @if (item.emergencyContact; as emergency) { <a class="mt-4 flex items-center justify-between rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-900" [href]="telephoneLink(emergency.phone)"><span>{{ emergency.name }}</span><span>{{ emergency.phone }}</span></a> }
                      @if (item.notes) { <p class="mt-4 border-t border-slate-100 pt-4 text-sm leading-6 text-slate-600">{{ item.notes }}</p> }
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
  passengerLine(passenger: ItineraryItem['passengers'][number]): string { return this.joined([passenger.travelClass, passenger.seat ? `Seat ${passenger.seat}` : null, passenger.cabinBaggage, passenger.checkedBaggage, passenger.meal, passenger.assistance]); }
  telephoneLink(phone: string): string { return `tel:${phone.replace(/[^0-9+]/g, '')}`; }

  private dateLabel(date: string): string {
    if (date === 'To be confirmed') return date;
    return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00`));
  }

  private daysBetween(start: string, end: string): number { return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000); }
}
