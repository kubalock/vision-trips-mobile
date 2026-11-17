import { Component, input, output, signal } from '@angular/core';
import { countryNames, NATIONALITIES, type TravellerProfile, type TravellerProfileUpdate } from '@vision-trips/contracts';
import { EuropeanDatePipe } from '../../shared/european-date.pipe';
import { VtIcon } from '../../shared/lucide-icon';

type EditableKey = Exclude<keyof TravellerProfileUpdate, 'airlineLoyalty' | 'cruiseLoyalty'>;

/** The fields a customer may change here; the API enforces the same allow-list. */
export const TRAVELLER_FIELDS: ReadonlyArray<{ key: EditableKey; label: string; type: 'text' | 'date' | 'tel'; group: 'passport' | 'licence' | 'kin'; autocomplete: string }> = [
  { key: 'passportNumber', label: 'Passport number', type: 'text', group: 'passport', autocomplete: 'off' },
  { key: 'nationality', label: 'Nationality', type: 'text', group: 'passport', autocomplete: 'off' },
  { key: 'passportIssuingCountry', label: 'Issuing country', type: 'text', group: 'passport', autocomplete: 'off' },
  { key: 'passportIssueDate', label: 'Issue date', type: 'date', group: 'passport', autocomplete: 'off' },
  { key: 'passportExpiryDate', label: 'Expiry date', type: 'date', group: 'passport', autocomplete: 'off' },
  { key: 'drivingLicenceNumber', label: 'Driving licence number', type: 'text', group: 'licence', autocomplete: 'off' },
  { key: 'drivingLicenceExpiryDate', label: 'Licence expiry date', type: 'date', group: 'licence', autocomplete: 'off' },
  { key: 'nextOfKinName', label: 'Next of kin name', type: 'text', group: 'kin', autocomplete: 'off' },
  { key: 'nextOfKinPhone', label: 'Next of kin phone', type: 'tel', group: 'kin', autocomplete: 'off' },
];

/**
 * Account → Traveller details. Only changed fields are sent. Passport and licence numbers are never shown in full:
 * the placeholder is the masked ending, and the field starts empty (leave it empty to keep the number on file).
 * Names, dates of birth and contact details are read-only with a way to ask the agent.
 */
@Component({
  selector: 'app-traveller-details-section',
  imports: [EuropeanDatePipe, VtIcon],
  template: `
    <datalist id="vt-countries">@for (country of countries; track country) { <option [value]="country"></option> }</datalist>
    <datalist id="vt-nationalities">@for (nationality of nationalities; track nationality) { <option [value]="nationality"></option> }</datalist>
    <section class="vt-account-card vt-traveller-details" aria-labelledby="traveller-details-title">
      <h2 id="traveller-details-title">Traveller details</h2>
      @if (loading()) { <p class="vt-account-intro" role="status"><vt-icon name="loader" [size]="16" /> Loading traveller details…</p> }
      @else if (error()) { <p class="vt-account-intro" role="alert">{{ error() }} <button type="button" class="vt-link-button" (click)="reload.emit()">Try again</button></p> }
      @else if (!travellers().length) { <p class="vt-account-intro">No travellers are saved on your account yet. Your travel agent can add them.</p> }
      @for (traveller of travellers(); track traveller.travellerId) {
        <details class="vt-traveller-edit" [open]="editing() === traveller.travellerId" (toggle)="toggle(traveller.travellerId, $event)">
          <summary><strong>{{ traveller.name }}</strong><small>{{ summary(traveller) }}</small></summary>
          <p class="vt-traveller-edit__readonly">Name{{ traveller.dateOfBirth ? ' and date of birth (' + (traveller.dateOfBirth | europeanDate) + ')' : '' }} can only be changed by your travel agent, because they appear on every booking. <button type="button" class="vt-link-button" (click)="contactAgent.emit(traveller.name)">Ask for a change</button></p>
          <form (submit)="submit($event, traveller)">
            @for (group of groups; track group.id) {
              <fieldset><legend>{{ group.label }}</legend>
                @for (field of fieldsIn(group.id); track field.key) {
                  <label [for]="traveller.travellerId + field.key"><span>{{ field.label }}</span>
                    <input [id]="traveller.travellerId + field.key" [type]="field.type" [attr.autocomplete]="field.autocomplete" maxlength="60"
                      [attr.placeholder]="placeholder(traveller, field.key)" [attr.list]="field.key === 'nationality' ? 'vt-nationalities' : field.key === 'passportIssuingCountry' ? 'vt-countries' : null" [value]="initial(traveller, field.key)" (input)="edit(field.key, $event)" [disabled]="saving() === traveller.travellerId">
                  </label>
                }
              </fieldset>
            }
            @if (traveller.airlineLoyalty || traveller.cruiseLoyalty) {
              <p class="vt-traveller-edit__readonly">Loyalty programmes: {{ loyaltyText(traveller) }}. Ask your travel agent to add or change a programme.</p>
            }
            <button type="submit" class="vt-primary-action" [disabled]="saving() !== null || !hasChanges()">{{ saving() === traveller.travellerId ? 'Saving…' : 'Save changes' }}</button>
            @if (savedId() === traveller.travellerId) { <p role="status" class="vt-traveller-edit__status">Saved. Your travel agent has been told.</p> }
            @if (saveError() && editing() === traveller.travellerId) { <p role="alert" class="vt-traveller-edit__status">{{ saveError() }}</p> }
          </form>
        </details>
      }
    </section>
  `,
})
export class TravellerDetailsSection {
  readonly travellers = input<TravellerProfile[]>([]);
  readonly loading = input(false);
  readonly error = input('');
  readonly saving = input<string | null>(null);
  readonly savedId = input<string | null>(null);
  readonly saveError = input('');
  readonly save = output<{ travellerId: string; update: TravellerProfileUpdate }>();
  readonly reload = output<void>();
  readonly contactAgent = output<string>();

