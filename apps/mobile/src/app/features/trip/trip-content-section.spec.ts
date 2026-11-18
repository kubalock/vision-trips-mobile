import { TestBed } from '@angular/core/testing';
import { parseTripSnapshot } from '../../core/api/trip-schema';
import { embedUrl } from '../../shared/video-viewer';
import { ExtrasSection } from './extras-section';
import { TripContentSection } from './trip-content-section';

const trip = (extra: Record<string, unknown> = {}) => parseTripSnapshot({ schemaVersion: 4, tripId: 'trp_1', stage: 'quote', accessScope: 'primary_customer', summary: { name: 'Lisbon', reference: 'R1', totalTravellers: 2 }, ...extra });

describe('TripContentSection', () => {
  const render = (snapshot: ReturnType<typeof trip>) => { const fixture = TestBed.createComponent(TripContentSection); fixture.componentRef.setInput('trip', snapshot); fixture.detectChanges(); return fixture.nativeElement as HTMLElement; };

  it('renders nothing for missing inclusion lists and no video without a valid video', () => {
    const element = render(trip({ content: { included: [], notIncluded: [], includedSource: 'none', videoMessage: { kind: 'file', url: 'ftp://x/v.mp4', title: 'x' }, walkthrough: null } }));
    expect(element.querySelector('.vt-inclusions')).toBeNull();
    expect(element.querySelector('.vt-video-card')).toBeNull();
  });

  it('shows the lists, notes derived inclusions, and a compact Watch card that loads nothing yet', () => {
    const element = render(trip({ content: { included: [{ text: 'Flights' }], notIncluded: [{ text: 'Travel insurance' }], includedSource: 'itinerary', walkthrough: { kind: 'file', url: 'https://dl.airtable.com/v.mp4', mimeType: 'video/mp4', posterUrl: null, title: 'Sarah walks you through your trip' }, videoMessage: null } }));
    expect(element.textContent).toContain('Flights');
    expect(element.textContent).toContain('Travel insurance');
    expect(element.textContent).toContain('Based on the items in your itinerary');
    expect(element.querySelector('.vt-video-card')?.textContent).toContain('Watch');
    expect(element.querySelector('video, iframe')).toBeNull();
  });

  it('says it is opening the walkthrough while its fresh link loads, and ignores more taps', () => {
    const url = 'https://dl.airtable.com/v.mp4';
    const fixture = TestBed.createComponent(TripContentSection);
    fixture.componentRef.setInput('trip', trip({ content: { included: [], notIncluded: [], includedSource: 'none', walkthrough: { kind: 'file', url, mimeType: 'video/mp4', posterUrl: null, title: 'Walkthrough' }, videoMessage: null } }));
    fixture.componentRef.setInput('opening', url);
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.vt-video-card__watch')!;
    expect(button.textContent).toContain('Opening…');
    // Still focusable (so the viewer can hand focus back to it), but marked unavailable and ignoring taps.
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
    let emitted = 0; fixture.componentInstance.watch.subscribe(() => { emitted += 1; });
    button.click();
    expect(emitted).toBe(0);
  });

});

describe('BrandSupportSection', () => {
  it('shows the basic reassurance points when the brand has an empty list, never an empty card', async () => {
    const { BrandSupportSection } = await import('./brand-support-section');
    const fixture = TestBed.createComponent(BrandSupportSection);
    fixture.componentRef.setInput('trip', trip({ stage: 'countdown', brand: { name: 'Lisbon Travel', profile: { reassurance: [] } } }));
    fixture.detectChanges();
    const items = (fixture.nativeElement as HTMLElement).querySelectorAll('.vt-value-props li');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('Your own travel expert');
  });
});

describe('video embeds', () => {
  it('only loads the rebuilt privacy-friendly players or https files', () => {
    expect(embedUrl({ kind: 'youtube', url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0', mimeType: null, posterUrl: null, title: '' })).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0');
    expect(embedUrl({ kind: 'youtube', url: 'https://evil.example/embed/dQw4w9WgXcQ', mimeType: null, posterUrl: null, title: '' })).toBeNull();
    expect(embedUrl({ kind: 'vimeo', url: 'https://player.vimeo.com/video/123456789?autoplay=1', mimeType: null, posterUrl: null, title: '' })).toBe('https://player.vimeo.com/video/123456789?dnt=1');
    expect(embedUrl({ kind: 'file', url: 'http://dl.airtable.com/v.mp4', mimeType: null, posterUrl: null, title: '' })).toBeNull();
    // The API's own media endpoint over plain http is allowed only on this machine or the local network (development).
    expect(embedUrl({ kind: 'file', url: 'http://localhost:3000/v1/media/attachment/abc', mimeType: null, posterUrl: null, title: '' })).toBe('http://localhost:3000/v1/media/attachment/abc');
    expect(embedUrl({ kind: 'file', url: 'http://192.168.1.20:3000/v1/media/attachment/abc', mimeType: null, posterUrl: null, title: '' })).not.toBeNull();
    expect(embedUrl({ kind: 'file', url: 'http://evil.example/v1/media/attachment/abc', mimeType: null, posterUrl: null, title: '' })).toBeNull();
    expect(embedUrl({ kind: 'file', url: 'http://localhost:3000/other.mp4', mimeType: null, posterUrl: null, title: '' })).toBeNull();
  });
});

describe('ExtrasSection affiliate links', () => {
  it('offers "Book this" only for an https affiliate link, and always a way to ask about that exact extra', () => {
    const fixture = TestBed.createComponent(ExtrasSection);
    fixture.componentRef.setInput('extras', [
      { id: 'e1', name: 'Spa day', description: null, imageUrl: null, supplierName: null, affiliateUrl: 'https://partner.example/spa' },
      { id: 'e2', name: 'Boat trip', description: null, imageUrl: null, supplierName: null, affiliateUrl: 'javascript:alert(1)' },
    ]);
    const asked: string[] = []; const booked: string[] = [];
    fixture.componentInstance.enquire.subscribe((extra) => asked.push(extra.name));
    fixture.componentInstance.book.subscribe((choice) => booked.push(choice.url));
    fixture.detectChanges();
    const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('.vt-upsell-card');
    const buttons = (index: number) => [...cards[index]!.querySelectorAll('button')];
    expect(buttons(0).map((button) => button.textContent?.trim())).toEqual(['Book this', 'Ask us instead']);
    expect(buttons(1).map((button) => button.textContent?.trim())).toEqual(['Ask your travel expert']);
    buttons(0)[0]!.click(); buttons(0)[1]!.click(); buttons(1)[0]!.click();
    expect(booked).toEqual(['https://partner.example/spa']);
    expect(asked).toEqual(['Spa day', 'Boat trip']);
  });
});
