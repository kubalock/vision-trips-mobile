import { Component, input } from '@angular/core';
import type { ItineraryItem } from '@vision-trips/contracts';

@Component({
  selector: 'app-itinerary-section',
  template: `
    <section class="mt-8" aria-labelledby="itinerary-title">
      <h2 id="itinerary-title" class="text-2xl font-semibold tracking-tight">Your itinerary</h2>
      @if (items().length) {
        <ol class="mt-4 grid gap-3">
          @for (item of items(); track item.id) {
            <li class="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-xs font-semibold uppercase tracking-wider text-teal-700">{{ item.typeLabel }}</p>
                  <h3 class="mt-1 font-semibold">{{ item.title }}</h3>
                </div>
                @if (item.startDate) { <time class="text-sm text-slate-500">{{ item.startDate }}</time> }
              </div>
              @if (item.startTime || item.endTime) {
                <p class="mt-2 text-sm text-slate-600">{{ item.startTime }}{{ item.endTime ? ' – ' + item.endTime : '' }}</p>
              }
              @if (item.carrier || item.flightNumber) { <p class="mt-2 text-sm text-slate-600">{{ item.carrier }} {{ item.flightNumber }}</p> }
              @if (item.reference) { <p class="mt-2 text-sm text-slate-500">Reference {{ item.reference }}</p> }
              @if (item.notes) { <p class="mt-3 border-t border-slate-100 pt-3 text-sm leading-6 text-slate-600">{{ item.notes }}</p> }
            </li>
          }
        </ol>
      } @else {
        <p class="mt-3 text-slate-500">Your itinerary will appear here as soon as it is confirmed.</p>
      }
    </section>
  `,
})
export class ItinerarySection {
  readonly items = input.required<ItineraryItem[]>();
}
