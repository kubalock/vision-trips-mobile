import { Component, HostListener, OnDestroy, OnInit, computed, effect, inject, isDevMode, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Network } from '@capacitor/network';
import type { CustomerAccount, CustomerEngagementEvent, CustomerMessageTopic, CustomerPreferences, ExternalTripContent, LinkExchangeChallenge, LinkExchangeResponse, MobileSession, PaymentStatusResponse, RelatedQuotationSummary, TripDocument, TripSnapshot, TripStage } from '@vision-trips/contracts';
import { VisionApiService } from './core/api/vision-api.service';
import { SavedTripsStore, type SavedTrip } from './core/storage/saved-trips.store';
import { BrandAssetsStore } from './core/storage/brand-assets.store';
import { groupSavedTrips } from './core/storage/trip-library';
import { CustomerNotificationsStore, type CustomerNotification } from './core/storage/customer-notifications.store';
import { DocumentWalletStore, type WalletStatus } from './core/storage/document-wallet.store';
import { ExternalPages, type PendingExternalPage } from './core/platform/external-pages';
import { ShareSheet } from './core/platform/share-sheet';
import { SessionManager } from './core/session/session-manager';
import { Directory, Filesystem, Encoding } from '@capacitor/filesystem';
import { DocumentsSection } from './features/trip/documents-section';
import { DestinationsSection } from './features/trip/destinations-section';
import { CommunicationsSection } from './features/trip/communications-section';
import { ItinerarySection } from './features/trip/itinerary-section';
import { ExtrasSection } from './features/trip/extras-section';
import { PaymentsSection } from './features/trip/payments-section';
import { ExternalContentSection } from './features/trip/external-content-section';
import { StageExperienceSection } from './features/trip/stage-experience-section';
import { BookingJourneySection } from './features/trip/booking-journey-section';
import { CustomerAccountSection } from './features/account/customer-account-section';
import { BrandSupportSection } from './features/trip/brand-support-section';
import { VtIcon, type VtIconName } from './shared/lucide-icon';
import { brandPalette } from './shared/brand-palette';
import { EuropeanDatePipe, formatEuropeanDate } from './shared/european-date.pipe';

type AppView = 'home' | 'itinerary' | 'payments' | 'documents' | 'help' | 'account';
type TripRefreshState = 'idle' | 'refreshing' | 'fresh' | 'stale' | 'offline' | 'error';
type Appearance = 'light' | 'dark';
type AppearancePreference = Appearance | 'system';

