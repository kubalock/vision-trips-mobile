import { Component, input } from '@angular/core';
import type { TripCommunication } from '@vision-trips/contracts';

@Component({
  selector: 'app-communications-section',
  template: `
    @if (communications().length) {
      <section class="mt-8" aria-labelledby="updates-title">
        <h2 id="updates-title" class="text-2xl font-semibold tracking-tight">Trip updates</h2>
        <div class="mt-4 grid gap-3">
          @for (message of communications(); track message.id) {
            <article class="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
              <div class="flex items-start justify-between gap-4"><p class="text-xs font-semibold uppercase tracking-wider text-teal-700">{{ message.type }}</p>@if (message.sentAt) { <time class="text-xs text-slate-500">{{ message.sentAt.slice(0, 10) }}</time> }</div>
              <h3 class="mt-2 font-semibold">{{ message.subject }}</h3>
              @if (message.content) { <p class="mt-2 text-sm leading-6 text-slate-600">{{ message.content }}</p> }
            </article>
          }
        </div>
      </section>
    }
  `,
})
export class CommunicationsSection {
  readonly communications = input.required<TripCommunication[]>();
}
