import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { invitationErrorSchema, type InvitationAuthorized, type InvitationErrorCode, type InvitationState } from '@vision-trips/contracts';
import { VisionApiService } from '../../core/api/vision-api.service';
import { SavedTripsStore } from '../../core/storage/saved-trips.store';
import { VtIcon } from '../../shared/lucide-icon';

type Step = 'loading' | 'welcome' | 'code' | 'unavailable' | 'error';

interface Problem { title: string; message: string }

/** Only the digits of what was typed or pasted, at most six. */
export function sanitizeOtp(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6);
}

/**
 * Invitation link → branded welcome → send code → enter the six-digit code → verified trip.
 *
 * Every request captures a generation number; if the token changes (another invitation opened) or the flow is closed,
 * late responses are dropped instead of updating the wrong screen. Buttons are disabled while a request is running,
 * so a code can't be submitted twice.
 */
@Component({
  selector: 'app-invitation-flow',
  imports: [VtIcon],
  template: `
    <section class="vt-invite" [attr.aria-busy]="busy() || step() === 'loading'" aria-labelledby="invite-title">
      <p class="vt-sr-only" aria-live="polite" role="status">{{ announcement() }}</p>
      <button type="button" class="vt-invite__back" [disabled]="busy() && step() === 'code'" (click)="close()"><vt-icon name="chevron-left" [size]="18" /> {{ step() === 'unavailable' || step() === 'error' ? 'Back' : 'Not now' }}</button>
      @switch (step()) {
        @case ('loading') {
          <header class="vt-page-head">
            <p class="vt-page-kicker vt-page-head__kicker">Opening your invitation</p>
            <h1 id="invite-title" class="vt-page-title vt-page-head__title" tabindex="-1" #heading>Just a moment…</h1>
          </header>
          <div class="vt-invite__card"><p class="vt-invite__lead"><vt-icon class="vt-invite__spin" name="loader" [size]="18" /> Checking your link.</p></div>
        }
        @case ('welcome') {
          @if (invitation(); as current) {
            <header class="vt-page-head">
              <p class="vt-page-kicker vt-page-head__kicker">Your trip with {{ current.brand.name }}</p>
              <h1 id="invite-title" class="vt-page-title vt-page-head__title" tabindex="-1" #heading>{{ current.verification === 'none' ? 'You’ve been invited to view a trip' : 'Welcome — your trip is ready' }}</h1>
            </header>
            <div class="vt-invite__card">
              <div class="vt-invite__brand">
                @if (current.brand.logoUrl) { <img class="vt-invite__logo" [src]="current.brand.logoUrl" [alt]="current.brand.name" decoding="async" /> }
                @else { <span class="vt-invite__brand-name">{{ current.brand.name }}</span> }
              </div>
              @if (current.verification === 'none') {
                <p class="vt-invite__lead">A fellow traveller has shared the itinerary, documents and contact details with you. Prices and payments aren’t included.</p>
                <button type="button" class="vt-invite__primary" [disabled]="busy() || !online()" (click)="openWithoutCode()">{{ busy() ? 'Opening…' : 'Open the trip' }}</button>
              } @else if (current.trustedDevice) {
                <p class="vt-invite__lead">This device is already trusted for your trip, so you don’t need a code.</p>
                <button type="button" class="vt-invite__primary" [disabled]="busy() || !online()" (click)="openWithoutCode()">{{ busy() ? 'Opening…' : 'Open my trip' }}</button>
                <button type="button" class="vt-invite__link" [disabled]="busy() || !online()" (click)="sendCode()">Send me a code instead</button>
              } @else {
                <p class="vt-invite__lead">To keep your booking safe, we’ll email a six-digit code to <strong>{{ current.destinationHint }}</strong>.</p>
                <button type="button" class="vt-invite__primary" [disabled]="busy() || !online() || resendSeconds() > 0" (click)="sendCode()"><vt-icon name="mail" [size]="19" /> {{ busy() ? 'Sending…' : resendSeconds() > 0 ? 'Send my code in ' + resendSeconds() + 's' : 'Send my code' }}</button>
                <p class="vt-invite__fine">Not your email address? Contact {{ current.brand.name }} — they can update it and send a new invitation.</p>
              }
              @if (!online()) { <p class="vt-invite__error" role="alert">You’re offline. Connect to the internet to receive and enter your code.</p> }
              @else if (problem(); as current) { <p class="vt-invite__error" role="alert">{{ current.message }}</p> }
            </div>
          }
        }
        @case ('code') {
          <header class="vt-page-head">
            <p class="vt-page-kicker vt-page-head__kicker">Check your email</p>
            <h1 id="invite-title" class="vt-page-title vt-page-head__title" tabindex="-1" #heading>Enter your code</h1>
            <p class="vt-page-description vt-page-head__lead" id="otp-help">We sent a six-digit code to <strong>{{ invitation()?.destinationHint }}</strong>. It expires in 10 minutes.</p>
          </header>
          <div class="vt-invite__card">
            <form class="vt-form vt-invite__form" (submit)="verify($event)" novalidate>
              <label for="invite-otp">Six-digit code</label>
              <input #codeInput id="invite-otp" name="one-time-code" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code"
                maxlength="14" spellcheck="false" class="vt-invite__code" [value]="code()" [attr.aria-invalid]="problem() ? true : null"
                [attr.aria-describedby]="problem() ? 'otp-help otp-error' : 'otp-help'" [disabled]="busy()" (input)="updateCode($event)" (paste)="pasteCode($event)" />
              @if (!online()) { <p class="vt-invite__error" role="alert">You’re offline. Connect to the internet to receive and enter your code.</p> }
              @else if (problem(); as current) { <p id="otp-error" class="vt-invite__error" role="alert">{{ current.message }}</p> }
              <label class="vt-invite__remember"><input type="checkbox" [checked]="rememberDevice()" (change)="rememberDevice.set($any($event.target).checked)" [disabled]="busy()" /><span>Trust this device for 30 days. Don’t tick this on a shared device.</span></label>
              <button type="submit" class="vt-invite__primary" [disabled]="busy() || code().length !== 6 || !online()">{{ busy() ? 'Checking…' : 'Verify and open my trip' }}</button>
            </form>
            <button type="button" class="vt-invite__link" [disabled]="busy() || resendSeconds() > 0 || remainingSends() === 0 || !online()" (click)="sendCode()">
              {{ remainingSends() === 0 ? 'No more codes can be sent right now' : resendSeconds() > 0 ? 'Send a new code in ' + resendSeconds() + 's' : 'Send a new code' }}
            </button>
          </div>
        }
        @case ('unavailable') {
          <header class="vt-page-head">
            <p class="vt-page-kicker vt-page-head__kicker">Invitation</p>
            <h1 id="invite-title" class="vt-page-title vt-page-head__title" tabindex="-1" #heading>{{ problem()?.title }}</h1>
          </header>
          <div class="vt-invite__card">
            <p class="vt-invite__lead" role="alert">{{ problem()?.message }}</p>
            <p class="vt-invite__fine">Your travel agent can send you a fresh invitation at any time. Trips you’ve already opened stay in My trips on this device.</p>
          </div>
        }
        @case ('error') {
          <header class="vt-page-head">
            <p class="vt-page-kicker vt-page-head__kicker">Invitation</p>
            <h1 id="invite-title" class="vt-page-title vt-page-head__title" tabindex="-1" #heading>{{ problem()?.title }}</h1>
          </header>
          <div class="vt-invite__card">
            <p class="vt-invite__lead" role="alert">{{ problem()?.message }}</p>
            <button type="button" class="vt-invite__primary" [disabled]="busy()" (click)="retry()"><vt-icon name="refresh" [size]="18" /> Try again</button>
          </div>
        }
      }
    </section>
  `,
})
export class InvitationFlow {
  private readonly api = inject(VisionApiService);
  private readonly savedTrips = inject(SavedTripsStore);

