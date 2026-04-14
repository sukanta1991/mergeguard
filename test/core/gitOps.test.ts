import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execGit, execGitStreaming, getGitVersion, checkMergeTreeSupport, compareVersions } from '../../src/core/gitOps';
import { resolve } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// ──────────────────────────────────────────────────────────
// compareVersions — pure function, no git needed
// ──────────────────────────────────────────────────────────
describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('2.38.0', '2.38.0')).toBe(0);
  });

  it('returns 1 when a > b (major)', () => {
    expect(compareVersions('3.0.0', '2.99.99')).toBe(1);
  });

  it('returns -1 when a < b (minor)', () => {
    expect(compareVersions('2.37.9', '2.38.0')).toBe(-1);
  });

  it('returns 1 when a > b (patch)', () => {
    expect(compareVersions('2.38.1', '2.38.0')).toBe(1);
  });

  it('handles versions with different segment counts', () => {
    expect(compareVersions('2.38', '2.38.0')).toBe(0);
    expect(compareVersions('2.38.0', '2.38')).toBe(0);
  });

  it('handles single-segment versions', () => {
    expect(compareVersions('3', '2')).toBe(1);
    expect(compareVersions('2', '3')).toBe(-1);
  });
});

// ──────────────────────────────────────────────────────────
// Integration tests — require git to be installed
// ──────────────────────────────────────────────────────────

/**
 * Create a temporary git repository for testing.
 * Returns the path to the repo. Caller must clean up.
 */
function createTempGitRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'mergeguard-test-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
  writeFileSync(resolve(dir, 'README.md'), '# Test\n');
  execSync('git add . && git commit -m "init"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('execGit', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
    return () => rmSync(repoDir, { recursive: true, force: true });
  });

  it('runs a simple git command and returns stdout', async () => {
    const result = await execGit(['rev-parse', '--is-inside-work-tree'], repoDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('true');
  });

  it('returns non-zero exit code for invalid git command', async () => {
    const result = await execGit(['rev-parse', '--verify', 'nonexistent-ref'], repoDir);
    expect(result.exitCode).not.toBe(0);
  });

  it('returns stderr for failed commands', async () => {
    const result = await execGit(['checkout', 'nonexistent-branch'], repoDir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('rejects with descriptive error when git is not found', async () => {
    // Temporarily override PATH to make git unavailable
    const originalPath = process.env.PATH;
    process.env.PATH = '';
    try {
      await expect(execGit(['--version'], repoDir)).rejects.toThrow(
        'Git is not installed or not found in PATH.',
      );
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('handles cwd that is not a git repo', async () => {
    const nonRepo = mkdtempSync(resolve(tmpdir(), 'mergeguard-nonrepo-'));
    try {
      const result = await execGit(['rev-parse', '--show-toplevel'], nonRepo);
      expect(result.exitCode).not.toBe(0);
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });
});

describe('execGitStreaming', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
    // Create several commits so there's multi-line log output
    for (let i = 1; i <= 5; i++) {
      writeFileSync(resolve(repoDir, `file${i}.txt`), `content ${i}\n`);
      execSync(`git add . && git commit -m "commit ${i}"`, { cwd: repoDir, stdio: 'ignore' });
    }
    return () => rmSync(repoDir, { recursive: true, force: true });
  });

  it('delivers lines one at a time through callback', async () => {
    const lines: string[] = [];
    const result = await execGitStreaming(
      ['log', '--oneline'],
      repoDir,
      (line) => lines.push(line),
    );

    expect(result.exitCode).toBe(0);
    // 5 commits + 1 initial = 6 commits total
    expect(lines.length).toBe(6);
    expect(lines[0]).toContain('commit 5');
  });

  it('handles output not ending with newline', async () => {
    const lines: string[] = [];
    const result = await execGitStreaming(
      ['rev-parse', 'HEAD'],
      repoDir,
      (line) => lines.push(line),
    );

    expect(result.exitCode).toBe(0);
    expect(lines.length).toBe(1);
    // SHA is 40 hex chars
    expect(lines[0]).toMatch(/^[0-9a-f]{40}$/);
  });

  it('returns stderr on error', async () => {
    const lines: string[] = [];
    const result = await execGitStreaming(
      ['checkout', 'nonexistent-branch'],
      repoDir,
      (line) => lines.push(line),
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});

describe('getGitVersion', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
    return () => rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns a valid semver version string', async () => {
    const version = await getGitVersion(repoDir);
    expect(version).not.toBeNull();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('returns null when git is not available', async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '';
    try {
      const version = await getGitVersion(repoDir);
      expect(version).toBeNull();
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

describe('checkMergeTreeSupport', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
    return () => rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns a boolean', async () => {
    const result = await checkMergeTreeSupport(repoDir);
    expect(typeof result).toBe('boolean');
  });

  it('returns true for modern git (this machine should have >= 2.38)', async () => {
    const version = await getGitVersion(repoDir);
    if (version && compareVersions(version, '2.38.0') >= 0) {
      expect(await checkMergeTreeSupport(repoDir)).toBe(true);
    }
  });
});
