import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheManager, CacheStorage } from '../../src/core/cache';
import type { ConflictResult } from '../../src/core/types';
import { ConflictType, RiskLevel } from '../../src/core/types';

/** Create a minimal ConflictResult for testing. */
function makeResult(branch: string, fileCount = 0): ConflictResult {
  return {
    branch,
    currentSHA: 'aaa',
    targetSHA: 'bbb',
    files: Array.from({ length: fileCount }, (_, i) => ({
      path: `file${i}.ts`,
      conflictType: ConflictType.Content,
      lineRanges: [],
      stages: {},
    })),
    riskScore: 0,
    riskLevel: RiskLevel.None,
    timestamp: Date.now(),
    status: 'clean' as const,
  };
}

/** In-memory storage that mimics VS Code workspaceState. */
function createMockStorage(): CacheStorage {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string, defaultValue: T): T {
      return (store.get(key) as T) ?? defaultValue;
    },
    update(key: string, value: unknown) {
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

describe('CacheManager', () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager();
  });

  // ── Basic get/set ──────────────────────────────────

  it('returns undefined for a miss', () => {
    expect(cache.get('sha1', 'sha2')).toBeUndefined();
  });

  it('stores and retrieves a result', () => {
    const result = makeResult('main');
    cache.set('sha1', 'sha2', result);
    expect(cache.get('sha1', 'sha2')).toEqual(result);
  });

  it('has() returns correct boolean', () => {
    expect(cache.has('a', 'b')).toBe(false);
    cache.set('a', 'b', makeResult('main'));
    expect(cache.has('a', 'b')).toBe(true);
  });

  it('size reflects number of entries', () => {
    expect(cache.size).toBe(0);
    cache.set('a', 'b', makeResult('main'));
    cache.set('c', 'd', makeResult('dev'));
    expect(cache.size).toBe(2);
  });

  it('different SHA pairs store independently', () => {
    const r1 = makeResult('main');
    const r2 = makeResult('dev');
    cache.set('sha1', 'sha2', r1);
    cache.set('sha3', 'sha4', r2);
    expect(cache.get('sha1', 'sha2')?.branch).toBe('main');
    expect(cache.get('sha3', 'sha4')?.branch).toBe('dev');
  });

  // ── Invalidation ───────────────────────────────────

  it('invalidate() removes matching branch entries', () => {
    cache.set('a', 'b', makeResult('main'));
    cache.set('c', 'd', makeResult('dev'));
    cache.set('e', 'f', makeResult('main'));
    cache.invalidate('main');
    expect(cache.size).toBe(1);
    expect(cache.get('c', 'd')?.branch).toBe('dev');
  });

  it('invalidate() does nothing when branch not found', () => {
    cache.set('a', 'b', makeResult('main'));
    cache.invalidate('nonexistent');
    expect(cache.size).toBe(1);
  });

  it('invalidateAll() clears entire cache', () => {
    cache.set('a', 'b', makeResult('main'));
    cache.set('c', 'd', makeResult('dev'));
    cache.invalidateAll();
    expect(cache.size).toBe(0);
  });

  // ── LRU eviction ──────────────────────────────────

  it('evicts LRU entry when over 50 capacity', () => {
    // Insert 50 entries with staggered access times
    for (let i = 0; i < 50; i++) {
      cache.set(`sha${i}`, 'target', makeResult(`branch-${i}`));
    }
    expect(cache.size).toBe(50);

    // Inserting one more should evict the least recently used and keep size at 50
    cache.set('sha-new', 'target', makeResult('new-branch'));
    expect(cache.size).toBe(50);
    // The new entry should exist
    expect(cache.has('sha-new', 'target')).toBe(true);
  });

  it('respects max capacity of 50', () => {
    for (let i = 0; i < 55; i++) {
      cache.set(`sha${i}`, 'target', makeResult(`branch-${i}`));
    }
    expect(cache.size).toBe(50);
  });

  // ── Persistence ────────────────────────────────────

  it('persists to storage on set', () => {
    const storage = createMockStorage();
    const persistedCache = new CacheManager(storage);
    persistedCache.set('a', 'b', makeResult('main'));

    // New cache instance loads from same storage
    const loaded = new CacheManager(storage);
    expect(loaded.get('a', 'b')?.branch).toBe('main');
  });

  it('persists invalidation to storage', () => {
    const storage = createMockStorage();
    const c1 = new CacheManager(storage);
    c1.set('a', 'b', makeResult('main'));
    c1.set('c', 'd', makeResult('dev'));
    c1.invalidate('main');

    const c2 = new CacheManager(storage);
    expect(c2.size).toBe(1);
    expect(c2.get('c', 'd')?.branch).toBe('dev');
  });

  it('persists invalidateAll to storage', () => {
    const storage = createMockStorage();
    const c1 = new CacheManager(storage);
    c1.set('a', 'b', makeResult('main'));
    c1.invalidateAll();

    const c2 = new CacheManager(storage);
    expect(c2.size).toBe(0);
  });

  it('works without storage (in-memory only)', () => {
    const c = new CacheManager();
    c.set('a', 'b', makeResult('main'));
    expect(c.get('a', 'b')?.branch).toBe('main');
  });

  // ── Edge cases ─────────────────────────────────────

  it('overwriting same key updates the entry', () => {
    cache.set('a', 'b', makeResult('main'));
    const r2 = makeResult('main-v2');
    cache.set('a', 'b', r2);
    expect(cache.size).toBe(1);
    expect(cache.get('a', 'b')?.branch).toBe('main-v2');
  });
});
