/**
 * A small IndexedDB key-value store for trips saved in a browser. Falls back to memory for the current visit
 * when IndexedDB is unavailable (some private windows, tests).
 */
export class BrowserTripDb {
  private db: Promise<IDBDatabase | null> | null = null;
  private readonly memory = new Map<string, unknown>();

  constructor(private readonly name = 'vision-trips', private readonly store = 'trips') {}

  async get(key: string): Promise<unknown> {
    const db = await this.open();
    return db ? request(db.transaction(this.store).objectStore(this.store).get(key)) : this.memory.get(key);
  }

  async keys(): Promise<string[]> {
    const db = await this.open();
    const keys = db ? await request(db.transaction(this.store).objectStore(this.store).getAllKeys()) : [...this.memory.keys()];
    return keys.filter((key): key is string => typeof key === 'string');
  }

  async set(key: string, value: unknown): Promise<void> {
    const db = await this.open();
    if (db) await request(db.transaction(this.store, 'readwrite').objectStore(this.store).put(value, key));
    else this.memory.set(key, value);
  }

  async delete(key: string): Promise<void> {
    const db = await this.open();
    if (db) await request(db.transaction(this.store, 'readwrite').objectStore(this.store).delete(key));
    else this.memory.delete(key);
  }

  private open(): Promise<IDBDatabase | null> {
    this.db ??= new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      try {
        const opening = indexedDB.open(this.name, 1);
        opening.onupgradeneeded = () => opening.result.createObjectStore(this.store);
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => resolve(null);
        opening.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
    return this.db;
  }
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });
}
