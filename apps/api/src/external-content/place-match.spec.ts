import { placeSearchQuery, shownPlaceRating, similarTextPercent, verifyPlaceMatch } from './place-match.js';

const lisbon = { latitude: 38.7223, longitude: -9.1393 };
const result = (extra: Partial<Parameters<typeof verifyPlaceMatch>[1]> = {}) => ({ name: 'Hotel Avenida Palace', address: 'R. 1º de Dezembro 123, Lisboa, Portugal', types: ['lodging', 'hotel'], coordinates: { latitude: 38.714, longitude: -9.141 }, ...extra });

describe('Google Places match checking (PHP parity)', () => {
  it('accepts the right hotel near the stay', () => {
    expect(verifyPlaceMatch('Avenida Palace, Lisbon', result(), lisbon, true, 'balanced').ok).toBe(true);
  });

  it('rejects a namesake far from the stay unless the name is near perfect', () => {
    const faraway = result({ name: 'Avenida Porto Hotel', coordinates: { latitude: 41.15, longitude: -8.61 } }); // Porto, ~275 km
    const verdict = verifyPlaceMatch('Avenida Lux Palace, Lisbon', faraway, lisbon, true, 'balanced');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('too far');
  });

  it('needs a close full-name match when the result is not lodging', () => {
    const cinema = result({ name: 'Palace Cinema', types: ['movie_theater'] });
    expect(verifyPlaceMatch('Avenida Palace, Lisbon', cinema, lisbon, true, 'balanced').ok).toBe(false);
    expect(verifyPlaceMatch('Avenida Palace, Lisbon', cinema, lisbon, true, 'balanced').reason).toContain('not lodging');
  });

  it('strict mode requires lodging within 40 km; off accepts anything', () => {
    const nearby = result({ coordinates: { latitude: 38.95, longitude: -9.3 } }); // ~29 km
    expect(verifyPlaceMatch('Avenida Palace, Lisbon', nearby, lisbon, true, 'strict').ok).toBe(true);
    expect(verifyPlaceMatch('Avenida Palace, Lisbon', result({ coordinates: { latitude: 39.2, longitude: -9.1 } }), lisbon, true, 'strict').ok).toBe(false);
    expect(verifyPlaceMatch('Somewhere Else', result({ types: ['museum'] }), lisbon, true, 'off').ok).toBe(true);
  });

  it('matches without a known location on the name alone', () => {
    expect(verifyPlaceMatch('Avenida Palace', result(), null, true, 'balanced').ok).toBe(true);
    expect(verifyPlaceMatch('Ritz Four Seasons', result(), null, true, 'balanced').ok).toBe(false);
  });

  it("computes PHP's similar_text percentage", () => {
    expect(similarTextPercent('hello', 'hello')).toBe(100);
    expect(similarTextPercent('World', 'Word')).toBeCloseTo(88.89, 1);
    expect(similarTextPercent('', 'x')).toBe(0);
  });
});

describe('Google Places presentation rules', () => {
  it('never shows a rating below the minimum', () => {
    expect(shownPlaceRating(3.9, 4)).toBeNull();
    expect(shownPlaceRating(0, 4)).toBeNull();
    expect(shownPlaceRating(null, 4)).toBeNull();
    expect(shownPlaceRating(4.2, 4)).toBe(4.2);
  });

  it('only searches a generic stay title with an address', () => {
    expect(placeSearchQuery('Hotel', null, 'Lisbon')).toBe('');
    expect(placeSearchQuery('Hotel', 'Rua Augusta 1, Lisbon', null)).toBe('Hotel, Rua Augusta 1, Lisbon');
    expect(placeSearchQuery('Avenida Palace', null, 'Lisbon')).toBe('Avenida Palace, Lisbon');
    expect(placeSearchQuery('Avenida Palace', null, null)).toBe('Avenida Palace');
  });
});
