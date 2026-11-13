import { TestBed } from '@angular/core/testing';
import type { CustomerAccount, CustomerPreferences } from '@vision-trips/contracts';
import { CustomerAccountSection } from './customer-account-section';

const preferences = (overrides: Partial<CustomerPreferences> = {}): CustomerPreferences => ({ emailMarketing: false, smsMarketing: false, postalMarketing: false, preferredAirports: [], preferredMonths: [], ...overrides });
const account = (prefs: Partial<CustomerPreferences> = {}) => ({ emailHint: 'a***@x.com', preferences: preferences(prefs), airportOptions: ['London Heathrow', 'Manchester'], monthOptions: ['January', 'February'], trips: [] }) as unknown as CustomerAccount;
const checked = (value: boolean) => ({ target: { checked: value } }) as unknown as Event;
const submitEvent = { preventDefault: () => undefined } as Event;

function setup(initial = account()) {
  const fixture = TestBed.createComponent(CustomerAccountSection);
  const section = fixture.componentInstance;
  const saved: CustomerPreferences[] = [];
  section.save.subscribe((value) => saved.push(value));
  fixture.componentRef.setInput('account', initial);
  fixture.detectChanges();
  const element = fixture.nativeElement as HTMLElement;
  const saveButton = () => element.querySelector<HTMLButtonElement>('.vt-account-save')!;
  return { fixture, section, saved, element, saveButton };
}

describe('CustomerAccountSection preferences', () => {
  it('edits a draft and leaves the server copy untouched until a save succeeds', () => {
    const server = account();
    const { section } = setup(server);

    section.channel('smsMarketing', checked(true));
    section.addAirport('Manchester');

    expect(server.preferences).toEqual(preferences());
    expect(section.draft()).toMatchObject({ smsMarketing: true, preferredAirports: ['Manchester'] });
  });

  it('only allows saving when something changed, and not while a save is running', () => {
    const { fixture, section, saved, saveButton } = setup();
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().textContent).toContain('No changes to save');

    section.toggleMonth('January', checked(true)); fixture.detectChanges();
    expect(saveButton().disabled).toBe(false);

    fixture.componentRef.setInput('saving', true); fixture.detectChanges();
    expect(saveButton().disabled).toBe(true);
    section.submit(submitEvent);
    expect(saved).toEqual([]);

    section.toggleMonth('January', checked(false)); fixture.componentRef.setInput('saving', false); fixture.detectChanges();
    expect(saveButton().disabled).toBe(true); // Back to what the server has.
  });

  it('keeps the edits and shows an inline retry when saving fails', () => {
    const server = account();
    const { fixture, section, saved, element } = setup(server);
    section.channel('emailMarketing', checked(true)); fixture.detectChanges();
    section.submit(submitEvent);

    fixture.componentRef.setInput('saveError', 'Our booking system is busy right now.'); fixture.detectChanges();

    expect(saved).toEqual([preferences({ emailMarketing: true })]);
    expect(server.preferences.emailMarketing).toBe(false);
    expect(section.draft()?.emailMarketing).toBe(true);
    expect(element.querySelector('.vt-retry')?.textContent).toContain('Your preferences weren’t saved');
    expect(element.querySelector('.vt-account-saved')).toBeNull();

    (element.querySelector('.vt-retry button') as HTMLButtonElement).click();
    expect(saved).toHaveLength(2);
  });

  it('takes the saved values from the server reply', () => {
    const { fixture, section, element } = setup();
    section.channel('emailMarketing', checked(true));
    section.addAirport('London Heathrow');

    fixture.componentRef.setInput('account', account({ emailMarketing: true, preferredAirports: ['London Heathrow'] }));
    fixture.componentRef.setInput('savedNotice', 'Saved across 2 customer records.'); fixture.detectChanges();

    expect(section.dirty()).toBe(false);
    expect(element.querySelector('.vt-account-saved')?.textContent).toContain('Saved across 2');
  });

  it('keeps edits through a reload that returns the same saved preferences', () => {
    const { fixture, section } = setup();
    section.channel('postalMarketing', checked(true));

    fixture.componentRef.setInput('account', account()); fixture.detectChanges();

    expect(section.draft()?.postalMarketing).toBe(true);
  });

  it('discards unsaved edits when a different account is shown', () => {
    const { fixture, section, saved } = setup(account());
    section.channel('smsMarketing', checked(true));

    fixture.componentRef.setInput('account', account({ emailMarketing: true })); fixture.detectChanges();
    section.channel('postalMarketing', checked(true));
    section.submit(submitEvent);

    expect(saved[0]).toEqual(preferences({ emailMarketing: true, postalMarketing: true }));
  });
});

describe('CustomerAccountSection trips and sign-out', () => {
  const trip = (name: string, tripId: string, current = false) => ({ accountTripId: `acct-${name}`, tripId, reference: name.toUpperCase(), name, departureDate: null, returnDate: null, status: 'confirmed', heroImageUrl: null, current });
  const withTrips = () => ({ ...account(), trips: [trip('Lisbon', 'trp_lisbon', true), trip('Japan', 'trp_japan'), trip('Rome', 'trp_rome')] }) as unknown as CustomerAccount;

  it('distinguishes trips saved on this device from trips only available in the account', () => {
    const { fixture, element } = setup(withTrips());
    fixture.componentRef.setInput('savedTripIds', new Set(['trp_lisbon', 'trp_japan']));
    fixture.componentRef.setInput('brandName', 'Branch A Travel');
    fixture.detectChanges();
    const labels = [...element.querySelectorAll('.vt-account-trip__saved')].map((item) => item.textContent?.trim());
    expect(labels).toEqual(['Saved on this device', 'Saved on this device', 'Available in your account · not saved on this device']);
    const buttons = [...element.querySelectorAll('.vt-account-trip__action')].map((item) => item.textContent?.trim());
    expect(buttons).toEqual(['Open trip', 'Open and save trip']);
    expect(element.querySelector('.vt-account-intro')?.textContent).toContain('Branch A Travel');
  });

  it('offers a scoped sign-out and a separate “remove all data” action with accurate wording', () => {
    const { fixture, section, element } = setup(withTrips());
    fixture.componentRef.setInput('brandName', 'Branch A Travel');
    fixture.detectChanges();
    let signOut = 0; let removeAll = 0;
    section.signOut.subscribe(() => { signOut += 1; });
    section.removeAll.subscribe(() => { removeAll += 1; });
    const button = (text: string) => [...element.querySelectorAll('button')].find((item) => item.textContent?.trim() === text)!;
    expect(element.textContent).toContain('Trips from other travel companies or other customers stay saved');
    button('Sign out of this account').click();
    button('Remove all data').click();
    expect([signOut, removeAll]).toEqual([1, 1]);
  });
});
