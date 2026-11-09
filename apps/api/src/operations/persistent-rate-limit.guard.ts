import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DurableAuthStore } from '../sessions/durable-auth.store.js';

@Injectable()
export class PersistentRateLimitGuard implements CanActivate {
  constructor(private readonly store: DurableAuthStore) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const sensitive = request.path.includes('/link-exchanges') || request.path.includes('/sessions/refresh');
    const limit = numberEnv(sensitive ? 'RATE_LIMIT_AUTH_PER_MINUTE' : 'RATE_LIMIT_PER_MINUTE', sensitive ? 30 : 180);
    const identity = request.ip || request.socket.remoteAddress || 'unknown';
    const group = sensitive ? 'auth' : 'api';
    const result = this.store.consumeRateLimit(`${group}:${identity}`, limit, 60_000);
    response.setHeader('RateLimit-Limit', String(limit));
    response.setHeader('RateLimit-Remaining', String(result.remaining));
    response.setHeader('RateLimit-Reset', String(Math.ceil(result.resetAt / 1_000)));
    if (!result.allowed) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1_000))));
      throw new HttpException('Too many requests. Try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
