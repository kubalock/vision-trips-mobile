import { Injectable } from '@nestjs/common';

interface Entry { value: unknown; expiresAt: number }

@Injectable()
export class ExternalCacheService {
  private readonly entries = new Map<string, Entry>();
  private hits = 0;
  private misses = 0;
  private writes = 0;

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= Date.now()) { this.entries.delete(key); this.misses += 1; return undefined; }
    this.hits += 1;
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): T {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    this.writes += 1;
    return value;
  }

  stats(): { entries: number; hits: number; misses: number; writes: number } {
    return { entries: this.entries.size, hits: this.hits, misses: this.misses, writes: this.writes };
  }
}
