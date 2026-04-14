# Architecture Overview

This document describes the internal architecture of the Merge Guard VS Code extension.

## High-Level Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                          extension.ts                                │
│                      (activate / deactivate)                         │
│                                                                      │
│   ┌────────────┐  ┌──────────────┐  ┌──────────────┐                │
│   │ BranchMon  │→ │ ScanOrchest  │← │ CacheManager │                │
│   │  itor      │  │   rator      │  │              │                │
│   └────────────┘  └──────┬───────┘  └──────────────┘                │
│                          │                                           │
│              ┌───────────┼───────────────┐                           │
│              │           │               │                           │
│              ▼           ▼               ▼                           │
│   ┌────────────┐  ┌────────────┐  ┌────────────┐                    │
│   │  Analyzer  │  │ RiskScorer │  │  Telemetry │                    │
│   │ (merge-tree)│  │            │  │  Service   │                    │
│   └────────────┘  └────────────┘  └────────────┘                    │
│                          │                                           │
│          ┌───────────────┼───────────────────────────┐               │
│          │               │               │           │               │
│          ▼               ▼               ▼           ▼               │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐ ┌──────────┐          │
│   │ StatusBar│   │ TreeView │   │ Dashboard│ │Diagnostics│          │
│   └──────────┘   └──────────┘   └──────────┘ └──────────┘          │
│          │               │               │           │               │
│          ▼               ▼               ▼           ▼               │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐ ┌──────────┐          │
│   │ CodeLens │   │  Hover   │   │  Decor-  │ │  File    │          │
│   │          │   │ Provider │   │  ations  │ │  Badges  │          │
│   └──────────┘   └──────────┘   └──────────┘ └──────────┘          │
│                                                                      │
│   ┌────────────────────────────────────────────────────┐             │
│   │                SCM Providers                        │             │
│   │   GitHub │ GitLab │ Bitbucket │ Azure DevOps       │             │
│   └────────────────────────────────────────────────────┘             │
└──────────────────────────────────────────────────────────────────────┘
```

## Module Responsibilities

### Core Layer (`src/core/`)

| Module | Purpose |
|--------|---------|
| `gitOps.ts` | Low-level Git CLI wrapper. Executes `git merge-tree`, `diff`, `merge-base`, etc. via `child_process.spawn`. |
| `analyzer.ts` | Conflict analysis engine. Runs merge-tree simulation and parses output into `ConflictResult`. Falls back to diff-based detection for Git < 2.38. |
| `branchMonitor.ts` | Watches `.git/HEAD` and `.git/refs/` for changes. Emits `onBranchChanged` and `onTrackedBranchUpdated` events. |
| `cache.ts` | SHA-keyed LRU cache. Keys on `(currentSHA, targetSHA)` pairs to skip redundant analyses. Persists to `workspaceState`. |
| `riskScorer.ts` | Computes 0–100 risk scores across five weighted dimensions. |
| `scanOrchestrator.ts` | Orchestrates the full scan lifecycle: debouncing, abort/cancel, caching, parallel analysis, and listener notification. |
| `types.ts` | Shared TypeScript type definitions (`ConflictResult`, `ScanResult`, `RiskLevel`, etc.). |
| `logger.ts` | Centralized logging to a VS Code OutputChannel. |
| `telemetry.ts` | Opt-in telemetry using `vscode.env.createTelemetryLogger`. Respects `isTelemetryEnabled`. |
| `mergeOptimizer.ts` | Greedy algorithm to suggest optimal merge order minimizing cascading conflicts. |
| `prAwareAnalysis.ts` | Discovers open PRs/MRs via SCM providers and enriches scan results with PR metadata. |
| `teamAwareness.ts` | Detects team file overlaps from PR metadata. |
| `multiRootManager.ts` | Manages multiple git roots in multi-root / monorepo workspaces. |
| `conflictContent.ts` | Retrieves and formats conflict content for the preview diff. |

### UI Layer (`src/ui/`)

| Module | Purpose |
|--------|---------|
| `statusBar.ts` | Status bar item with 6 states (ready/scanning/clean/conflict/error/disabled). |
| `treeView.ts` | 3-level TreeDataProvider: Branch → File → Region. Supports sort, filter, dismiss. |
| `dashboard.ts` | Webview panel with SVG gauge, branch breakdown, heatmap, pie chart, timeline. |
| `decorations.ts` | Inline editor decorations for conflict regions with color-coded gutter marks. |
| `hover.ts` | Rich Markdown hover with conflict details and quick-action links. |
| `diagnostics.ts` | Populates VS Code's Problems panel with conflict warnings. |
| `fileDecorations.ts` | File Explorer badges showing conflict counts. |
| `codeLens.ts` | CodeLens annotations above conflict regions. |
| `notifications.ts` | Smart notifications that track seen conflicts and only alert on new ones. |
| `conflictPreview.ts` | Conflict preview diff and three-way diff commands. |

### SCM Layer (`src/scm/`)

| Module | Purpose |
|--------|---------|
| `provider.ts` | SCM provider abstraction with factory registry and remote URL detection. |
| `github.ts` | GitHub integration via VS Code's built-in OAuth. |
| `gitlab.ts` | GitLab integration with PAT stored in SecretStorage. |
| `bitbucket.ts` | Bitbucket Cloud integration with App Password. |
| `azureDevops.ts` | Azure DevOps integration with PAT. |

## Data Flow

1. **Trigger**: A scan is triggered by branch change, file save (debounced), periodic interval, or manual command.
2. **Branch Resolution**: `BranchMonitor` provides the current branch, SHA, and tracked branches.
3. **Cache Check**: `ScanOrchestrator` checks the LRU cache and incremental SHA pairs to skip unchanged branches.
4. **Parallel Analysis**: Up to 4 branches are analyzed concurrently via `analyzeConflicts()`.
5. **Risk Scoring**: Results are scored by `RiskScorer`.
6. **Listener Notification**: All registered UI listeners receive the `ScanResult`.
7. **UI Update**: Status bar, tree view, decorations, diagnostics, CodeLens, file badges, and dashboard are updated.

## Design Principles

- **Zero dependencies**: No npm production dependencies. All Git operations use `child_process.spawn`.
- **Non-destructive**: `git merge-tree --write-tree` is side-effect-free. No files are changed.
- **Privacy-first**: Telemetry is opt-in and respects VS Code's telemetry settings. SCM tokens are stored in OS keychain via `SecretStorage`.
- **Lazy loading**: The dashboard module is dynamically imported on first use to keep activation fast.
- **Incremental**: SHA-pair tracking avoids re-analyzing branches that haven't changed.
