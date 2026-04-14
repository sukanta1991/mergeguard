# Changelog

All notable changes to the MergeGuard extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] — 2026-04-14

### Fixed

- Re-publish to fix marketplace validation issue with v1.0.0

## [1.0.0] — 2026-04-14

### Added

- **Performance optimization (M4.1)** — Incremental scanning with SHA-pair tracking skips unchanged branches; parallel branch analysis (max 4 concurrent `merge-tree` processes); lazy-loaded dashboard via dynamic `import()`; activation timing and performance logging
- **Error handling hardening (M4.2)** — Workspace trust check (`vscode.workspace.isTrusted`); Git version/install validation with actionable messages and install link; `safeScan()` wrapper prevents uncaught exceptions; network error fallback with stale data; all errors logged with stack traces
- **Accessibility (M4.3)** — `accessibilityInformation` on all TreeView items (branch, file, region) and StatusBar states; ARIA roles/labels on dashboard elements (`role="meter"`, `role="region"`, `role="img"`); keyboard navigation with `tabindex`/`onkeydown`; `:focus-visible` styles
- **Internationalization (M4.4)** — All user-facing strings wrapped in `vscode.l10n.t()`; English base bundle at `l10n/bundle.l10n.json` (80+ strings); `l10n` field in `package.json`; translation contribution guide
- **Telemetry (M4.5)** — Opt-in telemetry via `vscode.env.createTelemetryLogger`; tracks activation time, scan duration, branch/conflict counts, feature usage, error counts by type; respects `vscode.env.isTelemetryEnabled`
- **Documentation (M4.6)** — `docs/` folder with architecture overview, contributing guide, development setup, and API documentation; README expanded with comparison table, performance benchmarks, troubleshooting guide
- **Community readiness (M4.7)** — Question issue template; PR template; Code of Conduct; CI auto-publish on `vX.Y.Z` tags via `VSCE_PAT`
- **Remote development support** — `extensionKind: ["workspace"]` for SSH, Codespaces, and WSL compatibility
- **Gallery banner** — Dark theme banner for marketplace listing
- **Expanded keywords** — Added `diff`, `merge-tree`, `risk` for discoverability

### Changed

- Test count: 499 (was 473 at v0.3.0)
- Test files: 35 (was 33)
- Bundle size: ~77KB (was 75KB)

---

## [0.3.0] — 2026-06-22

### Added

- **SCM provider abstraction** — Pluggable provider interface with factory registry for multi-platform support
- **GitHub integration** — Automatic PR discovery via VS Code's built-in OAuth authentication; rate-limit handling
- **GitLab integration** — Merge Request discovery with PAT authentication stored in SecretStorage
- **Bitbucket Cloud integration** — Pull Request discovery with App Password authentication; cursor-based pagination
- **Azure DevOps integration** — Pull Request discovery with PAT authentication; `$top/$skip` pagination
- **PR-aware conflict analysis** — Open PRs/MRs are discovered and their branches included in conflict scans automatically
- **Team awareness** — Shows which teammates are working on overlapping files based on PR metadata
- **Multi-root workspace support** — Automatically detects and monitors all git roots; aggregated scanning with per-root breakdown
- **Path filtering** — `includePaths` / `excludePaths` settings to control which git roots are scanned
- **5 new settings**: `scanOpenPRs`, `showTeamActivity`, `includePaths`, `excludePaths`, plus SCM credential commands
- **Security**: All SCM tokens stored exclusively in VS Code SecretStorage; CSP nonce on dashboard webview; XSS protection via `esc()` / `escAttr()` helpers; tokens never logged

### Changed

- Monorepo FAQ updated — multi-root workspaces now get independent scanners per git root
- Test count: 450+ (was 339 at v0.2.0)
- Bundle size: ~71KB (was 56.4KB)

---

## [0.2.0] — 2026-06-15

### Added

- **Conflict preview diff** — Preview merged file content in a VS Code diff editor via `mergeguard:` URI scheme
- **Three-way diff** — Compare base↔ours and base↔theirs in side-by-side diff tabs
- **CodeLens annotations** — File-level and region-level CodeLens showing conflict info with click-to-preview and three-way diff actions
- **Risk dashboard webview** — Interactive panel with SVG gauge, branch breakdown table, file heatmap, risk distribution pie chart, and scan timeline; CSP-compliant and theme-aware
- **Merge order optimization** — Greedy conflict-graph algorithm suggests optimal branch merge sequence to minimize cascading conflicts
- **Smart notifications** — Fingerprint-based tracking of seen conflicts; only notifies for NEW conflicts; 4 configurable levels (all/high/badge/silent); per-branch dismiss
- **Enhanced TreeView** — Sort by severity, file name, or branch; filter high-risk only; dismiss individual conflicts; conflict count badge on activity bar icon
- **Welcome view** — Helpful getting-started view when no conflicts are detected
- **3 new commands**: Sort Conflicts, Toggle High-Risk Filter, Dismiss Conflict
- **3 new settings**: `showCodeLens`, `notificationLevel` (enum), and inline dismiss support

### Changed

- Tree view file click now opens conflict preview diff (was plain file open)
- Hover tooltips now include quick links to preview and three-way diff
- Bundle size: 56.4KB (was 53.6KB)
- Test count: 339 (was 238 at v0.1.0)

---

## [0.1.0] — 2026-04-13

### Added

- **Conflict detection engine** — `git merge-tree --write-tree` simulation with automatic fallback to `merge-base + diff` for Git < 2.38
- **Branch monitoring** — FileSystemWatcher on `.git/HEAD` and `.git/refs/**` with events for branch switch and tracked branch updates
- **Risk scoring** — 0–100 composite score with five weighted components (conflict count, line density, type severity, file criticality, branch count)
- **SHA-keyed LRU cache** — Avoids redundant analysis when branches haven't changed; persists to workspaceState
- **Scan orchestration** — Auto-scan on save (debounced), branch change (immediate), and periodic interval; abort/cancel support
- **Status bar** — 6 display states (ready, scanning, clean, conflict, error, disabled) with risk-level coloring
- **TreeView sidebar** — 3-level hierarchy: branches → files → conflict regions, with icons and descriptions
- **Inline editor decorations** — Per-conflict-type highlighting (content, rename, delete) with overview ruler marks
- **Hover tooltips** — Rich Markdown hover with branch name, conflict type description, line range, and action links
- **Problems panel** — Predicted conflicts appear as `Warning` diagnostics with MergeGuard source label
- **File Explorer badges** — Conflicted files show a warning badge with the count of conflicting branches
- **4 commands**: Scan Current Branch, Scan All, Configure Tracked Branches (QuickPick multi-select), Toggle Auto-Scan
- **7 configuration settings**: `trackedBranches`, `autoScanOnSave`, `autoScanInterval`, `debounceDelay`, `showInlineDecorations`, `showInProblemsPanel`, `riskThreshold`
- **Settings reactivity** — `onDidChangeConfiguration` handler reapplies UI toggles and re-scans on tracked branch changes
- **Full test suite** — 238 tests (unit + integration) with fixture git repo for end-to-end validation
