import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, signal } from '@angular/core';
import type { ItineraryItem } from '@vision-trips/contracts';
import { PhotoGallery } from '../../shared/photo-gallery';
import { VtIcon } from '../../shared/lucide-icon';
import { calendarDate } from '../../shared/european-date.pipe';

const TO_BE_CONFIRMED = 'to-be-confirmed';
/** Days rendered at first, and added by each "show more" button. */
export const ITINERARY_DAY_WINDOW = 20;
const DAY_LABEL = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

interface DayGroup {
  date: string;
  dateLabel: string;
  dayLabel: string;
  items: Array<{ item: ItineraryItem; typeLabel: string; showTypeLabel: boolean; showRoute: boolean; notes: NoteBlocks | null; passengerLines: string[] }>;
}

/** Agent notes split into an opening paragraph and the " - " bullet points that often follow it. */
export interface NoteBlocks {
  intro: string;
  points: string[];
}

@Component({
  selector: 'app-itinerary-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PhotoGallery, VtIcon],
  template: `
    <section class="vt-section" aria-labelledby="itinerary-title">
      <p class="vt-page-kicker text-sm font-semibold uppercase tracking-widest text-teal-700">Trip plan</p><h1 id="itinerary-title" class="vt-page-title mt-1 text-3xl font-semibold">Your itinerary</h1>
      @if (items().length) {
        @if (windowStart() > 0) {
          <button type="button" class="vt-days__more" (click)="showEarlier()">Show earlier days <span>{{ windowStart() }} before {{ visibleDays()[0].dayLabel.toLowerCase() }}</span></button>
        }
        <div class="vt-days">
          @for (group of visibleDays(); track group.date) {
            <section class="vt-day-card">
              <div class="vt-day__head">
                <p class="vt-day__n">{{ group.dayLabel }}</p><h2 class="vt-day__label">{{ group.dateLabel }}</h2>
              </div>
              <ol class="vt-day__items">
                @for (entry of group.items; track entry.item.id) {
                  @let item = entry.item;
                  <li class="vt-el">
                    @if (item.images.length) { <app-photo-gallery [photos]="item.images" [limit]="4" /> }
                    <div class="vt-el__row">
                      <div class="vt-el__main">
                        <div>@if (entry.showTypeLabel) { <p class="vt-el__kind">{{ entry.typeLabel }}</p> }<h3 class="vt-el__title">{{ item.title }}</h3></div>
                        @if (item.startTime) { <time class="vt-chip">{{ item.startTime }}</time> }
                      </div>
                      @if (entry.showRoute) { <p class="vt-el__route flex items-center gap-1">{{ item.from }}@if (item.to) { <vt-icon name="arrow-right" [size]="15" /> {{ item.to }} }</p> }
                      @if (item.kind === 'flight' && flightCodes(item); as codes) { <p class="vt-el__meta vt-el__codes">{{ codes }}</p> }
                      @if (item.carrier || item.flightNumber) { <p class="vt-el__meta">{{ item.carrier }} {{ item.flightNumber }}</p> }
                      @if (item.address) { <p class="vt-el__meta">{{ item.address }}</p> }
                      @if (item.details.length) {
                        <dl class="vt-itinerary-meta">
                          @for (detail of item.details; track $index) { <div [class.is-long]="detail.value.length > 32"><dt>{{ detail.label }}</dt><dd [attr.aria-label]="detailStars(detail) ? detail.value + ' stars' : null">{{ detailStars(detail) || detail.value }}</dd></div> }
                        </dl>
                      }
                      @for (room of item.rooms; track $index) {
                        <section class="vt-itinerary-detail" aria-label="Accommodation details"><h4>{{ room.type }}</h4><dl>@if (room.board) { <div><dt>Board basis</dt><dd>{{ room.board }}</dd></div> }@if (room.view) { <div><dt>Room view</dt><dd>{{ room.view }}</dd></div> }@if (room.requests) { <div><dt>Requests</dt><dd>{{ room.requests }}</dd></div> }</dl></section>
                      }
                      @for (cabin of item.cabins; track $index) {
                        <section class="vt-itinerary-detail" aria-label="Cabin details"><h4>{{ cabin.name }}</h4><dl>@if (cabin.grade) { <div><dt>Grade</dt><dd>{{ cabin.grade }}</dd></div> }@if (cabin.number) { <div><dt>Cabin</dt><dd>{{ cabin.number }}</dd></div> }@if (cabin.deck) { <div><dt>Deck</dt><dd>{{ cabin.deck }}</dd></div> }@if (cabin.bed) { <div><dt>Bed</dt><dd>{{ cabin.bed }}</dd></div> }@if (cabin.dining) { <div><dt>Dining</dt><dd>{{ cabin.dining }}</dd></div> }</dl></section>
                      }
                      @if (item.passengers.length) {
                        <details class="vt-itinerary-disclosure" (toggle)="toggled('passengers:' + item.id, $event)"><summary><span>Passenger details</span><vt-icon name="chevron-down" [size]="18" /></summary>
                          @if (opened().has('passengers:' + item.id)) {
                            <div class="vt-passenger-list">@for (passenger of item.passengers; track $index) { <div><p>{{ passenger.name }}</p><span>{{ entry.passengerLines[$index] }}</span></div> }</div>
                          }
                        </details>
                      }
                      @if (item.cruisePorts.length) {
                        <details class="vt-itinerary-disclosure vt-cruise-stops" (toggle)="toggled('ports:' + item.id, $event)"><summary><span>Cruise itinerary <em>{{ item.cruisePorts.length }} stops</em></span><vt-icon name="chevron-down" [size]="18" /></summary>
                          <!-- Port lists can run to 100+ stops: build them only once the traveller opens the list. -->
                          @if (opened().has('ports:' + item.id)) { <ol class="vt-cruise-timeline">
                          @for (port of item.cruisePorts; track $index) { <li><span class="vt-cruise-timeline__node" aria-hidden="true"></span><div><p class="vt-cruise-timeline__title">{{ port.day ? 'Day ' + port.day + ' · ' : '' }}{{ port.port }}</p>@if (port.arrivalTime || port.departureTime) { <p class="vt-cruise-timeline__time">{{ port.arrivalTime }}{{ port.departureTime ? ' – ' + port.departureTime : '' }}</p> }@if (port.description) { <p class="vt-cruise-timeline__description">{{ port.description }}</p> }</div></li> }
                        </ol> }</details>
                      }
                      @if (item.supplier || item.reference) { <dl class="vt-itinerary-reference">@if (item.supplier) { <div><dt>Supplier</dt><dd>{{ item.supplier.name }}</dd></div> }@if (item.reference) { <div><dt>Booking reference</dt><dd>{{ item.reference }}</dd></div> }</dl> }
                      @if (item.emergencyContact; as emergency) { <a class="mt-4 flex items-center justify-between rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-900" [href]="telephoneLink(emergency.phone)"><span>{{ emergency.name }}</span><span>{{ emergency.phone }}</span></a> }
                      @if (entry.notes; as notes) { <div class="vt-itinerary-notes">@if (notes.intro) { <p>{{ notes.intro }}</p> }@if (notes.points.length) { <ul>@for (point of notes.points; track $index) { <li>{{ point }}</li> }</ul> }</div> }
                    </div>
                  </li>
                }
              </ol>
            </section>
          }
        </div>
        @if (hiddenAfter() > 0) {
          <button type="button" class="vt-days__more" (click)="showLater()">Show next {{ nextStep() }} {{ nextStep() === 1 ? 'day' : 'days' }} <span>{{ hiddenAfter() }} more in this trip</span></button>
        }
      } @else { <p class="mt-3 text-slate-500">Your itinerary will appear here as soon as it is confirmed.</p> }
    </section>
  `,
})
export class ItinerarySection {
  readonly items = input.required<ItineraryItem[]>();

