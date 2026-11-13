import { Component, HostListener, OnDestroy, OnInit, computed, effect, inject, isDevMode, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Network } from '@capacitor/network';
import type { CustomerAccount, CustomerEngagementEvent, CustomerMessageTopic, CustomerPreferences, ExternalTripContent, InvitationAuthorized, LinkExchangeResponse, MobileSession, PaymentStatusResponse, RelatedQuotationSummary, TripDocument, TripSnapshot, TripStage } from '@vision-trips/contracts';
import { DocumentTooLargeError, VisionApiService } from './core/api/vision-api.service';
import { SavedTripsStore, type SavedTrip } from './core/storage/saved-trips.store';
import { BrandAssetsStore } from './core/storage/brand-assets.store';
import { groupSavedTrips } from './core/storage/trip-library';
import { CustomerNotificationsStore, type CustomerNotification } from './core/storage/customer-notifications.store';
import { DocumentWalletStore, type WalletStatus } from './core/storage/document-wallet.store';
import { ExternalPages, type PendingExternalPage } from './core/platform/external-pages';
import { ShareSheet } from './core/platform/share-sheet';
import { tripLinkFromPath, tripLinkFromUrl, type TripLink } from './core/platform/deep-links';
import { SessionManager, isTerminalSessionError } from './core/session/session-manager';
import { isTripDataError } from './core/api/trip-schema';
import { IMAGE_SIZES, sourceFor, srcset } from './shared/responsive-image';
import { Directory, Filesystem, Encoding } from '@capacitor/filesystem';
import { DocumentsSection } from './features/trip/documents-section';
import { DestinationsSection } from './features/trip/destinations-section';
import { CommunicationsSection } from './features/trip/communications-section';
import { ItinerarySection } from './features/trip/itinerary-section';
import { ExtrasSection } from './features/trip/extras-section';
import { PaymentsSection } from './features/trip/payments-section';
import { ExternalContentSection } from './features/trip/external-content-section';
import { StageExperienceSection, clearChecklist } from './features/trip/stage-experience-section';
import { BookingJourneySection } from './features/trip/booking-journey-section';
import { CustomerAccountSection } from './features/account/customer-account-section';
import { BrandSupportSection } from './features/trip/brand-support-section';
import { InvitationFlow } from './features/invitation/invitation-flow';
import { VtIcon, type VtIconName } from './shared/lucide-icon';
import { brandPalette } from './shared/brand-palette';
import { EuropeanDatePipe, formatEuropeanDate } from './shared/european-date.pipe';

type AppView = 'home' | 'itinerary' | 'payments' | 'documents' | 'help' | 'account';
type TripRefreshState = 'idle' | 'refreshing' | 'fresh' | 'stale' | 'offline' | 'error' | 'signed_out';
type Appearance = 'light' | 'dark';
type AppearancePreference = Appearance | 'system';

