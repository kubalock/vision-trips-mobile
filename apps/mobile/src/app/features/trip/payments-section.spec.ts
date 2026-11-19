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
    expect(text).toContain('Ask your travel expert');
    expect(text).toContain('Not available');
  });

  it('gives the summary and each row the same pill for the same state', () => {
    const row = (id: string, status: string) => ({ id, label: id, amount: 100, currency: 'GBP', status, dueDate: null, completedDate: null, canPay: false, actionUrl: null });
    const element = render(summary({ total: 300, paid: 100, balance: 200, items: [row('Deposit', 'paid'), row('Instalment', 'overdue'), row('Balance', 'outstanding')] } as Partial<PaymentSummary>));
    const pills = [...element.querySelectorAll('.vt-pay__status')].map((pill) => [pill.textContent?.trim(), pill.className.replace('vt-pay__status ', '').trim()]);
    expect(pills).toEqual([['paid', 'vt-pay__status--paid'], ['overdue', 'vt-pay__status--overdue'], ['outstanding', 'vt-pay__status--due']]);
    const balance = element.querySelector('.vt-payment-summary__balance')!;
    expect(balance.classList.contains('is-overdue')).toBe(true);
    expect(balance.querySelector('small')?.textContent?.trim()).toBe('£100.00 overdue'); // Only part of the £200 balance is late.
  });

  it('never shows a quotation awaiting acceptance as overdue, even from an older saved copy', () => {
    const fixture = TestBed.createComponent(PaymentsSection);
    const row = (id: string, status: string) => ({ id, label: id, amount: 100, currency: 'GBP', status, dueDate: '2020-01-01', completedDate: null, canPay: false, actionUrl: null });
    fixture.componentRef.setInput('payments', summary({ total: 200, paid: 0, balance: 200, items: [row('Deposit', 'outstanding'), row('Balance', 'overdue')] } as Partial<PaymentSummary>));
    fixture.componentRef.setInput('stage', 'quote');
    fixture.componentRef.setInput('awaitingAcceptance', true);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.is-overdue')).toBeNull();
    expect(element.querySelector('.vt-pay__status--overdue')).toBeNull();
    expect(element.querySelector('.vt-pay__status')?.textContent?.trim()).toBe('On acceptance');
    expect(element.querySelector('.vt-payment-summary__balance small')?.textContent?.trim()).toBe('On acceptance');
    expect(element.querySelector('.vt-payment-summary__balance')?.classList.contains('is-quote')).toBe(true);
    expect(element.querySelector('.vt-pay__date')?.textContent).toContain('Was due 01/01/2020');
    expect(element.textContent).not.toMatch(/overdue/i);
  });

  it('marks only the late amount as overdue and explains a balance with no payment scheduled for it', () => {
    const row = (id: string, status: string, amount: number) => ({ id, label: id, amount, currency: 'GBP', status, dueDate: '2020-01-01', completedDate: null, canPay: false, actionUrl: null });
    const element = render(summary({ total: 500, paid: 2, balance: 498, items: [row('Deposit', 'overdue', 1), row('Instalment', 'paid', 1)] } as Partial<PaymentSummary>));
    expect(element.querySelector('.vt-payment-summary__balance small')?.textContent?.trim()).toBe('£1.00 overdue');
    expect(element.querySelector('.vt-payment-schedule__unscheduled')?.textContent).toContain('£497.00 of your balance isn’t scheduled yet');
    const whole = render(summary({ total: 500, paid: 0, balance: 500, items: [row('Balance', 'overdue', 500)] } as Partial<PaymentSummary>));
    expect(whole.querySelector('.vt-payment-summary__balance small')?.textContent?.trim()).toBe('Overdue');
    expect(whole.querySelector('.vt-payment-schedule__unscheduled')).toBeNull();
  });

  it('says "Less than 1% paid" once something is paid and shows when each payment was made', () => {
    const element = render(summary({ total: 500, paid: 2, balance: 498, items: [{ id: 'i1', label: 'Trip Instalment', amount: 1, currency: 'GBP', status: 'paid', dueDate: null, completedDate: '2026-10-29', canPay: false, actionUrl: null }] } as Partial<PaymentSummary>));
    expect(element.querySelector('.vt-payment-progress__meta strong')?.textContent?.trim()).toBe('Less than 1% paid');
    expect(element.querySelector('.vt-pay__date')?.textContent?.trim()).toBe('Paid 29/10/2026');
  });

  it('shows known figures in the booking currency', () => {
    const text = render(summary({ currency: 'EUR', total: 1000, paid: 250, balance: 750 })).textContent ?? '';
    expect(text).toContain('€1,000.00');
    expect(text).toContain('25% paid');
  });
});
