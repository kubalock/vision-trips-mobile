import { TestBed } from '@angular/core/testing';
import type { PaymentSummary, TripLoyalty } from '@vision-trips/contracts';
import { PaymentsSection } from './payments-section';

const payments = (overrides: Partial<PaymentSummary> = {}): PaymentSummary => ({
  currency: 'GBP', total: 3000, paid: 0, balance: 3000, totalIncludingResort: null, nextDueAmount: null, nextDueDate: null, balanceDueDate: null, alternativeCurrency: null,
  customPayments: { enabled: true, minimum: 0.01, maximum: 3000 },
  items: [
    { id: 'pay_deposit', label: 'Deposit', amount: 300, currency: 'GBP', status: 'outstanding', dueDate: null, completedDate: null, canPay: true, actionUrl: null },
    { id: 'pay_points', label: 'Points', kind: 'points', points: 2500, amount: 25, currency: 'GBP', status: 'paid', dueDate: null, completedDate: '2026-11-01', canPay: false, actionUrl: null },
  ],
  ...overrides,
});

function render(inputs: Record<string, unknown>): HTMLElement {
  const fixture = TestBed.createComponent(PaymentsSection);
  for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('PaymentsSection on a quotation', () => {
  it('offers no Pay now or custom amount before acceptance, only "Accept and pay deposit"', () => {
    const element = render({ payments: payments(), stage: 'quote', awaitingAcceptance: true });
    const buttons = [...element.querySelectorAll('button')].map((button) => button.textContent?.trim());
    expect(buttons).toContain('Accept and pay deposit');
    expect(buttons.some((text) => text?.includes('Pay now'))).toBe(false);
    expect(element.querySelector('.vt-custom-payment')).toBeNull();
  });

  it('shows normal and custom payments once booked', () => {
    const element = render({ payments: payments(), stage: 'countdown', awaitingAcceptance: false });
    expect(element.textContent).toContain('Pay now');
    expect(element.querySelector('.vt-custom-payment')).not.toBeNull();
  });

  it('shows a points payment as points, not money', () => {
    const element = render({ payments: payments(), stage: 'countdown' });
    const row = [...element.querySelectorAll('.vt-pay')].find((item) => item.textContent?.includes('Points'))!;
    expect(row.textContent).toContain('2,500 points');
    expect(row.textContent).not.toContain('£25');
  });

  it('shows per person only with more than one traveller', () => {
    expect(render({ payments: payments(), travellerCount: 2 }).textContent).toContain('£1,500.00 per person');
    expect(render({ payments: payments(), travellerCount: 1 }).textContent).not.toContain('per person');
    expect(render({ payments: payments({ total: null }), travellerCount: 3 }).textContent).not.toContain('per person');
  });
});

describe('PaymentsSection loyalty', () => {
  const loyalty = (overrides: Partial<TripLoyalty>): TripLoyalty => ({ pointsEarned: 1, state: 'pending', eligibleFrom: '2027-05-08', ...overrides });
  it('words each state with correct singular and plural', () => {
    expect(render({ payments: payments(), loyalty: loyalty({}) }).textContent).toContain('This trip earns you 1 point, credited after you return on 8 May 2027.');
    expect(render({ payments: payments(), loyalty: loyalty({ pointsEarned: 2500, state: 'awarded' }) }).textContent).toContain('You earned 2,500 points');
    expect(render({ payments: payments(), loyalty: loyalty({ pointsEarned: 500, state: 'post_return' }) }).textContent).toContain('credited shortly');
    expect(render({ payments: payments(), stage: 'quote', loyalty: loyalty({ pointsEarned: 500, state: 'quote' }), balance: { available: 1200, availableValue: 12, currency: 'GBP', lifetime: null, expiresAt: null, transactions: [] } }).textContent).toMatch(/Book with us and earn 500 points[\s\S]*1,200 points[\s\S]*£12\.00[\s\S]*this trip/);
  });
  it('shows the balance and VIP only from the verified account, never from the trip', () => {
    const withoutAccount = render({ payments: payments(), loyalty: loyalty({ pointsEarned: 500 }) });
    expect(withoutAccount.textContent).not.toContain('You have');
    expect(withoutAccount.querySelector('.vt-vip-pill')).toBeNull();
    const withAccount = render({ payments: payments(), loyalty: loyalty({ pointsEarned: 500 }), vip: true, balance: { available: 300, availableValue: null, currency: 'GBP', lifetime: null, expiresAt: null, transactions: [] } });
    expect(withAccount.textContent).toContain('You have 300 points');
    expect(withAccount.querySelector('.vt-vip-pill')).not.toBeNull();
  });

  it('shows nothing for missing points rather than 0, and no block without loyalty', () => {
    const missing = render({ payments: payments(), loyalty: loyalty({ pointsEarned: null }) });
    expect(missing.textContent).not.toMatch(/(^|[^\d,])0 points/);
    expect(missing.querySelector('.vt-loyalty-card p')).toBeNull();
    expect(render({ payments: payments(), loyalty: null }).querySelector('.vt-loyalty-card')).toBeNull();
  });
});