  readonly token = input.required<string>();
  readonly online = input(true);
  readonly authorized = output<InvitationAuthorized>();
  readonly cancelled = output<void>();

  protected readonly step = signal<Step>('loading');
  protected readonly invitation = signal<InvitationState | null>(null);
  protected readonly problem = signal<Problem | null>(null);
  protected readonly code = signal('');
  protected readonly rememberDevice = signal(true);
  protected readonly busy = signal(false);
  protected readonly announcement = signal('');
  protected readonly resendSeconds = signal(0);
  protected readonly remainingSends = computed(() => this.invitation()?.otp.remainingSends ?? 1);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');
  private generation = 0;
  private resendTimer: ReturnType<typeof setInterval> | null = null;
  private focusTarget: 'heading' | 'code' | null = null;

  constructor() {
    effect(() => {
      const token = this.token();
      untracked(() => void this.start(token));
    });
    // Move focus to the new screen's heading (or the code field) after each step change, for screen readers.
    effect(() => {
      this.step();
      const heading = this.heading();
      const codeInput = this.codeInput();
      untracked(() => {
        const target = this.focusTarget === 'code' ? codeInput : heading;
        if (!target || !this.focusTarget) return;
        this.focusTarget = null;
        queueMicrotask(() => target.nativeElement.focus());
      });
    });
    inject(DestroyRef).onDestroy(() => { this.generation += 1; this.stopCountdown(); });
  }

