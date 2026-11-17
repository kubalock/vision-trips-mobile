import { CurrencyPipe } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { formatPoints, type PaymentSummary, type TripLoyalty, type TripStage } from '@vision-trips/contracts';

function formatDay(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(value.getTime()) ? date : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(value);
}
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
          @if (perPerson() !== null) { <small class="vt-payment-summary__pp">{{ money(perPerson(), payments().currency) }} per person</small> }
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

      @if (loyalty(); as points) {
        <section class="vt-payment-card vt-loyalty-card" aria-labelledby="loyalty-title">
          <h2 id="loyalty-title"><span aria-hidden="true">★</span> Loyalty points @if (points.vip) { <span class="vt-vip-pill">VIP</span> }</h2>
          @if (earnedLine(); as line) { <p>{{ line }}</p> }
          @if (points.available !== null && points.available > 0) {
            <p>You have <strong>{{ pointsLabel(points.available) }}</strong>@if (points.availableValue !== null && points.availableValue > 0) { (worth {{ money(points.availableValue, points.currency) }}) } to put towards {{ stage() === 'quote' ? 'this trip' : 'your next trip' }}.</p>
          }
        </section>
      }

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
                @if (payment.kind === 'points') {
                  <strong>★ {{ payment.points !== null && payment.points !== undefined ? pointsLabel(payment.points) : 'Points' }}</strong>
                } @else {
                  <strong [class.vt-money--unavailable]="payment.amount === null">{{ money(payment.amount, payment.currency) }}</strong>
                }
                @if (payment.dueDate) { <span class="vt-pay__date">Due {{ payment.dueDate | europeanDate }}</span> }
              </div>
              @if (awaitingAcceptance() && isFirstOutstanding(payment.id)) {
                <!-- A quotation is never paid directly: the deposit is taken at the end of the acceptance. -->
                <button type="button" class="vt-primary-action vt-pay__action" [disabled]="actionsDisabled()" (click)="accept.emit()">Accept and pay deposit</button>
              } @else if (payment.canPay && !awaitingAcceptance()) {
                <button type="button" class="vt-primary-action vt-pay__action" [disabled]="openingPaymentId() !== null || actionsDisabled()" (click)="pay.emit(payment.id)">{{ openingPaymentId() === payment.id ? 'Opening…' : 'Pay now' }}</button>
              } @else if (payment.kind === 'points') {
                <span class="vt-pay__status vt-pay__status--paid">Loyalty points</span>
              } @else {
                <span class="vt-pay__status" [class.vt-pay__status--paid]="payment.status === 'paid'" [class.vt-pay__status--overdue]="payment.status === 'overdue'">{{ statusLabel(payment.status) }}</span>
              }
            </li>
          } @empty {
            <li class="vt-payment-schedule__empty">No scheduled payments yet.</li>
          }
        </ul>
      </section>

      @if (payments().customPayments.enabled && !awaitingAcceptance() && stage() !== 'quote') {
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
  readonly stage = input<TripStage | null>(null);
  /** True on a quotation the customer can still accept: no payment is offered, only "Accept and pay deposit". */
  readonly awaitingAcceptance = input(false);
  readonly travellerCount = input(0);
  readonly loyalty = input<TripLoyalty | null | undefined>(null);
  /** Wording follows the state; a missing points figure shows no line rather than "0 points". */
  protected readonly earnedLine = computed(() => {
    const loyalty = this.loyalty();
    if (!loyalty || loyalty.pointsEarned === null || loyalty.pointsEarned <= 0) return null;
    const points = formatPoints(loyalty.pointsEarned);
    switch (loyalty.state) {
      case 'quote': return `Book with us and earn ${points}.`;
      case 'awarded': return `You earned ${points} on this trip.`;
      case 'post_return': return `This trip earns you ${points}, which will be credited shortly.`;
      default: return `This trip earns you ${points}, credited after you return${loyalty.eligibleFrom ? ` on ${formatDay(loyalty.eligibleFrom)}` : ''}.`;
    }
  });
  readonly accept = output<void>();
  readonly pay = output<string>();
  /** The booking's own figure, otherwise the total shared out; only with more than one traveller, never a made-up 0. */
  protected readonly perPerson = computed(() => {
    const own = this.payments().perPerson;
    if (this.travellerCount() < 2) return null;
    if (own !== null && own !== undefined) return own;
    const total = this.payments().total;
    return total !== null && total > 0 ? Math.round(total / this.travellerCount() * 100) / 100 : null;
  });
  protected isFirstOutstanding(id: string): boolean { return this.payments().items.find((item) => item.status === 'outstanding' || item.status === 'overdue')?.id === id; }
  protected pointsLabel(points: number): string { return formatPoints(points); }
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
