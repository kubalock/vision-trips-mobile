import { Component, input, output } from '@angular/core';
import type { TripDocument } from '@vision-trips/contracts';

@Component({
  selector: 'app-documents-section',
  template: `
    <section class="mt-8" aria-labelledby="documents-title">
      <h2 id="documents-title" class="text-2xl font-semibold tracking-tight">Your documents</h2>
      <ul class="mt-4 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        @for (document of documents(); track document.id; let last = $last) {
          <li [class.border-b]="!last" class="border-slate-200">
            @if (document.url) {
              <a class="flex items-center justify-between gap-4 p-4" [href]="document.url" target="_blank" rel="noopener">
                <span><strong class="block">{{ document.title }}</strong><span class="text-sm text-slate-500">{{ document.description }}</span></span><span aria-hidden="true">↗</span>
              </a>
            } @else if (document.downloadAction) {
              <button type="button" class="flex w-full items-center justify-between gap-4 p-4 text-left" (click)="download.emit(document.downloadAction)">
                <span><strong class="block">{{ document.title }}</strong><span class="text-sm text-slate-500">{{ document.description }}</span></span><span aria-hidden="true">↓</span>
              </button>
            } @else {
              <div class="flex items-center justify-between gap-4 p-4"><span><strong class="block">{{ document.title }}</strong><span class="text-sm text-slate-500">{{ document.description }}</span></span><span class="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">{{ document.status === 'pending' ? 'Coming soon' : 'Unavailable' }}</span></div>
            }
          </li>
        }
      </ul>
    </section>
  `,
})
export class DocumentsSection {
  readonly documents = input.required<TripDocument[]>();
  readonly download = output<'confirmation' | 'invoice'>();
}
