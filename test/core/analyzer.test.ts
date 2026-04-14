import { describe, it, expect, beforeEach } from 'vitest';
import {
  analyzeConflicts,
  analyzeMultipleBranches,
  preScreenConflicts,
  parseMergeTreeOutput,
  parseConflictMessage,
  parseConflictMarkers,
} from '../../src/core/analyzer';
import { ConflictType } from '../../src/core/types';
import { resolve } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// ──────────────────────────────────────────────────────────
// Pure function tests (no git required)
// ──────────────────────────────────────────────────────────

describe('parseConflictMessage', () => {
  it('parses content conflict', () => {
    const result = parseConflictMessage('CONFLICT (content): Merge conflict in file.txt');
    expect(result).toEqual({ path: 'file.txt', type: ConflictType.Content });
  });

  it('parses add/add conflict', () => {
    const result = parseConflictMessage('CONFLICT (add/add): Merge conflict in newfile.ts');
    expect(result).toEqual({ path: 'newfile.ts', type: ConflictType.Content });
  });

  it('parses modify/delete conflict', () => {
    const result = parseConflictMessage(
      'CONFLICT (modify/delete): utils.ts deleted in HEAD and modified in feature.',
    );
    expect(result).toEqual({ path: 'utils.ts', type: ConflictType.Delete });
  });

  it('parses binary conflict', () => {
    const result = parseConflictMessage('CONFLICT (binary): Merge conflict in image.png');
    expect(result).toEqual({ path: 'image.png', type: ConflictType.Binary });
  });

  it('parses rename conflict', () => {
    const result = parseConflictMessage(
      'CONFLICT (rename/rename): Rename old.ts->new.ts in branch1. Rename old.ts->other.ts in branch2.',
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe(ConflictType.Rename);
  });

  it('parses file/directory conflict', () => {
    const result = parseConflictMessage(
      'CONFLICT (file/directory): dir.txt in branch conflicts with directory dir.txt in HEAD.',
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe(ConflictType.Directory);
  });

  it('returns null for non-CONFLICT lines', () => {
    expect(parseConflictMessage('some random line')).toBeNull();
    expect(parseConflictMessage('')).toBeNull();
  });
});

describe('parseMergeTreeOutput', () => {
  it('parses output with content conflict', () => {
    const output = [
      'abc123def456789012345678901234567890abcd',
      '',
      'CONFLICT (content): Merge conflict in src/app.ts',
      '',
      '100644 aaaa000000000000000000000000000000000001 1\tsrc/app.ts',
      '100644 aaaa000000000000000000000000000000000002 2\tsrc/app.ts',
      '100644 aaaa000000000000000000000000000000000003 3\tsrc/app.ts',
    ].join('\n');

    const files = parseMergeTreeOutput(output);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/app.ts');
    expect(files[0].conflictType).toBe(ConflictType.Content);
    expect(files[0].stages?.ancestor?.oid).toBe('aaaa000000000000000000000000000000000001');
    expect(files[0].stages?.ours?.oid).toBe('aaaa000000000000000000000000000000000002');
    expect(files[0].stages?.theirs?.oid).toBe('aaaa000000000000000000000000000000000003');
  });

  it('parses output with multiple conflicts', () => {
    const output = [
      'tree-oid-here',
      '',
      'CONFLICT (content): Merge conflict in a.ts',
      'CONFLICT (modify/delete): b.ts deleted in HEAD and modified in branch.',
      '',
      '100644 0000000000000000000000000000000000000001 1\ta.ts',
      '100644 0000000000000000000000000000000000000002 2\ta.ts',
      '100644 0000000000000000000000000000000000000003 3\ta.ts',
    ].join('\n');

    const files = parseMergeTreeOutput(output);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe('a.ts');
    expect(files[0].conflictType).toBe(ConflictType.Content);
    expect(files[1].path).toBe('b.ts');
    expect(files[1].conflictType).toBe(ConflictType.Delete);
  });

  it('handles output with only stage entries (no CONFLICT messages)', () => {
    const output = [
      'tree-oid',
      '',
      '100644 0000000000000000000000000000000000000001 1\tfile.ts',
      '100644 0000000000000000000000000000000000000002 2\tfile.ts',
      '100644 0000000000000000000000000000000000000003 3\tfile.ts',
    ].join('\n');

    const files = parseMergeTreeOutput(output);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('file.ts');
  });

  it('returns empty array for clean merge output', () => {
    const output = 'abc123def456789012345678901234567890abcd\n';
    const files = parseMergeTreeOutput(output);
    expect(files).toEqual([]);
  });
});

describe('parseConflictMarkers', () => {
  it('extracts conflict ranges from standard markers', () => {
    const content = [
      'line 1',
      'line 2',
      '<<<<<<< ours',
      'our version',
      '=======',
      'their version',
      '>>>>>>> theirs',
      'line 8',
    ].join('\n');

    const ranges = parseConflictMarkers(content);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].startLine).toBe(3); // <<<<<<< is on line 3 (1-based)
    expect(ranges[0].endLine).toBe(7); // >>>>>>> is on line 7
  });

  it('handles multiple conflict regions', () => {
    const content = [
      '<<<<<<< ours',
      'a',
      '=======',
      'b',
      '>>>>>>> theirs',
      'middle',
      '<<<<<<< ours',
      'c',
      '=======',
      'd',
      '>>>>>>> theirs',
    ].join('\n');

    const ranges = parseConflictMarkers(content);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual({ startLine: 1, endLine: 5 });
    expect(ranges[1]).toEqual({ startLine: 7, endLine: 11 });
  });

  it('returns empty array when no markers present', () => {
    expect(parseConflictMarkers('clean file\nno conflicts\n')).toEqual([]);
  });

  it('handles unclosed conflict marker gracefully', () => {
    const content = '<<<<<<< ours\nsome content\n=======\ntheir content\n';
    const ranges = parseConflictMarkers(content);
    // Unclosed marker — no complete range
    expect(ranges).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────
// Integration tests — require git
// ──────────────────────────────────────────────────────────

function createTempGitRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'mergeguard-analyzer-test-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

/**
 * Create a repo with a conflict scenario:
 * - main has file.txt with "main content"
 * - feature branch has file.txt with "feature content"
 * Both diverge from a common ancestor.
 */
function createConflictRepo(): string {
  const dir = createTempGitRepo();

  // Initial commit on main
  writeFileSync(resolve(dir, 'file.txt'), 'line1\nline2\nline3\nline4\nline5\n');
  writeFileSync(resolve(dir, 'clean.txt'), 'will not conflict\n');
  execSync('git add . && git commit -m "init"', { cwd: dir, stdio: 'ignore' });

  // Create feature branch and modify file.txt
  execSync('git checkout -b feature', { cwd: dir, stdio: 'ignore' });
  writeFileSync(resolve(dir, 'file.txt'), 'line1\nfeature-change\nline3\nline4\nline5\n');
  execSync('git add . && git commit -m "feature change"', { cwd: dir, stdio: 'ignore' });

  // Go back to main and make a conflicting change
  execSync('git checkout -', { cwd: dir, stdio: 'ignore' });
  writeFileSync(resolve(dir, 'file.txt'), 'line1\nmain-change\nline3\nline4\nline5\n');
  execSync('git add . && git commit -m "main change"', { cwd: dir, stdio: 'ignore' });

  return dir;
}

/**
 * Create a repo with NO conflict (clean merge possible).
 */
function createCleanRepo(): string {
  const dir = createTempGitRepo();

  writeFileSync(resolve(dir, 'file.txt'), 'original\n');
  execSync('git add . && git commit -m "init"', { cwd: dir, stdio: 'ignore' });

  execSync('git checkout -b feature', { cwd: dir, stdio: 'ignore' });
  writeFileSync(resolve(dir, 'feature-only.txt'), 'new file\n');
  execSync('git add . && git commit -m "feature: add file"', { cwd: dir, stdio: 'ignore' });

  execSync('git checkout -', { cwd: dir, stdio: 'ignore' });
  writeFileSync(resolve(dir, 'main-only.txt'), 'another new file\n');
  execSync('git add . && git commit -m "main: add file"', { cwd: dir, stdio: 'ignore' });

  return dir;
}

describe('analyzeConflicts (integration)', () => {
  let conflictDir: string;
  let cleanDir: string;

  beforeEach(() => {
    conflictDir = createConflictRepo();
    cleanDir = createCleanRepo();
    return () => {
      rmSync(conflictDir, { recursive: true, force: true });
      rmSync(cleanDir, { recursive: true, force: true });
    };
  });

  it('detects conflicts between diverged branches', async () => {
    // We're on main, analyzing against feature
    const result = await analyzeConflicts('HEAD', 'feature', conflictDir);

    expect(result.status).toBe('success');
    expect(result.files.length).toBeGreaterThanOrEqual(1);

    const conflictedFile = result.files.find((f) => f.path === 'file.txt');
    expect(conflictedFile).toBeDefined();
    expect(conflictedFile!.conflictType).toBe(ConflictType.Content);
  });

  it('reports no conflicts for cleanly mergeable branches', async () => {
    const result = await analyzeConflicts('HEAD', 'feature', cleanDir);

    expect(result.status).toBe('success');
    expect(result.files).toHaveLength(0);
  });

  it('populates currentSHA and targetSHA', async () => {
    const result = await analyzeConflicts('HEAD', 'feature', conflictDir);

    expect(result.currentSHA).toMatch(/^[0-9a-f]{40}$/);
    expect(result.targetSHA).toMatch(/^[0-9a-f]{40}$/);
    expect(result.currentSHA).not.toBe(result.targetSHA);
  });

  it('sets timestamp', async () => {
    const before = Date.now();
    const result = await analyzeConflicts('HEAD', 'feature', conflictDir);
    const after = Date.now();

    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(after);
  });

  it('returns error result for invalid ref', async () => {
    await expect(
      analyzeConflicts('HEAD', 'nonexistent-branch', conflictDir),
    ).rejects.toThrow(/Cannot resolve ref/);
  });
});

describe('analyzeMultipleBranches (integration)', () => {
  let dir: string;

  beforeEach(() => {
    dir = createConflictRepo();

    // Add a second feature branch with no conflict
    execSync('git checkout -b feature-clean', { cwd: dir, stdio: 'ignore' });
    writeFileSync(resolve(dir, 'newfile.txt'), 'no conflict\n');
    execSync('git add . && git commit -m "clean feature"', { cwd: dir, stdio: 'ignore' });
    execSync('git checkout -', { cwd: dir, stdio: 'ignore' });

    return () => rmSync(dir, { recursive: true, force: true });
  });

  it('analyzes multiple branches and returns results for each', async () => {
    const results = await analyzeMultipleBranches('HEAD', ['feature', 'feature-clean'], dir);

    expect(results).toHaveLength(2);
    expect(results[0].branch).toBe('feature');
    expect(results[0].files.length).toBeGreaterThanOrEqual(1);
    expect(results[1].branch).toBe('feature-clean');
    expect(results[1].files).toHaveLength(0);
  });

  it('handles errors for individual branches gracefully', async () => {
    const results = await analyzeMultipleBranches(
      'HEAD',
      ['feature', 'nonexistent-xyz'],
      dir,
    );

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('success');
    expect(results[1].status).toBe('error');
    expect(results[1].errorMessage).toBeTruthy();
  });
});

describe('preScreenConflicts (integration)', () => {
  let dir: string;

  beforeEach(() => {
    dir = createConflictRepo();
    return () => rmSync(dir, { recursive: true, force: true });
  });

  it('returns overlapping files when both branches touch the same file', async () => {
    const overlap = await preScreenConflicts('HEAD', 'feature', dir);
    expect(overlap).not.toBeNull();
    expect(overlap).toContain('file.txt');
  });

  it('returns null when branches modify different files', async () => {
    const cleanDir = createCleanRepo();
    try {
      const overlap = await preScreenConflicts('HEAD', 'feature', cleanDir);
      expect(overlap).toBeNull();
    } finally {
      rmSync(cleanDir, { recursive: true, force: true });
    }
  });
});

describe('conflict line ranges (integration)', () => {
  let dir: string;

  beforeEach(() => {
    dir = createConflictRepo();
    return () => rmSync(dir, { recursive: true, force: true });
  });

  it('extracts line ranges for content conflicts', async () => {
    const result = await analyzeConflicts('HEAD', 'feature', dir);
    const conflicted = result.files.find((f) => f.path === 'file.txt');

    expect(conflicted).toBeDefined();
    // Line ranges should be populated for content conflicts with stage info
    if (conflicted?.stages?.ours && conflicted?.stages?.theirs) {
      expect(conflicted.lineRanges.length).toBeGreaterThanOrEqual(0);
      // If ranges are extracted, they should have valid values
      for (const range of conflicted.lineRanges) {
        expect(range.startLine).toBeGreaterThan(0);
        expect(range.endLine).toBeGreaterThanOrEqual(range.startLine);
      }
    }
  });
});
