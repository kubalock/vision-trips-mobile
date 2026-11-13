import { Component, OnDestroy, computed, input, output, signal } from '@angular/core';
import { IMAGE_SIZES, sourceFor, srcset } from '../../shared/responsive-image';
import { Share } from '@capacitor/share';
import type { ExternalTripContent, TripSnapshot } from '@vision-trips/contracts';
import { buildChecklist, countdownTo, todayAndUpcoming } from './stage-experience';
import { VtIcon } from '../../shared/lucide-icon';
import { EuropeanDatePipe } from '../../shared/european-date.pipe';

@Component({
  selector: 'app-stage-experience-section',
  imports: [EuropeanDatePipe, VtIcon],
  template: `
    @if (surprise().concealed) {
      <section class="vt-section overflow-hidden rounded-3xl bg-gradient-to-br from-violet-950 via-indigo-900 to-teal-800 p-7 text-white"><p class="text-xs font-semibold uppercase tracking-[.25em] text-teal-200">A surprise is waiting</p><h2 class="mt-3 text-3xl font-semibold">Your destination is under wraps</h2><p class="mt-3 max-w-xl leading-7 text-indigo-100">Your travel expert is keeping the destination and itinerary secret for now. Dates, payments, preparation and support remain available.</p>@if (surprise().revealAt) { <p class="mt-5 text-sm font-semibold text-white">Reveal date: {{ surprise().revealAt | europeanDate }}</p> }</section>
    }
    @if (countdown(); as count) {
      @if (trip().stage === 'countdown' || trip().stage === 'prep') {
        <section class="vt-countdown-card" aria-label="Countdown until departure">
          <p class="vt-countdown-card__kicker">Until you leave</p>
          <div class="vt-countdown-card__units">
            <div class="vt-countdown-card__unit"><strong>{{ count.days }}</strong><span>days</span></div>
            <div class="vt-countdown-card__unit"><strong>{{ count.hours }}</strong><span>hours</span></div>
            <div class="vt-countdown-card__unit"><strong>{{ count.minutes }}</strong><span>minutes</span></div>
          </div>
        </section>
      }
    }
    @if (isAway()) {
      <section class="vt-section rounded-3xl bg-teal-950 p-6 text-white"><div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p class="text-xs font-semibold uppercase tracking-widest text-teal-300">Today · {{ todayLabel() }}</p><h2 class="mt-2 text-3xl font-semibold">Your day at a glance</h2></div>@if (trip().support.emergencyPhone) { <a class="rounded-full bg-red-500 px-5 py-3 text-center text-sm font-bold text-white" [href]="'tel:' + trip().support.emergencyPhone">Emergency · {{ trip().support.emergencyPhone }}</a> }</div>
        @if (dayPlan().today.length) { <h3 class="mt-6 text-sm font-semibold uppercase tracking-wider text-teal-200">Today</h3><ol class="mt-3 grid gap-3">@for (item of dayPlan().today; track item.id) { <li class="flex gap-4 rounded-2xl bg-white/10 p-4"><time class="font-semibold text-teal-200">{{ item.startTime || 'All day' }}</time><div><strong>{{ item.title }}</strong><p class="mt-1 flex items-center gap-1 text-sm text-teal-50">{{ item.from }}@if (item.to) { <vt-icon name="arrow-right" [size]="15" /> {{ item.to }} }{{ item.address ? item.address : '' }}</p></div></li> }</ol> } @else { <p class="mt-6 text-teal-100">There are no timed itinerary items for today.</p> }
        @if (dayPlan().upcoming.length) { <h3 class="mt-6 text-sm font-semibold uppercase tracking-wider text-teal-200">Coming up</h3><div class="mt-3 grid gap-3 sm:grid-cols-2">@for (item of dayPlan().upcoming; track item.id) { <div class="rounded-2xl border border-white/15 p-4"><strong>{{ item.title }}</strong><p class="mt-1 text-sm text-teal-100">{{ item.startDate | europeanDate }}{{ item.startTime ? ' · ' + item.startTime : '' }}</p></div> }</div> }
      </section>
    }
    @if (trip().stage === 'prep') {
      <section class="vt-section"><p class="text-xs font-semibold uppercase tracking-widest text-teal-700">Before you go</p><h2 class="vt-h2">Final checks</h2><ul class="mt-5 grid gap-3">@for (item of checklist(); track item.id) { <li class="flex items-start gap-4 rounded-2xl bg-white p-4 ring-1" [class.ring-red-200]="item.level === 'alert'" [class.ring-slate-200]="item.level !== 'alert'"><button type="button" class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold" [class.bg-emerald-600]="isDone(item.id) || item.level === 'done'" [class.text-white]="isDone(item.id) || item.level === 'done'" [disabled]="item.locked" (click)="toggleCheck(item.id)" [attr.aria-label]="(isDone(item.id) || item.level === 'done' ? 'Completed: ' : 'Mark complete: ') + item.title">@if (isDone(item.id) || item.level === 'done') { <vt-icon name="check" [size]="18" /> } @else if (item.level === 'alert') { <vt-icon name="alert" [size]="17" /> }</button><div><strong [class.text-red-800]="item.level === 'alert'">{{ item.title }}</strong><p class="mt-1 text-sm leading-6 text-slate-600">{{ item.text }}</p>@if (item.id === 'advice' && trip().summary.countries[0]) { <a class="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-teal-700" [href]="adviceUrl()" target="_blank" rel="noopener">Official travel advice <vt-icon name="external" [size]="14" /></a> }</div></li> }</ul></section>
    }
    @if (trip().stage === 'home' || trip().stage === 'past') {
      <section class="vt-returned-card" aria-labelledby="returned-title">
        <header class="vt-booking-journey-card__header"><p>{{ trip().stage === 'home' ? 'We hope you had a wonderful time' : 'Thanks for travelling with us' }}</p><h2 id="returned-title">Thank you for travelling with {{ trip().brand.name }}</h2></header>
        <p class="vt-returned-card__lead">We hope your trip gave you plenty of good memories. We would love to hear how it went—and help whenever the next idea arrives.</p>
        <div class="vt-returned-card__actions">
          @if (reviewUrl()) { <a class="vt-btn vt-btn--primary" [href]="reviewUrl()" target="_blank" rel="noopener">Leave a review</a> }
          <button type="button" class="vt-btn" [class.vt-btn--primary]="!reviewUrl()" [class.vt-btn--ghost]="reviewUrl()" (click)="planNext.emit()">Plan your next trip</button>
          <button type="button" class="vt-btn vt-btn--ghost" (click)="recommend()">Recommend us</button>
        </div>
        @if (trip().summary.gallery.length) {
          <div class="vt-returned-card__gallery">@for (image of trip().summary.gallery.slice(0, 10); track image.url) { <img [src]="img.sourceFor(image, 208)" [attr.srcset]="img.srcset(image)" [attr.sizes]="img.sizes.strip" [alt]="image.alt" loading="lazy" decoding="async" /> }</div>
        }
      </section>
    }
  `,
})
export class StageExperienceSection implements OnDestroy {
  protected readonly img = { srcset, sourceFor, sizes: IMAGE_SIZES };
  readonly trip = input.required<TripSnapshot>();
  readonly external = input<ExternalTripContent | null>(null);
  readonly planNext = output<void>();
  private readonly tick = signal(Date.now());
  private readonly checked = signal<string[]>([]);
  private readonly timer = setInterval(() => this.tick.set(Date.now()), 30_000);
  readonly countdown = computed(() => { this.tick(); return countdownTo(this.trip()); });
  readonly dayPlan = computed(() => { this.tick(); return todayAndUpcoming(this.trip().itinerary); });
  readonly checklist = computed(() => buildChecklist(this.trip()));
  constructor() { this.checked.set(readChecks()); }
  ngOnDestroy(): void { clearInterval(this.timer); }
  surprise(): TripSnapshot['experience']['surprise'] { return this.trip().experience.surprise ?? { enabled: false, concealed: false, revealAt: null }; }
  isAway(): boolean { return ['departure', 'travelling', 'returning'].includes(this.trip().stage); }
  todayLabel(): string { this.tick(); return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()); }
  isDone(id: string): boolean { return this.checked().includes(`${this.trip().tripId}:${id}`); }
  toggleCheck(id: string): void { const key = `${this.trip().tripId}:${id}`; this.checked.update((items) => items.includes(key) ? items.filter((item) => item !== key) : [...items, key]); localStorage.setItem('vision-trips:checklist', JSON.stringify(this.checked())); }
  adviceUrl(): string { return `https://www.gov.uk/foreign-travel-advice/${slug(this.trip().summary.countries[0] || '')}`; }
  reviewUrl(): string | null { return this.trip().brand.profile.reviewLinks.find((link) => link.provider === 'google')?.url ?? this.trip().brand.profile.reviewLinks[0]?.url ?? null; }
  async recommend(): Promise<void> { const trip = this.trip(); await Share.share({ title: trip.brand.name, text: `We booked with ${trip.brand.name} and they looked after our trip. ${trip.support.phone || trip.support.websiteUrl || ''}` }); }
}
/** Forgets the ticked checklist items of one trip (when it is removed, or another Customer takes over its saved copy). */
export function clearChecklist(tripId: string): void {
  try { localStorage.setItem('vision-trips:checklist', JSON.stringify(readChecks().filter((item) => !item.startsWith(`${tripId}:`)))); } catch { /* Storage unavailable. */ }
}
function readChecks(): string[] { try { const value = JSON.parse(localStorage.getItem('vision-trips:checklist') || '[]') as unknown; return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } }
function slug(value: string): string { return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
