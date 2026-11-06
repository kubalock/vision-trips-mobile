import { Component, input, output } from '@angular/core';
import type { TripDocument } from '@vision-trips/contracts';

@Component({
  selector: 'app-documents-section',
  template: `
    <section class="vt-section" aria-labelledby="documents-title">
      <h2 id="documents-title" class="vt-h2">Your documents</h2>
      <ul class="vt-docs" role="list">
        @for (document of documents(); track document.id; let last = $last) {
          <li>
            @if (document.url) {
              <a [href]="document.url" target="_blank" rel="noopener"><span aria-hidden="true">▤</span><span><strong>{{ document.title }}</strong><em>{{ document.description }}</em></span><span aria-hidden="true">↗</span>
              </a>
            } @else if (document.downloadAction) {
              <button type="button" class="vt-doc-button" (click)="download.emit(document.downloadAction)"><span aria-hidden="true">▤</span><span><strong>{{ document.title }}</strong><em>{{ document.description }}</em></span><span aria-hidden="true">↓</span>
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
  readonly download = output<'confirmation' | 'invoice' | 'acceptance'>();
}