  /** Sorted and grouped once per itinerary change, not on every change-detection pass. */
  readonly days = computed<DayGroup[]>(() => groupByDay(this.items()));

  /**
   * Only a window of days is rendered. It opens at today while the trip is under way (earlier days one tap
   * away), otherwise at the start, and resets when another trip's itinerary arrives.
   */
  private readonly initialWindow = computed(() => {
    const start = startingDay(this.days());
    return { start, end: Math.min(this.days().length, start + ITINERARY_DAY_WINDOW) };
  });
  readonly windowStart = linkedSignal(() => this.initialWindow().start);
  readonly windowEnd = linkedSignal(() => this.initialWindow().end);
  readonly visibleDays = computed(() => this.days().slice(this.windowStart(), this.windowEnd()));
  readonly hiddenAfter = computed(() => this.days().length - this.windowEnd());
  readonly nextStep = computed(() => Math.min(ITINERARY_DAY_WINDOW, this.hiddenAfter()));

  /** Disclosures the traveller has opened; their contents are only built once opened. */
  readonly opened = linkedSignal<ItineraryItem[], ReadonlySet<string>>({ source: this.items, computation: () => new Set() });

  showLater(): void { this.windowEnd.update((end) => Math.min(this.days().length, end + ITINERARY_DAY_WINDOW)); }
  showEarlier(): void { this.windowStart.update((start) => Math.max(0, start - ITINERARY_DAY_WINDOW)); }

  toggled(key: string, event: Event): void {
    if (!(event.target as HTMLDetailsElement).open || this.opened().has(key)) return;
    this.opened.update((keys) => new Set(keys).add(key));
  }

  /** A 1–5 hotel rating reads as stars ("★★★★"); anything else is shown as given. */
  protected detailStars(detail: { label: string; value: string }): string | null {
    const stars = /rating|stars/i.test(detail.label) ? Number(detail.value.trim()) : NaN;
    return Number.isInteger(stars) && stars >= 1 && stars <= 5 ? '★'.repeat(stars) : null;
  }

