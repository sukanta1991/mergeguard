import type { ConflictResult } from './types';

/** Storage interface matching VS Code's Memento (workspaceState). */
export interface CacheStorage {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

interface CacheEntry {
  result: ConflictResult;
  accessedAt: number;
}

const STORAGE_KEY = 'mergeguard.cache';
const MAX_ENTRIES = 50;

/**
 * LRU cache for conflict analysis results.
 * Keyed by `${currentSHA}:${targetSHA}` to avoid redundant git operations.
 * Persists to VS Code workspaceState for cross-session survival.
 */
export class CacheManager {
  private entries = new Map<string, CacheEntry>();

  constructor(private readonly storage?: CacheStorage) {
    this.loadFromStorage();
  }

  private static key(currentSHA: string, targetSHA: string): string {
    return `${currentSHA}:${targetSHA}`;
  }

  /**
   * Get a cached result for the given SHA pair.
   * Returns undefined if not cached. Updates LRU access time on hit.
   */
  get(currentSHA: string, targetSHA: string): ConflictResult | undefined {
    const k = CacheManager.key(currentSHA, targetSHA);
    const entry = this.entries.get(k);
    if (!entry) return undefined;

    // Update access time for LRU
    entry.accessedAt = Date.now();
    return entry.result;
  }

  /**
   * Store a result in the cache.
   * Evicts the least-recently-used entry if at capacity.
   */
  set(currentSHA: string, targetSHA: string, result: ConflictResult): void {
    const k = CacheManager.key(currentSHA, targetSHA);

    this.entries.set(k, { result, accessedAt: Date.now() });

    // Evict LRU entries if over capacity
    while (this.entries.size > MAX_ENTRIES) {
      this.evictLRU();
    }

    this.saveToStorage();
  }

  /**
   * Invalidate all entries that reference a specific branch name.
   */
  invalidate(branch: string): void {
    let changed = false;
    for (const [key, entry] of this.entries) {
      if (entry.result.branch === branch) {
        this.entries.delete(key);
        changed = true;
      }
    }
    if (changed) this.saveToStorage();
  }

  /**
   * Clear the entire cache.
   */
  invalidateAll(): void {
    this.entries.clear();
    this.saveToStorage();
  }

  /** Number of cached entries. */
  get size(): number {
    return this.entries.size;
  }

  /** Check whether a result is cached for the given SHAs. */
  has(currentSHA: string, targetSHA: string): boolean {
    return this.entries.has(CacheManager.key(currentSHA, targetSHA));
  }

  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.entries) {
      if (entry.accessedAt < oldestTime) {
        oldestTime = entry.accessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.entries.delete(oldestKey);
    }
  }

  private loadFromStorage(): void {
    if (!this.storage) return;
    const data = this.storage.get<Record<string, CacheEntry>>(STORAGE_KEY, {});
    this.entries.clear();
    for (const [key, entry] of Object.entries(data)) {
      this.entries.set(key, entry);
    }
  }

  private saveToStorage(): void {
    if (!this.storage) return;
    const data: Record<string, CacheEntry> = {};
    for (const [key, entry] of this.entries) {
      data[key] = entry;
    }
    this.storage.update(STORAGE_KEY, data);
  }
}
