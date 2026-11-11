import { CurrencyPipe } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import type { PaymentSummary } from '@vision-trips/contracts';
import { EuropeanDatePipe } from '../../shared/european-date.pipe';

@Component({
  selector: 'app-payments-section',
  imports: [CurrencyPipe, EuropeanDatePipe],
  template: `
    <section class="vt-section vt-payments-screen" aria-labelledby="payments-title">
      <header class="vt-payments__heading">
        <p class="vt-page-kicker vt-payments__kicker">Your booking</p>
        <h1 id="payments-title" class="vt-page-title">Payments</h1>
      </header>

      <section class="vt-payment-card vt-payment-summary" aria-label="Payment summary">
        <div class="vt-payment-summary__total">
          <span>Total trip price</span>
          <strong [class.vt-money--unavailable]="payments().total === null">{{ money(payments().total, payments().currency) }}</strong>
        </div>
        <div class="vt-payment-summary__stats">
          <div>
            <span>Paid</span>
            <strong [class.vt-money--unavailable]="payments().paid === null">{{ money(payments().paid, payments().currency) }}</strong>
          </div>
          <div class="vt-payment-summary__balance" [class.is-paid]="payments().balance !== null && payments().balance! <= 0">
            <span>Balance</span>
            <strong [class.vt-money--unavailable]="payments().balance === null">{{ money(payments().balance, payments().currency) }}</strong>
            <small>{{ payments().balance === null ? 'Ask your travel agent' : payments().balance! > 0 ? 'Outstanding' : 'Paid in full' }}</small>
          </div>
        </div>
        <div class="vt-payment-progress__footer">
          <div class="vt-payment-progress__meta"><span>Payment progress</span><strong>{{ paidPercent() === null ? 'Not available' : paidPercent() + '% paid' }}</strong></div>
          <div class="vt-payment-progress" role="progressbar" aria-label="Trip price paid" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="paidPercent()">
            <span [style.width.%]="paidPercent() ?? 0"></span>
          </div>
        </div>
      </section>

      <section class="vt-payment-card vt-payment-schedule" aria-labelledby="payment-schedule-title">
        <header class="vt-payment-card__heading">
          <div>
            <h2 id="payment-schedule-title">Payment schedule</h2>
            <p>Deposits, instalments and completed payments</p>
          </div>
          <span>{{ payments().items.length }}</span>
        </header>
        <ul class="vt-payments" role="list">
          @for (payment of payments().items; track payment.id) {
            <li class="vt-pay" [class.is-paid]="payment.status === 'paid'" [class.is-overdue]="payment.status === 'overdue'" [class.is-refund]="payment.status === 'refund'" [class.is-resort]="payment.status === 'local'">
              <div class="vt-pay__main">
                <span class="vt-pay__label">{{ payment.label }}</span>
                <strong [class.vt-money--unavailable]="payment.amount === null">{{ money(payment.amount, payment.currency) }}</strong>
                @if (payment.dueDate) { <span class="vt-pay__date">Due {{ payment.dueDate | europeanDate }}</span> }
              </div>
              @if (payment.canPay) {
                <button type="button" class="vt-primary-action vt-pay__action" [disabled]="openingPaymentId() !== null || actionsDisabled()" (click)="pay.emit(payment.id)">{{ openingPaymentId() === payment.id ? 'Opening…' : 'Pay now' }}</button>
              } @else {
                <span class="vt-pay__status" [class.vt-pay__status--paid]="payment.status === 'paid'" [class.vt-pay__status--overdue]="payment.status === 'overdue'">{{ statusLabel(payment.status) }}</span>
              }
            </li>
          } @empty {
            <li class="vt-payment-schedule__empty">No scheduled payments yet.</li>
          }
        </ul>
      </section>

      @if (payments().customPayments.enabled) {
        <form class="vt-payment-card vt-custom-payment" (submit)="submitCustom($event)">
          <header>
            <h2>Pay another amount</h2>
            <p>Choose any amount up to your current balance.</p>
          </header>
          <label for="custom-payment">Amount</label>
          <div class="vt-custom-payment__field">
            <span aria-hidden="true">{{ payments().currency === 'GBP' ? '£' : payments().currency }}</span>
            <input id="custom-payment" type="number" inputmode="decimal" step="0.01" min="0.01" [max]="payments().customPayments.maximum" [value]="customAmount()" (input)="updateCustom($event)" placeholder="0.00">
          </div>
          <p class="vt-custom-payment__limit">Maximum {{ payments().customPayments.maximum | currency: payments().currency }}</p>
          <button type="submit" class="vt-primary-action vt-custom-payment__submit" [disabled]="actionsDisabled() || openingPaymentId() !== null || !validCustom()">{{ openingPaymentId() === 'custom' ? 'Opening…' : 'Pay securely' }}</button>
        </form>
      }
    </section>
  `,
})
export class PaymentsSection {
  readonly payments = input.required<PaymentSummary>();
  readonly openingPaymentId = input<string | null>(null);
  readonly actionsDisabled = input(false);
  readonly pay = output<string>();
  readonly payCustom = output<number>();
  protected readonly customAmount = signal('');
  protected readonly validCustom = computed(() => { const amount = Number(this.customAmount()); return Number.isFinite(amount) && amount >= 0.01 && amount <= this.payments().customPayments.maximum; });
  /** Null when either figure is unknown, so the bar never claims 0% or 100% by accident. */
  readonly paidPercent = computed(() => { const { total, paid } = this.payments(); return total !== null && paid !== null && total > 0 ? Math.min(100, Math.round(paid / total * 100)) : null; });
  /** A missing amount reads "Unavailable", never £0.00. */
  protected money(amount: number | null, currency: string): string {
    if (amount === null) return 'Unavailable';
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount); } catch { return `${amount.toFixed(2)} ${currency}`; }
  }
  protected statusLabel(status: PaymentSummary['items'][number]['status']): string { return status === 'local' ? 'Pay locally' : status; }
  protected updateCustom(event: Event): void { this.customAmount.set((event.target as HTMLInputElement).value); }
  protected submitCustom(event: Event): void { event.preventDefault(); if (this.validCustom()) this.payCustom.emit(Number(this.customAmount())); }
}
