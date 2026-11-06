import { SessionsService } from './sessions.service.js';

describe('SessionsService', () => {
  it('rotates refresh tokens and rejects replay of the previous token', () => {
    const service = new SessionsService();
    const initial = service.issue({
      baseId: 'appABCDEFGHIJKLMN',
      recordId: 'recABCDEFGHIJKLMN',
      fellowTraveller: false,
    });
    const refreshed = service.refresh(initial.refreshToken);

    expect(refreshed.refreshToken).not.toBe(initial.refreshToken);
    expect(() => service.refresh(initial.refreshToken)).toThrow('expired');
  });

  it('rejects refresh after revocation', () => {
    const service = new SessionsService();
    const session = service.issue({
      baseId: 'appABCDEFGHIJKLMN',
      recordId: 'recABCDEFGHIJKLMN',
      fellowTraveller: true,
    });
    service.revoke(session.refreshToken);
    expect(() => service.refresh(session.refreshToken)).toThrow('expired');
  });
});
