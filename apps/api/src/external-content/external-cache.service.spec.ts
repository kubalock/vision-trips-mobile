import { ExternalCacheService } from './external-cache.service.js';

describe('ExternalCacheService', () => {
  it('returns cached provider content before its expiry', () => {
    const cache = new ExternalCacheService();
    cache.set('weather:lisbon', { temperature: 22 }, 1_000);
    expect(cache.get('weather:lisbon')).toEqual({ temperature: 22 });
  });

  it('drops expired and negative-cache entries', () => {
    vi.useFakeTimers();
    const cache = new ExternalCacheService();
    cache.set('missing:place', null, 500);
    vi.advanceTimersByTime(501);
    expect(cache.get('missing:place')).toBeUndefined();
    vi.useRealTimers();
  });
});
