import { sourceFor, srcset } from './responsive-image';

const image = { url: 'https://cdn/original.jpg', variants: [{ url: 'https://cdn/large.jpg', width: 683 }, { url: 'https://cdn/full.jpg', width: 3000 }, { url: 'https://cdn/original.jpg', width: 4000 }] };

describe('responsive images', () => {
  it('builds a srcset from the smaller copies', () => {
    expect(srcset(image)).toBe('https://cdn/large.jpg 683w, https://cdn/full.jpg 3000w, https://cdn/original.jpg 4000w');
    expect(srcset({ url: 'https://cdn/x.jpg' })).toBeNull();
  });

  it('gives small cards a thumbnail rather than the original', () => {
    expect(sourceFor(image, 240)).toBe('https://cdn/large.jpg');
    expect(sourceFor(image, 800)).toBe('https://cdn/full.jpg');
    expect(sourceFor(image, 5000)).toBe('https://cdn/original.jpg');
    expect(sourceFor({ url: 'https://cdn/only.jpg' }, 240)).toBe('https://cdn/only.jpg');
  });
});
