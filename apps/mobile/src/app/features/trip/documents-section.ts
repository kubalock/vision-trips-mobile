import { Component, computed, input, output } from '@angular/core';
import type { TripDocument } from '@vision-trips/contracts';
import type { WalletStatus } from '../../core/storage/document-wallet.store';
import { EuropeanDatePipe } from '../../shared/european-date.pipe';
import { VtIcon } from '../../shared/lucide-icon';

interface DocumentGroup {
  id: 'core' | 'payments' | 'correspondence';
  title: string;
  description: string;
  documents: TripDocument[];
}

@Component({
  selector: 'app-documents-section',
  imports: [EuropeanDatePipe, VtIcon],
  template: `
    <section class="vt-section vt-documents" aria-labelledby="documents-title">
      <header class="vt-documents__heading">
        <p class="vt-documents__kicker">Travel wallet</p>
        <h1 id="documents-title">Your documents</h1>
        <p>Downloaded documents are kept on this device for offline access. Replaced files are clearly marked as updated.</p>
      </header>

      @for (group of groups(); track group.id) {
        <section class="vt-doc-group" [attr.aria-labelledby]="'documents-' + group.id">
          <header class="vt-doc-group__heading">
            <div>
              <h2 [id]="'documents-' + group.id">{{ group.title }}</h2>
              <p>{{ group.description }}</p>
            </div>
            <span>{{ group.documents.length }}</span>
          </header>
          <ul class="vt-docs" role="list">
            @for (document of group.documents; track document.id) {
              <li>
                @if (document.downloadAction) {
                  <button
                    type="button"
                    class="vt-doc-button"
                    [disabled]="downloadingId() === document.id"
                    [attr.aria-label]="'Download ' + document.title"
                    (click)="download.emit(document)"
                  >
                    <span class="vt-doc-button__icon"><vt-icon name="file" [size]="21" /></span>
                    <span class="vt-doc-button__copy">
                      <span class="vt-doc-button__title">
                        <strong>{{ document.title }}</strong>
                        <small class="vt-doc-badge vt-doc-badge--type">{{ fileType(document) }}</small>
                        @if (statuses()[document.id] === 'updated') {
                          <small class="vt-doc-badge vt-doc-badge--updated">Updated</small>
                        }
                      </span>
                      <span class="vt-doc-button__description">{{ document.description }}</span>
                      <span class="vt-doc-button__meta">
                        Updated {{ document.updatedAt | europeanDate }}
                        @if (statuses()[document.id] === 'saved') {
                          <small>Available offline</small>
                        }
                      </span>
                    </span>
                    <span class="vt-doc-button__action" aria-hidden="true">
                      @if (downloadingId() === document.id) {
                        <vt-icon class="animate-spin" name="loader" [size]="19" />
                      } @else {
                        <vt-icon name="download" [size]="19" />
                      }
                    </span>
                  </button>
                } @else {
                  <div class="vt-doc-button vt-doc-button--unavailable">
                    <span class="vt-doc-button__icon"><vt-icon name="file" [size]="21" /></span>
                    <span class="vt-doc-button__copy">
                      <span class="vt-doc-button__title">
                        <strong>{{ document.title }}</strong>
                        <small class="vt-doc-badge vt-doc-badge--type">{{ fileType(document) }}</small>
                      </span>
                      <span class="vt-doc-button__description">{{ document.description }}</span>
                      <span class="vt-doc-button__meta">Updated {{ document.updatedAt | europeanDate }}</span>
                    </span>
                    <span class="vt-doc-badge vt-doc-badge--pending">{{ document.status === 'pending' ? 'Coming soon' : 'Unavailable' }}</span>
                  </div>
                }
              </li>
            }
          </ul>
        </section>
      } @empty {
        <section class="vt-doc-empty">
          <span class="vt-doc-button__icon"><vt-icon name="file" [size]="22" /></span>
          <h2>No documents yet</h2>
          <p>Your travel documents will appear here as soon as they are ready.</p>
        </section>
      }
    </section>
  `,
})
export class DocumentsSection {
  readonly documents = input.required<TripDocument[]>();
  readonly statuses = input.required<Record<string, WalletStatus>>();
  readonly downloadingId = input<string | null>(null);
  readonly download = output<TripDocument>();
  readonly groups = computed<DocumentGroup[]>(() => {
    const groups: DocumentGroup[] = [
      { id: 'core', title: 'Core booking documents', description: 'Essential protection and trip paperwork', documents: [] },
      { id: 'payments', title: 'Receipts & payments', description: 'Invoices, receipts and payment records', documents: [] },
      { id: 'correspondence', title: 'Correspondence', description: 'Letters and supplier information', documents: [] },
    ];
    for (const document of this.documents()) {
      const group = ['invoice', 'receipt'].includes(document.kind) ? groups[1] : ['letter', 'supplier'].includes(document.kind) ? groups[2] : groups[0];
      group.documents.push(document);
    }
    return groups.filter((group) => group.documents.length > 0);
  });

  fileType(document: TripDocument): string {
    if (document.mimeType.toLowerCase().includes('pdf')) return 'PDF';
    const subtype = document.mimeType.split('/')[1];
    return subtype ? subtype.toUpperCase().replace('JPEG', 'JPG') : 'FILE';
  }
}
