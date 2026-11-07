import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { Share } from '@capacitor/share';
import type { CustomerMessageTopic, LinkExchangeChallenge, LinkExchangeResponse, MobileSession, TripDocument, TripSnapshot } from '@vision-trips/contracts';
import { VisionApiService } from './core/api/vision-api.service';
import { SavedTripsStore } from './core/storage/saved-trips.store';
import { DocumentWalletStore, type WalletStatus } from './core/storage/document-wallet.store';
import { DocumentsSection } from './features/trip/documents-section';
import { DestinationsSection } from './features/trip/destinations-section';
import { CommunicationsSection } from './features/trip/communications-section';
import { ItinerarySection } from './features/trip/itinerary-section';
import { ExtrasSection } from './features/trip/extras-section';
import { PaymentsSection } from './features/trip/payments-section';

type AppView = 'home' | 'itinerary' | 'payments' | 'documents' | 'help';

@Component({
  selector: 'app-root',
  imports: [CommunicationsSection, DestinationsSection, DocumentsSection, ExtrasSection, ItinerarySection, PaymentsSection],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  private readonly api = inject(VisionApiService);
  private readonly savedTrips = inject(SavedTripsStore);
  private readonly documentWallet = inject(DocumentWalletStore);
  protected readonly baseId = signal('');
  protected readonly recordId = signal('');
  protected readonly submitting = signal(false);
  protected readonly error = signal('');
  protected readonly trip = signal<TripSnapshot | null>(null);
  protected readonly challenge = signal<LinkExchangeChallenge | null>(null);
  protected readonly postcode = signal('');
  protected readonly otpCode = signal('');
  protected readonly verificationMethod = signal<'postcode' | 'otp'>('otp');
  protected readonly rememberDevice = signal(true);
  protected readonly resendSeconds = signal(0);
  protected readonly storedSecurely = signal(false);
  protected readonly activeView = signal<AppView>('home');
  protected readonly acceptanceName = signal('');
  protected readonly acceptanceEmail = signal('');
  protected readonly acceptanceConfirmations = signal<string[]>([]);
  protected readonly acceptanceSectionsOpened = signal<string[]>([]);
  protected readonly acceptanceComplete = signal(false);
  protected readonly acceptanceNotice = signal('');
  protected readonly messageTopic = signal<CustomerMessageTopic>('itinerary');
  protected readonly customerMessage = signal('');
  protected readonly messageSent = signal(false);
  protected readonly openingPaymentId = signal<string | null>(null);
  protected readonly paymentReturnState = signal<'idle' | 'checking' | 'updated' | 'unchanged' | 'error'>('idle');
  protected readonly online = signal(true);
  protected readonly refreshing = signal(false);
  protected readonly sharing = signal(false);
  protected readonly shareResult = signal('');
  protected readonly documentStatuses = signal<Record<string, WalletStatus>>({});
  protected readonly downloadingDocumentId = signal<string | null>(null);
  private readonly session = signal<MobileSession | null>(null);
  private paymentAwaitingReturn = false;
  private paymentOpenedAt = 0;
  private paymentPaidBefore = 0;
  private paymentIdAwaiting: string | null = null;
  private resumeListener: PluginListenerHandle | null = null;
  private networkListener: PluginListenerHandle | null = null;
  private resendTimer: ReturnType<typeof setInterval> | null = null;
  protected readonly canContinue = computed(() => /^app[A-Za-z0-9]{14}$/.test(this.baseId().trim()) && /^rec[A-Za-z0-9]{14}$/.test(this.recordId().trim()) && !this.submitting());

  ngOnInit(): void {
    document.body.classList.add('vt');
    void this.openSharedLinkFromLocation();
    void this.initializeOfflineState();
    if (Capacitor.isNativePlatform()) {
      void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) void this.checkPaymentReturn();
      }).then((listener) => { this.resumeListener = listener; });
    }
  }

  ngOnDestroy(): void {
    document.body.classList.remove('vt');
    void this.resumeListener?.remove();
    void this.networkListener?.remove();
    if (this.resendTimer) clearInterval(this.resendTimer);
  }

  @HostListener('window:focus')
  protected onWindowFocus(): void {
    void this.checkPaymentReturn();
  }

  protected updateBaseId(event: Event): void {
    this.baseId.set((event.target as HTMLInputElement).value);
  }

  protected updateRecordId(event: Event): void {
    this.recordId.set((event.target as HTMLInputElement).value);
  }

  protected async openTrip(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canContinue()) return;

    this.submitting.set(true);
    this.error.set('');
    try {
      const response = await this.api.exchangeLocalTrip(this.baseId().trim(), this.recordId().trim());
      if (response.status === 'authorized') {
        await this.acceptAuthorized(response);
      } else {
        this.setChallenge(response.challenge);
      }
    } catch (error) {
      this.error.set(this.apiError(error, 'We could not open that trip. Check the Airtable IDs and API configuration, then try again.'));
    } finally {
      this.submitting.set(false);
    }
  }

  protected updatePostcode(event: Event): void {
    this.postcode.set((event.target as HTMLInputElement).value);
  }

  protected updateOtpCode(event: Event): void { this.otpCode.set((event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6)); }
  protected updateRememberDevice(event: Event): void { this.rememberDevice.set((event.target as HTMLInputElement).checked); }
  protected chooseVerificationMethod(method: 'postcode' | 'otp'): void {
    this.verificationMethod.set(method); this.error.set('');
    if (method === 'otp' && !this.challenge()?.resendAvailableAt) void this.sendOtp();
  }

  protected updateAcceptanceName(event: Event): void {
    this.acceptanceName.set((event.target as HTMLInputElement).value);
  }

  protected updateAcceptanceEmail(event: Event): void {
    this.acceptanceEmail.set((event.target as HTMLInputElement).value);
  }

  protected toggleAcceptanceConfirmation(confirmation: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.acceptanceConfirmations.update((items) => checked ? [...items, confirmation] : items.filter((item) => item !== confirmation));
  }

  protected markAcceptanceSectionOpened(sectionId: string, event: Event): void {
    const details = event.target as HTMLDetailsElement;
    if (!details.open) return;
    requestAnimationFrame(() => {
      const body = details.querySelector<HTMLElement>('.vt-read__body');
      if (body && body.scrollHeight <= body.clientHeight + 2) this.markAcceptanceSectionRead(sectionId);
    });
  }

  protected checkAcceptanceSectionScroll(sectionId: string, event: Event): void {
    const body = event.target as HTMLElement;
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) this.markAcceptanceSectionRead(sectionId);
  }

  private markAcceptanceSectionRead(sectionId: string): void {
    this.acceptanceSectionsOpened.update((items) => items.includes(sectionId) ? items : [...items, sectionId]);
  }

  protected async acceptQuotation(event: Event): Promise<void> {
    event.preventDefault();
    const currentSession = this.session();
    const currentTrip = this.trip();
    if (!currentSession || !currentTrip?.quotation.canAccept || !this.online()) return;
    this.submitting.set(true);
    this.error.set('');
    try {
      const result = await this.api.acceptQuotation({
        name: this.acceptanceName().trim(),
        email: this.acceptanceEmail().trim(),
        agreed: true,
        confirmations: this.acceptanceConfirmations(),
      }, currentSession.accessToken);
      this.acceptanceComplete.set(true);
      this.acceptanceNotice.set(result.notifications.customer === 'sent' ? 'A confirmation email has been sent to you.' : result.notifications.customer === 'local_preview' ? 'Email delivery is in local preview mode.' : 'Your acceptance was recorded, but the confirmation email could not be sent.');
      this.trip.update((trip) => trip ? {
        ...trip,
        quotation: { ...trip.quotation, canAccept: false },
        capabilities: { ...trip.capabilities, acceptQuotation: false },
      } : trip);
      await this.refreshTripAfterWrite();
      if (result.paymentUrl) {
        this.paymentPaidBefore = currentTrip.payments?.paid ?? 0;
        this.paymentAwaitingReturn = true;
        this.paymentOpenedAt = Date.now();
        window.open(result.paymentUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      this.error.set(this.apiError(error, 'We could not record your acceptance. Please try again or contact your travel agent.'));
    } finally {
      this.submitting.set(false);
    }
  }

  protected updateMessageTopic(event: Event): void {
    this.messageTopic.set((event.target as HTMLSelectElement).value as CustomerMessageTopic);
  }

  protected updateCustomerMessage(event: Event): void {
    this.customerMessage.set((event.target as HTMLTextAreaElement).value);
  }

  protected async sendCustomerMessage(event: Event): Promise<void> {
    event.preventDefault();
    const currentSession = this.session();
    if (!currentSession || this.messageSent() || this.submitting() || !this.online()) return;
    this.submitting.set(true);
    this.error.set('');
    try {
      await this.api.sendMessage({ topic: this.messageTopic(), message: this.customerMessage().trim() }, currentSession.accessToken);
      this.messageSent.set(true);
      await this.refreshTripAfterWrite();
    } catch (error) {
      this.error.set(this.apiError(error, 'We could not send your message. Please try again or contact your travel agent directly.'));
    } finally {
      this.submitting.set(false);
    }
  }

  protected writeAnotherMessage(): void {
    this.customerMessage.set('');
    this.messageSent.set(false);
    this.error.set('');
  }

  protected async openPayment(paymentId: string): Promise<void> {
    const currentSession = this.session();
    const payments = this.trip()?.payments;
    if (!currentSession || !payments || this.openingPaymentId() || !this.online()) return;
    this.openingPaymentId.set(paymentId);
    this.paymentReturnState.set('idle');
    this.error.set('');
    try {
      const link = await this.api.paymentLink(paymentId, currentSession.accessToken);
      this.paymentPaidBefore = payments.paid;
      this.paymentIdAwaiting = paymentId;
      this.paymentAwaitingReturn = true;
      this.paymentOpenedAt = Date.now();
      window.open(link.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      this.error.set(this.apiError(error, 'This payment link is no longer available. Refresh the trip and try again.'));
      this.paymentReturnState.set('error');
    } finally {
      this.openingPaymentId.set(null);
    }
  }

  protected async shareWithTraveller(): Promise<void> {
    const currentSession = this.session();
    const currentTrip = this.trip();
    if (!currentSession || !currentTrip?.capabilities.shareWithTraveller || !this.online() || this.sharing()) return;
    this.sharing.set(true);
    this.shareResult.set('');
    this.error.set('');
    try {
      const link = await this.api.fellowTravellerLink(currentSession.accessToken);
      const text = `View ${currentTrip.summary.name} in Vision Trips. This restricted link expires ${link.expiresAt.slice(0, 10)}.`;
      try {
        await Share.share({ title: currentTrip.summary.name, text, url: link.url, dialogTitle: 'Share trip' });
        this.shareResult.set('The restricted trip link is ready to share.');
      } catch {
        await navigator.clipboard.writeText(link.url);
        this.shareResult.set('Restricted trip link copied.');
      }
    } catch (error) {
      this.error.set(this.apiError(error, 'We could not create a sharing link. Please try again.'));
    } finally {
      this.sharing.set(false);
    }
  }

  private async openSharedLinkFromLocation(): Promise<void> {
    const match = window.location.pathname.match(/\/trip\/([^/]+)/);
    if (!match?.[1] || this.trip()) return;
    this.submitting.set(true);
    this.error.set('');
    try {
      const response = await this.api.exchangeLink(match[1], await this.savedTrips.deviceTrust());
      if (response.status === 'authorized') await this.acceptAuthorized(response);
      else this.setChallenge(response.challenge);
    } catch (error) {
      this.error.set(this.apiError(error, 'This shared trip link is invalid or has expired.'));
    } finally {
      this.submitting.set(false);
    }
  }

  private async checkPaymentReturn(): Promise<void> {
    if (!this.paymentAwaitingReturn || Date.now() - this.paymentOpenedAt < 1_000) return;
    const currentSession = this.session();
    if (!currentSession) return;
    this.paymentAwaitingReturn = false;
    this.paymentReturnState.set('checking');
    try {
      const snapshot = await this.api.refreshTrip(currentSession.accessToken);
      const paidNow = snapshot.payments?.paid ?? 0;
      const itemNow = snapshot.payments?.items.find((item) => item.id === this.paymentIdAwaiting);
      this.trip.set(snapshot);
      await this.refreshDocumentStatuses(snapshot);
      this.storedSecurely.set(await this.savedTrips.save(snapshot, currentSession));
      this.paymentReturnState.set(paidNow > this.paymentPaidBefore || itemNow?.status === 'paid' ? 'updated' : 'unchanged');
    } catch {
      this.paymentReturnState.set('error');
    } finally {
      this.paymentIdAwaiting = null;
    }
  }

  private async refreshTripAfterWrite(): Promise<void> {
    const currentSession = this.session();
    if (!currentSession) return;
    try {
      const snapshot = await this.api.refreshTrip(currentSession.accessToken);
      this.trip.set(snapshot);
      await this.refreshDocumentStatuses(snapshot);
      this.storedSecurely.set(await this.savedTrips.save(snapshot, currentSession));
    } catch {
      // The write already succeeded. Keep the optimistic state and refresh next time the trip opens.
    }
  }

  protected async refreshCurrentTrip(showError = true): Promise<void> {
    const currentSession = this.session();
    if (!currentSession || this.refreshing()) return;
    if (!this.online()) {
      this.markFreshness('offline');
      if (showError) this.error.set('You are offline. Your last saved trip is still available.');
      return;
    }
    this.refreshing.set(true);
    if (showError) this.error.set('');
    try {
      let activeSession = currentSession;
      let snapshot: TripSnapshot;
      try {
        snapshot = await this.api.refreshTrip(activeSession.accessToken);
      } catch (error) {
        if (!(error instanceof HttpErrorResponse) || error.status !== 401) throw error;
        activeSession = await this.api.refreshSession(activeSession.refreshToken);
        this.session.set(activeSession);
        snapshot = await this.api.refreshTrip(activeSession.accessToken);
      }
      this.trip.set(snapshot);
      await this.refreshDocumentStatuses(snapshot);
      this.storedSecurely.set(await this.savedTrips.save(snapshot, activeSession));
    } catch (error) {
      this.markFreshness(this.online() ? 'stale' : 'offline');
      if (showError) this.error.set(this.apiError(error, 'We could not refresh this trip. Your saved copy is still available.'));
    } finally {
      this.refreshing.set(false);
    }
  }

  private async initializeOfflineState(): Promise<void> {
    const status = await Network.getStatus();
    this.online.set(status.connected);
    this.networkListener = await Network.addListener('networkStatusChange', ({ connected }) => {
      this.online.set(connected);
      if (!connected) this.markFreshness('offline');
      else if (this.trip()) void this.refreshCurrentTrip(false);
    });
    if (!Capacitor.isNativePlatform() || this.trip()) return;
    const saved = (await this.savedTrips.all()).sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
    if (!saved || this.trip()) return;
    this.session.set(saved.session);
    const offlineSnapshot = { ...saved.snapshot, freshness: { ...saved.snapshot.freshness, status: status.connected && !isSnapshotStale(saved.snapshot) ? 'fresh' as const : status.connected ? 'stale' as const : 'offline' as const } };
    this.trip.set(offlineSnapshot);
    await this.refreshDocumentStatuses(offlineSnapshot);
    this.storedSecurely.set(true);
    if (status.connected) await this.refreshCurrentTrip(false);
  }

  private markFreshness(status: 'stale' | 'offline'): void {
    this.trip.update((trip) => trip ? { ...trip, freshness: { ...trip.freshness, status } } : trip);
  }

  protected async verifyPostcode(event: Event): Promise<void> {
    event.preventDefault();
    const challenge = this.challenge();
    if (!challenge || !this.postcode().trim()) return;
    this.submitting.set(true);
    this.error.set('');
    try {
      const response = await this.api.verifyPostcode(challenge.exchangeId, this.postcode().trim(), this.rememberDevice());
      if (response.status === 'authorized') await this.acceptAuthorized(response);
    } catch {
      this.error.set('That postcode did not match the booking. Please check it and try again.');
    } finally {
      this.submitting.set(false);
    }
  }

  protected async sendOtp(): Promise<void> {
    const challenge = this.challenge();
    if (!challenge || this.resendSeconds() > 0 || this.submitting()) return;
    this.submitting.set(true); this.error.set('');
    try { this.setChallenge(await this.api.sendOtp(challenge.exchangeId)); }
    catch (error) { this.error.set(this.apiError(error, 'We could not send a code. Please wait and try again.')); }
    finally { this.submitting.set(false); }
  }

  protected async verifyOtp(event: Event): Promise<void> {
    event.preventDefault(); const challenge = this.challenge();
    if (!challenge || this.otpCode().length !== 6) return;
    this.submitting.set(true); this.error.set('');
    try { const response = await this.api.verifyOtp(challenge.exchangeId, this.otpCode(), this.rememberDevice()); if (response.status === 'authorized') await this.acceptAuthorized(response); }
    catch (error) { this.error.set(this.apiError(error, 'That code was not accepted. Check it and try again.')); }
    finally { this.submitting.set(false); }
  }

  private setChallenge(challenge: LinkExchangeChallenge): void {
    this.challenge.set(challenge);
    this.verificationMethod.set(challenge.methods.includes('otp') && !challenge.methods.includes('postcode') ? 'otp' : 'postcode');
    this.startResendCountdown(challenge.resendAvailableAt);
  }

  private startResendCountdown(availableAt: string | null): void {
    if (this.resendTimer) clearInterval(this.resendTimer);
    const update = () => this.resendSeconds.set(availableAt ? Math.max(0, Math.ceil((new Date(availableAt).getTime() - Date.now()) / 1000)) : 0);
    update(); this.resendTimer = setInterval(update, 1000);
  }

  private async acceptAuthorized(response: Extract<LinkExchangeResponse, { status: 'authorized' }>): Promise<void> {
    this.trip.set(response.snapshot);
    await this.refreshDocumentStatuses(response.snapshot);
    this.session.set(response.session);
    this.challenge.set(null);
    this.activeView.set('home');
    this.storedSecurely.set(await this.savedTrips.save(response.snapshot, response.session));
    if (response.trustedDeviceToken) await this.savedTrips.saveDeviceTrust(response.trustedDeviceToken);
  }

  protected selectView(view: AppView): void {
    this.activeView.set(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected openAnotherTrip(): void {
    this.trip.set(null);
    this.session.set(null);
    this.activeView.set('home');
    this.acceptanceComplete.set(false);
    this.acceptanceConfirmations.set([]);
    this.acceptanceSectionsOpened.set([]);
    this.acceptanceNotice.set('');
    this.customerMessage.set('');
    this.messageSent.set(false);
    this.paymentAwaitingReturn = false;
    this.paymentReturnState.set('idle');
    this.openingPaymentId.set(null);
    this.shareResult.set('');
    this.documentStatuses.set({});
  }

  protected async downloadCalendar(): Promise<void> {
    const session = this.session();
    const trip = this.trip();
    if (!session || !trip) return;
    this.error.set('');
    try {
      const blob = await this.api.downloadCalendar(session.accessToken);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${trip.summary.reference.replace(/[^A-Za-z0-9_-]+/g, '-')}-itinerary.ics`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.error.set(this.apiError(error, 'We could not create the calendar file. Please try again.'));
    }
  }

  protected async downloadDocument(value: TripDocument | string): Promise<void> {
    const session = this.session();
    const trip = this.trip();
    if (!session || !trip) return;
    const document = typeof value === 'string' ? trip.documents.find((item) => item.downloadAction === value) : value;
    if (!document?.downloadAction) return;
    this.error.set('');
    this.downloadingDocumentId.set(document.id);
    try {
      if (this.documentStatuses()[document.id] === 'saved') {
        const uri = await this.documentWallet.uri(trip.tripId, document.id);
        if (uri) { await Share.share({ title: document.title, files: [uri], dialogTitle: 'Open or share document' }); return; }
      }
      if (!this.online()) throw new Error('offline');
      const blob = await this.api.downloadDocument(document.downloadAction, session.accessToken);
      if (await this.documentWallet.save(trip.tripId, document, blob)) {
        await this.refreshDocumentStatuses(trip);
        const uri = await this.documentWallet.uri(trip.tripId, document.id);
        if (uri) await Share.share({ title: document.title, files: [uri], dialogTitle: 'Document saved offline' });
      } else {
        this.downloadBlob(blob, `${trip.summary.reference.replace(/[^A-Za-z0-9_-]+/g, '-')}-${document.title.replace(/[^A-Za-z0-9_-]+/g, '-')}${fileExtension(blob.type)}`);
      }
    } catch (error) {
      this.error.set(this.online() ? this.apiError(error, 'We could not create that document. Please try again.') : 'This document has not been saved for offline use yet. Connect to download it.');
    } finally {
      this.downloadingDocumentId.set(null);
    }
  }

  private async refreshDocumentStatuses(snapshot: TripSnapshot): Promise<void> {
    this.documentStatuses.set(await this.documentWallet.statuses(snapshot.tripId, snapshot.documents));
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private apiError(error: unknown, fallback: string): string {
    if (!(error instanceof HttpErrorResponse)) return fallback;
    if (error.status === 0) return 'The local API is not reachable. Make sure npm run start:api is running on port 3000.';
    const message = error.error?.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (Array.isArray(message)) return message.filter((item): item is string => typeof item === 'string').join(' ');
    return fallback;
  }
}

function isSnapshotStale(snapshot: TripSnapshot): boolean {
  return !snapshot.freshness.nextRefreshAfter || Date.parse(snapshot.freshness.nextRefreshAfter) <= Date.now();
}

function fileExtension(mimeType: string): string { return mimeType.includes('pdf') ? '.pdf' : mimeType.includes('png') ? '.png' : mimeType.includes('jpeg') ? '.jpg' : '.bin'; }
