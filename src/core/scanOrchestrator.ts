import * as vscode from 'vscode';
import { analyzeConflicts } from '../core/analyzer';
import { BranchMonitor } from '../core/branchMonitor';
import { CacheManager } from '../core/cache';
import { Logger } from '../core/logger';
import { calculateRiskScore, scoreConflictResult } from '../core/riskScorer';
import type { ConflictResult, ScanResult } from '../core/types';
import { RiskLevel } from '../core/types';

/** Callback signature for UI layers to receive scan results. */
export type ScanListener = (scan: ScanResult, gitRoot: string) => void;

/** Maximum number of concurrent branch analyses. */
const MAX_CONCURRENCY = 4;

/** Minimal type for VS Code's built-in Git extension API. */
interface GitAPI {
  getAPI(version: number): {
    repositories: Array<{
      rootUri: vscode.Uri;
      state: { onDidChange: vscode.Event<void> };
    }>;
  } | undefined;
}

/**
 * Orchestrates conflict scanning, caching, and UI updates.
 *
 * Ties together:
 *  - BranchMonitor (branch events)
 *  - Analyzer (git merge-tree)
 *  - CacheManager (SHA-keyed cache)
 *  - RiskScorer (scoring)
 *  - UI listeners (status bar, tree view, decorations, diagnostics)
 *
 * Performance features:
 *  - Incremental scanning: skips branches whose SHAs haven't changed
 *  - Parallel branch analysis: up to MAX_CONCURRENCY concurrent merge-tree processes
 */
