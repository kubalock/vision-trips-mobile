import { CurrencyPipe } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { formatPoints, type CustomerLoyalty, type PaymentSummary, type TripLoyalty, type TripStage } from '@vision-trips/contracts';

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
          <div class="vt-payment-summary__balance" [class.is-paid]="payments().balance !== null && payments().balance! <= 0" [class.is-overdue]="hasOverdue() && payments().balance !== null && payments().balance! > 0" [class.is-unknown]="payments().balance === null" [class.is-quote]="awaitingAcceptance() && !hasOverdue()">
            <span>Balance</span>
            <strong [class.vt-money--unavailable]="payments().balance === null">{{ money(payments().balance, payments().currency) }}</strong>
            <small>{{ payments().balance === null ? 'Ask your travel expert' : payments().balance! > 0 ? (hasOverdue() ? overdueLabel() : awaitingAcceptance() ? 'On acceptance' : 'Outstanding') : 'Paid in full' }}</small>
          </div>
        </div>
        <div class="vt-payment-progress__footer">
          <div class="vt-payment-progress__meta"><span>Payment progress</span><strong>{{ paidLabel() }}</strong></div>
          <div class="vt-payment-progress" role="progressbar" aria-label="Trip price paid" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="paidPercent()">
            <span [style.width.%]="paidPercent() ?? 0"></span>
          </div>
        </div>
      </section>

      @if (loyalty(); as points) {
        <section class="vt-payment-card vt-loyalty-card" aria-labelledby="loyalty-title">
          <h2 id="loyalty-title"><span aria-hidden="true">★</span> Loyalty points @if (vip()) { <span class="vt-vip-pill">VIP</span> }</h2>
          @if (earnedLine(); as line) { <p>{{ line }}</p> }
          @if (balance(); as own) { @if (own.available !== null && own.available > 0) {
            <p>You have <strong>{{ pointsLabel(own.available) }}</strong>@if (own.availableValue !== null && own.availableValue > 0) { (worth {{ money(own.availableValue, own.currency) }}) } to put towards {{ stage() === 'quote' ? 'this trip' : 'your next trip' }}.</p>
          } }
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
            <li class="vt-pay" [class.is-paid]="payment.status === 'paid'" [class.is-overdue]="isOverdue(payment)" [class.is-refund]="payment.status === 'refund'" [class.is-resort]="payment.status === 'local'">
              <div class="vt-pay__main">
                <span class="vt-pay__label">{{ payment.label }}</span>
                @if (payment.kind === 'points') {
                  <strong>★ {{ payment.points !== null && payment.points !== undefined ? pointsLabel(payment.points) : 'Points' }}</strong>
                } @else {
                  <strong [class.vt-money--unavailable]="payment.amount === null">{{ money(payment.amount, payment.currency) }}</strong>
                }
                @if (payment.status === 'paid' && payment.completedDate) {
                  <span class="vt-pay__date">Paid {{ payment.completedDate | europeanDate }}</span>
                } @else if (payment.dueDate) {
                  @let due = dueState(payment);
                  <span class="vt-pay__date" [class.is-overdue]="due === 'overdue'" [class.is-today]="due === 'today'">{{ due === 'overdue' ? 'Overdue · was due' : due === 'today' ? 'Due today ·' : due === 'lapsed' ? 'Was due' : 'Due' }} {{ payment.dueDate | europeanDate }}{{ due === 'lapsed' ? ' · your travel expert will confirm new dates when you accept' : '' }}</span>
                }
              </div>
              @if (awaitingAcceptance() && isFirstOutstanding(payment.id)) {
                <!-- A quotation is never paid directly: the deposit is taken at the end of the acceptance. -->
                <button type="button" class="vt-primary-action vt-pay__action" [disabled]="actionsDisabled()" (click)="accept.emit()">Accept and pay deposit</button>
              } @else if (payment.canPay && !awaitingAcceptance()) {
                <button type="button" class="vt-primary-action vt-pay__action" [disabled]="openingPaymentId() !== null || actionsDisabled()" (click)="pay.emit(payment.id)">{{ openingPaymentId() === payment.id ? 'Opening…' : 'Pay now' }}</button>
              } @else if (payment.kind === 'points') {
                <span class="vt-pay__status vt-pay__status--paid">Loyalty points</span>
              } @else {
                <span class="vt-pay__status" [class.vt-pay__status--paid]="payment.status === 'paid'" [class.vt-pay__status--due]="payment.status === 'outstanding' && !awaitingAcceptance()" [class.vt-pay__status--overdue]="isOverdue(payment)">{{ awaitingAcceptance() && (payment.status === 'outstanding' || payment.status === 'overdue') ? 'On acceptance' : statusLabel(payment.status) }}</span>
              }
            </li>
          } @empty {
            <li class="vt-payment-schedule__empty">No scheduled payments yet.</li>
          }
        </ul>
        @if (unscheduled(); as rest) {
          <p class="vt-payment-schedule__unscheduled">{{ money(rest, payments().currency) }} of your balance isn’t scheduled yet. Your travel expert will let you know when it’s due.</p>
        }
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
  /** The verified customer's own balance, from the account endpoint (never from the shared booking snapshot). */
  readonly balance = input<CustomerLoyalty | null | undefined>(null);
  readonly vip = input(false);
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
  /** The summary pill and the row pills use the same states: paid (green), due (amber), overdue (red), other (grey). */
  /** Owed amounts on the schedule; null when any is unknown or in another currency, so nothing is guessed. */
  private readonly scheduledOwed = computed(() => {
    const { items, currency } = this.payments();
    const owed = items.filter((item) => item.status === 'outstanding' || item.status === 'overdue');
    if (owed.some((item) => item.kind === 'points' || item.amount === null || item.currency !== currency)) return null;
    return { all: owed.reduce((sum, item) => sum + (item.amount ?? 0), 0), overdue: owed.filter((item) => this.isOverdue(item)).reduce((sum, item) => sum + (item.amount ?? 0), 0) };
  });
  /** "£1.00 overdue" when only part of the balance is late, so the whole balance never reads as overdue. */
  protected overdueLabel(): string {
    const owed = this.scheduledOwed(); const balance = this.payments().balance;
    return owed && balance !== null && owed.overdue > 0 && owed.overdue < balance - 0.005 ? `${this.money(owed.overdue, this.payments().currency)} overdue` : 'Overdue';
  }
  /** The part of the balance with no payment on the schedule (e.g. a balance the agent hasn't set a date for yet). */
  protected readonly unscheduled = computed(() => {
    const owed = this.scheduledOwed(); const balance = this.payments().balance;
    if (!owed || balance === null) return null;
    const rest = Math.round((balance - owed.all) * 100) / 100;
    return rest > 0.005 ? rest : null;
  });
  protected hasOverdue(): boolean { return this.payments().items.some((item) => this.isOverdue(item)); }
  /** Nothing is owed on a quotation until it is accepted, so it is never overdue (even from an older saved copy). */
  protected isOverdue(payment: PaymentSummary['items'][number]): boolean { return payment.status === 'overdue' && !this.awaitingAcceptance(); }
  protected isFirstOutstanding(id: string): boolean { return this.payments().items.find((item) => item.status === 'outstanding' || item.status === 'overdue')?.id === id; }
  protected pointsLabel(points: number): string { return formatPoints(points); }
  readonly payCustom = output<number>();
  protected readonly customAmount = signal('');
  protected readonly validCustom = computed(() => { const amount = Number(this.customAmount()); return Number.isFinite(amount) && amount >= 0.01 && amount <= this.payments().customPayments.maximum; });
  /** "Less than 1% paid" rather than "0% paid" once something is paid, and never "100%" while money is still owed. */
  protected paidLabel(): string {
    const percent = this.paidPercent(); const { paid, balance } = this.payments();
    if (percent === null) return 'Not available';
    if (percent === 0 && (paid ?? 0) > 0) return 'Less than 1% paid';
    if (percent === 100 && (balance ?? 0) > 0) return '99% paid';
    return `${percent}% paid`;
  }
  /** Null when either figure is unknown, so the bar never claims 0% or 100% by accident. */
  readonly paidPercent = computed(() => { const { total, paid } = this.payments(); return total !== null && paid !== null && total > 0 ? Math.min(100, Math.round(paid / total * 100)) : null; });
  /** A missing amount reads "Unavailable", never £0.00. */
  protected money(amount: number | null, currency: string): string {
    if (amount === null) return 'Unavailable';
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount); } catch { return `${amount.toFixed(2)} ${currency}`; }
  }
  /** Overdue as the booking says; "today" for anything still owed on its due date (local calendar day). */
  /** On a quotation awaiting acceptance a past date is "lapsed": shown neutrally, since nothing is owed yet. */
  protected dueState(payment: PaymentSummary['items'][number]): 'overdue' | 'today' | 'lapsed' | null {
    if (payment.status !== 'outstanding' && payment.status !== 'overdue') return null;
    if (!payment.dueDate) return null;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const due = payment.dueDate.slice(0, 10);
    if (this.awaitingAcceptance()) return due < today ? 'lapsed' : due === today ? 'today' : null;
    if (payment.status === 'overdue') return 'overdue';
    return due === today ? 'today' : null;
  }
  protected statusLabel(status: PaymentSummary['items'][number]['status']): string { return status === 'local' ? 'Pay locally' : status; }
  protected updateCustom(event: Event): void { this.customAmount.set((event.target as HTMLInputElement).value); }
  protected submitCustom(event: Event): void { event.preventDefault(); if (this.validCustom()) this.payCustom.emit(Number(this.customAmount())); }
}
