import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';
import { VisionApiService } from './core/api/vision-api.service';
import { parseTripSnapshot } from './core/api/trip-schema';
import { DocumentWalletStore } from './core/storage/document-wallet.store';
import { ShareSheet } from './core/platform/share-sheet';

/**
 * A saved trip the traveller is signed out of stays readable, but every action that needs a session says how to sign
 * in again instead of offering a control that does nothing. Saved documents still open.
 */
describe('signed-out saved trip', () => {
  type Internals = { trip: { set: (value: unknown) => void }; signedOut: { set: (value: boolean) => void }; session: { set: (value: unknown) => void }; activeView: { set: (value: string) => void }; documentStatuses: { set: (value: Record<string, string>) => void }; downloadDocument: (value: string) => Promise<void>; documentFailure: () => { message: string } | null };

  const trip = (stage = 'confirmed', extra: Record<string, unknown> = {}) => parseTripSnapshot({
    schemaVersion: 3, tripId: 'trp_1', stage, accessScope: 'primary_customer', summary: { name: 'Lisbon', reference: 'R1' }, brand: { name: 'Sunny Travel' },
    capabilities: { sendMessage: true, shareWithTraveller: true, makePayment: true, acceptQuotation: stage === 'quote' },
    payments: { currency: 'GBP', total: 1000, paid: 0, balance: 1000, items: [{ id: 'pay_1', label: 'Deposit', amount: 200, currency: 'GBP', status: 'outstanding', canPay: true }], customPayments: { enabled: false, minimum: 0, maximum: 0 } },
    documents: [
      { id: 'doc_saved', title: 'Confirmation', description: '', kind: 'confirmation', offlineAvailable: true, status: 'ready', downloadAction: 'confirmation', version: 'v1', updatedAt: '2026-11-01T10:00:00Z', mimeType: 'application/pdf' },
      { id: 'doc_new', title: 'Invoice', description: '', kind: 'invoice', offlineAvailable: true, status: 'ready', downloadAction: 'invoice', version: 'v1', updatedAt: '2026-11-01T10:00:00Z', mimeType: 'application/pdf' },
    ],
    ...extra,
  });

  async function render(stage?: string, extra?: Record<string, unknown>) {
    await TestBed.configureTestingModule({ imports: [App], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    vi.spyOn(TestBed.inject(VisionApiService), 'externalContent').mockReturnValue(new Promise(() => undefined));
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as Internals;
    app.trip.set(trip(stage, extra)); app.session.set(null); app.signedOut.set(true);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const show = (view: string) => { app.activeView.set(view); fixture.detectChanges(); };
    const text = () => element.textContent?.replace(/\s+/g, ' ') ?? '';
    return { fixture, app, element, show, text };
  }
  afterEach(() => vi.restoreAllMocks());

  it('hides the calendar and refresh on Home, showing the signed-out card instead', async () => {
    const { element } = await render();
    expect(element.querySelector('.vt-signed-out')).not.toBeNull();
    expect(element.querySelector('.vt-hero__calendar')).toBeNull();
    expect(element.querySelector('.vt-trip-status-card__refresh, .vt-freshness__refresh')).toBeNull();
  });

  it('replaces the message form and sharing with a sign-in-again note on Help', async () => {
    const { element, show, text } = await render();
    show('help');
    expect(element.querySelector('.vt-help-form')).toBeNull();
    expect(element.querySelector('.vt-share-button')).toBeNull();
    expect(element.querySelectorAll('vt-sign-in-again')).toHaveLength(2);
    expect(text()).toContain('To send a message, open your newest invitation link from Sunny Travel');
  });

  it('disables payment buttons and says why', async () => {
    const { element, show, text } = await render();
    show('payments');
    expect(element.querySelector<HTMLButtonElement>('.vt-pay__action')?.disabled).toBe(true);
    expect(text()).toContain('To make a payment');
  });

  it('replaces quotation acceptance with the note', async () => {
    const { element, text } = await render('quote', { quotation: { status: 'available', canAccept: true, requiredConfirmations: [], reviewSections: [] } });
    expect(element.querySelector('.vt-accept-form')).toBeNull();
    expect(text()).toContain('To accept this quotation');
  });

  it('shows the note on Account, keeping the device sign-out controls', async () => {
    const { element, show, text } = await render();
    show('account');
    expect(text()).toContain('To see your trips and preferences');
    expect(element.querySelectorAll('.vt-account-danger')).toHaveLength(2);
  });

  it('still opens saved documents, and explains why an unsaved one cannot download', async () => {
    const { app } = await render();
    const wallet = TestBed.inject(DocumentWalletStore);
    vi.spyOn(wallet, 'shareUri').mockResolvedValue('file:///saved.pdf');
    const share = vi.spyOn(TestBed.inject(ShareSheet), 'share').mockResolvedValue(undefined as never);
    app.documentStatuses.set({ doc_saved: 'saved', doc_new: 'not_saved' });
    await app.downloadDocument('confirmation');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: ['file:///saved.pdf'] }));
    expect(app.documentFailure()).toBeNull();
    await app.downloadDocument('invoice');
    expect(app.documentFailure()?.message).toContain('Sign in again to download it');
  });
});
