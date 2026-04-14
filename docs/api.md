# API Documentation

This document describes the public APIs of Merge Guard's core modules. These are internal APIs used by the extension itself — not exposed as a public extension API.

## Core Modules

### `gitOps.ts`

```typescript
findGitRoots(): Promise<string[]>
```
Discovers all Git repository roots in the current workspace.

```typescript
getGitVersion(gitRoot: string): Promise<string | undefined>
```
Returns the installed Git version string, or `undefined` if Git is not available.

```typescript
checkMergeTreeSupport(gitRoot: string): Promise<boolean>
```
Returns `true` if the installed Git supports `merge-tree --write-tree` (Git 2.38+).

```typescript
execGit(args: string[], cwd: string, options?: { timeout?: number }): Promise<{ stdout: string; stderr: string }>
```
Low-level Git command executor. Spawns `git` with the given arguments.

---

### `analyzer.ts`

```typescript
analyzeConflicts(currentBranch: string, targetBranch: string, gitRoot: string): Promise<ConflictResult>
```
Performs a merge-tree simulation between two branches and returns a `ConflictResult` containing conflicting files, line ranges, and conflict types.

```typescript
preScreenConflicts(currentBranch: string, targetBranch: string, gitRoot: string): Promise<string[]>
```
Quick check using `diff --name-only` to list files that differ between branches.

---

### `branchMonitor.ts`

```typescript
class BranchMonitor implements Disposable
```

| Method | Description |
|--------|-------------|
| `getCurrentBranch()` | Returns the name of the current branch. |
| `getCurrentSHA()` | Returns the SHA of the current HEAD. |
| `getTrackedBranches()` | Returns tracked branches with their SHAs. |
| `listLocalBranches()` | Lists all local branches. |
| `listRemoteBranches()` | Lists all remote-tracking branches. |
| `startWatching()` | Begins watching for branch changes. |
| `snapshotTrackedBranches()` | Takes a snapshot of tracked branch SHAs. |

| Event | Fires when |
|-------|-----------|
| `onBranchChanged` | The current branch changes (HEAD switches). |
| `onTrackedBranchUpdated` | A tracked branch's ref is updated. |

---

### `cache.ts`

```typescript
class CacheManager
```

| Method | Description |
|--------|-------------|
| `get(currentSHA, targetSHA)` | Retrieve cached `ConflictResult` for a SHA pair. |
| `set(currentSHA, targetSHA, result)` | Store a result in the cache. |
| `invalidate(branch)` | Remove cached entries for a branch. |
| `invalidateAll()` | Clear the entire cache. |

---

### `riskScorer.ts`

```typescript
calculateRiskScore(results: ConflictResult[]): { score: number; level: RiskLevel }
```
Computes the overall risk score and level from an array of conflict results.

```typescript
scoreConflictResult(result: ConflictResult): void
```
Mutates a `ConflictResult` to set its `riskScore` and `riskLevel` fields.

---

### `scanOrchestrator.ts`

```typescript
class ScanOrchestrator implements Disposable
```

| Method | Description |
|--------|-------------|
| `runScan()` | Executes a full scan and returns a `ScanResult`. |
| `startAutoScan()` | Begins automatic scanning on branch changes, saves, and intervals. |
| `onScanComplete(listener)` | Registers a callback for scan completion events. |
| `getLastScan()` | Returns the most recent `ScanResult`. |
| `isScanning()` | Returns `true` if a scan is in progress. |

---

### `telemetry.ts`

```typescript
class TelemetryService implements Disposable
```

| Method | Description |
|--------|-------------|
| `logActivation(durationMs)` | Logs extension activation time. |
| `logScan(data)` | Logs scan duration, branch count, conflicts. |
| `logFeatureUsed(feature)` | Logs a feature usage event. |
| `logError(errorType)` | Logs an error occurrence. |
| `isEnabled` | Returns `true` if telemetry is enabled. |

---

## Type Definitions (`types.ts`)

### `ConflictResult`

```typescript
interface ConflictResult {
  branch: string;
  currentSHA: string;
  targetSHA: string;
  files: ConflictFile[];
  riskScore: number;
  riskLevel: RiskLevel;
  timestamp: number;
  status: 'success' | 'error';
  errorMessage?: string;
}
```

### `ConflictFile`

```typescript
interface ConflictFile {
  path: string;
  conflictType: ConflictType;
  lineRanges: LineRange[];
}
```

### `ScanResult`

```typescript
interface ScanResult {
  results: ConflictResult[];
  overallRiskScore: number;
  overallRiskLevel: RiskLevel;
  totalConflictFiles: number;
  timestamp: number;
  durationMs: number;
}
```

### Enums

```typescript
enum RiskLevel { None, Low, Medium, High }
enum ConflictType { Content, Rename, Delete, Binary, Directory, ModeChange }
```

---

## SCM Provider Interface

```typescript
interface SCMProvider extends Disposable {
  readonly type: 'github' | 'gitlab' | 'bitbucket' | 'azureDevops';
  listOpenPRs(): Promise<PRInfo[]>;
  getPRFiles(prNumber: number): Promise<string[]>;
  getPRAuthors(prNumber: number): Promise<string[]>;
}
```
