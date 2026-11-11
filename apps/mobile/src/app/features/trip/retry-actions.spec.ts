import { TestBed } from '@angular/core/testing';
import type { TripDocument } from '@vision-trips/contracts';
import { CustomerAccountSection } from '../account/customer-account-section';
import { DocumentsSection } from './documents-section';
import { ExternalContentSection } from './external-content-section';

function retryButton(element: HTMLElement): HTMLButtonElement | null {
  return [...element.querySelectorAll<HTMLButtonElement>('.vt-retry button')].find((button) => button.textContent?.trim() === 'Try again') ?? null;
}

describe('retry actions', () => {
  it('lets the traveller retry live travel information', () => {
    const fixture = TestBed.createComponent(ExternalContentSection);
    fixture.componentRef.setInput('content', null);
    fixture.componentRef.setInput('failed', true);
    fixture.detectChanges();
    const refresh = vi.fn();
    fixture.componentInstance.refresh.subscribe(refresh);

    retryButton(fixture.nativeElement)?.click();

    expect(refresh).toHaveBeenCalledOnce();
  });

  it('lets the traveller retry loading their account', () => {
    const fixture = TestBed.createComponent(CustomerAccountSection);
    fixture.componentRef.setInput('account', null);
    fixture.componentRef.setInput('error', 'Our booking system is busy right now.');
    fixture.detectChanges();
    const retry = vi.fn();
    fixture.componentInstance.retry.subscribe(retry);

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Our booking system is busy right now.');
    retryButton(fixture.nativeElement)?.click();

    expect(retry).toHaveBeenCalledOnce();
  });

  it('shows a failed download beside that document and retries the same document', () => {
    const documents = [
      { id: 'doc-1', title: 'Invoice', description: '', kind: 'invoice', downloadAction: 'invoice', mimeType: 'application/pdf', updatedAt: '2026-11-01', status: 'ready' },
      { id: 'doc-2', title: 'Confirmation', description: '', kind: 'confirmation', downloadAction: 'confirmation', mimeType: 'application/pdf', updatedAt: '2026-11-01', status: 'ready' },
    ] as TripDocument[];
    const fixture = TestBed.createComponent(DocumentsSection);
    fixture.componentRef.setInput('documents', documents);
    fixture.componentRef.setInput('statuses', {});
    fixture.componentRef.setInput('failure', { id: 'doc-1', message: 'Our booking system is busy right now.' });
    fixture.detectChanges();
    const download = vi.fn();
    fixture.componentInstance.download.subscribe(download);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('.vt-retry')).toHaveLength(1);
    expect(element.querySelector('.vt-retry')?.textContent).toContain('Invoice didn’t download');
    retryButton(element)?.click();

    expect(download).toHaveBeenCalledWith(documents[0]);
  });
});
