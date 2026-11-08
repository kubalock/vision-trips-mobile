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

  it('reports cache activity without exposing cached values', () => {
    const cache = new ExternalCacheService();
    cache.set('place:secret-key', { private: 'value' }, 1_000);
    cache.get('place:secret-key');
    cache.get('missing');
    expect(cache.stats()).toEqual({ entries: 1, hits: 1, misses: 1, writes: 1 });
    expect(JSON.stringify(cache.stats())).not.toContain('secret-key');
  });
});
