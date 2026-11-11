import { TestBed } from '@angular/core/testing';
import type { PaymentSummary } from '@vision-trips/contracts';
import { PaymentsSection } from './payments-section';

function summary(overrides: Partial<PaymentSummary>): PaymentSummary {
  return {
    currency: 'GBP', total: 500, paid: 2, balance: 498, items: [], totalIncludingResort: null, nextDueAmount: null,
    nextDueDate: null, balanceDueDate: null, alternativeCurrency: null, customPayments: { enabled: false, minimum: 0.01, maximum: 0 },
    ...overrides,
  };
}

describe('PaymentsSection', () => {
  function render(payments: PaymentSummary): HTMLElement {
    const fixture = TestBed.createComponent(PaymentsSection);
    fixture.componentRef.setInput('payments', payments);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows missing figures as unavailable instead of £0.00 or "Paid in full"', () => {
    const text = render(summary({ total: null, paid: null, balance: null, items: [{ id: 'p1', label: 'Deposit', amount: null, currency: 'GBP', status: 'outstanding', dueDate: null, completedDate: null, canPay: false, actionUrl: null }] })).textContent ?? '';
    expect(text).toContain('Unavailable');
    expect(text).not.toContain('£0.00');
    expect(text).not.toContain('Paid in full');
    expect(text).toContain('Ask your travel agent');
    expect(text).toContain('Not available');
  });

  it('shows known figures in the booking currency', () => {
    const text = render(summary({ currency: 'EUR', total: 1000, paid: 250, balance: 750 })).textContent ?? '';
    expect(text).toContain('€1,000.00');
    expect(text).toContain('25% paid');
  });
});
