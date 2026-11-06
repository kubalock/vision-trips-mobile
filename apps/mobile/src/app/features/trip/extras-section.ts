import { Component, input } from '@angular/core';
import type { TripExtra } from '@vision-trips/contracts';

@Component({
  selector: 'app-extras-section',
  template: `
    @if (extras().length) {
      <section class="mt-8" aria-labelledby="extras-title">
        <h2 id="extras-title" class="text-2xl font-semibold tracking-tight">Make it even better</h2>
        <div class="mt-4 flex snap-x gap-4 overflow-x-auto pb-2">
          @for (extra of extras(); track extra.id) {
            <article class="min-w-[17rem] snap-start overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
              @if (extra.imageUrl) { <img class="h-36 w-full object-cover" [src]="extra.imageUrl" [alt]="extra.name" loading="lazy" /> }
              <div class="p-5">
                <h3 class="font-semibold">{{ extra.name }}</h3>
                @if (extra.description) { <p class="mt-2 text-sm leading-6 text-slate-600">{{ extra.description }}</p> }
                @if (extra.supplierName) { <p class="mt-3 text-xs font-medium text-slate-500">Provided by {{ extra.supplierName }}</p> }
                <p class="mt-4 text-sm font-semibold text-teal-700">Ask your travel expert</p>
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
