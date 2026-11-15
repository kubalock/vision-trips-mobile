/** A small in-memory cache with a per-entry lifetime and a size cap (expired entries go first, then the oldest). */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; storedAt: number; expiresAt: number }>();

  constructor(private readonly maxEntries: number, private readonly now: () => number = Date.now) {}

  /** The value if it was stored at most `maxAgeMs` ago (and hasn't expired). */
  get(key: string, maxAgeMs = Number.POSITIVE_INFINITY): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const now = this.now();
    if (entry.expiresAt <= now) { this.entries.delete(key); return undefined; }
    return now - entry.storedAt <= maxAgeMs ? entry.value : undefined;
  }

  set(key: string, value: T, ttlMs: number): void {
    const now = this.now();
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(id);
      // Map iteration is insertion order, so the first keys are the oldest.
      for (const id of this.entries.keys()) { if (this.entries.size < this.maxEntries) break; this.entries.delete(id); }
    }
    this.entries.set(key, { value, storedAt: now, expiresAt: now + ttlMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}
