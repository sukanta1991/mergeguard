# Merge Guard — Conflict Predictor

<p align="center">
  <img src="https://raw.githubusercontent.com/sukanta1991/mergeguard/main/images/icon.png" alt="Merge Guard Logo" width="128" height="128">
</p>

<p align="center">
  <strong>Predict merge conflicts before they happen.</strong><br>
  Continuously monitors your Git branches and warns you about potential merge conflicts — before you even open a Pull Request.
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=SukantaSaha.mergeguard">
    <img src="https://img.shields.io/badge/VS%20Code%20Marketplace-v1.0.3-blue?logo=visualstudiocode" alt="VS Code Marketplace">
  </a>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
</p>

---

## How It Works

MergeGuard uses `git merge-tree --write-tree` to perform **true merge simulations** without touching your working tree. It compares your current branch against configured target branches and reports exactly which files and line ranges would conflict.

```
Your Branch ─────┐
                  ├──► git merge-tree (simulation) ──► Conflict Report
Target Branch ───┘
```

## Features

### Core Detection
- **Real-time conflict detection** — Scans tracked branches automatically on save, branch switch, or on demand
- **Risk scoring** — Quantifies conflict severity with a 0–100 score across five weighted dimensions
- **Smart caching** — SHA-keyed LRU cache avoids redundant analysis when branches haven't changed
- **Graceful fallback** — Works with any Git version; uses `merge-base + diff` when `merge-tree --write-tree` isn't available (Git < 2.38)

### Editor Integration
- **Inline editor decorations** — Highlights predicted conflict regions directly in the editor with color-coded gutter marks
- **CodeLens annotations** — See conflict info above affected regions; click to preview or diff
- **Rich hover tooltips** — Hover over highlighted regions to see branch, conflict type, and quick action links

### UI & Dashboard
- **Status bar indicator** — At-a-glance conflict count and risk level with color-coded backgrounds
- **Enhanced TreeView sidebar** — Browse conflicts by branch → file → region with sort (severity/name/branch), filter (high-risk only), and dismiss actions
- **Conflict count badge** — Activity bar icon shows the number of active conflicts
- **Welcome view** — Helpful getting-started view when no conflicts are detected
- **Risk dashboard** — Interactive webview with gauge, branch breakdown, file heatmap, pie chart, and timeline
- **Problems panel integration** — Conflicts appear as warnings in VS Code's built-in Problems panel
- **File Explorer badges** — Conflicted files show a warning badge with the number of conflicting branches

### Intelligence
- **Conflict preview & three-way diff** — Preview merged content or compare base↔ours and base↔theirs side-by-side
- **Merge order optimization** — Suggests the optimal merge sequence to minimize cascading conflicts
- **Smart notifications** — Tracks seen conflicts and only alerts on new ones; configurable notification levels (all/high/badge/silent)

### SCM Integration
- **Multi-platform support** — GitHub, GitLab, Bitbucket Cloud, and Azure DevOps
- **PR-aware conflict analysis** — Automatically discovers open PRs/MRs and includes their branches in conflict scans
- **Team awareness** — See which teammates are working on files that overlap with your changes
- **Secure authentication** — Tokens stored exclusively in VS Code's SecretStorage; never logged or exposed

### Monorepo & Multi-Root
- **Multi-root workspace support** — Automatically detects and monitors all git repositories in your workspace
- **Path filtering** — Include/exclude specific paths for targeted scanning
- **Aggregated risk dashboard** — Unified view across all git roots with per-root breakdown

## Requirements

- **VS Code 1.85+**
- **Git 2.38+** recommended (for `merge-tree --write-tree`). Older Git versions are supported with approximate conflict detection via a diff-based fallback.

## Getting Started

1. **Install** the extension from the VS Code Marketplace
2. **Open** a Git repository in VS Code  
3. MergeGuard **auto-detects** your branches and starts monitoring
4. View conflicts in the **MergeGuard sidebar** (Activity Bar)
5. Configure tracked branches: `Cmd/Ctrl+Shift+P` → **MergeGuard: Configure Tracked Branches**

