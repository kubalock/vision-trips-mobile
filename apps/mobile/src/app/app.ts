import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { Share } from '@capacitor/share';
import type { CustomerMessageTopic, ExternalTripContent, LinkExchangeChallenge, LinkExchangeResponse, MobileSession, TripDocument, TripSnapshot } from '@vision-trips/contracts';
import { VisionApiService } from './core/api/vision-api.service';
import { SavedTripsStore, type SavedTrip } from './core/storage/saved-trips.store';
import { groupSavedTrips } from './core/storage/trip-library';
import { CustomerNotificationsStore, type CustomerNotification } from './core/storage/customer-notifications.store';
import { DocumentWalletStore, type WalletStatus } from './core/storage/document-wallet.store';
import { DocumentsSection } from './features/trip/documents-section';
import { DestinationsSection } from './features/trip/destinations-section';
import { CommunicationsSection } from './features/trip/communications-section';
import { ItinerarySection } from './features/trip/itinerary-section';
import { ExtrasSection } from './features/trip/extras-section';
import { PaymentsSection } from './features/trip/payments-section';
import { ExternalContentSection } from './features/trip/external-content-section';

type AppView = 'home' | 'itinerary' | 'payments' | 'documents' | 'help';
type TripRefreshState = 'idle' | 'refreshing' | 'fresh' | 'stale' | 'offline' | 'error';

