/** Types of merge conflicts that can be detected. */
export enum ConflictType {
  Content = 'content',
  Rename = 'rename',
  Delete = 'delete',
  Binary = 'binary',
  Directory = 'directory',
  ModeChange = 'mode-change',
}

/** Risk level classification. */
export enum RiskLevel {
  None = 'none',
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

/** A range of lines in a file. */
export interface LineRange {
  startLine: number;
  endLine: number;
}

/** A single file that has a predicted conflict. */
export interface ConflictFile {
  /** Path relative to the git root. */
  path: string;
  /** Type of conflict detected. */
  conflictType: ConflictType;
  /** Specific line ranges where conflicts occur (empty if not determinable). */
  lineRanges: LineRange[];
  /** Git stage info (from merge-tree output). */
  stages?: {
    ancestor?: { mode: string; oid: string };
    ours?: { mode: string; oid: string };
    theirs?: { mode: string; oid: string };
  };
}

/** Result of analyzing conflicts between the current branch and a target branch. */
export interface ConflictResult {
  /** The target branch that was analyzed against. */
  branch: string;
  /** SHA of the current branch at the time of analysis. */
  currentSHA: string;
  /** SHA of the target branch at the time of analysis. */
  targetSHA: string;
  /** Files with predicted conflicts. */
  files: ConflictFile[];
  /** Calculated risk score (0-100). */
  riskScore: number;
  /** Risk level classification. */
  riskLevel: RiskLevel;
  /** When this analysis was performed. */
  timestamp: number;
  /** Whether the analysis completed successfully. */
  status: 'success' | 'error' | 'fallback';
  /** Error message if status is 'error'. */
  errorMessage?: string;
}

/** Overall scan result encompassing all target branches. */
export interface ScanResult {
  /** Results for each target branch. */
  results: ConflictResult[];
  /** Overall risk score (max of individual scores). */
  overallRiskScore: number;
  /** Overall risk level. */
  overallRiskLevel: RiskLevel;
  /** Total number of conflicted files across all branches. */
  totalConflictFiles: number;
  /** When this scan was performed. */
  timestamp: number;
  /** Duration of the scan in milliseconds. */
  durationMs: number;
}

/** Information about a git branch. */
export interface BranchInfo {
  /** Branch name (e.g. 'main', 'origin/main'). */
  name: string;
  /** Current SHA of the branch tip. */
  sha: string;
  /** Whether this is a remote-tracking branch. */
  isRemote: boolean;
  /** Whether this branch is being tracked by MergeGuard. */
  isTracked: boolean;
  /** Timestamp when this branch was last scanned. */
  lastScanned?: number;
}

/** Extension configuration shape. */
export interface MergeGuardConfig {
  trackedBranches: string[];
  autoScanOnSave: boolean;
  autoScanInterval: number;
  debounceDelay: number;
  showInlineDecorations: boolean;
  showInProblemsPanel: boolean;
  riskThreshold: RiskLevel;
}
