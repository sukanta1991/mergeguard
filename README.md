# Merge Guard — Detect & Prevent Git Merge Conflicts in VS Code

<p align="center">
  <img src="https://raw.githubusercontent.com/sukanta1991/mergeguard/main/images/icon.png" alt="Merge Guard Logo" width="128" height="128">
</p>

<p align="center">
  <strong>VS Code extension to detect and prevent Git merge conflicts early.</strong><br>
  Continuously monitors your branches and warns you about conflicts — before you pull, push, or open a PR.
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=SukantaSaha.mergeguard">
    <img src="https://img.shields.io/badge/VS%20Code%20Marketplace-v1.0.6-blue?logo=visualstudiocode" alt="VS Code Marketplace">
  </a>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
</p>

---

### Why Merge Guard?

> Stop getting surprised by merge conflicts.

✅ **Detect conflicts before they happen** — scans your branches continuously in the background  
✅ **See exact files & lines at risk** — know what will break before you pull or open a PR  
✅ **Reduce painful merge debugging** — get warnings early, fix issues while they're small  
✅ **Zero side effects** — simulations never touch your working tree or create commits  

---

### What developers are saying

> ⭐⭐⭐⭐⭐ *"Extremely helpful tool for resolving merge conflicts — no more manual effort needed. It makes the whole process smooth and fast."*

> ⭐⭐⭐⭐⭐ *"Finally, a useful tool to prevent cursing your colleagues at every 'git push'."*

> ⭐⭐⭐⭐⭐ *"This is a very useful tool and saves a lot of time for me."*

**Rated 5.0/5** on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=SukantaSaha.mergeguard&ssr=false#review-details) · Built to solve real-world Git pain.

---

## Features

### 🔍 Detection
- **Real-time conflict scanning** — Automatically scans on save, branch switch, or on demand
- **Risk scoring** — 0–100 severity score across five weighted dimensions
- **PR-aware analysis** — Discovers open PRs/MRs and includes their branches in scans
- **Multi-branch & multi-root** — Monitors all branches and git repositories in your workspace
- **Smart caching** — SHA-keyed cache skips redundant analysis when nothing has changed
- **Works with any Git version** — Full precision with Git 2.38+; graceful diff-based fallback for older versions

### 👁 Visualization
- **Inline editor highlights** — Color-coded gutter marks on predicted conflict regions
- **CodeLens annotations** — Conflict info above affected code; click to preview or diff
- **Rich hover tooltips** — Branch, conflict type, and quick actions on hover
- **Sidebar TreeView** — Browse conflicts by branch → file → region; sort, filter, and dismiss
- **Risk dashboard** — Interactive webview with gauge, heatmap, pie chart, and timeline
- **Status bar & badges** — At-a-glance conflict count in the status bar and File Explorer
- **Problems panel** — Conflicts surface as warnings in VS Code's built-in diagnostics

### 🧠 Intelligence
- **Three-way diff & conflict preview** — Compare base↔ours and base↔theirs side-by-side
- **Merge order optimization** — Suggests the best sequence to minimize cascading conflicts
- **Team awareness** — See who's editing overlapping files via SCM metadata
- **Smart notifications** — Only alerts on new conflicts; configurable levels (all / high / badge / silent)
- **SCM integration** — GitHub, GitLab, Bitbucket Cloud, and Azure DevOps with secure token storage

---

## How It Works

MergeGuard simulates merges in the background — **no files are changed, no commits are created.**

```
Your Branch ─────┐
                  ├──► merge simulation ──► Conflict Report
Target Branch ───┘
```

It uses `git merge-tree` to compare your branch against targets and reports exactly which files and line ranges would conflict. Everything runs in Git's object database — your working tree is never touched.

## Quick Start

1. **Install** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=SukantaSaha.mergeguard)
2. **Open** any Git repo
3. **See conflicts instantly** in the sidebar

That's it — MergeGuard auto-detects your branches and starts scanning.

## Setup & Configuration

### Requirements

- **VS Code 1.85+**
- **Git 2.38+** recommended (for `merge-tree --write-tree`). Older Git versions are supported with approximate conflict detection via a diff-based fallback.

### Detailed Setup

1. View conflicts in the **MergeGuard sidebar** (Activity Bar)
2. Configure tracked branches: `Cmd/Ctrl+Shift+P` → **MergeGuard: Configure Tracked Branches**

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
