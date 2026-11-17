import { samePhone } from './same-phone';

describe('samePhone', () => {
  it('matches the same line however it is written', () => {
    expect(samePhone('tel:03300431750', '0330 043 1750')).toBe(true);
    expect(samePhone('tel:+443300431750', '0330 043 1750')).toBe(true);
  });

  it('keeps genuinely different or missing numbers apart', () => {
    expect(samePhone('tel:03300431750', '0330 043 0100')).toBe(false);
    expect(samePhone(null, null)).toBe(false);
    expect(samePhone('tel:', '')).toBe(false);
  });
});
