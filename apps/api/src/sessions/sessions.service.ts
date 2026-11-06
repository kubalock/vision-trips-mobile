import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { MobileSession } from '@vision-trips/contracts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

interface StoredSession {
  id: string;
  baseId: string;
  recordId: string;
  fellowTraveller: boolean;
  refreshHash: string;
  refreshExpiresAt: number;
  revoked: boolean;
}

@Injectable()
export class SessionsService {
  private readonly sessions = new Map<string, StoredSession>();

  issue(input: { baseId: string; recordId: string; fellowTraveller: boolean }): MobileSession {
    const id = randomUUID();
    const refreshToken = token('vrt');
    const refreshExpiresAt = Date.now() + 30 * 86_400_000;
    this.sessions.set(id, {
      id,
      ...input,
      refreshHash: hash(refreshToken),
      refreshExpiresAt,
      revoked: false,
    });
    return this.tokensFor(id, refreshToken, refreshExpiresAt);
  }

  refresh(refreshToken: unknown): MobileSession {
    if (typeof refreshToken !== 'string') throw new UnauthorizedException('The session is not valid.');
    const currentHash = hash(refreshToken);
    const stored = [...this.sessions.values()].find((session) => session.refreshHash === currentHash);
    if (!stored || stored.revoked || stored.refreshExpiresAt < Date.now()) {
      throw new UnauthorizedException('The session has expired.');
    }
    const nextRefresh = token('vrt');
    stored.refreshHash = hash(nextRefresh);
    stored.refreshExpiresAt = Date.now() + 30 * 86_400_000;
    return this.tokensFor(stored.id, nextRefresh, stored.refreshExpiresAt);
  }

  revoke(refreshToken: unknown): void {
    if (typeof refreshToken !== 'string') return;
    const currentHash = hash(refreshToken);
    const stored = [...this.sessions.values()].find((session) => session.refreshHash === currentHash);
    if (stored) stored.revoked = true;
  }

  private tokensFor(sessionId: string, refreshToken: string, refreshExpiresAt: number): MobileSession {
    const accessExpiresAt = Date.now() + 15 * 60_000;
    return {
      accessToken: `${token('vta')}.${sessionId}`,
      accessExpiresAt: new Date(accessExpiresAt).toISOString(),
      refreshToken,
      refreshExpiresAt: new Date(refreshExpiresAt).toISOString(),
    };
  }
}

function token(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}
