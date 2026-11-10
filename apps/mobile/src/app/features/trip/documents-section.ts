import { Component, input, output } from '@angular/core';
import type { TripDocument } from '@vision-trips/contracts';
import type { WalletStatus } from '../../core/storage/document-wallet.store';
import { VtIcon } from '../../shared/lucide-icon';

@Component({
  selector: 'app-documents-section',
  imports: [VtIcon],
  template: `
    <section class="vt-section" aria-labelledby="documents-title">
      <p class="text-sm font-semibold uppercase tracking-widest text-teal-700">Travel wallet</p><h1 id="documents-title" class="mt-1 text-3xl font-semibold">Your documents</h1><p class="mt-2 text-sm leading-6 text-slate-600">Downloaded documents are kept on this device for offline access. When your agent replaces one, it will be marked Updated.</p>
      <ul class="vt-docs" role="list">
        @for (document of documents(); track document.id; let last = $last) {
          <li>
            @if (document.downloadAction) {
              <button type="button" class="vt-doc-button" [disabled]="downloadingId() === document.id" (click)="download.emit(document)"><span><vt-icon name="file" [size]="22" /></span><span><strong>{{ document.title }} @if (statuses()[document.id] === 'updated') { <small class="ml-2 rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-900">Updated</small> }</strong><em>{{ document.description }} · {{ (document.mimeType || 'application/pdf').includes('pdf') ? 'PDF' : 'File' }}</em>@if (statuses()[document.id] === 'saved') { <small class="mt-1 block font-semibold text-emerald-700">Available offline</small> }</span><span>@if (downloadingId() === document.id) { <vt-icon class="animate-spin" name="loader" [size]="20" /> } @else { <vt-icon name="download" [size]="20" /> }</span>
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
  readonly statuses = input.required<Record<string, WalletStatus>>();
  readonly downloadingId = input<string | null>(null);
  readonly download = output<TripDocument>();
}