@Component({
  selector: 'app-root',
  imports: [BookingJourneySection, BrandSupportSection, CommunicationsSection, CustomerAccountSection, DestinationsSection, DocumentsSection, EuropeanDatePipe, ExtrasSection, ExternalContentSection, ItinerarySection, PaymentsSection, StageExperienceSection, VtIcon],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  private readonly api = inject(VisionApiService);
  private readonly savedTrips = inject(SavedTripsStore);
  private readonly brandAssets = inject(BrandAssetsStore);
  private readonly documentWallet = inject(DocumentWalletStore);
  private readonly customerNotifications = inject(CustomerNotificationsStore);
  private readonly externalPages = inject(ExternalPages);
  private readonly shareSheet = inject(ShareSheet);
  /** Set when the browser blocked a payment page; the template offers a direct link instead. */
  protected readonly blockedPageUrl = signal<string | null>(null);
  /** The Airtable-ID entry form is a local development tool; production builds only open trips from links. */
  protected readonly localPreviewEnabled = isDevMode();
  protected readonly baseId = signal('');
  protected readonly recordId = signal('');
  protected readonly submitting = signal(false);
  protected readonly error = signal('');
  protected readonly trip = signal<TripSnapshot | null>(null);
  protected readonly brandLogoUrl = signal<string | null>(null);
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
  protected readonly paymentStatus = computed<PaymentStatusView | null>(() => {
    switch (this.paymentReturnState()) {
      case 'checking': return { tone: 'info', icon: 'loader', title: 'Checking your payment', body: 'This usually takes less than a minute. You can keep using the app.', action: null };
      case 'updated': return { tone: 'ok', icon: 'check', title: 'Payment received', body: 'Thank you. Your balance has been updated.', action: null };
      case 'unchanged': return { tone: 'warn', icon: 'pound', title: 'Waiting for confirmation', body: 'Payments can take a few minutes to show here. We’ll check again when you come back to the app.', action: 'Check now' };
      case 'error': return { tone: 'warn', icon: 'alert', title: 'We couldn’t confirm your payment yet', body: 'If you’ve paid, there’s nothing more to do. It will appear here once it has been processed.', action: 'Check again' };
      default: return null;
    }
  });
  protected readonly online = signal(true);
  protected readonly refreshing = signal(false);
  protected readonly sharing = signal(false);
  protected readonly shareResult = signal('');
  /** Shown as selectable text when neither the share sheet nor the clipboard is available. */
  protected readonly shareFallbackUrl = signal<string | null>(null);
  protected readonly documentStatuses = signal<Record<string, WalletStatus>>({});
  protected readonly downloadingDocumentId = signal<string | null>(null);
  protected readonly savedTripList = signal<SavedTrip[]>([]);
  protected readonly showTripLibrary = signal(false);
  protected readonly expiredTripsRemoved = signal(0);
  protected readonly tripRefreshStates = signal<Record<string, TripRefreshState>>({});
  protected readonly tripGroups = computed(() => groupSavedTrips(this.savedTripList()));
  protected readonly displayedTrip = computed(() => this.showTripLibrary() ? null : this.trip());
  protected readonly notifications = signal<CustomerNotification[]>([]);
  protected readonly showNotifications = signal(false);
  protected readonly deviceNotificationsEnabled = signal(false);
  protected readonly unreadNotifications = computed(() => this.notifications().filter((notification) => !notification.readAt).length);
  protected readonly externalContent = signal<ExternalTripContent | null>(null);
  protected readonly externalContentLoading = signal(false);
  protected readonly externalContentFailed = signal(false);
  protected readonly displayedDestinations = computed(() => this.externalContent()?.destinations ?? this.trip()?.destinations ?? []);
  protected readonly relatedQuotations = signal<RelatedQuotationSummary[]>([]);
  protected readonly openingRelatedId = signal<string | null>(null);
  protected readonly customerAccount = signal<CustomerAccount | null>(null);
  protected readonly accountLoading = signal(false);
  protected readonly accountSaving = signal(false);
  protected readonly accountNotice = signal('');
  protected readonly openingAccountTripId = signal<string | null>(null);
  /** What the traveller chose; 'system' follows the device setting live. */
  protected readonly appearancePreference = signal<AppearancePreference>(initialAppearancePreference());
  private readonly systemPrefersDark = signal(prefersDark());
  protected readonly appearance = computed<Appearance>(() => {
    const preference = this.appearancePreference();
    return preference === 'system' ? (this.systemPrefersDark() ? 'dark' : 'light') : preference;
  });
  /** Brand accent tokens, adjusted so they stay readable on the current theme. */
  protected readonly brandStyle = computed<Record<string, string>>(() => {
    const theme = this.trip()?.brand?.theme;
    const palette = brandPalette(theme?.primaryColor, this.appearance());
    return {
      '--vt-accent': palette.accent, '--vt-accent-text': palette.accentText, '--vt-accent-text-dark': palette.accentText,
      '--accent-action': palette.action, '--accent-action-ink': palette.actionInk, '--accent-ink': palette.actionInk,
      '--tint': palette.tint, '--tint-2': palette.tint2, '--link': palette.accentText,
      '--vt-accent-2': theme?.secondaryColor || '#115e59', '--vt-wash': palette.accent,
      '--vt-hero-a': theme?.secondaryColor || '#134e4a', '--vt-hero-b': palette.accent,
    };
  });
  protected readonly appearanceOptions: ReadonlyArray<{ value: AppearancePreference; label: string; icon: VtIconName }> = [
    { value: 'system', label: 'Device', icon: 'device' },
    { value: 'light', label: 'Light', icon: 'sun' },
    { value: 'dark', label: 'Dark', icon: 'moon' },
  ];
  private readonly applyAppearanceEffect = effect(() => this.applyAppearance(this.appearance()));
  private readonly sessions = inject(SessionManager);
  private readonly session = this.sessions.session;
  private paymentAwaitingReturn = false;
  private paymentOpenedAt = 0;
  /** Paid total before the payment page opened; null when it wasn't known (then only the instalment's status counts). */
  private paymentPaidBefore: number | null = null;
  private paymentIdAwaiting: string | null = null;
  private resumeListener: PluginListenerHandle | null = null;
  private backButtonListener: PluginListenerHandle | null = null;
  private browserClosedListener: { remove: () => Promise<void> } | null = null;
  /** Bumped whenever a different trip is opened or the trip is closed; see beginTrip(). */
  private tripGeneration = 0;
  private readonly paymentPollDelaysMs: readonly number[] = PAYMENT_POLL_DELAYS_MS;
  private networkListener: PluginListenerHandle | null = null;
  private resendTimer: ReturnType<typeof setInterval> | null = null;
  private externalContentTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly canContinue = computed(() => /^app[A-Za-z0-9]{14}$/.test(this.baseId().trim()) && /^rec[A-Za-z0-9]{14}$/.test(this.recordId().trim()) && !this.submitting());

  constructor() {
    this.sessions.connect({
      tripIdFor: (refreshToken) => (this.session()?.refreshToken === refreshToken ? this.trip()?.tripId : undefined)
        ?? this.savedTripList().find((trip) => trip.session.refreshToken === refreshToken)?.snapshot.tripId,
      renewed: async ({ previousRefreshToken, session, fromServer }) => {
        const snapshot = this.trip();
        if (fromServer && snapshot && this.session()?.refreshToken === session.refreshToken) this.storedSecurely.set(await this.savedTrips.save(snapshot, session));
        // The old refresh token is now dead server-side; keep the in-memory library in step with storage.
        this.savedTripList.update((trips) => trips.map((trip) => trip.session.refreshToken === previousRefreshToken ? { ...trip, session } : trip));
      },
    });
  }

  ngOnInit(): void {
    document.body.classList.add('vt');
    if (typeof matchMedia === 'function') {
      const query = matchMedia('(prefers-color-scheme: dark)');
      query.addEventListener?.('change', (event) => this.systemPrefersDark.set(event.matches));
    }
    this.deviceNotificationsEnabled.set(this.customerNotifications.deviceEnabled());
    // Decide up front which wins at launch: a booking link in the URL beats re-opening the last saved trip.
    const sharedLinkToken = window.location.pathname.match(/\/trip\/([^/]+)/)?.[1] ?? null;
    if (sharedLinkToken) void this.openSharedLink(sharedLinkToken);
    void this.initializeOfflineState(!sharedLinkToken);
    if (Capacitor.isNativePlatform()) {
      void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) void this.checkPaymentReturn();
      }).then((listener) => { this.resumeListener = listener; });
      void this.externalPages.onClosed(() => void this.checkPaymentReturn()).then((listener) => { this.browserClosedListener = listener; });
      if (Capacitor.getPlatform() === 'android') {
        void CapacitorApp.addListener('backButton', () => this.handleAndroidBack()).then((listener) => {
          this.backButtonListener = listener;
        });
      }
    }
  }

  ngOnDestroy(): void {
    document.body.classList.remove('vt');
    void this.resumeListener?.remove();
    void this.backButtonListener?.remove();
    void this.browserClosedListener?.remove();
    void this.networkListener?.remove();
    if (this.resendTimer) clearInterval(this.resendTimer);
    if (this.externalContentTimer) clearTimeout(this.externalContentTimer);
    this.replaceBrandLogo(null);
  }

  @HostListener('window:focus')
  protected onWindowFocus(): void {
    void this.checkPaymentReturn();
  }

  @HostListener('document:click', ['$event'])
  protected recordClickedAction(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button, a') : null;
    if (!target || target.hasAttribute('disabled')) return;
    const label = engagementLabel(target);
    if (label) this.trackEngagement('action_clicked', label);
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
    const generation = this.tripGeneration;
    try {
      const result = await this.withSession(currentSession, (accessToken) => this.api.acceptQuotation({
        name: this.acceptanceName().trim(),
        email: this.acceptanceEmail().trim(),
        agreed: true,
        confirmations: this.acceptanceConfirmations(),
      }, accessToken));
      await this.customerNotifications.quoteAccepted(currentTrip);
      if (!this.isCurrentTrip(generation)) return; // Recorded; the traveller has moved on to another trip.
      this.acceptanceComplete.set(true);
      this.loadCustomerNotifications(currentTrip.tripId);
      this.acceptanceNotice.set(result.notifications.customer === 'sent' ? 'A confirmation email has been sent to you.' : result.notifications.customer === 'local_preview' ? 'Email delivery is in local preview mode.' : 'Your acceptance was recorded, but the confirmation email could not be sent.');
      this.trip.update((trip) => trip ? {
        ...trip,
        quotation: { ...trip.quotation, canAccept: false },
        capabilities: { ...trip.capabilities, acceptQuotation: false },
      } : trip);
      await this.refreshTripAfterWrite();
      if (result.paymentUrl) {
        this.paymentPaidBefore = currentTrip.payments?.paid ?? null;
        this.paymentIdAwaiting = null;
        this.paymentAwaitingReturn = true;
        this.paymentOpenedAt = Date.now();
        // Not reserved up front (acceptance may not return a payment link), so a blocked page falls back to a link.
        await this.openPaymentPage(result.paymentUrl, null);
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
      const generation = this.tripGeneration;
      await this.withSession(currentSession, (accessToken) => this.api.sendMessage({ topic: this.messageTopic(), message: this.customerMessage().trim() }, accessToken));
      if (!this.isCurrentTrip(generation)) return;
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
    const item = payments.items.find((payment) => payment.id === paymentId);
    if (item?.actionUrl) {
      // The booking already has a payment link: open it straight from the tap, no API or Airtable round trip.
      this.paymentReturnState.set('idle');
      this.error.set('');
      this.paymentPaidBefore = payments.paid;
      this.paymentIdAwaiting = paymentId;
      this.paymentAwaitingReturn = true;
      this.paymentOpenedAt = Date.now();
      await this.openPaymentPage(item.actionUrl, null);
      return;
    }
    const page = this.externalPages.reserve(); // Must happen during the tap, before any await.
    this.openingPaymentId.set(paymentId);
    this.paymentReturnState.set('idle');
    this.error.set('');
    try {
      const link = await this.withSession(currentSession, (accessToken) => this.api.paymentLink(paymentId, accessToken));
      this.paymentPaidBefore = payments.paid;
      this.paymentIdAwaiting = paymentId;
      this.paymentAwaitingReturn = true;
      this.paymentOpenedAt = Date.now();
      await this.openPaymentPage(link.url, page);
    } catch (error) {
      page.cancel();
      this.error.set(this.apiError(error, 'This payment link is no longer available. Refresh the trip and try again.'));
      this.paymentReturnState.set('error');
    } finally {
      this.openingPaymentId.set(null);
    }
  }

  protected async openCustomPayment(amount: number): Promise<void> {
    const currentSession = this.session(); const payments = this.trip()?.payments;
    if (!currentSession || !payments?.customPayments.enabled || this.openingPaymentId() || !this.online()) return;
    const page = this.externalPages.reserve(); // Must happen during the tap, before any await.
    this.openingPaymentId.set('custom'); this.paymentReturnState.set('idle'); this.error.set('');
    try {
      const link = await this.withSession(currentSession, (accessToken) => this.api.customPaymentLink(amount, accessToken));
      this.paymentPaidBefore = payments.paid; this.paymentIdAwaiting = null; this.paymentAwaitingReturn = true; this.paymentOpenedAt = Date.now();
      await this.openPaymentPage(link.url, page);
    } catch (error) { page.cancel(); this.error.set(this.apiError(error, 'We could not create that payment link. Check the amount and try again.')); this.paymentReturnState.set('error'); }
    finally { this.openingPaymentId.set(null); }
  }

  private async openPaymentPage(url: string, page: PendingExternalPage | null): Promise<void> {
    this.blockedPageUrl.set(null);
    const opened = page ? await page.open(url) : await this.externalPages.open(url);
    if (!opened) this.blockedPageUrl.set(url);
  }

  protected openBlockedPage(): void {
    // A real tap on the fallback link, so the browser allows the new tab; the anchor's own href does the navigation.
    this.blockedPageUrl.set(null);
  }

  protected async shareWithTraveller(): Promise<void> {
    const currentSession = this.session();
    const currentTrip = this.trip();
    if (!currentSession || !currentTrip?.capabilities.shareWithTraveller || !this.online() || this.sharing()) return;
    this.sharing.set(true);
    this.shareResult.set('');
    this.shareFallbackUrl.set(null);
    this.error.set('');
    try {
      const link = await this.withSession(currentSession, (accessToken) => this.api.fellowTravellerLink(accessToken));
      const text = `View ${currentTrip.summary.name} in Vision Trips. This restricted link expires ${formatEuropeanDate(link.expiresAt)}.`;
      if (await this.shareSheet.available()) {
        try {
          await this.shareSheet.share({ title: currentTrip.summary.name, text, url: link.url, dialogTitle: 'Share trip' });
          this.shareResult.set('Link shared. It works for seven days.');
          return;
        } catch (shareError) {
          if (isShareCancelled(shareError)) return; // The traveller changed their mind: do nothing, copy nothing.
        }
      }
      // No share sheet (most desktop browsers) or it failed: copy instead, and show the link if copying is blocked too.
      try {
        await navigator.clipboard.writeText(link.url);
        this.shareResult.set('Link copied. Paste it into a message to your fellow traveller.');
      } catch {
        this.shareFallbackUrl.set(link.url);
      }
    } catch (error) {
      this.error.set(this.apiError(error, 'We could not create a sharing link. Please try again.'));
    } finally {
      this.sharing.set(false);
    }
  }

  private async openSharedLink(linkToken: string): Promise<void> {
    // Keep the signed token out of the address bar and browser history once it has been read.
    try { window.history.replaceState(window.history.state, '', new URL(document.baseURI).pathname); } catch { /* Not fatal. */ }
    this.submitting.set(true);
    this.error.set('');
    try {
      const response = await this.api.exchangeLink(linkToken, await this.savedTrips.deviceTrusts());
      if (response.status === 'authorized') await this.acceptAuthorized(response);
      else this.setChallenge(response.challenge);
    } catch (error) {
      const linkRejected = error instanceof HttpErrorResponse && [400, 401, 403, 404, 410].includes(error.status);
      this.error.set(linkRejected ? 'This trip link has expired or is no longer valid. Ask your travel agent for a new one.' : this.apiError(error, 'We could not open that trip link. Please try again.'));
      // Don't strand someone on the entry screen when they already have trips saved on this device.
      if (!this.trip() && !this.challenge()) {
        if (!this.savedTripList().length) await this.reloadSavedTrips();
        if (this.savedTripList().length) this.showTripLibrary.set(true);
      }
    } finally {
      this.submitting.set(false);
    }
  }

  private async checkPaymentReturn(): Promise<void> {
    if (!this.paymentAwaitingReturn || Date.now() - this.paymentOpenedAt < 1_000) return;
    const currentSession = this.session();
    if (!currentSession) return;
    if (Date.now() - this.paymentOpenedAt > PAYMENT_RECHECK_WINDOW_MS) { this.paymentAwaitingReturn = false; this.paymentIdAwaiting = null; return; }
    const generation = this.tripGeneration;
    this.paymentAwaitingReturn = false;
    this.paymentReturnState.set('checking');
    let reconciled = false;
    try {
      // Poll the lightweight payment-status endpoint (2 Airtable reads) rather than reloading the whole trip (~20).
      // Mint reports to Airtable via a webhook, which can take a minute or more.
      for (const [attempt, waitMs] of this.paymentPollDelaysMs.entries()) {
        if (attempt > 0) await delay(waitMs);
        if (!this.isCurrentTrip(generation)) return; // Another trip was opened, or signed out, while waiting.
        const status = await this.withSession(this.session() ?? currentSession, (accessToken) => this.api.paymentStatus(accessToken));
        if (!this.isCurrentTrip(generation)) return;
        const itemNow = status.items.find((item) => item.id === this.paymentIdAwaiting);
        const before = this.paymentPaidBefore;
        reconciled = (before !== null && status.paid !== null && status.paid > before) || itemNow?.status === 'paid';
        if (reconciled) { this.applyPaymentStatus(status); break; }
      }
      // Confirmed: one full reload picks up receipts, documents and notifications that came with the payment.
      if (reconciled) await this.refreshTripAfterWrite();
      this.paymentReturnState.set(reconciled ? 'updated' : 'unchanged');
    } catch {
      if (this.isCurrentTrip(generation)) this.paymentReturnState.set('error');
    } finally {
      if (!this.isCurrentTrip(generation)) return;
      // Not confirmed yet: check again the next time the user comes back to the app, within the recheck window.
      if (!reconciled && this.session() && Date.now() - this.paymentOpenedAt <= PAYMENT_RECHECK_WINDOW_MS) this.paymentAwaitingReturn = true;
      else this.paymentIdAwaiting = null;
    }
  }

  /** A refresh that finished after the traveller switched trips: keep the saved copy current, don't show it. */
  private async storeBackgroundRefresh(snapshot: TripSnapshot, session: MobileSession): Promise<void> {
    await this.savedTrips.save(snapshot, session);
    await this.reloadSavedTrips();
  }

  /** Shows the confirmed payment straight away, even if the full trip reload that follows fails. */
  private applyPaymentStatus(status: PaymentStatusResponse): void {
    this.trip.update((trip) => {
      if (!trip?.payments || trip.tripId !== status.tripId) return trip;
      const byId = new Map(status.items.map((item) => [item.id, item]));
      return { ...trip, payments: {
        ...trip.payments, paid: status.paid, balance: status.balance, total: status.total,
        items: trip.payments.items.map((item) => {
          const latest = byId.get(item.id);
          return latest ? { ...item, status: latest.status, completedDate: latest.completedDate, canPay: item.canPay && latest.status !== 'paid' } : item;
        }),
      } };
    });
  }

  private async refreshTripAfterWrite(): Promise<void> {
    const generation = this.tripGeneration;
    const currentSession = this.session();
    if (!currentSession) return;
    try {
      const { result: snapshot, session: activeSession } = await this.sessions.runWithSession(currentSession, (accessToken) => this.api.refreshTrip(accessToken));
      if (!this.isCurrentTrip(generation)) { await this.storeBackgroundRefresh(snapshot, activeSession); return; }
      const previous = this.trip();
      this.trip.set(snapshot);
      await this.loadBrandLogo(snapshot, true);
      await this.syncCustomerNotifications(previous, snapshot);
      void this.loadExternalContent(false);
      await this.refreshDocumentStatuses(snapshot, generation);
      this.storedSecurely.set(await this.savedTrips.save(snapshot, this.session() ?? activeSession));
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
    const generation = this.tripGeneration;
    this.refreshing.set(true);
    const tripId = this.trip()?.tripId;
    if (tripId) this.setTripRefreshState(tripId, 'refreshing');
    if (showError) this.error.set('');
    try {
      const { result: snapshot, session: activeSession } = await this.sessions.runWithSession(currentSession, (accessToken) => this.api.refreshTrip(accessToken));
      if (!this.isCurrentTrip(generation)) { await this.storeBackgroundRefresh(snapshot, activeSession); return; }
      const previous = this.trip();
      this.trip.set(snapshot);
      await this.loadBrandLogo(snapshot, true);
      await this.syncCustomerNotifications(previous, snapshot);
      void this.loadExternalContent(false);
      await this.refreshDocumentStatuses(snapshot);
      this.storedSecurely.set(await this.savedTrips.save(snapshot, activeSession));
      await this.reloadSavedTrips();
      this.setTripRefreshState(snapshot.tripId, 'fresh');
    } catch (error) {
      if (tripId) this.setTripRefreshState(tripId, this.online() ? 'error' : 'offline');
      if (!this.isCurrentTrip(generation)) return;
      this.markFreshness(this.online() ? 'stale' : 'offline');
      if (showError) this.error.set(this.apiError(error, 'We could not refresh this trip. Your saved copy is still available.'));
    } finally {
      if (this.isCurrentTrip(generation)) this.refreshing.set(false);
    }
  }

  private async initializeOfflineState(activateSaved = true): Promise<void> {
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
    if (!activateSaved || !saved.length || this.trip() || this.challenge()) return;
    if (saved.length > 1) {
      await this.activateSavedTrip(saved[0], false);
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
    } catch (error) {
      this.error.set(this.apiError(error, 'That postcode didn’t match the booking. Please check it and try again.'));
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
    const generation = this.beginTrip();
    this.trip.set(response.snapshot);
    this.session.set(response.session);
    this.challenge.set(null);
    this.showTripLibrary.set(false);
    void this.loadExternalContent();
    void this.loadRelatedQuotations();
    await this.loadBrandLogo(response.snapshot, true);
    await this.syncCustomerNotifications(null, response.snapshot);
    await this.refreshDocumentStatuses(response.snapshot, generation);
    this.storedSecurely.set(await this.savedTrips.save(response.snapshot, response.session));
    await this.reloadSavedTrips();
    if (response.trustedDeviceToken) await this.savedTrips.saveDeviceTrust(response.trustedDeviceToken);
  }

  protected dismissPaymentStatus(): void {
    this.paymentReturnState.set('idle');
  }

  protected recheckPayment(): void {
    if (this.paymentReturnState() === 'checking') return;
    if (Date.now() - this.paymentOpenedAt <= PAYMENT_RECHECK_WINDOW_MS) {
      this.paymentAwaitingReturn = true;
      void this.checkPaymentReturn();
    } else {
      this.paymentReturnState.set('idle');
      void this.refreshCurrentTrip();
    }
  }

  protected dismissError(): void {
    this.error.set('');
  }

  protected selectView(view: AppView): void {
    this.error.set('');
    this.showTripLibrary.set(false);
    this.activeView.set(view);
    this.trackEngagement('section_opened', view);
    if (view === 'account') void this.loadCustomerAccount();
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    requestAnimationFrame(() => document.querySelector<HTMLElement>('#main-content')?.focus({ preventScroll: true }));
  }

  protected toggleAppearance(): void {
    this.setAppearancePreference(this.appearance() === 'dark' ? 'light' : 'dark');
  }

  protected setAppearancePreference(preference: AppearancePreference): void {
    this.appearancePreference.set(preference);
    try {
      if (preference === 'system') localStorage.removeItem('vision-trips:appearance');
      else localStorage.setItem('vision-trips:appearance', preference);
    } catch { /* Appearance still applies for this session. */ }
    this.applyAppearance(this.appearance());
  }

  protected stageLabel(stage: TripStage): string {
    if (stage === 'quote') return 'Quotation';
    if (stage === 'quote_expired') return 'Quote expired';
    if (stage === 'closed') return 'Closed';
    if (stage === 'cancelled') return 'Cancelled';
    if (stage === 'departure') return 'Departure day';
    if (stage === 'travelling') return 'Travelling';
    if (stage === 'returning') return 'Returning home';
    if (stage === 'home') return 'Welcome home';
    if (stage === 'past') return 'Past trip';
    return 'Confirmed';
  }

  private applyAppearance(appearance: Appearance): void {
    document.documentElement.dataset['theme'] = appearance;
    const color = appearance === 'dark' ? '#121415' : '#f4f4f1';
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => { meta.content = color; });
  }

  private handleAndroidBack(): void {
    if (this.showNotifications()) {
      this.showNotifications.set(false);
      return;
    }
    if (this.trip() && this.activeView() !== 'home') {
      this.selectView('home');
      return;
    }
    if (this.trip() && this.savedTripList().length) {
      this.openAnotherTrip();
      return;
    }
    void CapacitorApp.minimizeApp();
  }

  protected async saveCustomerPreferences(preferences: CustomerPreferences): Promise<void> {
    const currentSession = this.session(); if (!currentSession || this.accountSaving()) return;
    this.accountSaving.set(true); this.accountNotice.set('');
    const generation = this.tripGeneration;
    try { const result = await this.withSession(currentSession, (accessToken) => this.api.updateCustomerPreferences(preferences, accessToken)); if (!this.isCurrentTrip(generation)) return; this.customerAccount.update((account) => account ? { ...account, preferences: result.preferences } : account); this.accountNotice.set(`Saved across ${result.updatedRecords} customer ${result.updatedRecords === 1 ? 'record' : 'records'}.`); }
    catch (error) { this.error.set(this.apiError(error, 'We could not save your preferences. Please try again.')); }
    finally { if (this.isCurrentTrip(generation)) this.accountSaving.set(false); }
  }

  protected async openCustomerAccountTrip(accountTripId: string): Promise<void> {
    const currentSession = this.session(); if (!currentSession || this.openingAccountTripId()) return;
    this.openingAccountTripId.set(accountTripId);
    try { const response = await this.withSession(currentSession, (accessToken) => this.api.openCustomerAccountTrip(accountTripId, accessToken)); await this.acceptAuthorized({ status: 'authorized', exchangeId: 'account', expiresAt: response.session.refreshExpiresAt, snapshot: response.snapshot, session: response.session }); }
    catch (error) { this.error.set(this.apiError(error, 'We could not open that trip. Please refresh your account.')); }
    finally { this.openingAccountTripId.set(null); }
  }

  protected async signOutDevice(): Promise<void> {
    if (!window.confirm('Sign out and remove all locally saved trips from this device?')) return;
    const saved = await this.savedTrips.all();
    const refreshTokens = [...new Set([this.session()?.refreshToken, ...saved.map((trip) => trip.session.refreshToken)].filter((token): token is string => Boolean(token)))];
    await Promise.allSettled(refreshTokens.map((refreshToken) => this.api.revokeSession(refreshToken)));
    for (const trip of saved) { await this.savedTrips.remove(trip.snapshot.tripId); await this.brandAssets.remove(trip.snapshot.tripId); this.customerNotifications.clear(trip.snapshot.tripId); }
    await this.documentWallet.remove();
    await this.savedTrips.clearDeviceTrust();
    this.clearOpenTrip(); this.savedTripList.set([]); this.showTripLibrary.set(false); this.storedSecurely.set(false);
  }

  private async loadCustomerAccount(): Promise<void> {
    const generation = this.tripGeneration;
    const currentSession = this.session(); if (!currentSession || this.accountLoading() || this.trip()?.accessScope !== 'primary_customer') return;
    this.accountLoading.set(true); this.accountNotice.set(''); this.error.set('');
    try { const account = await this.withSession(currentSession, (accessToken) => this.api.customerAccount(accessToken)); if (this.isCurrentTrip(generation)) this.customerAccount.set(account); }
    catch (error) { if (this.isCurrentTrip(generation)) { this.customerAccount.set(null); this.error.set(this.apiError(error, 'We could not load your customer account.')); } }
    finally { if (this.isCurrentTrip(generation)) this.accountLoading.set(false); }
  }

  protected planNextTrip(): void {
    this.customerMessage.set('We are thinking about our next trip. Could you send us some ideas?');
    this.messageTopic.set('other');
    this.selectView('help');
  }

  protected enquireAboutExtra(message: string): void { this.customerMessage.set(message); this.messageTopic.set('itinerary'); this.messageSent.set(false); this.selectView('help'); }

  protected async openRelatedQuotation(comparisonId: string): Promise<void> {
    const currentSession = this.session(); if (!currentSession || this.openingRelatedId()) return;
    this.openingRelatedId.set(comparisonId); this.error.set('');
    try {
      const response = await this.withSession(currentSession, (accessToken) => this.api.openRelatedQuotation(comparisonId, accessToken));
      await this.acceptAuthorized({ status: 'authorized', exchangeId: 'related', expiresAt: response.session.refreshExpiresAt, snapshot: response.snapshot, session: response.session });
    } catch (error) { this.error.set(this.apiError(error, 'We could not open that quotation. Refresh and try again.')); }
    finally { this.openingRelatedId.set(null); }
  }

  private async loadRelatedQuotations(): Promise<void> {
    const generation = this.tripGeneration;
    const currentSession = this.session(); if (!currentSession || !this.online() || this.trip()?.accessScope !== 'primary_customer') { this.relatedQuotations.set([]); return; }
    let quotations: RelatedQuotationSummary[] = [];
    try { quotations = (await this.withSession(currentSession, (accessToken) => this.api.relatedQuotations(accessToken))).quotations; } catch { quotations = []; }
    if (this.isCurrentTrip(generation)) this.relatedQuotations.set(quotations);
  }

  protected openAnotherTrip(): void {
    this.showNotifications.set(false);
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
    this.error.set('');
    this.showTripLibrary.set(false);
    await this.activateSavedTrip(saved, this.online());
  }

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  protected hideBrokenTripImage(event: Event): void {
    (event.target as HTMLImageElement).hidden = true;
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
      const openSession = this.trip()?.tripId === tripId ? this.session() : null;
      const { result: snapshot, session } = await this.sessions.runWithSession(openSession ?? saved.session, (accessToken) => this.api.refreshTrip(accessToken));
      await this.savedTrips.save(snapshot, session);
      if (snapshot.brand.logoUrl) await this.brandAssets.cacheLogo(snapshot.tripId, snapshot.brand.logoUrl);
      else await this.brandAssets.remove(snapshot.tripId);
      await this.customerNotifications.sync(saved.snapshot, snapshot);
      await this.reloadSavedTrips();
      this.setTripRefreshState(tripId, 'fresh');
      if (this.trip()?.tripId === tripId) {
        this.session.set(session);
        this.trip.set(snapshot);
        await this.loadBrandLogo(snapshot, true);
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
    const openSession = this.trip()?.tripId === saved.snapshot.tripId ? this.session() : null;
    void this.api.revokeSession((openSession ?? saved.session).refreshToken).catch(() => undefined);
    await this.savedTrips.remove(saved.snapshot.tripId);
    await this.brandAssets.remove(saved.snapshot.tripId);
    await this.documentWallet.remove(saved.snapshot.tripId);
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
    return `Saved ${formatEuropeanDate(saved.savedAt)}`;
  }

  private clearOpenTrip(): void {
    this.beginTrip();
    this.trip.set(null);
    this.replaceBrandLogo(null);
    this.session.set(null);
  }

  /**
   * Starts a new trip context: clears everything that belongs to the previous trip and invalidates its in-flight
   * work. Async loaders capture the returned generation and drop their results if another trip has been opened since.
   */
  private beginTrip(): number {
    const generation = ++this.tripGeneration;
    this.activeView.set('home');
    this.acceptanceName.set('');
    this.acceptanceEmail.set('');
    this.acceptanceComplete.set(false);
    this.acceptanceConfirmations.set([]);
    this.acceptanceSectionsOpened.set([]);
    this.acceptanceNotice.set('');
    this.customerMessage.set('');
    this.messageSent.set(false);
    this.paymentAwaitingReturn = false;
    this.paymentReturnState.set('idle');
    this.openingPaymentId.set(null);
    this.blockedPageUrl.set(null);
    this.shareResult.set('');
    this.shareFallbackUrl.set(null);
    this.documentStatuses.set({});
    this.externalContent.set(null);
    this.externalContentLoading.set(false);
    this.externalContentFailed.set(false);
    this.relatedQuotations.set([]);
    this.customerAccount.set(null); this.accountLoading.set(false); this.accountSaving.set(false); this.accountNotice.set(''); this.openingAccountTripId.set(null);
    if (this.externalContentTimer) clearTimeout(this.externalContentTimer);
    this.notifications.set([]);
    this.showNotifications.set(false);
    this.paymentIdAwaiting = null;
    this.refreshing.set(false);
    this.messageTopic.set('itinerary');
    this.error.set('');
    return generation;
  }

  private isCurrentTrip(generation: number): boolean {
    return generation === this.tripGeneration;
  }

  private async activateSavedTrip(saved: SavedTrip, refresh: boolean): Promise<void> {
    const generation = this.beginTrip();
    this.session.set(saved.session);
    const status = refresh && !isSnapshotStale(saved.snapshot) ? 'fresh' as const : refresh ? 'stale' as const : 'offline' as const;
    const snapshot = { ...saved.snapshot, freshness: { ...saved.snapshot.freshness, status } };
    this.trip.set(snapshot);
    this.storedSecurely.set(true);
    await this.loadBrandLogo(snapshot, false);
    if (!this.isCurrentTrip(generation)) return;
    await this.syncCustomerNotifications(null, snapshot);
    if (refresh) { void this.loadExternalContent(); void this.loadRelatedQuotations(); }
    await this.refreshDocumentStatuses(snapshot, generation);
    if (refresh && this.isCurrentTrip(generation)) await this.refreshCurrentTrip(false);
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

  protected handleBrandLogoError(): void {
    this.replaceBrandLogo(null);
  }

  private async loadBrandLogo(snapshot: TripSnapshot, cacheFreshLogo: boolean): Promise<void> {
    const sourceUrl = snapshot.brand.logoUrl;
    this.replaceBrandLogo(cacheFreshLogo ? sourceUrl : null);
    if (cacheFreshLogo && !sourceUrl) {
      await this.brandAssets.remove(snapshot.tripId);
      return;
    }
    const storedUrl = await this.brandAssets.logo(snapshot.tripId);
    if (this.trip()?.tripId !== snapshot.tripId) {
      if (storedUrl?.startsWith('blob:')) URL.revokeObjectURL(storedUrl);
      return;
    }
    if (storedUrl) this.replaceBrandLogo(storedUrl);
    if (!cacheFreshLogo || !sourceUrl) return;
    const cachedUrl = await this.brandAssets.cacheLogo(snapshot.tripId, sourceUrl);
    if (this.trip()?.tripId !== snapshot.tripId) {
      if (cachedUrl?.startsWith('blob:')) URL.revokeObjectURL(cachedUrl);
      return;
    }
    if (cachedUrl) this.replaceBrandLogo(cachedUrl);
  }

  private replaceBrandLogo(url: string | null): void {
    const previous = this.brandLogoUrl();
    if (previous && previous !== url && previous.startsWith('blob:')) URL.revokeObjectURL(previous);
    this.brandLogoUrl.set(url);
  }

  protected toggleNotifications(): void {
    const tripId = this.trip()?.tripId;
    if (!tripId) return;
    if (this.showTripLibrary()) {
      this.showTripLibrary.set(false);
      this.activeView.set('home');
    }
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
    if (snapshot.experience.surprise?.concealed) {
      this.externalContent.set(null);
      if (this.externalContentTimer) clearTimeout(this.externalContentTimer);
    }
    await this.customerNotifications.sync(previous, snapshot);
    this.loadCustomerNotifications(snapshot.tripId);
  }

  private loadCustomerNotifications(tripId: string): void {
    this.notifications.set(this.customerNotifications.list(tripId));
  }

  protected async loadExternalContent(showLoading = true): Promise<void> {
    const generation = this.tripGeneration;
    const currentSession = this.session();
    if (!currentSession || !this.online() || this.externalContentLoading()) return;
    if (this.externalContentTimer) clearTimeout(this.externalContentTimer);
    this.externalContentLoading.set(showLoading && !this.externalContent());
    this.externalContentFailed.set(false);
    try {
      const content = await this.withSession(currentSession, (accessToken) => this.api.externalContent(accessToken));
      if (!this.isCurrentTrip(generation)) return; // Another trip was opened while this was loading.
      this.externalContent.set(content);
      const pending = content.providers.ai.state === 'pending';
      const delayMs = pending ? 5_000 : Math.max(60, content.refreshAfterSeconds) * 1_000;
      this.externalContentTimer = setTimeout(() => { if (this.trip() && this.online()) void this.loadExternalContent(false); }, delayMs);
    } catch {
      if (!this.isCurrentTrip(generation)) return;
      this.externalContentFailed.set(true);
      this.externalContentTimer = setTimeout(() => { if (this.trip() && this.online()) void this.loadExternalContent(false); }, 60_000);
    } finally { if (this.isCurrentTrip(generation)) this.externalContentLoading.set(false); }
  }

  private sessionForRequest(session: MobileSession): Promise<MobileSession> { return this.sessions.forRequest(session); }
  private withSession<T>(session: MobileSession, request: (accessToken: string) => Promise<T>): Promise<T> { return this.sessions.run(session, request); }
  private refreshSession(expiredSession: MobileSession): Promise<MobileSession> { return this.sessions.renew(expiredSession); }

  private trackEngagement(event: CustomerEngagementEvent, detail: string): void {
    const session = this.session();
    if (!session || !this.online()) return;
    void this.withSession(session, (accessToken) => this.api.engagement({
      event,
      detail,
      stage: this.trip()?.stage,
      occurredAt: new Date().toISOString(),
      device: Capacitor.getPlatform(),
    }, accessToken)).catch(() => undefined);
  }

  protected async downloadCalendar(): Promise<void> {
    const session = this.session();
    const trip = this.trip();
    if (!session || !trip) return;
    this.error.set('');
    try {
      const blob = await this.withSession(session, (accessToken) => this.api.downloadCalendar(accessToken));
      const filename = `${trip.summary.reference.replace(/[^A-Za-z0-9_-]+/g, '-')}-itinerary.ics`;
      if (Capacitor.isNativePlatform()) {
        // WebView downloads are ignored on iOS/Android: write the file and hand it to the share sheet ("Add to Calendar").
        const { uri } = await Filesystem.writeFile({ path: `calendar/${filename}`, directory: Directory.Cache, recursive: true, encoding: Encoding.UTF8, data: await blob.text() });
        await this.shareSheet.share({ title: `${trip.summary.name} itinerary`, files: [uri], dialogTitle: 'Add to calendar' });
      } else {
        this.downloadBlob(blob, filename);
      }
    } catch (error) {
      if (isShareCancelled(error)) return;
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
        if (uri) { await this.shareSheet.share({ title: document.title, files: [uri], dialogTitle: 'Open or share document' }); return; }
      }
      if (!this.online()) throw new Error('offline');
      const action = document.downloadAction;
      const blob = await this.withSession(session, (accessToken) => this.api.downloadDocument(action, accessToken));
      if (await this.documentWallet.save(trip.tripId, document, blob)) {
        await this.refreshDocumentStatuses(trip);
        const uri = await this.documentWallet.uri(trip.tripId, document.id);
        if (uri) await this.shareSheet.share({ title: document.title, files: [uri], dialogTitle: 'Document saved offline' });
      } else {
        this.downloadBlob(blob, `${trip.summary.reference.replace(/[^A-Za-z0-9_-]+/g, '-')}-${document.title.replace(/[^A-Za-z0-9_-]+/g, '-')}${fileExtension(blob.type)}`);
      }
    } catch (error) {
      if (isShareCancelled(error)) return;
      this.error.set(this.online() ? this.apiError(error, 'We could not create that document. Please try again.') : 'This document has not been saved for offline use yet. Connect to download it.');
    } finally {
      this.downloadingDocumentId.set(null);
    }
  }

  private async refreshDocumentStatuses(snapshot: TripSnapshot, generation = this.tripGeneration): Promise<void> {
    const statuses = await this.documentWallet.statuses(snapshot.tripId, snapshot.documents);
    if (this.isCurrentTrip(generation)) this.documentStatuses.set(statuses);
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    // Revoking straight away can cancel the download in Safari/Firefox; give the browser time to start it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  private apiError(error: unknown, fallback: string): string {
    return customerErrorMessage(error, fallback);
  }

}

/** Waits between payment-status checks after returning from the payment page (first check is immediate). */
// Each check costs 2 Airtable reads (payment-status endpoint): ten checks over about 70 seconds.
export const PAYMENT_POLL_DELAYS_MS = [0, 3_000, 3_000, 5_000, 5_000, 8_000, 8_000, 10_000, 12_000, 15_000];
/** How long after opening a payment page a later return to the app still triggers a re-check. */
const PAYMENT_RECHECK_WINDOW_MS = 30 * 60_000;

function isSnapshotStale(snapshot: TripSnapshot): boolean {
  return !snapshot.freshness.nextRefreshAfter || Date.parse(snapshot.freshness.nextRefreshAfter) <= Date.now();
}

function initialAppearancePreference(): AppearancePreference {
  try {
    const saved = localStorage.getItem('vision-trips:appearance');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* Fall back to the device preference. */ }
  return 'system';
}

function prefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

function fileExtension(mimeType: string): string { return mimeType.includes('pdf') ? '.pdf' : mimeType.includes('png') ? '.png' : mimeType.includes('jpeg') ? '.jpg' : '.bin'; }
interface PaymentStatusView { tone: 'info' | 'ok' | 'warn'; icon: VtIconName; title: string; body: string; action: string | null }

/** Words that mean a message was written for developers, not customers. */
const INTERNAL_ERROR_TERMS = /airtable|token|mint|webhook|schema|api key|base id|record id|npm |port \d|status \d{3}/i;

/**
 * Turns an API failure into something a traveller can act on. Server text is only shown for client errors (4xx)
 * that our API phrases for customers; infrastructure and configuration failures get a calm, generic message.
 */
export function customerErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) return fallback;
  if (error.status === 0) return 'We can’t reach Vision Trips right now. Check your connection and try again.';
  if (error.status === 401) return 'For your security, please open your trip link again to continue.';
  if (error.status >= 500) return 'Our booking system is busy right now. Please try again in a minute.';
  const raw = error.error?.message;
  const message = typeof raw === 'string' ? raw.trim() : Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string').join(' ') : '';
  const safe = message && !INTERNAL_ERROR_TERMS.test(message) ? message : '';
  if (error.status === 429) return safe || 'Lots of requests at once. Please wait a moment and try again.';
  return safe || fallback;
}

/**
 * A label for click analytics that never carries personal details. Prefers an explicit data-engagement name, then the
 * kind of link (call/email/website), and only then the visible text with emails, phone numbers and long digit runs removed.
 */
export function engagementLabel(target: HTMLElement): string {
  const explicit = target.dataset['engagement']?.trim();
  if (explicit) return explicit.slice(0, 100);
  const href = target instanceof HTMLAnchorElement ? target.getAttribute('href') ?? '' : '';
  if (/^tel:/i.test(href)) return 'Phone link';
  if (/^mailto:/i.test(href)) return 'Email link';
  if (/^https?:/i.test(href)) { try { return `External link: ${new URL(href).hostname}`; } catch { return 'External link'; } }
  return redactPersonalDetails(target.getAttribute('aria-label') || target.textContent || '').slice(0, 100);
}

export function redactPersonalDetails(text: string): string {
  return text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{5,}\d/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Capacitor Share rejects with "Share canceled" when the user dismisses the sheet; that is not an error. */
export function isShareCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /cancel/i.test(message) || (error instanceof DOMException && error.name === 'AbortError');
}
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
