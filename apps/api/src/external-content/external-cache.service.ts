import { Injectable } from '@nestjs/common';

interface Entry { value: unknown; expiresAt: number }

@Injectable()
export class ExternalCacheService {
  private readonly entries = new Map<string, Entry>();

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= Date.now()) { this.entries.delete(key); return undefined; }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): T {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }
}
