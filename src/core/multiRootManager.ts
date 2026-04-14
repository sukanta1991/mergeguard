import * as vscode from 'vscode';
import { findGitRoots } from './gitOps';
import type { ScanResult, ConflictResult } from './types';
import { RiskLevel } from './types';
import { BranchMonitor } from './branchMonitor';
import { CacheManager } from './cache';
import { ScanOrchestrator } from './scanOrchestrator';
import { Logger } from './logger';

export type MultiRootScanListener = (scan: ScanResult, gitRoot: string) => void;

/**
 * Result of an aggregated scan across all git roots.
 */
export interface AggregatedScanResult {
  /** Per-root scan results keyed by git root path. */
  perRoot: Map<string, ScanResult>;
  /** Aggregated overall risk score. */
  overallRiskScore: number;
  /** Aggregated overall risk level. */
  overallRiskLevel: RiskLevel;
  /** Total conflict files across all roots. */
  totalConflictFiles: number;
  /** When the aggregation was performed. */
  timestamp: number;
}

/**
 * Manages multiple git roots in a monorepo or multi-root workspace.
 * Each git root gets its own BranchMonitor, CacheManager, and ScanOrchestrator.
 */
export class MultiRootManager implements vscode.Disposable {
  private readonly orchestrators = new Map<string, ScanOrchestrator>();
  private readonly monitors = new Map<string, BranchMonitor>();
  private readonly listeners: MultiRootScanListener[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private lastAggregated: AggregatedScanResult | undefined;

  constructor(
    private readonly logger: Logger,
    private readonly context: vscode.ExtensionContext,
  ) {}

  /** Discover all git roots and create orchestrators. */
  async initialize(): Promise<string[]> {
    const config = vscode.workspace.getConfiguration('mergeguard');
    const includePaths = config.get<string[]>('includePaths', []);
    const excludePaths = config.get<string[]>('excludePaths', []);

    let gitRoots = await findGitRoots();

    // Apply path filtering
    if (includePaths.length > 0) {
      gitRoots = gitRoots.filter(root =>
        includePaths.some(p => root.includes(p)),
      );
    }
    if (excludePaths.length > 0) {
      gitRoots = gitRoots.filter(root =>
        !excludePaths.some(p => root.includes(p)),
      );
    }

    for (const gitRoot of gitRoots) {
      this.addRoot(gitRoot);
    }

    this.logger.info(
      `MultiRootManager initialized with ${gitRoots.length} root(s): ${gitRoots.join(', ')}`,
    );

    return gitRoots;
  }

  /** Add a git root and create its orchestrator. */
  private addRoot(gitRoot: string): void {
    if (this.orchestrators.has(gitRoot)) return;

    const monitor = new BranchMonitor(gitRoot);
    const cache = new CacheManager(this.context.workspaceState);
    const orchestrator = new ScanOrchestrator(monitor, cache, this.logger, gitRoot);

    // Forward scan results to our listeners
    orchestrator.onScanComplete((scan, root) => {
      for (const listener of this.listeners) {
        listener(scan, root);
      }
    });

    this.orchestrators.set(gitRoot, orchestrator);
    this.monitors.set(gitRoot, monitor);
    this.disposables.push(monitor, orchestrator);
  }

  /** Register a listener for per-root scan completions. */
  onScanComplete(listener: MultiRootScanListener): void {
    this.listeners.push(listener);
  }

  /** Get all git roots being managed. */
  getRoots(): string[] {
    return Array.from(this.orchestrators.keys());
  }

  /** Get orchestrator for a specific root. */
  getOrchestrator(gitRoot: string): ScanOrchestrator | undefined {
    return this.orchestrators.get(gitRoot);
  }

  /** Run scan on all roots and return aggregated result. */
  async scanAll(): Promise<AggregatedScanResult> {
    const perRoot = new Map<string, ScanResult>();
    let maxRiskScore = 0;
    let totalConflictFiles = 0;

    const entries = Array.from(this.orchestrators.entries());
    // Scan sequentially to avoid overwhelming git
    for (const [gitRoot, orchestrator] of entries) {
      try {
        const scan = await orchestrator.runScan();
        perRoot.set(gitRoot, scan);
        maxRiskScore = Math.max(maxRiskScore, scan.overallRiskScore);
        totalConflictFiles += scan.totalConflictFiles;
      } catch (err) {
        this.logger.info(
          `Scan failed for root ${gitRoot}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const overallRiskLevel = riskScoreToLevel(maxRiskScore);

    this.lastAggregated = {
      perRoot,
      overallRiskScore: maxRiskScore,
      overallRiskLevel,
      totalConflictFiles,
      timestamp: Date.now(),
    };

    return this.lastAggregated;
  }

  /** Run scan for a specific root. */
  async scanRoot(gitRoot: string): Promise<ScanResult | undefined> {
    const orchestrator = this.orchestrators.get(gitRoot);
    if (!orchestrator) return undefined;
    return orchestrator.runScan();
  }

  /** Get last aggregated result. */
  getLastAggregated(): AggregatedScanResult | undefined {
    return this.lastAggregated;
  }

  /** Get the last scan for a specific root. */
  getLastScan(gitRoot: string): ScanResult | undefined {
    return this.orchestrators.get(gitRoot)?.getLastScan();
  }

  /** Create a unified ScanResult for UI display by merging all roots. */
  createUnifiedScan(): ScanResult | undefined {
    if (!this.lastAggregated) return undefined;

    const allResults: ConflictResult[] = [];
    let maxDuration = 0;

    for (const [, scan] of this.lastAggregated.perRoot) {
      allResults.push(...scan.results);
      maxDuration = Math.max(maxDuration, scan.durationMs);
    }

    return {
      results: allResults,
      overallRiskScore: this.lastAggregated.overallRiskScore,
      overallRiskLevel: this.lastAggregated.overallRiskLevel,
      totalConflictFiles: this.lastAggregated.totalConflictFiles,
      timestamp: this.lastAggregated.timestamp,
      durationMs: maxDuration,
    };
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.orchestrators.clear();
    this.monitors.clear();
    this.listeners.length = 0;
  }
}

/** Convert a numeric risk score to a RiskLevel. */
function riskScoreToLevel(score: number): RiskLevel {
  if (score >= 70) return RiskLevel.High;
  if (score >= 40) return RiskLevel.Medium;
  if (score > 0) return RiskLevel.Low;
  return RiskLevel.None;
}