export class ScanOrchestrator implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly listeners: ScanListener[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private intervalTimer: ReturnType<typeof setInterval> | undefined;
  private scanning = false;
  private abortController: AbortController | undefined;
  private lastScan: ScanResult | undefined;
  /** Track previous SHA pairs to enable incremental scanning. */
  private previousSHAPairs = new Map<string, { currentSHA: string; targetSHA: string }>();

  constructor(
    private readonly branchMonitor: BranchMonitor,
    private readonly cache: CacheManager,
    private readonly logger: Logger,
    private readonly gitRoot: string,
  ) {}

  /** Register a listener to be notified on every scan completion. */
  onScanComplete(listener: ScanListener): void {
    this.listeners.push(listener);
  }

  /** Start auto-scan listeners (branch changes, file saves, periodic). */
  startAutoScan(): void {
    const config = vscode.workspace.getConfiguration('mergeguard');

    // Branch change → immediate scan
    this.disposables.push(
      this.branchMonitor.onBranchChanged(() => {
        this.logger.info('Branch changed — triggering scan.');
        this.cache.invalidateAll();
        void this.safeScan();
      }),
    );

    // Tracked branch updated → immediate scan
    this.disposables.push(
      this.branchMonitor.onTrackedBranchUpdated(({ branch }) => {
        this.logger.info(`Tracked branch "${branch}" updated — triggering scan.`);
        this.cache.invalidate(branch);
        void this.safeScan();
      }),
    );

    // Save → debounced scan
    if (config.get<boolean>('autoScanOnSave', true)) {
      const delay = config.get<number>('debounceDelay', 2000);
      this.disposables.push(
        vscode.workspace.onDidSaveTextDocument(() => {
          this.scheduleDebouncedScan(delay);
        }),
      );
    }

    // Periodic interval scan
    const intervalSec = config.get<number>('autoScanInterval', 300);
    if (intervalSec > 0) {
      this.intervalTimer = setInterval(() => {
        void this.safeScan();
      }, intervalSec * 1000);
    }

    // VS Code Git extension state changes — catches commits, pulls, fetches,
    // stash operations, and other git actions performed through the UI that
    // may not trigger the filesystem watchers reliably.
    this.hookGitExtension();
  }

  /** Subscribe to the built-in Git extension's repository state changes. */
  private hookGitExtension(): void {
    try {
      const gitExt = vscode.extensions.getExtension<GitAPI>('vscode.git');
      if (!gitExt) return;

      const subscribe = (api: GitAPI) => {
        const git = api.getAPI(1);
        if (!git) return;
        for (const repo of git.repositories) {
          if (repo.rootUri.fsPath === this.gitRoot) {
            this.disposables.push(
              repo.state.onDidChange(() => {
                this.logger.info('Git extension state changed — triggering scan.');
                void this.safeScan();
              }),
            );
          }
        }
      };

      if (gitExt.isActive && gitExt.exports) {
        subscribe(gitExt.exports);
      } else {
        gitExt.activate().then(subscribe, () => { /* ignore activation failure */ });
      }
    } catch {
      // Git extension not available — rely on filesystem watchers
    }
  }

  /** Wraps runScan with error handling so uncaught exceptions never escape. */
  private async safeScan(): Promise<void> {
    try {
      await this.runScan();
    } catch (err) {
      this.logger.error('Unhandled scan error.', err);
    }
  }

  /** Run a full scan now (callable from commands). */
  async runScan(): Promise<ScanResult> {
    // Abort any in-progress scan
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.scanning = true;
    const startTime = Date.now();

    try {
      const currentBranch = await this.branchMonitor.getCurrentBranch();
      const currentSHA = await this.branchMonitor.getCurrentSHA();
      const tracked = await this.branchMonitor.getTrackedBranches();

      // Filter out the current branch from targets
      const targets = tracked.filter((b) => b.name !== currentBranch);

      // Incremental scanning: separate targets into cached, unchanged, and need-analysis
      const toAnalyze: typeof targets = [];
      const results: ConflictResult[] = [];

      for (const target of targets) {
        if (signal.aborted) break;

        const targetSHA = target.sha;

        // Check cache first
        const cached = this.cache.get(currentSHA, targetSHA);
        if (cached) {
          this.logger.info(`Cache hit for ${currentBranch}↔${target.name}`);
          results.push(cached);
          continue;
        }

        // Check if SHAs are unchanged since last scan (incremental skip)
        const prev = this.previousSHAPairs.get(target.name);
        if (prev && prev.currentSHA === currentSHA && prev.targetSHA === targetSHA && this.lastScan) {
          const prevResult = this.lastScan.results.find(r => r.branch === target.name);
          if (prevResult) {
            this.logger.info(`Incremental skip for ${currentBranch}↔${target.name} (SHAs unchanged)`);
            results.push(prevResult);
            continue;
          }
        }

        toAnalyze.push(target);
      }

      // Parallel branch analysis with bounded concurrency
      if (toAnalyze.length > 0 && !signal.aborted) {
        const analyzed = await this.analyzeParallel(
          currentBranch, currentSHA, toAnalyze, signal,
        );
        results.push(...analyzed);
      }

      // Update SHA pairs for incremental scanning
      for (const target of targets) {
        this.previousSHAPairs.set(target.name, {
          currentSHA,
          targetSHA: target.sha,
        });
      }

      const riskScore = calculateRiskScore(results);
      const totalConflictFiles = results.reduce((sum, r) => sum + r.files.length, 0);

      const scan: ScanResult = {
        results,
        overallRiskScore: riskScore.score,
        overallRiskLevel: riskScore.level,
        totalConflictFiles,
        timestamp: Date.now(),
        durationMs: Date.now() - startTime,
      };

      this.lastScan = scan;

      if (!signal.aborted) {
        this.notifyListeners(scan);
        this.logger.info(
          `Scan complete: ${totalConflictFiles} conflict(s) across ${results.length} branch(es) in ${scan.durationMs}ms` +
          (toAnalyze.length < targets.length
            ? ` (${targets.length - toAnalyze.length} cached/skipped, ${toAnalyze.length} analyzed)`
            : ''),
        );
      }

      return scan;
    } finally {
      this.scanning = false;
    }
  }

  /**
   * Analyze multiple branches in parallel with bounded concurrency.
   * At most MAX_CONCURRENCY branches run simultaneously to avoid overwhelming git.
   */
  private async analyzeParallel(
    currentBranch: string,
    currentSHA: string,
    targets: Array<{ name: string; sha: string }>,
    signal: AbortSignal,
  ): Promise<ConflictResult[]> {
    const results: ConflictResult[] = [];
    let index = 0;

    const worker = async (): Promise<void> => {
      while (index < targets.length) {
        if (signal.aborted) return;
        const i = index++;
        const target = targets[i];
        this.logger.info(`Analyzing ${currentBranch}↔${target.name}...`);
        try {
          const result = await analyzeConflicts(currentBranch, target.name, this.gitRoot);
          scoreConflictResult(result);
          this.cache.set(currentSHA, target.sha, result);
          results.push(result);
        } catch (err) {
          results.push({
            branch: target.name,
            currentSHA,
            targetSHA: target.sha,
            files: [],
            riskScore: 0,
            riskLevel: RiskLevel.None,
            timestamp: Date.now(),
            status: 'error',
            errorMessage: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };

    // Launch up to MAX_CONCURRENCY workers
    const concurrency = Math.min(MAX_CONCURRENCY, targets.length);
    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);

    return results;
  }

  /** Whether a scan is currently in progress. */
  isScanning(): boolean {
    return this.scanning;
  }

  /** Get the most recent scan result. */
  getLastScan(): ScanResult | undefined {
    return this.lastScan;
  }

  private scheduleDebouncedScan(delayMs: number): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      void this.runScan();
    }, delayMs);
  }

  private notifyListeners(scan: ScanResult): void {
    for (const listener of this.listeners) {
      listener(scan, this.gitRoot);
    }
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    if (this.abortController) this.abortController.abort();
    for (const d of this.disposables) d.dispose();
  }
}