  telephoneLink(phone: string): string { return `tel:${phone.replace(/[^0-9+]/g, '')}`; }
  /**
   * The line beneath the airport names: codes and terminals as booked ("LHR T5 → PFO T1"). Terminals come from the
   * booking (or its notes); live flight data never replaces them here.
   */
  protected flightCodes(item: ItineraryItem): string {
    const end = (code: string | null, terminal: string | null | undefined) => [code, terminal].filter(Boolean).join(' ');
    const from = end(item.fromCode, item.departureTerminal); const to = end(item.toCode, item.arrivalTerminal);
    return from || to ? `${from || '—'} → ${to || '—'}` : '';
  }
}

export function groupByDay(items: ItineraryItem[]): DayGroup[] {
  // A start date that is not a real calendar date is treated as not yet confirmed rather than breaking the view.
  const dated = items.map((item) => ({ item, date: calendarDate(item.startDate) ? item.startDate : null }));
  // Within a day: timed items by time, then untimed ones in travel order (arrive, check in, then plans and tips).
  dated.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || dayOrder(a.item).localeCompare(dayOrder(b.item)));
  const groups = new Map<string, ItineraryItem[]>();
  for (const { item, date } of dated) {
    const key = date ?? TO_BE_CONFIRMED;
    const group = groups.get(key);
    if (group) group.push(item); else groups.set(key, [item]);
  }
  const firstDate = dated.find(({ date }) => date)?.date ?? null;
  return [...groups].map(([date, groupItems]) => ({
    date,
    dateLabel: dateLabel(date),
    dayLabel: firstDate && date !== TO_BE_CONFIRMED ? `Day ${daysBetween(firstDate, date) + 1}` : 'Trip plan',
    items: groupItems.map((item) => {
      const typeLabel = customerTypeLabel(item);
      return { item, typeLabel, showTypeLabel: typeLabel.trim().toLocaleLowerCase() !== item.title.trim().toLocaleLowerCase(), showRoute: showRoute(item), notes: noteBlocks(item.notes), passengerLines: item.passengers.map(passengerLine) };
    }),
  }));
}

/** While the trip is under way, open at today's day (or the next one with plans); otherwise at the first day. */
function startingDay(days: DayGroup[], today = localToday()): number {
  const dated = days.filter((day) => day.date !== TO_BE_CONFIRMED);
  if (!dated.length || today <= dated[0].date || today > dated[dated.length - 1].date) return 0;
  const index = days.findIndex((day) => day.date !== TO_BE_CONFIRMED && day.date >= today);
  return Math.max(0, index);
}

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Untimed items follow the timed ones; among themselves, in the order a traveller meets them. */
const UNTIMED_ORDER: Record<ItineraryItem['kind'], number> = { flight: 0, train: 1, transfer: 2, carhire: 3, parking: 4, stay: 5, cruise: 6, attraction: 7, misc: 8 };
function dayOrder(item: ItineraryItem): string {
  return item.startTime ? `0${item.startTime}` : `1${UNTIMED_ORDER[item.kind] ?? 9}`;
}

/** The supplier's category, except the catch-all "Misc", which customers see as "Good to know". */
export function customerTypeLabel(item: ItineraryItem): string {
  return item.kind === 'misc' && /^\s*misc(ellaneous)?\s*$/i.test(item.typeLabel) ? 'Good to know' : item.typeLabel;
}

/** The "A → B" line, unless the title already names both ends ("London Heathrow Airport to Václav Havel Airport Prague"). */
function showRoute(item: ItineraryItem): boolean {
  if (!item.from && !item.to) return false;
  const title = item.title.toLocaleLowerCase();
  return !(item.from && item.to && title.includes(item.from.toLocaleLowerCase()) && title.includes(item.to.toLocaleLowerCase()));
}

/** Splits " - First point. - Second point." runs (two or more) into a list; other notes stay as one paragraph. */
export function noteBlocks(notes: string | null | undefined): NoteBlocks | null {
  const text = notes?.trim();
  if (!text) return null;
  const parts = text.split(/\s+-\s+(?=[A-Z0-9£€$])/);
  if (parts.length < 3) return { intro: text, points: [] };
  return { intro: parts[0].replace(/^-\s*/, '').trim(), points: parts.slice(1).map((part) => part.trim()).filter(Boolean) };
}

function passengerLine(passenger: ItineraryItem['passengers'][number]): string {
  return [passenger.travelClass, passenger.seat ? `Seat ${passenger.seat}` : null, passenger.cabinBaggage, passenger.checkedBaggage, passenger.meal, passenger.assistance].filter(Boolean).join(' · ');
}

function dateLabel(date: string): string {
  const parsed = calendarDate(date);
  if (!parsed) return 'Date to be confirmed';
  try { return DAY_LABEL.format(parsed); } catch { return 'Date to be confirmed'; }
}

function daysBetween(start: string, end: string): number { return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000); }