## SCM Platform Setup

MergeGuard integrates with popular SCM platforms to discover open PRs/MRs and enrich conflict analysis with team context.

### GitHub
Authentication uses VS Code's built-in GitHub authentication. When PR scanning is enabled, you'll be prompted to sign in via OAuth — no manual token needed.

### GitLab
Run `MergeGuard: Set GitLab PAT` and enter a Personal Access Token with `read_api` scope. The token is stored securely in VS Code's SecretStorage.

### Bitbucket Cloud
Run `MergeGuard: Set Bitbucket Credentials` and provide your Atlassian username and an App Password with `pullrequest:read` scope.

### Azure DevOps
Run `MergeGuard: Set Azure DevOps PAT` and enter a Personal Access Token with **Code (Read)** scope.

> **Security note:** All credentials are stored in VS Code's SecretStorage (OS keychain). Tokens are never written to settings files, logged, or included in error messages.

## Commands

| Command | Description |
|---------|-------------|
| `MergeGuard: Scan Current Branch for Conflicts` | Run an immediate scan against all tracked branches |
| `MergeGuard: Scan All Tracked Branches` | Full scan of all configured branches |
| `MergeGuard: Configure Tracked Branches` | Pick which branches to monitor via multi-select |
| `MergeGuard: Toggle Auto-Scan` | Enable or disable automatic scanning on save |
| `MergeGuard: Preview Conflict` | Open a diff preview of merged content |
| `MergeGuard: Three-Way Diff` | Compare base↔ours and base↔theirs side-by-side |
| `MergeGuard: Open Risk Dashboard` | Open the interactive risk dashboard webview |
| `MergeGuard: Suggest Merge Order` | Show the optimal branch merge sequence |
| `MergeGuard: Sort Conflicts` | Sort tree view by severity, file name, or branch |
| `MergeGuard: Toggle High-Risk Filter` | Show only high-risk conflicts in the tree view |
| `MergeGuard: Dismiss Conflict` | Dismiss a conflict from the tree (won't re-notify) |

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `mergeguard.trackedBranches` | `["main", "master", "develop"]` | Branches to scan for conflicts |
| `mergeguard.autoScanOnSave` | `true` | Scan automatically when files are saved |
| `mergeguard.autoScanInterval` | `300` | Seconds between periodic background scans (0 = disabled) |
| `mergeguard.debounceDelay` | `2000` | Milliseconds to debounce save-triggered scans |
| `mergeguard.showInlineDecorations` | `true` | Show conflict highlights in the editor |
| `mergeguard.showInProblemsPanel` | `true` | Show conflicts in the Problems panel |
| `mergeguard.showCodeLens` | `true` | Show CodeLens annotations above conflict regions |
| `mergeguard.notificationLevel` | `"all"` | Notification level: `all`, `high`, `badge`, or `silent` |
| `mergeguard.riskThreshold` | `"low"` | Minimum risk level to display (`low`, `medium`, `high`) |
| `mergeguard.scanOpenPRs` | `true` | Scan branches from open PRs/MRs on connected SCM platforms |
| `mergeguard.showTeamActivity` | `false` | Show team file activity from PR metadata |
| `mergeguard.includePaths` | `[]` | Git root paths to include (empty = all) |
| `mergeguard.excludePaths` | `[]` | Git root paths to exclude from scanning |

## Risk Score Explained

MergeGuard calculates a 0–100 risk score using five weighted components:

| Component | Weight | What it measures |
|-----------|--------|------------------|
| Conflict count | 25% | Number of conflicting files |
| Line density | 20% | Total conflict line ranges relative to file count |
| Type severity | 20% | Severity of conflict types (delete > content > rename) |
| File criticality | 20% | Whether critical files are affected (package.json, CI configs, etc.) |
| Branch count | 15% | How many branches have conflicts |

## Comparison with Alternatives

| Feature | Merge Guard | `git merge --no-commit` | GitLens | Git Graph |
|---------|:-----------:|:-----------------------:|:-------:|:---------:|
| Non-destructive simulation | ✅ | ❌ (modifies worktree) | ❌ | ❌ |
| Continuous background scanning | ✅ | ❌ | ❌ | ❌ |
| Multi-branch analysis | ✅ | ❌ (one at a time) | ❌ | ❌ |
| Line-level conflict regions | ✅ | ✅ | ❌ | ❌ |
| Risk scoring | ✅ | ❌ | ❌ | ❌ |
| Interactive dashboard | ✅ | ❌ | ❌ | ❌ |
| SCM integration (GitHub, GitLab, …) | ✅ | ❌ | ✅ (GitHub) | ❌ |
| Merge order optimization | ✅ | ❌ | ❌ | ❌ |
| Zero dependencies | ✅ | ✅ | ❌ | ❌ |
| Price | Free | Free | Freemium | Free |

## Performance Benchmarks

Measured on a MacBook Pro (M2, 16 GB) against real-world repositories:

| Repository | Files | Branches Scanned | Scan Time | Memory |
|------------|------:|:----------------:|:---------:|-------:|
| Small (< 100 files) | 85 | 3 | ~180 ms | ~12 MB |
| Medium (500 files) | 520 | 5 | ~1.2 s | ~18 MB |
| Large (2 000 files) | 2100 | 4 | ~3.8 s | ~25 MB |
| Monorepo (5 000+ files) | 5300 | 3 | ~4.7 s | ~32 MB |

**Activation time:** < 200 ms (lazy-loaded dashboard, incremental scanning).

**Incremental re-scan** (no SHA changes): **< 10 ms** — cached results are reused instantly.

## Troubleshooting

### "Could not detect git repositories"
- Make sure Git is installed: run `git --version` in a terminal.
- Ensure Git is in your system PATH.
- Open a folder that contains a `.git` directory.

### "Git is not installed or not found in PATH"
- Install Git from [git-scm.com](https://git-scm.com/downloads).
- If Git is installed in a non-standard location, add it to your PATH.

### No conflicts are detected
- Verify that you have tracked branches configured: run **MergeGuard: Configure Tracked Branches**.
- Run `git fetch` to update remote-tracking branches.
- Check the MergeGuard output channel (Output → MergeGuard) for error messages.

### Extension seems slow
- For very large repos, increase `mergeguard.debounceDelay` to reduce scan frequency.
- Disable `autoScanOnSave` and scan manually when needed.
- Use `includePaths` / `excludePaths` to limit which git roots are scanned.

### SCM integration not working
- Ensure you've authenticated with the correct platform (see SCM Platform Setup above).
- Check that `mergeguard.scanOpenPRs` is enabled (default: `true`).
- GitLab/Bitbucket/Azure DevOps require manually set tokens — see the setup section.

## FAQ

**Q: Does MergeGuard modify my working tree or create commits?**  
A: No. MergeGuard uses `git merge-tree --write-tree` which runs entirely in Git's object database. No files are changed, no commits are created, and no branches are affected.

**Q: How is this different from just running `git merge --no-commit`?**  
A: `git merge --no-commit` actually modifies your working tree and index, requiring cleanup. MergeGuard's simulation is completely side-effect-free and can run continuously in the background.

**Q: What happens with an older version of Git?**  
A: MergeGuard automatically detects your Git version. If `merge-tree --write-tree` isn't available (Git < 2.38), it falls back to `merge-base + diff --name-only` for approximate conflict detection. Line-level precision is only available with Git 2.38+.

**Q: Can I use MergeGuard with monorepos or multi-root workspaces?**  
A: Yes. MergeGuard auto-detects all Git repositories in your workspace. For multi-root setups, each git root gets its own independent scanner with results aggregated into a unified dashboard. Use `includePaths` and `excludePaths` settings to filter which roots are monitored.

**Q: Does this work with remote branches?**  
A: Yes. MergeGuard resolves configured branch names against both local and remote-tracking branches (e.g., `origin/main`). You may need to `git fetch` periodically to keep remote refs up to date.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE) — Sukanta Saha
