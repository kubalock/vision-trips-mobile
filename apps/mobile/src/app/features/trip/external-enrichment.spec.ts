import { TestBed } from '@angular/core/testing';
import type { ExternalTripContent } from '@vision-trips/contracts';
import { parseExternalContent } from '../../core/api/trip-schema';
import { withEarlierEnrichment } from '../../core/api/external-merge';
import { DestinationsSection } from './destinations-section';
import { ExternalContentSection } from './external-content-section';

const base = (extra: Record<string, unknown> = {}): ExternalTripContent => parseExternalContent({
  generatedAt: '2026-11-17T10:00:00Z', refreshAfterSeconds: 300, providers: {}, diagnostics: {},
  flights: [], weather: [], guides: [], ...extra,
});
const stay = (extra: Record<string, unknown> = {}) => ({ itineraryItemId: 'itm_1', placeId: 'p', name: 'Hotel Avenida', address: 'Lisbon', rating: null, ratingCount: 0, websiteUrl: null, phone: null, summary: null, mapsUrl: null, directionsUrl: 'https://maps.example', coordinates: { latitude: 1, longitude: 1 }, images: [], aiDescription: null, aiPending: false, ...extra });
const destination = (extra: Record<string, unknown> = {}) => ({ id: 'dst_1', name: 'Lisbon', country: 'Portugal', overview: null, attractions: [], practicalInformation: null, culturalInformation: null, travelAdviceUrl: null, imageUrl: null, coordinates: null, images: [], mapUrl: null, aiPending: false, ...extra });
const cruise = (extra: Record<string, unknown> = {}) => ({ itineraryItemId: 'itm_2', name: 'Iona', operator: 'P&O', introduction: null, coverImageUrl: null, profileImageUrl: null, facts: [], sections: [], voyage: null, ...extra });

describe('external enrichment parsing', () => {
  it('accepts the new optional pieces and drops unsafe ones', () => {
    const content = base({
      stays: [stay({ facilities: ['Outdoor pool', 'x'.repeat(41)], airportDistance: { airport: 'Lisbon', km: 10 } })],
      destinations: [destination({ facts: { currency: 'Euro' }, climate: { month: 'March', highC: 19, lowC: 10, sunshineHours: 7, rainyDays: 8, years: 3 } })],
      cruises: [cruise({ video: { kind: 'youtube', url: 'https://www.youtube-nocookie.com/embed/abcdefg?rel=0', mimeType: null, posterUrl: null, title: 'Ship' } })],
      routeMapUrl: 'javascript:alert(1)', agencyRating: { rating: 4.9, count: 312, url: null },
    });
    expect(content.stays[0]?.facilities).toEqual(['Outdoor pool']);
    expect(content.destinations[0]?.facts?.currency).toBe('Euro');
    expect(content.cruises[0]?.video?.kind).toBe('youtube');
    expect(content.routeMapUrl).toBeNull();
    expect(content.agencyRating?.rating).toBe(4.9);
  });

  it('copes with content from an older API that has none of them', () => {
    const content = base({ stays: [stay()], destinations: [destination()], cruises: [cruise()] });
    expect(content.stays[0]?.airportDistance).toBeNull();
    expect(content.destinations[0]?.climate).toBeNull();
    expect(content.agencyRating).toBeNull();
  });
});

describe('keeping earlier enrichment when a refresh is partial', () => {
  it('keeps what a failed provider would otherwise take away, and takes new values when they arrive', () => {
    const earlier = base({ stays: [stay({ facilities: ['Spa'], airportDistance: { airport: 'Lisbon', km: 10 } })], destinations: [destination({ facts: { currency: 'Euro' }, climate: { month: 'March', highC: 19, lowC: 10, sunshineHours: null, rainyDays: null, years: 3 } })], agencyRating: { rating: 4.8, count: 50, url: null } });
    const partial = base({ stays: [stay()], destinations: [destination({ overview: 'New copy' })] });
    const merged = withEarlierEnrichment(partial, earlier);
    expect(merged.stays[0]).toMatchObject({ facilities: ['Spa'], airportDistance: { km: 10 } });
    expect(merged.destinations[0]).toMatchObject({ overview: 'New copy', facts: { currency: 'Euro' }, climate: { month: 'March' } });
    expect(merged.agencyRating?.rating).toBe(4.8);
    const newer = base({ stays: [stay({ facilities: ['Pool'] })], destinations: [destination()] });
    expect(withEarlierEnrichment(newer, earlier).stays[0]?.facilities).toEqual(['Pool']);
  });
});

