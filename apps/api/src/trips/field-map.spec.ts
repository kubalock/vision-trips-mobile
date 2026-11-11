import { describe, expect, it } from 'vitest';
import { attachmentImage, dateString, firstAttachmentThumbnail } from './field-map.js';

describe('dateString', () => {
  it('keeps real calendar dates, trimming any time part', () => {
    expect(dateString('2026-03-01')).toBe('2026-03-01');
    expect(dateString(['2028-02-29T10:30:00.000Z'])).toBe('2028-02-29');
  });

  it('rejects dates that only look like dates', () => {
    for (const value of ['2026-99-99', '2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-1-1', 'soon', '', null]) {
      expect(dateString(value)).toBeNull();
    }
  });
});

describe('attachment images', () => {
  const attachment = {
    url: 'https://dl.airtable.com/original.jpg', filename: 'beach.jpg', width: 4000, height: 3000,
    thumbnails: { small: { url: 'https://dl.airtable.com/small.jpg', width: 48, height: 36 }, large: { url: 'https://dl.airtable.com/large.jpg', width: 683, height: 512 }, full: { url: 'https://dl.airtable.com/full.jpg', width: 3000, height: 2250 } },
  };

  it('offers Airtable thumbnails as smaller copies, smallest first, with the original size', () => {
    expect(attachmentImage(attachment)).toEqual({
      url: 'https://dl.airtable.com/original.jpg', width: 4000, height: 3000,
      variants: [{ url: 'https://dl.airtable.com/large.jpg', width: 683 }, { url: 'https://dl.airtable.com/full.jpg', width: 3000 }, { url: 'https://dl.airtable.com/original.jpg', width: 4000 }],
    });
  });

  it('copes with attachments that have no thumbnails or sizes yet', () => {
    expect(attachmentImage({ url: 'https://dl.airtable.com/new.jpg' })).toEqual({ url: 'https://dl.airtable.com/new.jpg', width: null, height: null, variants: [] });
    expect(attachmentImage({ url: 'http://insecure.example/x.jpg' })).toBeNull();
  });

  it('uses the large thumbnail for small cards and falls back to the original', () => {
    expect(firstAttachmentThumbnail([attachment])).toBe('https://dl.airtable.com/large.jpg');
    expect(firstAttachmentThumbnail([{ url: 'https://dl.airtable.com/only.jpg' }])).toBe('https://dl.airtable.com/only.jpg');
  });
});