@Component({
  selector: 'app-root',
  imports: [CommunicationsSection, DestinationsSection, DocumentsSection, ExtrasSection, ExternalContentSection, ItinerarySection, PaymentsSection],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  private readonly api = inject(VisionApiService);
  private readonly savedTrips = inject(SavedTripsStore);
  private readonly documentWallet = inject(DocumentWalletStore);
  private readonly customerNotifications = inject(CustomerNotificationsStore);
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
  protected readonly savedTripList = signal<SavedTrip[]>([]);
  protected readonly showTripLibrary = signal(false);
  protected readonly expiredTripsRemoved = signal(0);
  protected readonly tripRefreshStates = signal<Record<string, TripRefreshState>>({});
  protected readonly tripGroups = computed(() => groupSavedTrips(this.savedTripList()));
  protected readonly notifications = signal<CustomerNotification[]>([]);
  protected readonly showNotifications = signal(false);
  protected readonly deviceNotificationsEnabled = signal(false);
  protected readonly unreadNotifications = computed(() => this.notifications().filter((notification) => !notification.readAt).length);
  protected readonly externalContent = signal<ExternalTripContent | null>(null);
  protected readonly externalContentLoading = signal(false);
  protected readonly externalContentFailed = signal(false);
  protected readonly displayedDestinations = computed(() => this.externalContent()?.destinations ?? this.trip()?.destinations ?? []);
  private readonly session = signal<MobileSession | null>(null);
  private paymentAwaitingReturn = false;
  private paymentOpenedAt = 0;
  private paymentPaidBefore = 0;
  private paymentIdAwaiting: string | null = null;
  private resumeListener: PluginListenerHandle | null = null;
  private networkListener: PluginListenerHandle | null = null;
  private resendTimer: ReturnType<typeof setInterval> | null = null;
  private externalContentTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly canContinue = computed(() => /^app[A-Za-z0-9]{14}$/.test(this.baseId().trim()) && /^rec[A-Za-z0-9]{14}$/.test(this.recordId().trim()) && !this.submitting());

  ngOnInit(): void {
    document.body.classList.add('vt');
    this.deviceNotificationsEnabled.set(this.customerNotifications.deviceEnabled());
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
    if (this.externalContentTimer) clearTimeout(this.externalContentTimer);
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
      await this.customerNotifications.quoteAccepted(currentTrip);
      this.loadCustomerNotifications(currentTrip.tripId);
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

  protected async openCustomPayment(amount: number): Promise<void> {
    const currentSession = this.session(); const payments = this.trip()?.payments;
    if (!currentSession || !payments?.customPayments.enabled || this.openingPaymentId() || !this.online()) return;
    this.openingPaymentId.set('custom'); this.paymentReturnState.set('idle'); this.error.set('');
    try {
      const link = await this.api.customPaymentLink(amount, currentSession.accessToken);
      this.paymentPaidBefore = payments.paid; this.paymentIdAwaiting = null; this.paymentAwaitingReturn = true; this.paymentOpenedAt = Date.now();
      window.open(link.url, '_blank', 'noopener,noreferrer');
    } catch (error) { this.error.set(this.apiError(error, 'We could not create that payment link. Check the amount and try again.')); this.paymentReturnState.set('error'); }
    finally { this.openingPaymentId.set(null); }
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
      let latest: TripSnapshot | null = null;
      let reconciled = false;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        if (attempt > 0) await delay(2_000);
        latest = await this.api.refreshTrip(currentSession.accessToken);
        const paidNow = latest.payments?.paid ?? 0;
        const itemNow = latest.payments?.items.find((item) => item.id === this.paymentIdAwaiting);
        reconciled = paidNow > this.paymentPaidBefore || itemNow?.status === 'paid';
        if (reconciled) break;
      }
      if (latest) {
        const previous = this.trip();
        this.trip.set(latest);
        await this.syncCustomerNotifications(previous, latest);
        void this.loadExternalContent(false);
        await this.refreshDocumentStatuses(latest);
        this.storedSecurely.set(await this.savedTrips.save(latest, currentSession));
        await this.reloadSavedTrips();
      }
      this.paymentReturnState.set(reconciled ? 'updated' : 'unchanged');
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
      const previous = this.trip();
      this.trip.set(snapshot);
      await this.syncCustomerNotifications(previous, snapshot);
      void this.loadExternalContent(false);
      await this.refreshDocumentStatuses(snapshot);
      this.storedSecurely.set(await this.savedTrips.save(snapshot, currentSession));
      await this.reloadSavedTrips();
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
    const tripId = this.trip()?.tripId;
    if (tripId) this.setTripRefreshState(tripId, 'refreshing');
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
      const previous = this.trip();
      this.trip.set(snapshot);
      await this.syncCustomerNotifications(previous, snapshot);
      void this.loadExternalContent(false);
      await this.refreshDocumentStatuses(snapshot);
      this.storedSecurely.set(await this.savedTrips.save(snapshot, activeSession));
      await this.reloadSavedTrips();
      this.setTripRefreshState(snapshot.tripId, 'fresh');
    } catch (error) {
      this.markFreshness(this.online() ? 'stale' : 'offline');
      if (tripId) this.setTripRefreshState(tripId, this.online() ? 'error' : 'offline');
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
    if (this.trip()) return;
    const beforePrune = (await this.savedTrips.all()).length;
    const saved = (await this.savedTrips.pruneExpired()).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    this.expiredTripsRemoved.set(Math.max(0, beforePrune - saved.length));
    this.setSavedTripList(saved, status.connected);
    if (!saved.length || this.trip()) return;
    if (saved.length > 1) {
      this.showTripLibrary.set(true);
      return;
    }
    await this.activateSavedTrip(saved[0], status.connected);
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
    await this.syncCustomerNotifications(null, response.snapshot);
    await this.refreshDocumentStatuses(response.snapshot);
    this.session.set(response.session);
    void this.loadExternalContent();
    this.challenge.set(null);
    this.showTripLibrary.set(false);
    this.activeView.set('home');
    this.storedSecurely.set(await this.savedTrips.save(response.snapshot, response.session));
    await this.reloadSavedTrips();
    if (response.trustedDeviceToken) await this.savedTrips.saveDeviceTrust(response.trustedDeviceToken);
  }

  protected selectView(view: AppView): void {
    this.activeView.set(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected openAnotherTrip(): void {
    this.clearOpenTrip();
    this.showTripLibrary.set(this.savedTripList().length > 0);
  }

  protected addAnotherTrip(): void {
    this.clearOpenTrip();
    this.showTripLibrary.set(false);
    this.baseId.set('');
    this.recordId.set('');
    this.error.set('');
  }

  protected async openSavedTrip(saved: SavedTrip): Promise<void> {
    this.showTripLibrary.set(false);
    await this.activateSavedTrip(saved, this.online());
  }

  protected async refreshSavedTrip(saved: SavedTrip, event?: Event): Promise<void> {
    event?.stopPropagation();
    const tripId = saved.snapshot.tripId;
    if (!this.online()) {
      this.setTripRefreshState(tripId, 'offline');
      return;
    }
    if (this.tripRefreshStates()[tripId] === 'refreshing') return;
    this.setTripRefreshState(tripId, 'refreshing');
    try {
      let session = saved.session;
      let snapshot: TripSnapshot;
      try {
        snapshot = await this.api.refreshTrip(session.accessToken);
      } catch (error) {
        if (!(error instanceof HttpErrorResponse) || error.status !== 401) throw error;
        session = await this.api.refreshSession(session.refreshToken);
        snapshot = await this.api.refreshTrip(session.accessToken);
      }
      await this.savedTrips.save(snapshot, session);
      await this.customerNotifications.sync(saved.snapshot, snapshot);
      await this.reloadSavedTrips();
      this.setTripRefreshState(tripId, 'fresh');
      if (this.trip()?.tripId === tripId) {
        this.session.set(session);
        this.trip.set(snapshot);
        this.loadCustomerNotifications(tripId);
        void this.loadExternalContent(false);
        await this.refreshDocumentStatuses(snapshot);
      }
    } catch {
      this.setTripRefreshState(tripId, 'error');
    }
  }

  protected async removeSavedTrip(saved: SavedTrip, event?: Event): Promise<void> {
    event?.stopPropagation();
    if (!window.confirm(`Remove ${saved.snapshot.summary.name} from this device?`)) return;
    await this.savedTrips.remove(saved.snapshot.tripId);
    this.customerNotifications.clear(saved.snapshot.tripId);
    this.savedTripList.update((trips) => trips.filter((trip) => trip.snapshot.tripId !== saved.snapshot.tripId));
    this.tripRefreshStates.update((states) => {
      const next = { ...states };
      delete next[saved.snapshot.tripId];
      return next;
    });
    if (this.trip()?.tripId === saved.snapshot.tripId) this.clearOpenTrip();
    if (!this.savedTripList().length) this.showTripLibrary.set(false);
  }

  protected refreshStateLabel(saved: SavedTrip): string {
    const state = this.tripRefreshStates()[saved.snapshot.tripId] ?? 'idle';
    if (state === 'refreshing') return 'Refreshing…';
    if (state === 'fresh') return 'Up to date';
    if (state === 'offline') return 'Saved offline';
    if (state === 'error') return 'Refresh failed';
    if (state === 'stale') return 'May be out of date';
    return `Saved ${saved.savedAt.slice(0, 10)}`;
  }

  private clearOpenTrip(): void {
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
    this.externalContent.set(null);
    this.externalContentLoading.set(false);
    this.externalContentFailed.set(false);
    if (this.externalContentTimer) clearTimeout(this.externalContentTimer);
    this.notifications.set([]);
    this.showNotifications.set(false);
  }

  private async activateSavedTrip(saved: SavedTrip, refresh: boolean): Promise<void> {
    this.session.set(saved.session);
    const status = refresh && !isSnapshotStale(saved.snapshot) ? 'fresh' as const : refresh ? 'stale' as const : 'offline' as const;
    const snapshot = { ...saved.snapshot, freshness: { ...saved.snapshot.freshness, status } };
    this.trip.set(snapshot);
    await this.syncCustomerNotifications(null, snapshot);
    if (refresh) void this.loadExternalContent();
    this.activeView.set('home');
    this.storedSecurely.set(true);
    await this.refreshDocumentStatuses(snapshot);
    if (refresh) await this.refreshCurrentTrip(false);
  }

  private async reloadSavedTrips(): Promise<void> {
    this.setSavedTripList((await this.savedTrips.pruneExpired()).sort((a, b) => b.savedAt.localeCompare(a.savedAt)), this.online());
  }

  private setSavedTripList(saved: SavedTrip[], connected: boolean): void {
    this.savedTripList.set(saved);
    this.tripRefreshStates.update((states) => Object.fromEntries(saved.map((trip) => [
      trip.snapshot.tripId,
      states[trip.snapshot.tripId] === 'refreshing' ? 'refreshing' : connected ? (isSnapshotStale(trip.snapshot) ? 'stale' : 'fresh') : 'offline',
    ])));
  }

  private setTripRefreshState(tripId: string, state: TripRefreshState): void {
    this.tripRefreshStates.update((states) => ({ ...states, [tripId]: state }));
  }

  protected toggleNotifications(): void {
    const tripId = this.trip()?.tripId;
    if (!tripId) return;
    const opening = !this.showNotifications();
    this.showNotifications.set(opening);
    if (opening) {
      this.customerNotifications.markAllRead(tripId);
      this.loadCustomerNotifications(tripId);
    }
  }

  protected async toggleDeviceNotifications(event: Event): Promise<void> {
    const requested = (event.target as HTMLInputElement).checked;
    const enabled = await this.customerNotifications.setDeviceEnabled(requested);
    this.deviceNotificationsEnabled.set(enabled);
  }

  private async syncCustomerNotifications(previous: TripSnapshot | null, snapshot: TripSnapshot): Promise<void> {
    await this.customerNotifications.sync(previous, snapshot);
    this.loadCustomerNotifications(snapshot.tripId);
  }

  private loadCustomerNotifications(tripId: string): void {
    this.notifications.set(this.customerNotifications.list(tripId));
  }

  protected async loadExternalContent(showLoading = true): Promise<void> {
    const currentSession = this.session();
    if (!currentSession || !this.online() || this.externalContentLoading()) return;
    if (this.externalContentTimer) clearTimeout(this.externalContentTimer);
    this.externalContentLoading.set(showLoading && !this.externalContent());
    this.externalContentFailed.set(false);
    try {
      let session = currentSession;
      let content: ExternalTripContent;
      try { content = await this.api.externalContent(session.accessToken); }
      catch (error) {
        if (!(error instanceof HttpErrorResponse) || error.status !== 401) throw error;
        session = await this.api.refreshSession(session.refreshToken);
        this.session.set(session);
        content = await this.api.externalContent(session.accessToken);
      }
      this.externalContent.set(content);
      const pending = content.providers.ai.state === 'pending';
      const delayMs = pending ? 5_000 : Math.max(60, content.refreshAfterSeconds) * 1_000;
      this.externalContentTimer = setTimeout(() => { if (this.trip() && this.online()) void this.loadExternalContent(false); }, delayMs);
    } catch {
      this.externalContentFailed.set(true);
      this.externalContentTimer = setTimeout(() => { if (this.trip() && this.online()) void this.loadExternalContent(false); }, 60_000);
    } finally { this.externalContentLoading.set(false); }
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
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
