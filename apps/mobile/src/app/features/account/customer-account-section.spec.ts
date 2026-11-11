import { TestBed } from '@angular/core/testing';
import type { CustomerAccount, CustomerPreferences } from '@vision-trips/contracts';
import { CustomerAccountSection } from './customer-account-section';

function account(email: boolean): CustomerAccount {
  return { preferences: { emailMarketing: email, smsMarketing: false, postalMarketing: false, preferredAirports: [], preferredMonths: [] }, airportOptions: [], trips: [] } as unknown as CustomerAccount;
}

describe('CustomerAccountSection', () => {
  it('discards unsaved edits when a different account is shown', () => {
    const fixture = TestBed.createComponent(CustomerAccountSection);
    const section = fixture.componentInstance;
    const saved: CustomerPreferences[] = [];
    section.save.subscribe((preferences) => saved.push(preferences));

    const first = account(false);
    fixture.componentRef.setInput('account', first);
    fixture.detectChanges();
    section.channel(first, 'smsMarketing', { target: { checked: true } } as unknown as Event);

    const second = account(true);
    fixture.componentRef.setInput('account', second);
    fixture.detectChanges();
    section.submit({ preventDefault: () => undefined } as Event, second);

    expect(saved[0]).toMatchObject({ emailMarketing: true, smsMarketing: false });
  });
});
