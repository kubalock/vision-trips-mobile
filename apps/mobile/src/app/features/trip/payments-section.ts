import { CurrencyPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import type { PaymentSummary } from '@vision-trips/contracts';

@Component({
  selector: 'app-payments-section',
  imports: [CurrencyPipe],
  template: `
    <section class="mt-8" aria-labelledby="payments-title">
      <h2 id="payments-title" class="text-2xl font-semibold tracking-tight">Payments</h2>
      <div class="mt-4 rounded-2xl bg-slate-900 p-5 text-white">
        <p class="text-sm text-slate-300">Total trip price</p>
        <p class="mt-1 text-3xl font-semibold">{{ payments().total | currency: payments().currency }}</p>
        <div class="mt-5 h-2 overflow-hidden rounded-full bg-white/20"><span class="block h-full rounded-full bg-teal-400" [style.width.%]="paidPercent()"></span></div>
        <div class="mt-3 flex justify-between text-sm"><span>Paid {{ payments().paid | currency: payments().currency }}</span><span>Balance {{ payments().balance | currency: payments().currency }}</span></div>
      </div>
      <ul class="mt-3 grid gap-2">
        @for (payment of payments().items; track payment.id) {
          <li class="flex items-center justify-between rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <div><strong>{{ payment.amount | currency: payment.currency }}</strong><p class="text-sm text-slate-500">{{ payment.label }}{{ payment.dueDate ? ' · ' + payment.dueDate : '' }}</p></div>
            <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase">{{ payment.status }}</span>
          </li>
        }
      </ul>
    </section>
  `,
})
export class PaymentsSection {
  readonly payments = input.required<PaymentSummary>();
  readonly paidPercent = computed(() => this.payments().total > 0 ? Math.min(100, Math.round(this.payments().paid / this.payments().total * 100)) : 0);
}
