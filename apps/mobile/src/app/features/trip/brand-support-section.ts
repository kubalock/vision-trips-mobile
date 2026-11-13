import { Component, OnInit, computed, input } from '@angular/core';
import type { TripSnapshot } from '@vision-trips/contracts';
import { PhotoGallery } from '../../shared/photo-gallery';
import { VtIcon, type VtIconName } from '../../shared/lucide-icon';

@Component({
  selector: 'app-brand-support-section', imports: [PhotoGallery, VtIcon],
  template: `
    @if (!returned()) {
    <section class="vt-value-props" aria-labelledby="value-props-title"><header class="vt-lower-section__header"><p>Travel with confidence</p><h2 id="value-props-title">Why you can relax</h2></header><ul class="vt-value-props__grid">@for (item of trip().brand.profile.reassurance; track item.title; let i = $index) { <li><span class="vt-value-props__icon"><vt-icon [name]="reassuranceIcon(i)" [size]="21" /></span><span><strong>{{ item.title }}</strong><small>{{ item.text }}</small></span></li> }</ul></section>
    }
    @if (trip().brand.profile.whyBook.length || trip().brand.profile.about) { <section class="vt-why-book-card" aria-labelledby="why-book-title"><header class="vt-lower-section__header"><p>Your travel agency</p><h2 id="why-book-title">Why book with {{ trip().brand.name }}</h2></header>@if (trip().brand.profile.about) { <div class="vt-why-book-card__bio"><p>{{ trip().brand.profile.about }}</p></div> }@if (trip().brand.profile.whyBook.length) { <div class="vt-why-book-card__reasons">@for (reason of trip().brand.profile.whyBook; track reason.title; let i = $index) { <article><span>{{ i + 1 }}</span><div><h3>{{ reason.title }}</h3>@if (reason.text) { <p>{{ reason.text }}</p> }</div></article> }</div> }@if (reviewUrl()) { <a class="vt-why-book-card__review" [href]="reviewUrl()" target="_blank" rel="noopener">See what our customers say <vt-icon name="external" [size]="15" /></a> }</section> }
    @if (trip().brand.profile.teamPhotoUrl) { <section class="vt-section overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200"><div class="grid md:grid-cols-2"><img class="h-full min-h-64 w-full object-cover" [src]="trip().brand.profile.teamPhotoUrl" [alt]="'The team at ' + trip().brand.name" loading="lazy" decoding="async" /><div class="p-6 md:p-8"><p class="text-xs font-semibold uppercase tracking-widest text-teal-700">Your travel experts</p><h2 class="mt-2 text-2xl font-semibold">Real people, here when you need us</h2><p class="mt-3 leading-7 text-slate-600">{{ trip().experience.agentName ? trip().experience.agentName + ' and the wider team' : 'Our team' }} will look after your journey from planning through to your return home.</p></div></div></section> }
    @if (trip().summary.gallery.length || trip().brand.profile.gallery.length) { <section class="vt-inspiration" aria-labelledby="inspiration-title"><header class="vt-lower-section__header"><p>Dream a little</p><h2 id="inspiration-title">Travel inspiration</h2></header><div class="vt-inspiration-gallery"><app-photo-gallery [photos]="combinedGallery()" [showCaptions]="true" /></div></section> }
    <footer class="vt-home-footer">
      <div class="vt-home-footer__grid">
        <div class="vt-home-footer__brand"><p class="vt-home-footer__eyebrow">Here when you need us</p><h2>{{ trip().brand.name }}</h2>@if (trip().brand.profile.slogan) { <p>{{ trip().brand.profile.slogan }}</p> }
          @if (trip().brand.profile.socialLinks.length || trip().brand.profile.reviewLinks.length) { <div class="vt-home-footer__socials" aria-label="Social media and reviews">@for (social of trip().brand.profile.socialLinks; track social.url) { <a [href]="social.url" target="_blank" rel="noopener" [attr.aria-label]="socialLabel(social.network)">@switch (social.network) { @case ('instagram') { <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1.1"/></svg> } @case ('facebook') { <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 22v-9h3l.5-3h-3.5V8.1c0-.9.3-1.6 1.7-1.6H17V4c-.8-.1-1.8-.2-3-.2-3 0-5 1.8-5 5.1V10H6v3h3v9h4.5Z"/></svg> } @case ('linkedin') { <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.2 7.8A2.3 2.3 0 1 0 5.2 3a2.3 2.3 0 0 0 0 4.7ZM3.3 21h3.8V9.2H3.3V21Zm6.1 0h3.8v-6.6c0-1.7.3-3.4 2.5-3.4 2.2 0 2.2 2 2.2 3.5V21h3.8v-7.3c0-3.6-.8-6.3-4.9-6.3-2 0-3.3 1.1-3.8 2.1h-.1V9.2H9.4V21Z"/></svg> } @default { <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.2 2h3.7l-8 9.2L23.3 22H16l-5.7-7.5L3.8 22H.1l8.5-9.7L-.3 2H7l5.2 6.8L18.2 2Zm-1.3 18h2L5.9 3.9H3.8L16.9 20Z"/></svg> } }</a> }@for (review of trip().brand.profile.reviewLinks; track review.url) { <a class="vt-home-footer__review" [href]="review.url" target="_blank" rel="noopener"><vt-icon name="star" [size]="15" /> {{ review.provider }} reviews</a> }</div> }
        </div>
        <div class="vt-home-footer__contacts">
          @if (trip().support.phone) { <a [href]="'tel:' + trip().support.phone"><span><vt-icon name="phone" [size]="19" /></span><span><small>Call us</small><strong>{{ trip().support.phone }}</strong></span></a> }
          @if (trip().support.email; as email) { <a [href]="'mailto:' + email"><span><vt-icon name="mail" [size]="19" /></span><span><small>Email us</small><strong class="vt-email">@for (part of emailParts(email); track $index) {@if ($index) {<wbr />}{{ part }}}</strong></span></a> }
          @if (trip().support.whatsappUrl) { <a [href]="trip().support.whatsappUrl" target="_blank" rel="noopener"><span><vt-icon name="message" [size]="19" /></span><span><small>WhatsApp</small><strong>Start a conversation</strong></span></a> }
          @if (trip().brand.profile.address) { @if (trip().brand.profile.mapUrl) { <a [href]="trip().brand.profile.mapUrl" target="_blank" rel="noopener"><span><vt-icon name="map-pin" [size]="19" /></span><span><small>Visit us</small><strong>{{ trip().brand.profile.address }}</strong></span></a> } @else { <div><span><vt-icon name="map-pin" [size]="19" /></span><span><small>Visit us</small><strong>{{ trip().brand.profile.address }}</strong></span></div> } }
        </div>
      </div>
      @if (trip().brand.profile.openingHours || trip().brand.profile.footerText) { <div class="vt-home-footer__fine-print">@if (openingHours().length) { <section class="vt-home-footer__hours" aria-labelledby="opening-hours-title"><h3 id="opening-hours-title">Opening hours</h3><dl>@for (row of openingHours(); track $index) { <div><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></div> }</dl></section> }@if (trip().brand.profile.footerText) { <p>{{ trip().brand.profile.footerText }}</p> }</div> }
    </footer>
  `,
})
export class BrandSupportSection implements OnInit {
  readonly trip = input.required<TripSnapshot>();
  /** After the trip, the "Why you can relax" travel reassurance no longer applies. */
  protected readonly returned = computed(() => ['home', 'past', 'closed'].includes(this.trip().stage));
  /** Splits an address so a narrow screen breaks it after "@" or before a dot, never mid-word. */
  protected emailParts(email: string): string[] { return email.split(/(?=@|\.)/); }
  reassuranceIcon(index: number): VtIconName { return (['compass', 'circle-dot', 'badge-check', 'phone-call'] as const)[index % 4]; }
  ngOnInit(): void { const profile = this.trip().brand.profile; profile.whyBook ??= []; profile.gallery ??= []; profile.reassurance ??= [{ title: 'Your own travel expert', text: 'Personal support throughout your journey' }, { title: 'Built around you', text: 'Tailored, not off the shelf' }]; profile.footerImages ??= []; }
  reviewUrl(): string | null { return this.trip().brand.profile.reviewLinks.find((link) => link.provider === 'google')?.url ?? this.trip().brand.profile.reviewLinks[0]?.url ?? null; }
  combinedGallery() {
    return [...this.trip().summary.gallery, ...(this.trip().brand.profile.gallery ?? [])]
      .filter((photo, index, all) => all.findIndex((candidate) => candidate.url === photo.url) === index)
      .map((photo) => ({ ...photo, alt: this.cleanCaption(photo.alt) }));
  }
  socialLabel(network: string): string { return `Open ${network === 'x' ? 'X' : network} profile`; }
  openingHours(): Array<{ label: string; value: string }> {
    const source = this.trip().brand.profile.openingHours?.trim();
    if (!source) return [];
    const cleaned = source.replace(/\*\*/g, '').replace(/\r/g, '').trim();
    const dayBracket = '(Monday\\s*[–—-]\\s*Tuesday|Wednesday|Thursday\\s*[–—-]\\s*Friday|Saturday|Sunday\\s*(?:&|and)\\s*Bank\\s+Holidays)';
    const schedulePattern = new RegExp(`${dayBracket}\\s*:\\s*([\\s\\S]*?)(?=${dayBracket}\\s*:|$)`, 'gi');
    const schedule = Array.from(cleaned.matchAll(schedulePattern), (match) => ({
      label: match[1].replace(/\s*[–—-]\s*/g, ' – ').replace(/\band\b/gi, '&').replace(/\s+/g, ' ').trim(),
      value: match[2].replace(/^[\s;,.]+|[\s;,.]+$/g, '').replace(/\s*[–—-]\s*/g, ' – ').replace(/\s+/g, ' ').trim() || 'Contact us',
    }));
    if (schedule.length) return schedule;
    return cleaned
      .replace(/\s+(?=\*\*[^*]+(?::\*\*|\*\*\s*:))/g, '\n')
      .split(/\n+|\s*;\s*/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf(':');
        return separator >= 0
          ? { label: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() || 'Contact us' }
          : { label: line, value: '' };
      });
  }
  private cleanCaption(value: string): string {
    const caption = value.trim();
    if (!caption || /^(?:trip image|travel inspiration|photo|image)$/i.test(caption)) return '';
    if (!/\.(?:jpe?g|png|webp|gif|heic)$/i.test(caption) && !/[_-].*[_-]/.test(caption)) return caption;
    const filename = (caption.split(/[\\/]/).pop() ?? caption).replace(/%20/gi, ' ').replace(/\.(?:jpe?g|png|webp|gif|heic)$/i, '');
    const tokens = filename.split(/[_-]+/).filter(Boolean);
    while (tokens.length && (/^\d+$/.test(tokens[0]) || /^[A-Z]{2,5}\d*$/.test(tokens[0]))) tokens.shift();
    while (tokens.length && (/^\d+$/.test(tokens.at(-1) ?? '') || /^\d{2,4}x\d{2,4}$/i.test(tokens.at(-1) ?? ''))) tokens.pop();
    const human = tokens.join(' ').replace(/\band\b/gi, '&').replace(/\s+/g, ' ').trim();
    return human.length >= 3 && human.length <= 72 ? human : '';
  }
}
