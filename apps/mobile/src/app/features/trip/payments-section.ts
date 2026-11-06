import { CurrencyPipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
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
    </section>
  `,
})
export class PaymentsSection {
  readonly payments = input.required<PaymentSummary>();
  readonly openingPaymentId = input<string | null>(null);
  readonly actionsDisabled = input(false);
  readonly pay = output<string>();
  readonly paidPercent = computed(() => this.payments().total > 0 ? Math.min(100, Math.round(this.payments().paid / this.payments().total * 100)) : 0);
}