@Component({
  selector: 'app-root',
  imports: [BookingJourneySection, BrandSupportSection, CommunicationsSection, CustomerAccountSection, DestinationsSection, DocumentsSection, EuropeanDatePipe, ExtrasSection, ExternalContentSection, InvitationFlow, ItinerarySection, PaymentsSection, StageExperienceSection, VtIcon],
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
  /**
   * The invitation being verified (from a `vt_` link, a legacy link, a step-up or the development button). Only ever in
   * memory: invitation tokens, like access and refresh credentials, are never written to localStorage.
   */
  protected readonly invitationToken = signal<string | null>(null);
  /** Development builds only, and only when the API says a VISION_DEV_* test invitation is configured. */
  protected readonly devInvitationAvailable = signal(false);
  protected readonly devInvitationMessage = signal('');
  protected readonly openingDevInvitation = signal(false);
  /** A sensitive action was refused because this session hasn't been confirmed by email. */
  protected readonly verificationNeeded = signal(false);
  protected readonly startingStepUp = signal(false);
  protected readonly submitting = signal(false);
  protected readonly error = signal('');
  protected readonly trip = signal<TripSnapshot | null>(null);
  protected readonly brandLogoUrl = signal<string | null>(null);
  protected readonly storedSecurely = signal(false);
  /** Browsers save only the trip itself, in this browser's storage; the installed app uses the device's secure storage. */
  protected readonly savedInBrowser = !this.savedTrips.native;
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
  /** The open trip's session ended: its saved copy stays readable, but live actions need the trip link again. */
  protected readonly signedOut = signal(false);
  /** Saved trips being removed right now (their controls are locked until it finishes). */
  protected readonly removingTrips = signal<ReadonlySet<string>>(new Set());
  protected readonly img = { srcset, sizes: IMAGE_SIZES };
  protected readonly tripRefreshStates = signal<Record<string, TripRefreshState>>({});
  protected readonly tripGroups = computed(() => groupSavedTrips(this.savedTripList()));
  protected readonly displayedTrip = computed(() => this.showTripLibrary() || this.invitationToken() ? null : this.trip());
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
  /** Failures shown beside the thing that failed, each with its own retry (not in the global banner). */
  protected readonly accountError = signal('');
  protected readonly accountSaveError = signal('');
  protected readonly documentFailure = signal<{ id: string; message: string } | null>(null);
  protected readonly calendarError = signal('');
  protected readonly creatingCalendar = signal(false);
  protected readonly openingAccountTripId = signal<string | null>(null);
  /** Announced (and shown) after switching to a trip of another branch or Customer, or when a Customer replaced another's copy. */
  protected readonly switchNotice = signal('');
  /** More than one branch/brand is saved: My Trips labels each card so trips are not mistaken for one account. */
  protected readonly multipleBrands = computed(() => new Set(this.savedTripList().map((trip) => trip.snapshot.brand.name)).size > 1);
  protected readonly savedTripIds = computed(() => new Set(this.savedTripList().map((trip) => trip.snapshot.tripId)));
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
  private appUrlListener: PluginListenerHandle | null = null;
  /** Bumped for every trip link that arrives; a slower, earlier link exchange is then ignored. */
  private linkGeneration = 0;
  /** Bumped whenever a different trip is opened or the trip is closed; see beginTrip(). */
  private tripGeneration = 0;
  private readonly paymentPollDelaysMs: readonly number[] = PAYMENT_POLL_DELAYS_MS;
  private networkListener: PluginListenerHandle | null = null;
  private externalContentTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.sessions.connect({
      tripIdFor: (refreshToken) => (this.session()?.refreshToken === refreshToken ? this.trip()?.tripId : undefined)
        ?? this.savedTripList().find((trip) => trip.session?.refreshToken === refreshToken)?.snapshot.tripId,
      renewed: async ({ previousRefreshToken, session, fromServer }) => {
        const snapshot = this.trip();
        if (fromServer && snapshot && this.session()?.refreshToken === session.refreshToken) this.storedSecurely.set(await this.savedTrips.save(snapshot, session));
        // The old refresh token is now dead server-side; keep the in-memory library in step with storage.
        this.savedTripList.update((trips) => trips.map((trip) => trip.session?.refreshToken === previousRefreshToken ? { ...trip, session } : trip));
      },
      expired: (refreshToken) => this.handleSessionExpired(refreshToken),
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
    const launchLink = tripLinkFromPath(window.location.pathname);
    if (launchLink) void this.openTripLink(launchLink);
    void this.initializeOfflineState(!launchLink);
    if (isDevMode() && !launchLink) void this.checkDevInvitation();
    if (Capacitor.isNativePlatform()) {
      // Universal Links / App Links: `appUrlOpen` covers a link opened while the app is running (warm or from the
      // background); `getLaunchUrl` covers a cold launch, where the web view itself starts at the app's root.
      void CapacitorApp.addListener('appUrlOpen', ({ url }) => this.handleOpenedUrl(url)).then((listener) => { this.appUrlListener = listener; });
      void CapacitorApp.getLaunchUrl().then((launch) => { if (launch?.url) this.handleOpenedUrl(launch.url); }).catch(() => undefined);
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
    void this.appUrlListener?.remove();
    this.linkGeneration += 1;
    void this.networkListener?.remove();
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

  /** Local development: opens the server-configured test booking through the normal invitation and email-code flow. */
  protected async openDevelopmentInvitation(): Promise<void> {
    if (this.openingDevInvitation()) return;
    this.openingDevInvitation.set(true);
    this.error.set('');
    try {
      this.invitationToken.set(await this.api.createDevInvitation());
    } catch (error) {
      this.error.set(this.apiError(error, 'The development test trip could not be opened. Check the VISION_DEV_* settings and the API console.'));
    } finally {
      this.openingDevInvitation.set(false);
    }
  }

  private async checkDevInvitation(): Promise<void> {
    try {
      const status = await this.api.devInvitationStatus();
      this.devInvitationAvailable.set(status.available);
      this.devInvitationMessage.set(status.available ? '' : status.message ?? '');
    } catch {
      this.devInvitationAvailable.set(false); // 404 in production builds of the API, or the API isn't running.
    }
  }

  /** The invitation flow finished: open the verified trip and save it in My Trips. */
  protected async invitationAuthorized(response: InvitationAuthorized): Promise<void> {
    this.invitationToken.set(null);
    this.verificationNeeded.set(false);
    await this.acceptAuthorized({ status: 'authorized', exchangeId: 'invitation', expiresAt: response.session.refreshExpiresAt, snapshot: response.snapshot, session: response.session, trustedDeviceToken: response.trustedDeviceToken });
  }

  /** "Not now" / "Back": return to the open trip, My Trips, or the start screen — the open trip is never lost. */
  protected invitationCancelled(): void {
    this.invitationToken.set(null);
    if (!this.trip() && this.savedTripList().length) this.showTripLibrary.set(true);
    this.focusMain();
  }

  /** A link handed over by the OS: only a valid `/trip/<token>` link on an allowed host is used. */
  private handleOpenedUrl(url: string): void {
    const link = tripLinkFromUrl(url);
    if (link) void this.openTripLink(link);
  }

  /** Payments, quotation acceptance, sharing and account changes need a session confirmed by email. */
  protected async confirmIdentity(): Promise<void> {
    const currentSession = this.session();
    if (!currentSession || this.startingStepUp() || !this.online()) return;
    const generation = this.tripGeneration;
    this.startingStepUp.set(true);
    this.error.set('');
    try {
      const token = await this.withSession(currentSession, (accessToken) => this.api.stepUp(accessToken));
      if (this.isCurrentTrip(generation)) this.invitationToken.set(token);
    } catch (error) {
      if (this.isCurrentTrip(generation)) this.error.set(this.apiError(error, 'We couldn’t start the email check. Please try again.'));
    } finally {
      this.startingStepUp.set(false);
    }
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

  /**
   * Opens a trip link (at launch, or handed over while the app is running). The trip already open stays as it is
   * underneath: the invitation screen sits on top, and "Not now" returns to it. A newer link supersedes an older one
   * still being exchanged, and the invitation flow itself drops late replies for a token it no longer shows.
   */
  private async openTripLink(link: TripLink): Promise<void> {
    const generation = ++this.linkGeneration;
    // Keep the token out of the address bar and browser history once it has been read.
    try { window.history.replaceState(window.history.state, '', new URL(document.baseURI).pathname); } catch { /* Not fatal. */ }
    this.showNotifications.set(false);
    // Invitation links go straight to the invitation screen; nothing is authorised by opening them.
    if (link.kind === 'invitation') { this.error.set(''); this.invitationToken.set(link.token); return; }
    this.submitting.set(true);
    this.error.set('');
    try {
      // Legacy signed links only locate the booking now: customer links come back as an invitation to verify by email.
      const response = await this.api.exchangeLink(link.token);
      if (generation !== this.linkGeneration) return; // Another link arrived meanwhile; it wins.
      if (response.status === 'authorized') await this.acceptAuthorized(response);
      else this.invitationToken.set(response.invitationToken);
    } catch (error) {
      if (generation !== this.linkGeneration) return;
      const linkRejected = error instanceof HttpErrorResponse && [400, 401, 403, 404, 409, 410].includes(error.status);
      this.error.set(linkRejected ? 'This trip link has expired or is no longer valid. Ask your travel agent for a new invitation.' : this.apiError(error, 'We could not open that trip link. Please try again.'));
      // Don't strand someone on the entry screen when they already have trips saved on this device.
      if (!this.trip() && !this.invitationToken()) {
        if (!this.savedTripList().length) await this.reloadSavedTrips();
        if (this.savedTripList().length) this.showTripLibrary.set(true);
      }
    } finally {
      if (generation === this.linkGeneration) this.submitting.set(false);
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
    const saved = (await this.savedTrips.signOutExpired()).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    this.setSavedTripList(saved, status.connected);
    if (!activateSaved || !saved.length || this.trip() || this.invitationToken()) return;
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

  private async acceptAuthorized(response: Extract<LinkExchangeResponse, { status: 'authorized' }>): Promise<void> {
    const previous = { trip: this.trip(), identityKey: this.session()?.identityKey ?? null };
    const nextIdentity = response.session.identityKey ?? null;
    // Another Customer saved this same trip (booking) on this device: their copy is replaced, so clear what belonged to it.
    const savedBy = await this.savedTrips.identityFor(response.snapshot.tripId);
    const takesOver = Boolean(savedBy && nextIdentity && savedBy !== nextIdentity);
    if (takesOver) await this.clearTripLocalData(response.snapshot.tripId);
    const generation = this.beginTrip();
    this.trip.set(response.snapshot);
    this.session.set(response.session);
    this.showTripLibrary.set(false);
    this.switchNotice.set(switchMessage(previous, response.snapshot, nextIdentity, takesOver));
    void this.loadExternalContent();
    void this.loadRelatedQuotations();
    await this.loadBrandLogo(response.snapshot, true);
    await this.syncCustomerNotifications(null, response.snapshot);
    await this.refreshDocumentStatuses(response.snapshot, generation);
    // Opening a trip (link, verification, account or related quotation) brings it back even if it was removed earlier.
    this.storedSecurely.set(await this.savedTrips.save(response.snapshot, response.session, { reopened: true }));
    await this.reloadSavedTrips();
    if (response.trustedDeviceToken) await this.savedTrips.saveDeviceTrust(response.trustedDeviceToken, nextIdentity);
    if (this.isCurrentTrip(generation)) this.focusMain();
  }

  protected dismissSwitchNotice(): void { this.switchNotice.set(''); }

  private focusMain(): void {
    requestAnimationFrame(() => document.querySelector<HTMLElement>('#main-content')?.focus({ preventScroll: true }));
  }

  /** Everything this device keeps for one trip besides the saved copy itself. */
  private async clearTripLocalData(tripId: string): Promise<void> {
    await this.brandAssets.remove(tripId);
    await this.documentWallet.remove(tripId);
    this.customerNotifications.clear(tripId);
    clearChecklist(tripId);
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
    this.accountSaving.set(true); this.accountNotice.set(''); this.accountSaveError.set('');
    const generation = this.tripGeneration;
    // Only the server's reply updates the saved preferences; until then the edits live in the form's draft.
    try { const result = await this.withSession(currentSession, (accessToken) => this.api.updateCustomerPreferences(preferences, accessToken)); if (!this.isCurrentTrip(generation)) return; this.customerAccount.update((account) => account ? { ...account, preferences: result.preferences } : account); this.accountNotice.set(result.updatedRecords > 1 ? `Preferences saved to your ${result.updatedRecords} linked customer profiles with ${this.trip()?.brand.name ?? 'this company'}.` : `Preferences saved for your account with ${this.trip()?.brand.name ?? 'this company'}.`); }
    catch (error) { if (this.isCurrentTrip(generation)) this.accountSaveError.set(this.apiError(error, 'Something went wrong saving them.')); }
    finally { if (this.isCurrentTrip(generation)) this.accountSaving.set(false); }
  }

  /**
   * Opens a trip listed in the verified Customer's account: the API re-checks the link and issues a session for that
   * booking and Customer (no new invitation or code), and the trip is then saved in My Trips. If the customer moved
   * on (another trip or invitation opened) before the reply, the trip is saved but not switched to.
   */
  protected async openCustomerAccountTrip(accountTripId: string): Promise<void> {
    const currentSession = this.session(); if (!currentSession || this.openingAccountTripId()) return;
    const generation = this.tripGeneration;
    this.openingAccountTripId.set(accountTripId);
    try {
      const response = await this.withSession(currentSession, (accessToken) => this.api.openCustomerAccountTrip(accountTripId, accessToken));
      if (!this.isCurrentTrip(generation) || this.invitationToken()) { await this.savedTrips.save(response.snapshot, response.session, { reopened: true }); await this.reloadSavedTrips(); return; }
      await this.acceptAuthorized({ status: 'authorized', exchangeId: 'account', expiresAt: response.session.refreshExpiresAt, snapshot: response.snapshot, session: response.session });
    }
    catch (error) { if (this.isCurrentTrip(generation)) this.error.set(this.apiError(error, 'We could not open that trip. Please refresh your account.')); }
    finally { if (this.isCurrentTrip(generation)) this.openingAccountTripId.set(null); }
  }

  /**
   * "Sign out of this account": ends the sessions and removes the saved trips of the open trip's identity only (one
   * Customer in one branch), and forgets that identity's trusted device. Other branches and Customers stay signed in.
   */
  protected async signOutAccount(): Promise<void> {
    const identity = this.session()?.identityKey ?? null;
    const brand = this.trip()?.brand.name ?? 'this company';
    const saved = await this.savedTrips.all();
    const openTripId = this.trip()?.tripId;
    const mine = saved.filter((trip) => trip.snapshot.tripId === openTripId || (identity !== null && trip.identityKey === identity));
    const others = saved.length - mine.length;
    const message = `Sign out of your ${brand} account on this device? This removes ${mine.length === 1 ? 'this trip' : `${mine.length} trips`} and any documents saved for them.${others ? ` Your ${others} other saved ${others === 1 ? 'trip stays' : 'trips stay'} on this device.` : ''}`;
    if (!window.confirm(message)) return;
    const refreshTokens = [...new Set([this.session()?.refreshToken, ...mine.map((trip) => trip.session?.refreshToken)].filter((token): token is string => Boolean(token)))];
    await Promise.allSettled(refreshTokens.map((refreshToken) => this.api.revokeSession(refreshToken)));
    for (const trip of mine) { await this.savedTrips.remove(trip.snapshot.tripId); await this.clearTripLocalData(trip.snapshot.tripId); }
    if (identity) {
      await this.savedTrips.clearDeviceTrust(identity);
      if (!this.savedTrips.native) await this.api.forgetDeviceTrust(identity).catch(() => undefined);
    }
    this.clearOpenTrip(); this.storedSecurely.set(false);
    await this.reloadSavedTrips();
    this.showTripLibrary.set(this.savedTripList().length > 0);
    this.switchNotice.set(`Signed out of your ${brand} account on this device.`);
  }

  /** "Remove all data from this device": every saved trip, branch and Customer, every document and trusted device. */
  protected async signOutDevice(): Promise<void> {
    if (!window.confirm('Remove all data from this device? Every trip saved here — for every travel company and account — is signed out and removed, along with saved documents and trusted-device settings.')) return;
    const saved = await this.savedTrips.all();
    const refreshTokens = [...new Set([this.session()?.refreshToken, ...saved.map((trip) => trip.session?.refreshToken)].filter((token): token is string => Boolean(token)))];
    await Promise.allSettled(refreshTokens.map((refreshToken) => this.api.revokeSession(refreshToken)));
    for (const trip of saved) { await this.savedTrips.remove(trip.snapshot.tripId); await this.brandAssets.remove(trip.snapshot.tripId); this.customerNotifications.clear(trip.snapshot.tripId); clearChecklist(trip.snapshot.tripId); }
    await this.documentWallet.remove();
    await this.savedTrips.clearDeviceTrust();
    if (!this.savedTrips.native) await this.api.forgetDeviceTrust().catch(() => undefined);
    this.clearOpenTrip(); this.savedTripList.set([]); this.showTripLibrary.set(false); this.storedSecurely.set(false);
    this.switchNotice.set('All trips and data were removed from this device.');
  }

  protected retryAccount(): void { void this.loadCustomerAccount(); }

  private async loadCustomerAccount(): Promise<void> {
    const generation = this.tripGeneration;
    const currentSession = this.session(); if (!currentSession || this.accountLoading() || this.trip()?.accessScope !== 'primary_customer') return;
    this.accountLoading.set(true); this.accountNotice.set(''); this.accountError.set('');
    try { const account = await this.withSession(currentSession, (accessToken) => this.api.customerAccount(accessToken)); if (this.isCurrentTrip(generation)) this.customerAccount.set(account); }
    // Keep an account that is already on screen (and the traveller's unsaved edits); just offer a retry.
    catch (error) { if (this.isCurrentTrip(generation)) this.accountError.set(this.apiError(error, 'Check your connection and try again.')); }
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
    const generation = this.tripGeneration;
    this.openingRelatedId.set(comparisonId); this.error.set('');
    try {
      const response = await this.withSession(currentSession, (accessToken) => this.api.openRelatedQuotation(comparisonId, accessToken));
      if (!this.isCurrentTrip(generation) || this.invitationToken()) return; // The customer moved on; don't switch under them.
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
    this.invitationToken.set(null);
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

  /** A hero copy sized for the slot (about `cssWidth` px wide); falls back to the original URL from older data. */
  protected heroSource(summary: TripSnapshot['summary'], cssWidth: number): string | null {
    return summary.heroImage ? sourceFor(summary.heroImage, cssWidth) : summary.heroImageUrl;
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
    if (this.tripBusy(saved)) return;
    const openSession = this.trip()?.tripId === tripId ? this.session() : null;
    const credential = openSession ?? saved.session;
    if (!credential) { this.setTripRefreshState(tripId, 'signed_out'); return; }
    this.setTripRefreshState(tripId, 'refreshing');
    try {
      const { result: snapshot, session } = await this.sessions.runWithSession(credential, (accessToken) => this.api.refreshTrip(accessToken));
      await this.savedTrips.save(snapshot, session);
      // Removed while the refresh was in flight (from another screen or tab): the store refused it; drop the result too.
      if (this.savedTrips.wasRemoved(tripId)) { this.clearTripRefreshState(tripId); return; }
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
    } catch (error) {
      if (this.savedTrips.wasRemoved(tripId)) this.clearTripRefreshState(tripId);
      else this.setTripRefreshState(tripId, isTerminalSessionError(error) ? 'signed_out' : 'error');
    }
  }

  /** A saved trip is busy while it is being refreshed or removed; its refresh and remove controls wait. */
  protected tripBusy(saved: SavedTrip): boolean {
    return this.tripRefreshStates()[saved.snapshot.tripId] === 'refreshing' || this.removingTrips().has(saved.snapshot.tripId);
  }

  private clearTripRefreshState(tripId: string): void {
    this.tripRefreshStates.update((states) => {
      const next = { ...states };
      delete next[tripId];
      return next;
    });
  }

  protected async removeSavedTrip(saved: SavedTrip, event?: Event): Promise<void> {
    event?.stopPropagation();
    const tripId = saved.snapshot.tripId;
    if (this.tripBusy(saved)) return;
    if (!window.confirm(`Remove ${saved.snapshot.summary.name} from this device?`)) return;
    this.removingTrips.update((ids) => new Set(ids).add(tripId));
    try {
      const openSession = this.trip()?.tripId === tripId ? this.session() : null;
      const revoke = (openSession ?? saved.session)?.refreshToken;
      if (revoke) void this.api.revokeSession(revoke).catch(() => undefined);
      await this.savedTrips.remove(tripId);
      await this.brandAssets.remove(tripId);
      await this.documentWallet.remove(tripId);
      this.customerNotifications.clear(tripId);
      clearChecklist(tripId);
      this.savedTripList.update((trips) => trips.filter((trip) => trip.snapshot.tripId !== tripId));
      this.clearTripRefreshState(tripId);
      if (this.trip()?.tripId === tripId) this.clearOpenTrip();
      if (!this.savedTripList().length) this.showTripLibrary.set(false);
    } finally {
      this.removingTrips.update((ids) => { const next = new Set(ids); next.delete(tripId); return next; });
    }
  }


  protected refreshStateLabel(saved: SavedTrip): string {
    const state = this.tripRefreshStates()[saved.snapshot.tripId] ?? 'idle';
    if (state === 'refreshing') return 'Refreshing…';
    if (state === 'fresh') return 'Up to date';
    if (state === 'offline') return 'Saved offline';
    if (state === 'error') return 'Refresh failed';
    if (state === 'signed_out' || !saved.session) return 'Signed out · open your trip link to refresh';
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
    this.signedOut.set(false);
    this.switchNotice.set('');
    this.verificationNeeded.set(false); this.startingStepUp.set(false);
    this.accountError.set(''); this.accountSaveError.set(''); this.documentFailure.set(null); this.calendarError.set(''); this.creatingCalendar.set(false);
    return generation;
  }

  private isCurrentTrip(generation: number): boolean {
    return generation === this.tripGeneration;
  }

  private async activateSavedTrip(saved: SavedTrip, refresh: boolean): Promise<void> {
    const generation = this.beginTrip();
    this.session.set(saved.session);
    this.signedOut.set(!saved.session);
    if (!saved.session) refresh = false;
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
    this.setSavedTripList((await this.savedTrips.signOutExpired()).sort((a, b) => b.savedAt.localeCompare(a.savedAt)), this.online());
  }

  private setSavedTripList(saved: SavedTrip[], connected: boolean): void {
    this.savedTripList.set(saved);
    this.tripRefreshStates.update((states) => Object.fromEntries(saved.map((trip) => [
      trip.snapshot.tripId,
      states[trip.snapshot.tripId] === 'refreshing' ? 'refreshing' : !trip.session ? 'signed_out' : connected ? (isSnapshotStale(trip.snapshot) ? 'stale' : 'fresh') : 'offline',
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

  /**
   * Central handling for a session that can no longer be renewed. The credential is forgotten so nothing keeps
   * retrying it, but the saved trip stays on the device for offline viewing; opening the trip link signs in again.
   */
  private async handleSessionExpired(refreshToken: string): Promise<void> {
    const saved = this.savedTripList().find((trip) => trip.session?.refreshToken === refreshToken);
    const isOpenTrip = this.session()?.refreshToken === refreshToken;
    const tripId = isOpenTrip ? this.trip()?.tripId : saved?.snapshot.tripId;
    if (tripId) await this.savedTrips.signOut(tripId);
    this.savedTripList.update((trips) => trips.map((trip) => trip.session?.refreshToken === refreshToken ? { ...trip, session: null } : trip));
    if (tripId) this.setTripRefreshState(tripId, 'signed_out');
    if (!isOpenTrip) return;
    this.session.set(null);
    this.signedOut.set(true);
    this.refreshing.set(false);
    this.markFreshness('offline');
  }

  protected getNewTripLink(): void {
    this.dismissError();
    this.selectView('help');
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
    if (!session || !trip || this.creatingCalendar()) return;
    this.calendarError.set('');
    this.creatingCalendar.set(true);
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
      this.calendarError.set(this.online() ? this.apiError(error, 'Something went wrong creating it.') : 'You’re offline. Connect to the internet and try again.');
    } finally {
      this.creatingCalendar.set(false);
    }
  }

  protected async downloadDocument(value: TripDocument | string): Promise<void> {
    const session = this.session();
    const trip = this.trip();
    if (!session || !trip) return;
    const document = typeof value === 'string' ? trip.documents.find((item) => item.downloadAction === value) : value;
    if (!document?.downloadAction) return;
    this.documentFailure.set(null);
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
      const message = this.online() ? this.apiError(error, 'Something went wrong preparing it.') : 'It hasn’t been saved for offline use yet. Connect to the internet and try again.';
      if (message) this.documentFailure.set({ id: document.id, message });
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
    // The signed-out card already explains what happened and what to do; a toast would repeat it.
    if (isTerminalSessionError(error) && this.signedOut()) return '';
    // The "confirm it's you" card offers the fix, so the banner only needs a short explanation.
    if (isVerificationRequired(error)) { this.verificationNeeded.set(true); return 'Please confirm it’s you first — we’ll email you a code.'; }
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
/** The API refused a sensitive action because the session wasn't confirmed by email (legacy or share-link session). */
export function isVerificationRequired(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 403 && (error.error as { code?: unknown } | null)?.code === 'verification_required';
}

export function customerErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof DocumentTooLargeError) return 'This document is too large to download in the app. Ask your travel agent to email it to you.';
  if (isTripDataError(error)) return error.reason === 'unsupported_version'
    ? 'This trip needs a newer version of the app. Please update the app and try again.'
    : 'We couldn’t read this trip’s details. Please try again in a moment, or contact your travel agent.';
  if (isTerminalSessionError(error)) return 'You’ve been signed out of this trip. Open your trip link again to continue.';
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

/**
 * What to tell the customer after a trip opens. Silent when it is another trip of the same verified Customer in the
 * same branch (opening trips from the account should not interrupt); otherwise says which branch or account is now
 * shown, and that the previous trip is still saved.
 */
export function switchMessage(previous: { trip: TripSnapshot | null; identityKey: string | null }, next: TripSnapshot, nextIdentity: string | null, replacedAnotherCustomer: boolean): string {
  if (replacedAnotherCustomer) return `You’re now signed in to ${next.summary.name} as a different customer. The copy saved here by the previous customer has been replaced.`;
  if (!previous.trip || previous.trip.tripId === next.tripId && previous.identityKey === nextIdentity) return '';
  if (previous.trip.brand.name !== next.brand.name) return `Now showing ${next.summary.name} from ${next.brand.name}. Your ${previous.trip.brand.name} trips are still saved in My trips.`;
  if (previous.identityKey && nextIdentity && previous.identityKey !== nextIdentity) return `Switched to a different customer account: ${next.summary.name}. Your other trips are still saved in My trips.`;
  return '';
}
