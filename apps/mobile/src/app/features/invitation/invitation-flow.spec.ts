import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { InvitationAuthorized, InvitationState } from '@vision-trips/contracts';
import { VisionApiService } from '../../core/api/vision-api.service';
import { InvitationFlow, sanitizeOtp } from './invitation-flow';

const TOKEN = 'vt_abcdefghijklmnopqrstuvwxyzABCDEF';
const OTHER = 'vt_ZYXWVUTSRQPONMLKJIHGFEDCBAzyxwvu';

function state(overrides: Partial<InvitationState> = {}): InvitationState {
  return {
    status: 'pending', brand: { name: 'Example Travel', logoUrl: null, primaryColor: '#155B75' }, scope: 'primary_customer', verification: 'email_otp',
    destinationHint: 'gr***@example.com', expiresAt: new Date(Date.now() + 86_400_000).toISOString(), trustedDevice: false,
    otp: { codeSentAt: null, codeExpiresAt: null, resendAvailableAt: null, remainingSends: 5, remainingAttempts: 5 },
    ...overrides,
  };
}

const otpSent = (seconds = 60) => ({ codeSentAt: new Date().toISOString(), codeExpiresAt: new Date(Date.now() + 600_000).toISOString(), resendAvailableAt: new Date(Date.now() + seconds * 1000).toISOString(), remainingSends: 4, remainingAttempts: 5 });
const authorized = { status: 'authorized', snapshot: { tripId: 'trip-1' }, session: { accessToken: 'a', accessExpiresAt: 'x', refreshToken: 'r', refreshExpiresAt: 'x' } } as unknown as InvitationAuthorized;
const apiError = (status: number, code: string, message = 'Server message', extra: object = {}) => new HttpErrorResponse({ status, error: { statusCode: status, code, message, ...extra } });