describe('enrichment UI', () => {
  const renderContent = (content: ExternalTripContent) => { const fixture = TestBed.createComponent(ExternalContentSection); fixture.componentRef.setInput('content', content); fixture.detectChanges(); return fixture; };

  it('shows facility chips and the approximate airport distance', () => {
    const element = renderContent(base({ stays: [stay({ facilities: ['Outdoor pool', 'Spa'], airportDistance: { airport: 'Lisbon', km: 10 } })] })).nativeElement as HTMLElement;
    expect([...element.querySelectorAll('.vt-facility-chips li')].map((chip) => chip.textContent)).toEqual(['Outdoor pool', 'Spa']);
    expect(element.textContent).toContain('About 10 km from Lisbon airport');
  });

  it('only loads the route map once it is opened, and only from Google’s embed', () => {
    const fixture = renderContent(base({ routeMapUrl: 'https://www.google.com/maps/embed/v1/directions?key=k&origin=A&destination=B' }));
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.vt-route-map')).not.toBeNull();
    expect(element.querySelector('.vt-route-map iframe')).toBeNull();
    const details = element.querySelector<HTMLDetailsElement>('.vt-route-map')!;
    details.open = true; details.dispatchEvent(new Event('toggle')); fixture.detectChanges();
    expect(element.querySelector('.vt-route-map iframe')).not.toBeNull();
    expect((renderContent(base({ routeMapUrl: 'https://evil.example/maps/embed/v1/directions' })).nativeElement as HTMLElement).querySelector('.vt-route-map')).toBeNull();
  });

  it('offers the ship film and section videos as Watch buttons that load nothing until tapped', () => {
    const film = { kind: 'youtube', url: 'https://www.youtube-nocookie.com/embed/abcdefg?rel=0', mimeType: null, posterUrl: null, title: 'Take a look around Iona' };
    const fixture = renderContent(base({ cruises: [cruise({ video: film, sections: [{ title: 'Dining', items: [{ name: 'The Glass House', text: null, images: [], videoUrl: 'https://vimeo.com/123456789', video: { ...film, kind: 'vimeo', url: 'https://player.vimeo.com/video/123456789?dnt=1', title: 'The Glass House' } }] }] })] }));
    const watched: string[] = [];
    fixture.componentInstance.watch.subscribe((video) => watched.push(video.title));
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('iframe, video')).toBeNull();
    element.querySelector<HTMLButtonElement>('.vt-video-card--inline')!.click();
    [...element.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Watch video'))!.click();
    expect(watched).toEqual(['Take a look around Iona', 'The Glass House']);
  });

  it('never links a stay to its own website and hides a poor Google rating', () => {
    const element = renderContent(base({ stays: [stay({ websiteUrl: 'https://hotel-avenida.example', rating: 3.6, ratingCount: 900 })] })).nativeElement as HTMLElement;
    expect(element.querySelector('a[href="https://hotel-avenida.example"]')).toBeNull();
    expect(element.textContent).not.toContain('Official website');
    expect(element.textContent).not.toContain('3.6');
    const good = renderContent(base({ stays: [stay({ rating: 4.6, ratingCount: 120 })] })).nativeElement as HTMLElement;
    expect(good.textContent).toContain('4.6');
  });

  it('shows destination facts as approximate and the travel-month climate', () => {
    const fixture = TestBed.createComponent(DestinationsSection);
    fixture.componentRef.setInput('destinations', [destination({ facts: { currency: 'Euro (EUR)', language: null, timeDifference: 'Same as the UK', flightTimeFromLondon: null, plugs: null, bestTime: null }, climate: { month: 'March', highC: 19, lowC: 10, sunshineHours: 1, rainyDays: null, years: 3 } })]);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Euro (EUR)');
    expect(text).toContain('Approximate');
    expect(text).toContain('In March it’s usually 19° by day and 10° at night, with about 1 hour of sunshine a day');
    expect(text).not.toContain('Language');
  });
});
