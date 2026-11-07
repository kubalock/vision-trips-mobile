import { CurrencyPipe } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import type { PaymentSummary } from '@vision-trips/contracts';

@Component({
  selector: 'app-payments-section',
  imports: [CurrencyPipe],
  template: `
    <section class="vt-section" aria-labelledby="payments-title">
      <h2 id="payments-title" class="vt-h2">Payments</h2>
      <div class="vt-totals">
        <div class="vt-totals__main"><span class="vt-totals__label">Total trip price</span><strong class="vt-totals__amount">{{ payments().total | currency: payments().currency }}</strong></div>
        <div class="vt-totals__split"><div><span>Paid</span><strong>{{ payments().paid | currency: payments().currency }}</strong></div><div><span>Balance</span><strong>{{ payments().balance | currency: payments().currency }}</strong></div></div>
      </div>
      <ul class="vt-payments" role="list">
        @for (payment of payments().items; track payment.id) {
          <li class="vt-pay" [class.is-paid]="payment.status === 'paid'" [class.is-overdue]="payment.status === 'overdue'" [class.is-refund]="payment.status === 'refund'" [class.is-resort]="payment.status === 'local'">
            <div class="vt-pay__main"><strong>{{ payment.amount | currency: payment.currency }}</strong><span class="vt-pay__label">{{ payment.label }}{{ payment.dueDate ? ' · ' + payment.dueDate : '' }}</span></div>
            @if (payment.canPay) { <button type="button" class="vt-btn vt-btn--primary vt-btn--sm vt-pay__action" [disabled]="openingPaymentId() !== null || actionsDisabled()" (click)="pay.emit(payment.id)">{{ openingPaymentId() === payment.id ? 'Opening…' : 'Pay now' }}</button> }
            @else { <span class="vt-small">{{ payment.status }}</span> }
          </li>
        }
      </ul>
      @if (payments().customPayments.enabled) {
        <form class="mt-5 rounded-2xl bg-white p-5 ring-1 ring-slate-200" (submit)="submitCustom($event)">
          <h3 class="font-semibold">Pay another amount</h3><p class="mt-1 text-sm text-slate-600">Choose any amount up to your current balance.</p>
          <label for="custom-payment" class="mt-4 block text-sm font-semibold">Amount</label><div class="mt-2 flex items-center gap-2"><span class="text-lg font-semibold">{{ payments().currency === 'GBP' ? '£' : payments().currency }}</span><input id="custom-payment" type="number" inputmode="decimal" step="0.01" min="0.01" [max]="payments().customPayments.maximum" [value]="customAmount()" (input)="updateCustom($event)" class="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3"><button type="submit" class="vt-btn vt-btn--primary vt-btn--sm" [disabled]="actionsDisabled() || openingPaymentId() !== null || !validCustom()">{{ openingPaymentId() === 'custom' ? 'Opening…' : 'Pay' }}</button></div>
          <p class="mt-2 text-xs text-slate-500">Maximum {{ payments().customPayments.maximum | currency: payments().currency }}</p>
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
  readonly paidPercent = computed(() => this.payments().total > 0 ? Math.min(100, Math.round(this.payments().paid / this.payments().total * 100)) : 0);
  protected updateCustom(event: Event): void { this.customAmount.set((event.target as HTMLInputElement).value); }
  protected submitCustom(event: Event): void { event.preventDefault(); if (this.validCustom()) this.payCustom.emit(Number(this.customAmount())); }
}
