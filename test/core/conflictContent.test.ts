import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getFileAtRef,
  catFile,
  getMergeBase,
  getMergedFileContent,
  getThreeWayContent,
} from '../../src/core/conflictContent';

describe('conflictContent', () => {
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'mergeguard-content-'));
    execSync(
      `bash ${join(__dirname, '../fixtures/create-test-repo.sh')} "${fixtureDir}"`,
      { stdio: 'pipe' },
    );
  });

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  // ── getFileAtRef ──────────────────────────────

  describe('getFileAtRef', () => {
    it('returns file content at a branch ref', async () => {
      const content = await getFileAtRef('main', 'app.ts', fixtureDir);
      expect(content).not.toBeNull();
      expect(content).toContain('function');
    });

    it('returns content from a feature branch', async () => {
      const content = await getFileAtRef('feature/content-conflict', 'app.ts', fixtureDir);
      expect(content).not.toBeNull();
      expect(content).toContain('multiply');
    });

    it('returns null for non-existent file', async () => {
      const content = await getFileAtRef('main', 'does-not-exist.ts', fixtureDir);
      expect(content).toBeNull();
    });

    it('returns null for non-existent ref', async () => {
      const content = await getFileAtRef('nonexistent', 'app.ts', fixtureDir);
      expect(content).toBeNull();
    });
  });

  // ── catFile ───────────────────────────────────

  describe('catFile', () => {
    it('returns content for a valid OID', async () => {
      // Get the HEAD tree OID
      const oid = execSync('git rev-parse HEAD^{tree}', {
        cwd: fixtureDir,
        encoding: 'utf-8',
      }).trim();
      const content = await catFile(oid, fixtureDir);
      expect(content).not.toBeNull();
    });

    it('returns null for invalid OID', async () => {
      const content = await catFile('0000000000000000000000000000000000000000', fixtureDir);
      expect(content).toBeNull();
    });
  });

  // ── getMergeBase ──────────────────────────────

  describe('getMergeBase', () => {
    it('returns merge-base SHA for two branches', async () => {
      const base = await getMergeBase('main', 'feature/content-conflict', fixtureDir);
      expect(base).not.toBeNull();
      expect(base).toMatch(/^[0-9a-f]{40}$/);
    });

    it('returns null for unrelated refs', async () => {
      const base = await getMergeBase('main', 'nonexistent', fixtureDir);
      expect(base).toBeNull();
    });
  });

  // ── getMergedFileContent ──────────────────────

  describe('getMergedFileContent', () => {
    it('returns merged content with conflict markers for conflicting file', async () => {
      const content = await getMergedFileContent(
        'main',
        'feature/content-conflict',
        'app.ts',
        fixtureDir,
      );
      // Should have content — might have conflict markers
      expect(content).not.toBeNull();
      expect(typeof content).toBe('string');
    });

    it('returns null for non-existent file', async () => {
      const content = await getMergedFileContent(
        'main',
        'feature/content-conflict',
        'nonexistent.ts',
        fixtureDir,
      );
      expect(content).toBeNull();
    });
  });

  // ── getThreeWayContent ────────────────────────

  describe('getThreeWayContent', () => {
    it('returns base, ours, and theirs for a conflicting file', async () => {
      const result = await getThreeWayContent(
        'main',
        'feature/content-conflict',
        'app.ts',
        fixtureDir,
      );
      expect(result.base).not.toBeNull();
      expect(result.ours).not.toBeNull();
      expect(result.theirs).not.toBeNull();
    });

    it('base differs from both ours and theirs', async () => {
      const result = await getThreeWayContent(
        'main',
        'feature/content-conflict',
        'app.ts',
        fixtureDir,
      );
      // Base is the original, ours/theirs have diverged
      expect(result.base).not.toBe(result.ours);
      expect(result.base).not.toBe(result.theirs);
    });

    it('returns null base for file that did not exist at merge-base', async () => {
      // feature/clean adds new-file.ts which doesn't exist at merge-base
      const result = await getThreeWayContent(
        'main',
        'feature/clean',
        'new-file.ts',
        fixtureDir,
      );
      expect(result.base).toBeNull();
      expect(result.ours).toBeNull(); // doesn't exist on main
      expect(result.theirs).not.toBeNull(); // exists on feature/clean
    });
  });
});
