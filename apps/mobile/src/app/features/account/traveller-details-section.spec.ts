import { TestBed } from '@angular/core/testing';
import type { TravellerProfile } from '@vision-trips/contracts';
import { TravellerDetailsSection } from './traveller-details-section';

const traveller = (passport: Partial<TravellerProfile['passport']>) => ({
  travellerId: 't1', name: 'Alex Smith',
  passport: { numberHint: null, nationality: null, issuingCountry: null, issueDate: null, expiryDate: null, ...passport },
  drivingLicence: { numberHint: null, expiryDate: null }, nextOfKin: { name: null, phone: null },
}) as unknown as TravellerProfile;

describe('TravellerDetailsSection summary', () => {
  const summary = (value: TravellerProfile) => {
    const fixture = TestBed.createComponent(TravellerDetailsSection);
    fixture.componentRef.setInput('travellers', [value]);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector('summary small')?.textContent?.trim();
  };

  it('agrees with the number on file when the expiry date is missing', () => {
    expect(summary(traveller({ numberHint: '···000' }))).toBe('Passport ···000 · add the expiry date');
  });

  it('still says when nothing is on file, and shows the expiry when there is one', () => {
    expect(summary(traveller({}))).toBe('No passport details yet');
    expect(summary(traveller({ numberHint: '···000', expiryDate: '2030-04-01' }))).toBe('Passport ···000 expires 01/04/2030');
  });
});