  /** The same controlled lists the API validates against. */
  protected readonly countries = countryNames();
  protected readonly nationalities = [...NATIONALITIES];
  protected readonly groups = [{ id: 'passport' as const, label: 'Passport' }, { id: 'licence' as const, label: 'Driving licence' }, { id: 'kin' as const, label: 'Next of kin' }];
  protected readonly editing = signal<string | null>(null);
  private readonly changes = signal<Partial<Record<EditableKey, string>>>({});

  protected fieldsIn(group: 'passport' | 'licence' | 'kin') { return TRAVELLER_FIELDS.filter((field) => field.group === group); }
  protected hasChanges(): boolean { return Object.keys(this.changes()).length > 0; }
  protected summary(traveller: TravellerProfile): string {
    return traveller.passport.expiryDate ? `Passport ${traveller.passport.numberHint ?? ''} expires ${traveller.passport.expiryDate.split('-').reverse().join('/')}`.replace('  ', ' ') : 'No passport details yet';
  }
  /** Numbers are never prefilled: the masked ending is only a hint. */
  protected placeholder(traveller: TravellerProfile, key: EditableKey): string | null {
    if (key === 'passportNumber') return traveller.passport.numberHint ? `On file: ${traveller.passport.numberHint}` : null;
    if (key === 'drivingLicenceNumber') return traveller.drivingLicence.numberHint ? `On file: ${traveller.drivingLicence.numberHint}` : null;
    return null;
  }
  protected initial(traveller: TravellerProfile, key: EditableKey): string {
    const values: Partial<Record<EditableKey, string | null>> = {
      nationality: traveller.passport.nationality, passportIssuingCountry: traveller.passport.issuingCountry, passportIssueDate: traveller.passport.issueDate,
      passportExpiryDate: traveller.passport.expiryDate, drivingLicenceExpiryDate: traveller.drivingLicence.expiryDate, nextOfKinName: traveller.nextOfKin.name, nextOfKinPhone: traveller.nextOfKin.phone,
    };
    return values[key] ?? '';
  }
  protected toggle(travellerId: string, event: Event): void {
    if ((event.target as HTMLDetailsElement).open) { if (this.editing() !== travellerId) { this.editing.set(travellerId); this.changes.set({}); } }
    else if (this.editing() === travellerId) { this.editing.set(null); this.changes.set({}); }
  }
  protected edit(key: EditableKey, event: Event): void { const value = (event.target as HTMLInputElement).value; this.changes.update((current) => ({ ...current, [key]: value })); }
  protected submit(event: Event, traveller: TravellerProfile): void {
    event.preventDefault();
    const update = { ...this.changes() };
    // An empty number field means "keep what's on file", never "delete it".
    if (!update.passportNumber?.trim()) delete update.passportNumber;
    if (!update.drivingLicenceNumber?.trim()) delete update.drivingLicenceNumber;
    if (Object.keys(update).length) this.save.emit({ travellerId: traveller.travellerId, update });
  }
  protected loyaltyText(traveller: TravellerProfile): string { return [traveller.airlineLoyalty, traveller.cruiseLoyalty].filter((value): value is string => Boolean(value)).join(' · '); }
  /** Called by the app after a successful save, so unsent edits never linger. */
  reset(): void { this.changes.set({}); }
}
