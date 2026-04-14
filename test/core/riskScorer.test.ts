import { describe, it, expect } from 'vitest';
import {
  calculateRiskScore,
  scoreConflictResult,
  conflictCountScore,
  lineDensityScore,
  typeSeverityScore,
  fileCriticalityScore,
  branchCountScore,
  scoreToLevel,
} from '../../src/core/riskScorer';
import { ConflictType, RiskLevel } from '../../src/core/types';
import type { ConflictFile, ConflictResult } from '../../src/core/types';

function makeFile(
  path: string,
  type: ConflictType = ConflictType.Content,
  lineRanges: Array<{ startLine: number; endLine: number }> = [],
): ConflictFile {
  return { path, conflictType: type, lineRanges, stages: {} };
}

function makeResult(
  branch: string,
  files: ConflictFile[] = [],
  status: 'clean' | 'conflict' | 'error' = files.length > 0 ? 'conflict' : 'clean',
): ConflictResult {
  return {
    branch,
    currentSHA: 'aaa',
    targetSHA: 'bbb',
    files,
    riskScore: 0,
    riskLevel: RiskLevel.None,
    timestamp: Date.now(),
    status,
  };
}

// ── scoreToLevel ──────────────────────────────────

describe('scoreToLevel', () => {
  it('maps 0 to None', () => expect(scoreToLevel(0)).toBe(RiskLevel.None));
  it('maps 15 to Low', () => expect(scoreToLevel(15)).toBe(RiskLevel.Low));
  it('maps 30 to Low', () => expect(scoreToLevel(30)).toBe(RiskLevel.Low));
  it('maps 31 to Medium', () => expect(scoreToLevel(31)).toBe(RiskLevel.Medium));
  it('maps 60 to Medium', () => expect(scoreToLevel(60)).toBe(RiskLevel.Medium));
  it('maps 61 to High', () => expect(scoreToLevel(61)).toBe(RiskLevel.High));
  it('maps 100 to High', () => expect(scoreToLevel(100)).toBe(RiskLevel.High));
});

// ── conflictCountScore ───────────────────────────

describe('conflictCountScore', () => {
  it('returns 0 for 0 files', () => expect(conflictCountScore(0)).toBe(0));
  it('returns ~0.28 for 1 file', () => {
    const s = conflictCountScore(1);
    expect(s).toBeGreaterThan(0.2);
    expect(s).toBeLessThan(0.4);
  });
  it('increases with more files', () => {
    expect(conflictCountScore(5)).toBeGreaterThan(conflictCountScore(2));
  });
  it('caps at 1', () => {
    expect(conflictCountScore(100)).toBe(1);
  });
});

// ── lineDensityScore ─────────────────────────────

describe('lineDensityScore', () => {
  it('returns 0 for empty files', () => expect(lineDensityScore([])).toBe(0));
  it('returns 0.3 when no line ranges', () => {
    expect(lineDensityScore([makeFile('a.ts')])).toBe(0.3);
  });
  it('increases with more conflict lines', () => {
    const small = lineDensityScore([
      makeFile('a.ts', ConflictType.Content, [{ startLine: 1, endLine: 5 }]),
    ]);
    const large = lineDensityScore([
      makeFile('a.ts', ConflictType.Content, [{ startLine: 1, endLine: 100 }]),
    ]);
    expect(large).toBeGreaterThan(small);
  });
});

// ── typeSeverityScore ────────────────────────────

describe('typeSeverityScore', () => {
  it('returns 0 for empty', () => expect(typeSeverityScore([])).toBe(0));
  it('Content conflicts have lower severity than Binary', () => {
    const contentScore = typeSeverityScore([makeFile('a.ts', ConflictType.Content)]);
    const binaryScore = typeSeverityScore([makeFile('a.bin', ConflictType.Binary)]);
    expect(binaryScore).toBeGreaterThan(contentScore);
  });
  it('Delete conflicts are high severity', () => {
    const s = typeSeverityScore([makeFile('a.ts', ConflictType.Delete)]);
    expect(s).toBeGreaterThan(0.5);
  });
});

// ── fileCriticalityScore ─────────────────────────

