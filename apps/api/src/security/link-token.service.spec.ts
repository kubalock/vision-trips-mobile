import { createHmac } from 'node:crypto';
import { LinkTokenService } from './link-token.service.js';

describe('LinkTokenService', () => {
  const secret = 'test-link-secret';
  const service = new LinkTokenService();

  beforeEach(() => {
    process.env.VISION_LINK_SECRET = secret;
    delete process.env.VISION_LINK_SECRET_PREVIOUS;
  });

  it('parses the existing PHP token format from a trip URL', () => {
    const token = mint({ v: 1, b: 'appABCDEFGHIJKLMN', r: 'recABCDEFGHIJKLMN', s: 'c', e: 0 }, secret);
    expect(service.parseLinkOrToken(`https://trips.example/trip/${token}/`)).toEqual({
      baseId: 'appABCDEFGHIJKLMN',
      recordId: 'recABCDEFGHIJKLMN',
      scope: 'customer',
      expiresAt: 0,
      legacy: false,
      fellowTraveller: false,
    });
  });

  it('rejects a modified signature', () => {
    const token = mint({ v: 1, b: 'appABCDEFGHIJKLMN', r: 'recABCDEFGHIJKLMN', s: 'c', e: 0 }, secret);
    expect(() => service.parseLinkOrToken(`${token.slice(0, -1)}x`)).toThrow('not valid');
  });

  it('recognizes restricted fellow-traveller links', () => {
    const token = mint({ v: 1, b: 'appABCDEFGHIJKLMN', r: 'recABCDEFGHIJKLMN', s: 'c', e: 0, t: 1 }, secret);
    expect(service.parseLinkOrToken(token).fellowTraveller).toBe(true);
  });
});

function mint(payload: object, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}
