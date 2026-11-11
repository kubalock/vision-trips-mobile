import { Component, effect, input, output, untracked } from '@angular/core';
import type { CustomerAccount, CustomerAccountTrip, CustomerPreferences } from '@vision-trips/contracts';
import { VtIcon } from '../../shared/lucide-icon';
import { EuropeanDatePipe } from '../../shared/european-date.pipe';

@Component({
  selector: 'app-customer-account-section',
  imports: [EuropeanDatePipe, VtIcon],
  template: `
    <!-- A reload of an account already on screen keeps it (and any unsaved edits) visible. -->
    @if (loading() && !account()) {
      <section class="vt-section vt-account-page">
        <header class="vt-account-heading">
          <p class="vt-account-kicker">Your details</p>
          <h1>Account and preferences</h1>
        </header>
        <div class="vt-account-card"><p class="vt-account-muted">Loading your account…</p></div>
      </section>
    }
    @else if (account(); as data) {
      <section class="vt-section vt-account-page">
        @if (error()) { <section class="vt-status-card vt-retry" data-tone="warn" role="alert"><span class="vt-status-card__icon" aria-hidden="true"><vt-icon name="alert" [size]="20" /></span><div class="vt-status-card__copy"><strong>We couldn’t update your account</strong><p>{{ error() }} You can keep using what’s shown here.</p><button type="button" class="vt-status-card__action" [disabled]="loading()" (click)="retry.emit()">Try again</button></div></section> }
        <header class="vt-account-heading">
          <p class="vt-account-kicker">Your details</p>
          <h1 id="account-title">Account and preferences</h1>
        </header>

        <section class="vt-account-card" aria-labelledby="account-trips-title">
          <header class="vt-account-card__header">
            <span class="vt-account-card__icon"><vt-icon name="briefcase" [size]="21" /></span>
            <div>
              <p class="vt-account-kicker">Signed-in account</p>
              <h2 id="account-trips-title">All your trips</h2>
            </div>
          </header>
          <p class="vt-account-intro">Discovered using {{ data.emailHint }}. Only trips linked to that verified customer account are shown.</p>
          <div class="vt-account-trips">
            @for (trip of data.trips; track trip.accountTripId) {
              <article class="vt-account-trip" [class.vt-account-trip--current]="trip.current">
                @if (trip.heroImageUrl) { <img class="vt-account-trip__image" [src]="trip.heroImageUrl" alt="" loading="lazy" decoding="async" /> }
                <div class="vt-account-trip__body">
                  <div class="vt-account-trip__topline">
                    <div>
                      <h3>{{ trip.name }}</h3>
                      <p>{{ trip.reference }}</p>
                    </div>
                    <span class="vt-account-status" [class.vt-account-status--past]="isPastTrip(trip)">{{ tripStatusLabel(trip) }}</span>
                  </div>
                  <p class="vt-account-trip__dates">{{ (trip.departureDate | europeanDate) || 'Dates to be confirmed' }}@if (trip.returnDate) { — {{ trip.returnDate | europeanDate }} }</p>
                  @if (!trip.current) {
                    <button type="button" class="vt-account-trip__action" [disabled]="openingTripId() === trip.accountTripId" (click)="openTrip.emit(trip.accountTripId)">
                      @if (openingTripId() === trip.accountTripId) { Opening… } @else { Open and save trip <vt-icon name="arrow-right" [size]="17" /> }
                    </button>
                  }
                </div>
              </article>
            } @empty { <p class="vt-account-empty">No linked trips were found.</p> }
          </div>
        </section>

        <form class="vt-account-form" (submit)="submit($event, data)">
          <section class="vt-account-card" aria-labelledby="account-contact-title">
            <header class="vt-account-card__header">
              <span class="vt-account-card__icon"><vt-icon name="message" [size]="21" /></span>
              <div><p class="vt-account-kicker">Contact preferences</p><h2 id="account-contact-title">How should we keep in touch?</h2></div>
            </header>
            <fieldset class="vt-account-fieldset">
              <legend>Marketing channels</legend>
              <div class="vt-channel-grid">
                <label class="vt-channel-tile" [class.is-selected]="data.preferences.emailMarketing">
                  <input class="sr-only" type="checkbox" [checked]="data.preferences.emailMarketing" (change)="channel(data, 'emailMarketing', $event)">
                  <span class="vt-channel-tile__icon"><vt-icon name="mail" [size]="20" /></span>
                  <span class="vt-channel-tile__copy"><strong>Email</strong><small>Offers, inspiration and early access</small></span>
                  <span class="vt-toggle" aria-hidden="true"><span></span></span>
                </label>
                <label class="vt-channel-tile" [class.is-selected]="data.preferences.smsMarketing">
                  <input class="sr-only" type="checkbox" [checked]="data.preferences.smsMarketing" (change)="channel(data, 'smsMarketing', $event)">
                  <span class="vt-channel-tile__icon"><vt-icon name="message" [size]="20" /></span>
                  <span class="vt-channel-tile__copy"><strong>Text message</strong><small>Rare, time-sensitive opportunities</small></span>
                  <span class="vt-toggle" aria-hidden="true"><span></span></span>
                </label>
                <label class="vt-channel-tile" [class.is-selected]="data.preferences.postalMarketing">
                  <input class="sr-only" type="checkbox" [checked]="data.preferences.postalMarketing" (change)="channel(data, 'postalMarketing', $event)">
                  <span class="vt-channel-tile__icon"><vt-icon name="file" [size]="20" /></span>
                  <span class="vt-channel-tile__copy"><strong>Post</strong><small>Brochures and occasional cards</small></span>
                  <span class="vt-toggle" aria-hidden="true"><span></span></span>
                </label>
              </div>
            </fieldset>
          </section>

          <section class="vt-account-card" aria-labelledby="account-travel-title">
            <header class="vt-account-card__header">
              <span class="vt-account-card__icon"><vt-icon name="plane" [size]="21" /></span>
              <div><p class="vt-account-kicker">Travel preferences</p><h2 id="account-travel-title">Your favourite ways to travel</h2></div>
            </header>
            <fieldset class="vt-account-fieldset">
              <legend>Preferred departure airports</legend>
              <p class="vt-account-field-hint">Search and choose up to ten airports.</p>
              <div class="vt-airport-combobox">
                <div class="vt-airport-search">
                  <vt-icon name="plane" [size]="18" />
                  <input
                    type="search"
                    role="combobox"
                    aria-label="Search departure airports"
                    aria-autocomplete="list"
                    aria-controls="airport-options"
                    [attr.aria-expanded]="airportSearchOpen"
                    [value]="airportQuery"
                    [placeholder]="data.preferences.preferredAirports.length >= 10 ? 'Maximum of 10 selected' : 'Search airports…'"
                    [disabled]="data.preferences.preferredAirports.length >= 10"
                    (focus)="airportSearchOpen = true"
                    (input)="setAirportQuery($event)"
                    (keydown.escape)="airportSearchOpen = false"
                  >
                </div>
                @if (airportSearchOpen && data.preferences.preferredAirports.length < 10) {
                  <div id="airport-options" class="vt-airport-options" role="listbox" aria-label="Available departure airports">
                    @for (airport of filteredAirports(data); track airport) {
                      <button type="button" role="option" aria-selected="false" (mousedown)="$event.preventDefault()" (click)="addAirport(data, airport)">
                        <span>{{ airport }}</span><vt-icon name="arrow-right" [size]="15" />
                      </button>
                    } @empty { <p>No matching airports</p> }
                  </div>
                }
              </div>
              <div class="vt-selected-airports" aria-label="Selected departure airports">
                @for (airport of data.preferences.preferredAirports; track airport) {
                  <span class="vt-selected-airport">
                    <span>{{ airport }}</span>
                    <button type="button" [attr.aria-label]="'Remove ' + airport" (click)="removeAirport(data, airport)"><vt-icon name="close" [size]="14" /></button>
                  </span>
                } @empty { <span class="vt-selected-airports__empty">No airports selected yet</span> }
              </div>
            </fieldset>
            <fieldset class="vt-account-fieldset vt-account-fieldset--divided">
              <legend>Preferred travel months</legend>
              <p class="vt-account-field-hint">Select every month that suits you.</p>
              <div class="vt-month-grid">
                @for (month of data.monthOptions; track month) {
                  <label class="vt-month-chip" [class.is-selected]="data.preferences.preferredMonths.includes(month)">
                    <input class="sr-only" type="checkbox" [checked]="data.preferences.preferredMonths.includes(month)" (change)="toggleMonth(data, month, $event)">
                    <span>{{ month.slice(0, 3) }}</span>
                  </label>
                }
              </div>
            </fieldset>
            <button type="submit" class="vt-account-save" [disabled]="saving()">
              <vt-icon name="check" [size]="19" /> {{ saving() ? 'Saving…' : 'Save preferences' }}
            </button>
            @if (savedNotice()) { <p class="vt-account-saved" role="status">{{ savedNotice() }}</p> }
          </section>
        </form>

        <section class="vt-account-danger" aria-labelledby="account-signout-title">
          <span class="vt-account-danger__icon"><vt-icon name="alert" [size]="21" /></span>
          <div><h2 id="account-signout-title">Sign out of this device</h2><p>Signs out every trip saved on this device and removes them, along with any documents saved for offline use.</p></div>
          <button type="button" (click)="signOut.emit()">Sign out</button>
        </section>
      </section>
    } @else {
      <section class="vt-section vt-account-page">
        <header class="vt-account-heading"><p class="vt-account-kicker">Your details</p><h1>Account and preferences</h1></header>
        <section class="vt-status-card vt-retry" data-tone="warn" role="alert"><span class="vt-status-card__icon" aria-hidden="true"><vt-icon name="alert" [size]="20" /></span><div class="vt-status-card__copy"><strong>We couldn’t load your account</strong><p>{{ error() || 'Check your connection and try again.' }}</p><button type="button" class="vt-status-card__action" [disabled]="loading()" (click)="retry.emit()">Try again</button></div></section>
      </section>
    }
  `,
})
export class CustomerAccountSection {
  readonly account = input<CustomerAccount | null>(null); readonly loading = input(false); readonly saving = input(false); readonly savedNotice = input(''); readonly openingTripId = input<string | null>(null); readonly error = input('');
  readonly save = output<CustomerPreferences>(); readonly openTrip = output<string>(); readonly signOut = output<void>(); readonly retry = output<void>();
  private draft: CustomerPreferences | null = null;
  /** A new account (another trip, or a fresh load after saving) discards any unsaved edits from the previous one. */
  private readonly resetDraftOnAccountChange = effect(() => {
    this.account();
    untracked(() => { this.draft = null; this.airportQuery = ''; this.airportSearchOpen = false; });
  });
  airportQuery = '';
  airportSearchOpen = false;
  channel(data: CustomerAccount, key: 'emailMarketing' | 'smsMarketing' | 'postalMarketing', event: Event): void { const checked = (event.target as HTMLInputElement).checked; this.ensure(data)[key] = checked; data.preferences[key] = checked; }
  setAirportQuery(event: Event): void { this.airportQuery = (event.target as HTMLInputElement).value; this.airportSearchOpen = true; }
  filteredAirports(data: CustomerAccount): string[] { const query = this.airportQuery.trim().toLocaleLowerCase(); return data.airportOptions.filter((airport) => !data.preferences.preferredAirports.includes(airport) && (!query || airport.toLocaleLowerCase().includes(query))).slice(0, 8); }
  addAirport(data: CustomerAccount, airport: string): void { if (data.preferences.preferredAirports.length >= 10) return; const draft = this.ensure(data); draft.preferredAirports = [...new Set([...draft.preferredAirports, airport])].slice(0, 10); data.preferences.preferredAirports = draft.preferredAirports; this.airportQuery = ''; this.airportSearchOpen = false; }
  removeAirport(data: CustomerAccount, airport: string): void { const draft = this.ensure(data); draft.preferredAirports = draft.preferredAirports.filter((item) => item !== airport); data.preferences.preferredAirports = draft.preferredAirports; }
  toggleMonth(data: CustomerAccount, month: string, event: Event): void { const draft = this.ensure(data); draft.preferredMonths = (event.target as HTMLInputElement).checked ? [...new Set([...draft.preferredMonths, month])] : draft.preferredMonths.filter((item) => item !== month); data.preferences.preferredMonths = draft.preferredMonths; }
  isPastTrip(trip: CustomerAccountTrip): boolean { return ['closed', 'cancelled', 'home', 'past'].includes(trip.status); }
  tripStatusLabel(trip: CustomerAccountTrip): string { if (trip.current) return 'Open'; if (this.isPastTrip(trip)) return 'Past'; return trip.status === 'confirmed' ? 'Confirmed' : trip.status.replaceAll('_', ' '); }
  submit(event: Event, data: CustomerAccount): void { event.preventDefault(); this.save.emit(this.draft ?? structuredClone(data.preferences)); }
  private ensure(data: CustomerAccount): CustomerPreferences { return this.draft ??= structuredClone(data.preferences); }
}
