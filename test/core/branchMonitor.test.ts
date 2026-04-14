import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BranchMonitor, parseBranchList } from '../../src/core/branchMonitor';
import { resolve } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// ──────────────────────────────────────────────────────────
// parseBranchList — pure function
// ──────────────────────────────────────────────────────────
describe('parseBranchList', () => {
  it('parses local branch output correctly', () => {
    const output = 'main abc1234def5678901234567890123456789012\nfeature/auth 1234567890abcdef1234567890abcdef12345678\n';
    const result = parseBranchList(output, false);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: 'main',
      sha: 'abc1234def5678901234567890123456789012',
      isRemote: false,
      isTracked: false,
    });
    expect(result[1]).toEqual({
      name: 'feature/auth',
      sha: '1234567890abcdef1234567890abcdef12345678',
      isRemote: false,
      isTracked: false,
    });
  });

  it('parses remote branch output correctly', () => {
    const output = 'origin/main abc1234def5678901234567890123456789012\n';
    const result = parseBranchList(output, true);
    expect(result).toHaveLength(1);
    expect(result[0].isRemote).toBe(true);
    expect(result[0].name).toBe('origin/main');
  });

  it('skips HEAD pointer entries', () => {
    const output = 'origin/HEAD abc1234def5678901234567890123456789012\norigin/main def456\n';
    const result = parseBranchList(output, true);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('origin/main');
  });

  it('skips empty lines', () => {
    const output = '\nmain abc123\n\n';
    const result = parseBranchList(output, false);
    expect(result).toHaveLength(1);
  });

  it('returns empty array for empty output', () => {
    expect(parseBranchList('', false)).toEqual([]);
    expect(parseBranchList('\n', true)).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────
// Integration tests — require git
// ──────────────────────────────────────────────────────────

function createTempGitRepo(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'mergeguard-branch-test-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
  writeFileSync(resolve(dir, 'README.md'), '# Test\n');
  execSync('git add . && git commit -m "init"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('BranchMonitor', () => {
  let repoDir: string;
  let monitor: BranchMonitor;

  beforeEach(() => {
    repoDir = createTempGitRepo();
    monitor = new BranchMonitor(repoDir);
    return () => {
      monitor.dispose();
      rmSync(repoDir, { recursive: true, force: true });
    };
  });

  describe('getCurrentBranch', () => {
    it('returns the current branch name', async () => {
      const branch = await monitor.getCurrentBranch();
      // Git init defaults to 'main' or 'master' depending on config
      expect(['main', 'master']).toContain(branch);
    });

    it('returns HEAD in detached HEAD state', async () => {
      const sha = execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim();
      execSync(`git checkout ${sha}`, { cwd: repoDir, stdio: 'ignore' });
      const branch = await monitor.getCurrentBranch();
      expect(branch).toBe('HEAD');
    });
  });

  describe('getCurrentSHA', () => {
    it('returns a 40-char hex SHA', async () => {
      const sha = await monitor.getCurrentSHA();
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    });

    it('matches git rev-parse HEAD output', async () => {
      const expected = execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim();
      const sha = await monitor.getCurrentSHA();
      expect(sha).toBe(expected);
    });
  });

  describe('listLocalBranches', () => {
    it('returns the default branch', async () => {
      const branches = await monitor.listLocalBranches();
      expect(branches.length).toBeGreaterThanOrEqual(1);
      expect(branches[0].isRemote).toBe(false);
      expect(branches[0].sha).toMatch(/^[0-9a-f]{40}$/);
    });

    it('includes newly created branches', async () => {
      execSync('git branch feature/test', { cwd: repoDir, stdio: 'ignore' });
      execSync('git branch bugfix/fix-123', { cwd: repoDir, stdio: 'ignore' });
      const branches = await monitor.listLocalBranches();
      const names = branches.map((b) => b.name);
      expect(names).toContain('feature/test');
      expect(names).toContain('bugfix/fix-123');
    });
  });

  describe('listRemoteBranches', () => {
    it('returns empty array when no remotes configured', async () => {
      const branches = await monitor.listRemoteBranches();
      expect(branches).toEqual([]);
    });
  });

  describe('getBranchSHA', () => {
    it('resolves an existing branch to its SHA', async () => {
      const currentBranch = await monitor.getCurrentBranch();
      const sha = await monitor.getBranchSHA(currentBranch);
      expect(sha).not.toBeNull();
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    });

    it('returns null for a non-existent branch', async () => {
      const sha = await monitor.getBranchSHA('nonexistent-branch-xyz');
      expect(sha).toBeNull();
    });
  });

  describe('getTrackedBranches', () => {
    it('returns only branches that exist in the repo', async () => {
      // Default config tracks main/master/develop, but only main or master exists
      const tracked = await monitor.getTrackedBranches();
      expect(tracked.length).toBeGreaterThanOrEqual(1);
      expect(tracked.every((b) => b.isTracked)).toBe(true);
    });

    it('does not include branches that do not exist', async () => {
      const tracked = await monitor.getTrackedBranches();
      const names = tracked.map((b) => b.name);
      // 'develop' doesn't exist in our test repo
      expect(names).not.toContain('develop');
    });
  });

  describe('snapshotTrackedBranches', () => {
    it('takes a snapshot without errors', async () => {
      await expect(monitor.snapshotTrackedBranches()).resolves.toBeUndefined();
    });
  });

  describe('event emission', () => {
    it('fires onBranchChanged when branch switches', async () => {
      // Take initial snapshot
      await monitor.snapshotTrackedBranches();

      // Create a new branch and switch to it
      execSync('git branch test-switch', { cwd: repoDir, stdio: 'ignore' });

      const events: Array<{ previous: string | null; current: string }> = [];
      monitor.onBranchChanged((e) => events.push(e));

      // Simulate what the watcher does: switch branch, then call check
      const previousBranch = await monitor.getCurrentBranch();
      execSync('git checkout test-switch', { cwd: repoDir, stdio: 'ignore' });

      // Manually trigger the check (in production, FileSystemWatcher triggers this)
      await (monitor as any).checkBranchChange();

      expect(events).toHaveLength(1);
      expect(events[0].previous).toBe(previousBranch);
      expect(events[0].current).toBe('test-switch');
    });

    it('fires onTrackedBranchUpdated when a tracked branch gets a new commit', async () => {
      // Get the default branch name
      const defaultBranch = await monitor.getCurrentBranch();

      // Create a second branch, switch to it, and make a commit
      execSync('git branch other-branch', { cwd: repoDir, stdio: 'ignore' });
      execSync('git checkout other-branch', { cwd: repoDir, stdio: 'ignore' });

      // Snapshot now (tracks main/master which still has the old SHA)
      await monitor.snapshotTrackedBranches();

      // Go back to default branch and make a new commit
      execSync(`git checkout ${defaultBranch}`, { cwd: repoDir, stdio: 'ignore' });
      writeFileSync(resolve(repoDir, 'update.txt'), 'new content\n');
      execSync('git add . && git commit -m "update"', { cwd: repoDir, stdio: 'ignore' });

      // Switch back to other-branch so the monitor has a different HEAD
      execSync('git checkout other-branch', { cwd: repoDir, stdio: 'ignore' });

      const events: Array<{ branch: string; previousSHA: string; currentSHA: string }> = [];
      monitor.onTrackedBranchUpdated((e) => events.push(e));

      // Manually trigger the check
      await (monitor as any).checkTrackedBranchUpdates();

      expect(events).toHaveLength(1);
      expect(events[0].branch).toBe(defaultBranch);
      expect(events[0].previousSHA).not.toBe(events[0].currentSHA);
    });

    it('does not fire onBranchChanged if branch has not changed', async () => {
      await monitor.snapshotTrackedBranches();

      const events: Array<{ previous: string | null; current: string }> = [];
      monitor.onBranchChanged((e) => events.push(e));

      await (monitor as any).checkBranchChange();
      expect(events).toHaveLength(0);
    });
  });

  describe('dispose', () => {
    it('cleans up without errors', () => {
      expect(() => monitor.dispose()).not.toThrow();
    });

    it('can be called multiple times safely', () => {
      monitor.dispose();
      expect(() => monitor.dispose()).not.toThrow();
    });
  });
});