describe('fileCriticalityScore', () => {
  it('returns 0 for empty', () => expect(fileCriticalityScore([])).toBe(0));
  it('lock files are very critical', () => {
    const s = fileCriticalityScore([makeFile('package-lock.json')]);
    expect(s).toBeGreaterThanOrEqual(0.8);
  });
  it('test files have low criticality', () => {
    const s = fileCriticalityScore([makeFile('src/utils.test.ts')]);
    expect(s).toBeLessThanOrEqual(0.3);
  });
  it('regular source files get default score', () => {
    const s = fileCriticalityScore([makeFile('src/app.ts')]);
    expect(s).toBeCloseTo(0.4, 1);
  });
  it('CI workflow files are critical', () => {
    const s = fileCriticalityScore([makeFile('.github/workflows/ci.yml')]);
    expect(s).toBeGreaterThanOrEqual(0.7);
  });
  it('migration files are critical', () => {
    const s = fileCriticalityScore([makeFile('db/migrations/001_create_users.sql')]);
    expect(s).toBeGreaterThanOrEqual(0.7);
  });
});

// ── branchCountScore ─────────────────────────────

describe('branchCountScore', () => {
  it('returns 0 for 0', () => expect(branchCountScore(0)).toBe(0));
  it('returns 0.2 for 1', () => expect(branchCountScore(1)).toBe(0.2));
  it('returns 0.6 for 3', () => expect(branchCountScore(3)).toBe(0.6));
  it('returns 1 for 5+', () => expect(branchCountScore(5)).toBe(1));
});

// ── calculateRiskScore (integration) ─────────────

describe('calculateRiskScore', () => {
  it('returns zero score for no results', () => {
    const rs = calculateRiskScore([]);
    expect(rs.score).toBe(0);
    expect(rs.level).toBe(RiskLevel.None);
  });

  it('returns zero score when all results are clean', () => {
    const rs = calculateRiskScore([makeResult('main'), makeResult('dev')]);
    expect(rs.score).toBe(0);
    expect(rs.level).toBe(RiskLevel.None);
  });

  it('filters out error results', () => {
    const rs = calculateRiskScore([
      makeResult('main', [makeFile('a.ts')], 'error'),
    ]);
    // Error results are excluded
    expect(rs.score).toBe(0);
  });

  it('calculates a non-zero score for conflicts', () => {
    const rs = calculateRiskScore([
      makeResult('main', [
        makeFile('a.ts', ConflictType.Content, [{ startLine: 1, endLine: 10 }]),
      ]),
    ]);
    expect(rs.score).toBeGreaterThan(0);
    expect(rs.level).not.toBe(RiskLevel.None);
  });

  it('higher conflicts produce higher scores', () => {
    const low = calculateRiskScore([
      makeResult('main', [makeFile('a.ts')]),
    ]);
    const high = calculateRiskScore([
      makeResult('main', [
        makeFile('a.ts', ConflictType.Binary, [{ startLine: 1, endLine: 50 }]),
        makeFile('package-lock.json', ConflictType.Content, [{ startLine: 1, endLine: 200 }]),
        makeFile('.github/workflows/ci.yml', ConflictType.Delete),
      ]),
      makeResult('dev', [
        makeFile('b.ts', ConflictType.Content, [{ startLine: 1, endLine: 30 }]),
      ]),
    ]);
    expect(high.score).toBeGreaterThan(low.score);
  });

  it('includes component breakdown', () => {
    const rs = calculateRiskScore([
      makeResult('main', [makeFile('a.ts')]),
    ]);
    expect(rs.components).toHaveProperty('conflictCount');
    expect(rs.components).toHaveProperty('lineDensity');
    expect(rs.components).toHaveProperty('typeSeverity');
    expect(rs.components).toHaveProperty('fileCriticality');
    expect(rs.components).toHaveProperty('branchCount');
  });

  it('score is capped at 100', () => {
    // Create extreme data
    const files = Array.from({ length: 20 }, (_, i) =>
      makeFile(`lock${i}.json`, ConflictType.Binary, [{ startLine: 1, endLine: 1000 }]),
    );
    const results = Array.from({ length: 5 }, (_, i) =>
      makeResult(`branch-${i}`, files),
    );
    const rs = calculateRiskScore(results);
    expect(rs.score).toBeLessThanOrEqual(100);
  });
});

// ── scoreConflictResult ──────────────────────────

describe('scoreConflictResult', () => {
  it('mutates riskScore and riskLevel on the result', () => {
    const result = makeResult('main', [
      makeFile('a.ts', ConflictType.Content, [{ startLine: 1, endLine: 20 }]),
    ]);
    expect(result.riskScore).toBe(0);
    scoreConflictResult(result);
    expect(result.riskScore).toBeGreaterThan(0);
    expect(result.riskLevel).not.toBe(RiskLevel.None);
  });
});
