import { Component, input, output } from '@angular/core';
import { VtIcon } from './lucide-icon';

/**
 * Shown in place of an action that needs a live session (sending a message, sharing, accepting, paying, account) on
 * a saved trip the traveller is signed out of. Says why it's unavailable and how to get it back, instead of a control
 * that silently does nothing. Viewing the saved trip and its offline documents keeps working.
 */
@Component({
  selector: 'vt-sign-in-again',
  imports: [VtIcon],
  host: { class: 'vt-sign-in-again' },
  template: `
    <section class="vt-status-card vt-sign-in-again__card" data-tone="info" role="note">
      <span class="vt-status-card__icon" aria-hidden="true"><vt-icon name="lock" [size]="20" /></span>
      <div class="vt-status-card__copy">
        <strong>Sign in again to continue</strong>
        <p>To {{ action() }}, open your newest invitation link from {{ brandName() || 'your travel company' }} on this device. If it has expired or been used, ask them for a new one.</p>
        @if (showHelp()) { <button type="button" class="vt-status-card__action" data-engagement="Sign in again help" (click)="help.emit()">Contact {{ brandName() || 'your travel company' }}</button> }
      </div>
    </section>
  `,
})
export class VtSignInAgain {
  /** What the traveller wanted to do, completing "To …": e.g. "send a message". */
  readonly action = input.required<string>();
  readonly brandName = input<string | null>(null);
  /** Offer a way to the Help screen (its phone and email links work without signing in). */
  readonly showHelp = input(false);
  readonly help = output<void>();
}
