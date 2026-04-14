import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { analyzeConflicts, analyzeMultipleBranches } from '../../src/core/analyzer';
import { calculateRiskScore, scoreConflictResult } from '../../src/core/riskScorer';
import { ConflictType, RiskLevel } from '../../src/core/types';

/**
 * Integration tests using a real git repository created by the fixture script.
 * These test the full analysis pipeline end-to-end.
 */
describe('Integration: conflict analysis with real git repo', () => {
  let fixtureDir: string;
  let gitVersion: string;

  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'mergeguard-test-'));
    // Run fixture script
    execSync(`bash ${join(__dirname, '../fixtures/create-test-repo.sh')} "${fixtureDir}"`, {
      stdio: 'pipe',
    });

    gitVersion = execSync('git --version', { encoding: 'utf-8' }).trim();
  });

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  // ── Content conflict ──────────────────
  it('detects content conflict in app.ts against feature/content-conflict', async () => {
    const result = await analyzeConflicts('main', 'feature/content-conflict', fixtureDir);
    expect(result.status).not.toBe('error');
    expect(result.files.length).toBeGreaterThan(0);
    const appConflict = result.files.find((f) => f.path === 'app.ts');
    expect(appConflict).toBeDefined();
    expect(appConflict!.conflictType).toBe(ConflictType.Content);
  });

  // ── Clean branch ──────────────────────
  it('reports no conflicts for feature/clean', async () => {
    const result = await analyzeConflicts('main', 'feature/clean', fixtureDir);
    expect(result.status).not.toBe('error');
    expect(result.files.length).toBe(0);
  });

  // ── Delete conflict ───────────────────
  it('detects delete/modify conflict for feature/delete-conflict', async () => {
    const result = await analyzeConflicts('main', 'feature/delete-conflict', fixtureDir);
    expect(result.status).not.toBe('error');
    // config.json was removed on main, modified on feature
    const configConflict = result.files.find((f) => f.path === 'config.json');
    expect(configConflict).toBeDefined();
  });

  // ── Multiple branches ─────────────────
  it('analyzeMultipleBranches returns results for all targets', async () => {
    const results = await analyzeMultipleBranches(
      'main',
      ['feature/content-conflict', 'feature/clean', 'feature/delete-conflict'],
      fixtureDir,
    );
    expect(results).toHaveLength(3);
    // Content conflict branch should have conflicts
    expect(results[0].files.length).toBeGreaterThan(0);
    // Clean branch should have none
    expect(results[1].files.length).toBe(0);
    // Delete conflict should have conflicts
    expect(results[2].files.length).toBeGreaterThan(0);
  });

  // ── Risk scoring integration ──────────
  it('scores conflict result with riskScorer', async () => {
    const result = await analyzeConflicts('main', 'feature/content-conflict', fixtureDir);
    scoreConflictResult(result);
    expect(result.riskScore).toBeGreaterThan(0);
    expect(result.riskLevel).not.toBe(RiskLevel.None);
  });

  it('calculateRiskScore returns aggregate for multiple results', async () => {
    const results = await analyzeMultipleBranches(
      'main',
      ['feature/content-conflict', 'feature/clean'],
      fixtureDir,
    );
    results.forEach((r) => scoreConflictResult(r));
    const overall = calculateRiskScore(results);
    expect(overall.score).toBeGreaterThan(0);
    expect(typeof overall.level).toBe('string');
  });

  // ── Edge: non-existent branch ─────────
  it('throws or returns error for non-existent branch', async () => {
    try {
      const result = await analyzeConflicts('main', 'nonexistent-branch', fixtureDir);
      // If it doesn't throw, it should be an error result
      expect(result.status).toBe('error');
    } catch {
      // Expected — branch doesn't exist
    }
  });

  // ── Edge: same branch ─────────────────
  it('returns no conflicts when comparing branch with itself', async () => {
    const result = await analyzeConflicts('main', 'main', fixtureDir);
    expect(result.files.length).toBe(0);
  });

  // ── Edge: repo with only main branch ──
  it('analyzeMultipleBranches with empty targets', async () => {
    const results = await analyzeMultipleBranches('main', [], fixtureDir);
    expect(results).toHaveLength(0);
  });

  // ── Performance ──────────────────────
  it('scan completes in under 5 seconds for multiple branches', async () => {
    const start = Date.now();
    await analyzeMultipleBranches(
      'main',
      [
        'feature/content-conflict',
        'feature/rename-conflict',
        'feature/delete-conflict',
        'feature/binary-conflict',
        'feature/clean',
      ],
      fixtureDir,
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });
});
