/**
 * In-memory TTL cache for ABI resolutions.
 * Prevents repeated Sourcify/Explorer fetches for the same contract.
 */

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    // Evict expired entries on size check
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
    return this.store.size;
  }
}

// ABI cache: 30 min TTL — contracts don't change often
export const abiCache = new TtlCache<string>(30 * 60 * 1000);

// Negative cache: 5 min TTL — don't hammer failed lookups
export const abiNegativeCache = new TtlCache<true>(5 * 60 * 1000);

export function makeAbiCacheKey(chain: string, address: string, source: string): string {
  return `${chain}:${address.toLowerCase()}:${source}`;
}