  protected async retry(): Promise<void> {
    await this.start(this.token());
  }

  protected close(): void {
    this.generation += 1; // Anything still in flight now belongs to a closed screen.
    this.stopCountdown();
    this.cancelled.emit();
  }

  protected updateCode(event: Event): void {
    const input = event.target as HTMLInputElement;
    const clean = sanitizeOtp(input.value);
    if (input.value !== clean) input.value = clean;
    this.code.set(clean);
    if (this.problem()) this.problem.set(null);
    if (clean.length === 6) void this.submit();
  }

  protected pasteCode(event: ClipboardEvent): void {
    const pasted = event.clipboardData?.getData('text');
    if (pasted === undefined) return;
    event.preventDefault();
    const clean = sanitizeOtp(pasted);
    (event.target as HTMLInputElement).value = clean;
    this.code.set(clean);
    this.problem.set(null);
    if (clean.length === 6) void this.submit();
  }

  protected async sendCode(): Promise<void> {
    if (this.busy() || this.resendSeconds() > 0 || !this.online()) return;
    const generation = this.generation;
    this.busy.set(true);
    this.problem.set(null);
    this.announcement.set('Sending your code…');
    try {
      const otp = await this.api.sendInvitationCode(this.token());
      if (generation !== this.generation) return;
      this.invitation.update((current) => current ? { ...current, otp } : current);
      this.startCountdown(otp.resendAvailableAt);
      this.code.set('');
      this.focusTarget = 'code';
      this.step.set('code');
      this.announcement.set(`Code sent to ${this.invitation()?.destinationHint ?? 'your email'}.`);
    } catch (error) {
      if (generation !== this.generation) return;
      const failure = describe(error);
      if (failure.code === 'resend_cooldown' && failure.retryAfterSeconds) this.startCountdown(new Date(Date.now() + failure.retryAfterSeconds * 1000).toISOString());
      if (failure.code === 'send_limit') this.invitation.update((current) => current ? { ...current, otp: { ...current.otp, remainingSends: 0 } } : current);
      this.fail(failure);
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }

  protected async verify(event: Event): Promise<void> {
    event.preventDefault();
    await this.submit();
  }

  protected async openWithoutCode(): Promise<void> {
    if (this.busy() || !this.online()) return;
    const generation = this.generation;
    this.busy.set(true);
    this.problem.set(null);
    this.announcement.set('Opening your trip…');
    try {
      const result = await this.api.openInvitation(this.token(), await this.savedTrips.deviceTrusts());
      if (generation !== this.generation) return;
      this.announcement.set('Trip opened.');
      this.authorized.emit(result);
    } catch (error) {
      if (generation !== this.generation) return;
      const failure = describe(error);
      // The device is no longer trusted (expired or forgotten): fall back to an email code.
      if (failure.code === 'verification_required') this.invitation.update((current) => current ? { ...current, trustedDevice: false } : current);
      this.fail(failure);
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }

  private async submit(): Promise<void> {
    const code = this.code();
    if (this.busy() || code.length !== 6 || !this.online()) return;
    const generation = this.generation;
    this.busy.set(true);
    this.problem.set(null);
    this.announcement.set('Checking your code…');
    try {
      const result = await this.api.verifyInvitationCode(this.token(), code, this.rememberDevice());
      if (generation !== this.generation) return;
      this.announcement.set('Code accepted. Opening your trip.');
      this.stopCountdown();
      this.authorized.emit(result);
    } catch (error) {
      if (generation !== this.generation) return;
      const failure = describe(error);
      if (failure.code === 'code_invalid' || failure.code === 'code_expired' || failure.code === 'attempts_exhausted') {
        this.code.set('');
        const input = this.codeInput()?.nativeElement;
        if (input) input.value = ''; // The binding may not have rendered the typed value yet, so clear the field directly.
        this.focusTarget = 'code';
        if (failure.code === 'attempts_exhausted') this.invitation.update((current) => current ? { ...current, otp: { ...current.otp, remainingAttempts: 0 } } : current);
      }
      this.fail(failure);
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }

  private async start(token: string): Promise<void> {
    const generation = ++this.generation;
    this.stopCountdown();
    this.step.set('loading');
    this.invitation.set(null);
    this.problem.set(null);
    this.code.set('');
    this.busy.set(false);
    this.announcement.set('Checking your invitation…');
    try {
      const state = await this.api.resolveInvitation(token, await this.savedTrips.deviceTrusts());
      if (generation !== this.generation) return;
      this.invitation.set(state);
      this.startCountdown(state.otp.resendAvailableAt);
      this.focusTarget = state.otp.codeSentAt && !state.trustedDevice ? 'code' : 'heading';
      this.step.set(state.verification === 'email_otp' && state.otp.codeSentAt && !state.trustedDevice ? 'code' : 'welcome');
      this.announcement.set(`Invitation from ${state.brand.name}.`);
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(describe(error));
    }
  }

  private fail(failure: Failure): void {
    const problem = { title: failure.title, message: failure.message };
    this.problem.set(problem);
    this.announcement.set(failure.message);
    if (failure.terminal) { this.stopCountdown(); this.focusTarget = 'heading'; this.step.set('unavailable'); return; }
    if (this.step() === 'loading') { this.focusTarget = 'heading'; this.step.set('error'); }
  }

  private startCountdown(availableAt: string | null): void {
    this.stopCountdown();
    const update = () => {
      const seconds = availableAt ? Math.max(0, Math.ceil((Date.parse(availableAt) - Date.now()) / 1000)) : 0;
      this.resendSeconds.set(seconds);
      if (seconds === 0) this.stopCountdown();
    };
    update();
    if (this.resendSeconds() > 0) this.resendTimer = setInterval(update, 1000);
  }

  private stopCountdown(): void {
    if (this.resendTimer) clearInterval(this.resendTimer);
    this.resendTimer = null;
  }
}

interface Failure extends Problem { code: InvitationErrorCode | null; terminal: boolean; retryAfterSeconds?: number }

/** Turns an API error into a customer-safe message; never shows server internals. */
export function describe(error: unknown): Failure {
  if (!(error instanceof HttpErrorResponse)) return { code: null, terminal: false, title: 'Something went wrong', message: 'We couldn’t open your invitation. Please try again.' };
  if (error.status === 0) return { code: null, terminal: false, title: 'You’re offline', message: 'We can’t reach Vision Trips right now. Check your connection and try again.' };
  const body = invitationErrorSchema.safeParse(error.error);
  const code = body.success ? body.data.code : null;
  const message = body.success ? body.data.message : '';
  switch (code) {
    case 'invitation_invalid': return { code, terminal: true, title: 'This link isn’t valid', message };
    case 'invitation_expired': return { code, terminal: true, title: 'This invitation has expired', message };
    case 'invitation_revoked': return { code, terminal: true, title: 'This invitation was replaced', message };
    case 'invitation_consumed': return { code, terminal: true, title: 'This invitation has been used', message };
    case 'customer_unavailable': return { code, terminal: true, title: 'This invitation can’t be used', message };
    case null: break;
    default: return { code, terminal: false, title: 'Please try again', message, retryAfterSeconds: body.success ? body.data.retryAfterSeconds : undefined };
  }
  if (error.status >= 500) return { code: null, terminal: false, title: 'We’re having trouble', message: 'Our booking system is busy right now. Please try again in a minute.' };
  if (error.status === 429) return { code: null, terminal: false, title: 'Please wait', message: 'Lots of requests at once. Please wait a moment and try again.' };
  return { code: null, terminal: false, title: 'Something went wrong', message: 'We couldn’t open your invitation. Please try again.' };
}
