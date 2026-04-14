import { ConflictFile, ConflictResult, ConflictType, RiskLevel } from './types';

/** Weights for each risk component (sum to 1.0). */
const DEFAULT_WEIGHTS = {
  conflictCount: 0.25,
  lineDensity: 0.20,
  typeSeverity: 0.20,
  fileCriticality: 0.20,
  branchCount: 0.15,
};

/** Score result from the risk calculator. */
export interface RiskScore {
  /** Overall risk score from 0 to 100. */
  score: number;
  /** Classified risk level. */
  level: RiskLevel;
  /** Per-component breakdown (0–1 each). */
  components: {
    conflictCount: number;
    lineDensity: number;
    typeSeverity: number;
    fileCriticality: number;
    branchCount: number;
  };
}

/**
 * Calculate an overall risk score from conflict analysis results.
 *
 * @param results - Array of ConflictResult from analyzing multiple branches
 * @returns RiskScore with 0–100 score, risk level, and component breakdown
 */
export function calculateRiskScore(results: ConflictResult[]): RiskScore {
  // Only consider successful analyses
  const valid = results.filter((r) => r.status !== 'error');

  if (valid.length === 0 || valid.every((r) => r.files.length === 0)) {
    return {
      score: 0,
      level: RiskLevel.None,
      components: {
        conflictCount: 0,
        lineDensity: 0,
        typeSeverity: 0,
        fileCriticality: 0,
        branchCount: 0,
      },
    };
  }

  const allFiles = valid.flatMap((r) => r.files);
  const branchesWithConflicts = valid.filter((r) => r.files.length > 0).length;

  const cc = conflictCountScore(allFiles.length);
  const ld = lineDensityScore(allFiles);
  const ts = typeSeverityScore(allFiles);
  const fc = fileCriticalityScore(allFiles);
  const bc = branchCountScore(branchesWithConflicts);

  const weighted =
    cc * DEFAULT_WEIGHTS.conflictCount +
    ld * DEFAULT_WEIGHTS.lineDensity +
    ts * DEFAULT_WEIGHTS.typeSeverity +
    fc * DEFAULT_WEIGHTS.fileCriticality +
    bc * DEFAULT_WEIGHTS.branchCount;

  const score = Math.round(Math.min(100, weighted * 100));

  return {
    score,
    level: scoreToLevel(score),
    components: {
      conflictCount: cc,
      lineDensity: ld,
      typeSeverity: ts,
      fileCriticality: fc,
      branchCount: bc,
    },
  };
}

/**
 * Score a single ConflictResult and mutate its `riskScore` and `riskLevel` fields.
 */
export function scoreConflictResult(result: ConflictResult): void {
  const riskScore = calculateRiskScore([result]);
  result.riskScore = riskScore.score;
  result.riskLevel = riskScore.level;
}

// ──────────────────────────────────────────────────────────
// Individual component scorers (each returns 0–1)
// ──────────────────────────────────────────────────────────

/**
 * Score based on total number of conflicted files.
 * Uses a logarithmic curve: 1 file ≈ 0.2, 5 files ≈ 0.6, 10+ ≈ 0.9.
 */
export function conflictCountScore(count: number): number {
  if (count <= 0) return 0;
  // log2(count + 1) / log2(12) caps at ~1.0 for count >= 11
  return Math.min(1, Math.log2(count + 1) / Math.log2(12));
}

/**
 * Score based on how many lines are affected by conflicts relative to file size.
 * Higher density = more complex to resolve.
 */
export function lineDensityScore(files: ConflictFile[]): number {
  if (files.length === 0) return 0;

  let totalConflictLines = 0;

  for (const file of files) {
    for (const range of file.lineRanges) {
      totalConflictLines += range.endLine - range.startLine + 1;
    }
  }

  if (totalConflictLines === 0) {
    // No line range info → moderate assumption (0.3)
    return 0.3;
  }

  // Normalize: 10 lines ≈ 0.2, 50 lines ≈ 0.5, 200+ lines ≈ 0.9
  return Math.min(1, Math.log2(totalConflictLines + 1) / Math.log2(256));
}

/**
 * Score based on severity of conflict types.
 * Content conflicts are common; rename/delete/binary are harder to resolve.
 */
export function typeSeverityScore(files: ConflictFile[]): number {
  if (files.length === 0) return 0;

  const weights: Record<ConflictType, number> = {
    [ConflictType.Content]: 0.3,
    [ConflictType.ModeChange]: 0.2,
    [ConflictType.Rename]: 0.6,
    [ConflictType.Delete]: 0.7,
    [ConflictType.Directory]: 0.8,
    [ConflictType.Binary]: 0.9,
  };

  let totalWeight = 0;
  for (const file of files) {
    totalWeight += weights[file.conflictType] ?? 0.3;
  }

  // Average severity across files
  return Math.min(1, totalWeight / files.length);
}

/**
 * Score based on how critical the conflicted files are.
 * Lock files, configs, and certain paths are weighted higher.
 */
export function fileCriticalityScore(files: ConflictFile[]): number {
  if (files.length === 0) return 0;

  let totalCriticality = 0;

  for (const file of files) {
    totalCriticality += getFileCriticality(file.path);
  }

  return Math.min(1, totalCriticality / files.length);
}

/**
 * Score based on how many branches have conflicts.
 * Conflicts across many branches = harder to manage.
 */
export function branchCountScore(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 0.2;
  if (count === 2) return 0.4;
  if (count === 3) return 0.6;
  if (count === 4) return 0.8;
  return 1.0;
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function scoreToLevel(score: number): RiskLevel {
  if (score <= 0) return RiskLevel.None;
  if (score <= 30) return RiskLevel.Low;
  if (score <= 60) return RiskLevel.Medium;
  return RiskLevel.High;
}

/** Critical file patterns and their criticality score (0–1). */
const CRITICAL_PATTERNS: Array<{ pattern: RegExp; score: number }> = [
  // Lock files & dependency manifests
  { pattern: /package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$/i, score: 0.9 },
  { pattern: /package\.json$/i, score: 0.7 },
  { pattern: /Gemfile\.lock$|Cargo\.lock$|go\.sum$/i, score: 0.9 },

  // CI/CD & configuration
  { pattern: /\.github\/workflows\//i, score: 0.8 },
  { pattern: /\.gitlab-ci\.yml$/i, score: 0.8 },
  { pattern: /Dockerfile$/i, score: 0.6 },
  { pattern: /docker-compose/i, score: 0.6 },

  // Database & migrations
  { pattern: /migrations?\//i, score: 0.8 },
  { pattern: /schema\.(sql|prisma|graphql)$/i, score: 0.7 },

  // Config files
  { pattern: /tsconfig.*\.json$/i, score: 0.5 },
  { pattern: /\.env/i, score: 0.6 },
  { pattern: /webpack|vite|rollup|esbuild/i, score: 0.5 },

  // Test files (lower criticality — easier to resolve)
  { pattern: /\.(test|spec)\.(ts|js|tsx|jsx)$/i, score: 0.2 },
  { pattern: /__tests__\//i, score: 0.2 },
];

function getFileCriticality(filePath: string): number {
  for (const { pattern, score } of CRITICAL_PATTERNS) {
    if (pattern.test(filePath)) return score;
  }
  // Default criticality for source files
  return 0.4;
}

// Export scoreToLevel for testing
export { scoreToLevel };