async function render(token = TOKEN) {
  const api = TestBed.inject(VisionApiService);
  const fixture = TestBed.createComponent(InvitationFlow);
  fixture.componentRef.setInput('token', token);
  const emitted: InvitationAuthorized[] = [];
  let cancelled = 0;
  fixture.componentInstance.authorized.subscribe((value) => emitted.push(value));
  fixture.componentInstance.cancelled.subscribe(() => { cancelled += 1; });
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => { await new Promise((resolve) => setTimeout(resolve)); await fixture.whenStable(); };
  const button = (text: string) => [...element.querySelectorAll('button')].find((item) => item.textContent?.includes(text)) as HTMLButtonElement | undefined;
  return { api, fixture, element, emitted, cancelledCount: () => cancelled, settle, button };
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('sanitizeOtp', () => {
  it('keeps only the first six digits', () => {
    expect(sanitizeOtp(' 12-3 4a56 7')).toBe('123456');
    expect(sanitizeOtp('abc')).toBe('');
  });
});

describe('InvitationFlow', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [InvitationFlow], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows a branded welcome with only a masked email and a clear button', async () => {
    const view = await render();
    vi.spyOn(view.api, 'resolveInvitation').mockResolvedValue(state());
    view.fixture.componentRef.setInput('token', TOKEN);
    await view.settle();
    expect(view.element.querySelector('h1')?.textContent).toContain('Welcome');
    expect(view.element.textContent).toContain('Example Travel');
    expect(view.element.textContent).toContain('gr***@example.com');
    expect(view.button('Send my code')).toBeTruthy();
    expect(view.element.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it('sends a code, then shows an accessible numeric code field with a resend countdown', async () => {
    const view = await render();
    vi.spyOn(view.api, 'resolveInvitation').mockResolvedValue(state());
    const send = vi.spyOn(view.api, 'sendInvitationCode').mockResolvedValue(otpSent(45));
    await view.settle();
    view.button('Send my code')!.click();
    await view.settle();

    expect(send).toHaveBeenCalledWith(TOKEN);
    const input = view.element.querySelector<HTMLInputElement>('#invite-otp')!;
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    expect(view.element.querySelector('label[for="invite-otp"]')?.textContent).toContain('Six-digit code');
    expect(view.button('Send a new code in')?.disabled).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it('cleans typed and pasted codes and submits exactly once', async () => {
    const view = await render();
    vi.spyOn(view.api, 'resolveInvitation').mockResolvedValue(state({ otp: otpSent() }));
    let finish!: (value: InvitationAuthorized) => void;
    const verify = vi.spyOn(view.api, 'verifyInvitationCode').mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await view.settle();

    const input = view.element.querySelector<HTMLInputElement>('#invite-otp')!;
    type(input, '12 3-45');
    expect(input.value).toBe('12345');
    const paste = new Event('paste', { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => ' 123 456 ' } });
    input.dispatchEvent(paste);
    await view.settle();
    view.element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await view.settle();

    expect(verify).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledWith(TOKEN, '123456', true);
    expect(view.button('Checking…')?.disabled).toBe(true);
    finish(authorized);
    await view.settle();
    expect(view.emitted).toEqual([authorized]);
  });

  it('explains a wrong code and the attempts left, then the attempt limit', async () => {
    const view = await render();
    vi.spyOn(view.api, 'resolveInvitation').mockResolvedValue(state({ otp: otpSent() }));
    vi.spyOn(view.api, 'verifyInvitationCode')
      .mockRejectedValueOnce(apiError(401, 'code_invalid', 'That code isn’t right. 4 attempts left.', { remainingAttempts: 4 }))
      .mockRejectedValueOnce(apiError(429, 'attempts_exhausted', 'Too many incorrect codes. Ask for a new code to try again.'));
    await view.settle();
    const input = view.element.querySelector<HTMLInputElement>('#invite-otp')!;

    type(input, '000000');
    await view.settle();
    expect(view.element.querySelector('[role="alert"]')?.textContent).toContain('4 attempts left');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.value).toBe('');

    type(input, '111111');
    await view.settle();
    expect(view.element.querySelector('[role="alert"]')?.textContent).toContain('Ask for a new code');
  });

  it.each([
    ['invitation_expired', 'This invitation has expired'],
    ['invitation_consumed', 'This invitation has been used'],
    ['invitation_revoked', 'This invitation was replaced'],
    ['invitation_invalid', 'This link isn’t valid'],
  ])('shows a recovery screen for %s', async (code, title) => {
    const view = await render();
    vi.spyOn(view.api, 'resolveInvitation').mockRejectedValue(apiError(410, code, 'Ask your travel agent to send you a new one.'));
    view.fixture.componentRef.setInput('token', OTHER);
    await view.settle();
    expect(view.element.querySelector('h1')?.textContent).toContain(title);
    expect(view.element.textContent).toContain('Ask your travel agent');
    expect(view.button('Send my code')).toBeUndefined();
    view.button('Back')!.click();
    expect(view.cancelledCount()).toBe(1);
  });

  it('offers a retry when the network fails, instead of a blank screen', async () => {
    const view = await render();
    const resolve = vi.spyOn(view.api, 'resolveInvitation').mockRejectedValueOnce(new HttpErrorResponse({ status: 0 })).mockResolvedValueOnce(state());
    view.fixture.componentRef.setInput('token', OTHER);
    await view.settle();
    expect(view.element.querySelector('h1')?.textContent).toContain('offline');
    view.button('Try again')!.click();
    await view.settle();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(view.button('Send my code')).toBeTruthy();
  });

  it('disables sending while offline and says why', async () => {
    const view = await render();
    vi.spyOn(view.api, 'resolveInvitation').mockResolvedValue(state());
    view.fixture.componentRef.setInput('online', false);
    await view.settle();
    expect(view.button('Send my code')?.disabled).toBe(true);
    expect(view.element.textContent).toContain('You’re offline');
  });

  it('drops a verification that finishes after another invitation was opened', async () => {
    const view = await render();
    vi.spyOn(view.api, 'resolveInvitation').mockResolvedValueOnce(state({ otp: otpSent() })).mockReturnValueOnce(new Promise(() => undefined));
    let finish!: (value: InvitationAuthorized) => void;
    vi.spyOn(view.api, 'verifyInvitationCode').mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await view.settle();
    type(view.element.querySelector<HTMLInputElement>('#invite-otp')!, '123456');
    await view.settle();

    view.fixture.componentRef.setInput('token', OTHER); // A second invitation link arrives mid-verification.
    await view.settle();
    finish(authorized);
    await view.settle();
    expect(view.emitted).toEqual([]);
  });

  it('ignores late results after the customer chooses “Not now”', async () => {
    const view = await render();
    let finish!: (value: InvitationState) => void;
    vi.spyOn(view.api, 'resolveInvitation').mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await view.settle();
    view.button('Not now')!.click();
    finish(state());
    await view.settle();
    expect(view.cancelledCount()).toBe(1);
    expect(view.button('Send my code')).toBeUndefined();
  });

  it('opens directly on a trusted device, and falls back to a code if trust has lapsed', async () => {
    const view = await render();
    vi.spyOn(view.api, 'resolveInvitation').mockResolvedValue(state({ trustedDevice: true }));
    const open = vi.spyOn(view.api, 'openInvitation').mockRejectedValueOnce(apiError(403, 'verification_required', 'Confirm it’s you with a code sent to your email.')).mockResolvedValueOnce(authorized);
    await view.settle();
    view.button('Open my trip')!.click();
    await view.settle();
    expect(open).toHaveBeenCalledWith(TOKEN, []);
    expect(view.button('Send my code')).toBeTruthy();
    expect(view.emitted).toEqual([]);
  });

  it('opens a fellow-traveller share link without a code', async () => {
    const view = await render();
    vi.spyOn(view.api, 'resolveInvitation').mockResolvedValue(state({ verification: 'none', scope: 'fellow_traveller', destinationHint: null }));
    vi.spyOn(view.api, 'openInvitation').mockResolvedValue(authorized);
    await view.settle();
    expect(view.element.textContent).toContain('Prices and payments aren’t included');
    view.button('Open the trip')!.click();
    await view.settle();
    expect(view.emitted).toEqual([authorized]);
  });

  it('starts the resend countdown when the server says to wait', async () => {
    const view = await render();
    vi.spyOn(view.api, 'resolveInvitation').mockResolvedValue(state());
    vi.spyOn(view.api, 'sendInvitationCode').mockRejectedValue(apiError(429, 'resend_cooldown', 'Please wait a moment before asking for another code.', { retryAfterSeconds: 30 }));
    await view.settle();
    view.button('Send my code')!.click();
    await view.settle();
    expect(view.button('Send my code in')?.disabled).toBe(true);
    expect(view.element.querySelector('[role="alert"]')?.textContent).toContain('Please wait');
  });
});
