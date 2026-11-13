import { tripLinkFromPath, tripLinkFromUrl } from './deep-links';

const INVITATION = 'vt_abcdefghijklmnopqrstuvwxyzABCDEF';

describe('tripLinkFromUrl', () => {
  it('accepts an https Universal Link / App Link to /trip/<invitation>', () => {
    expect(tripLinkFromUrl(`https://trips.example.com/trip/${INVITATION}`)).toEqual({ kind: 'invitation', token: INVITATION });
    expect(tripLinkFromUrl(`https://trips.example.com/app/trip/${INVITATION}/`)).toEqual({ kind: 'invitation', token: INVITATION });
  });

  it('accepts an older signed link as a legacy token (the API still verifies it)', () => {
    expect(tripLinkFromUrl('https://trips.example.com/trip/eyJ2IjoxfQ.c2lnbmF0dXJl')).toEqual({ kind: 'legacy', token: 'eyJ2IjoxfQ.c2lnbmF0dXJl' });
  });

  it('enforces the configured host allow-list', () => {
    expect(tripLinkFromUrl(`https://trips.example.com/trip/${INVITATION}`, ['trips.example.com'])).not.toBeNull();
    expect(tripLinkFromUrl(`https://evil.example.net/trip/${INVITATION}`, ['trips.example.com'])).toBeNull();
  });

  it('rejects other schemes, plain http on public hosts, credentials and other paths', () => {
    expect(tripLinkFromUrl(`visiontrips://trip/${INVITATION}`)).toBeNull();
    expect(tripLinkFromUrl(`javascript:alert(1)//trip/${INVITATION}`)).toBeNull();
    expect(tripLinkFromUrl(`http://trips.example.com/trip/${INVITATION}`)).toBeNull();
    expect(tripLinkFromUrl(`https://user:pass@trips.example.com/trip/${INVITATION}`)).toBeNull();
    expect(tripLinkFromUrl(`https://trips.example.com/other/${INVITATION}`)).toBeNull();
    expect(tripLinkFromUrl(`https://trips.example.com/trip?token=${INVITATION}`)).toBeNull();
    expect(tripLinkFromUrl(`https://trips.example.com/trip/${INVITATION}/extra`)).toBeNull();
    expect(tripLinkFromUrl('not a url')).toBeNull();
  });

  it('allows plain http only for local development hosts', () => {
    expect(tripLinkFromUrl(`http://localhost:4200/trip/${INVITATION}`)).not.toBeNull();
    expect(tripLinkFromUrl(`http://192.168.1.20:4200/trip/${INVITATION}`, ['trips.example.com'])).not.toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(tripLinkFromPath('/trip/vt_short')).toBeNull();
    expect(tripLinkFromPath('/trip/<script>')).toBeNull();
    expect(tripLinkFromPath('/trip/%E0%A4%A')).toBeNull();
  });
});
