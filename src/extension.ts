import * as vscode from 'vscode';
import { findGitRoots, getGitVersion } from './core/gitOps';
import { Logger } from './core/logger';
import { BranchMonitor } from './core/branchMonitor';
import { CacheManager } from './core/cache';
import { ScanOrchestrator } from './core/scanOrchestrator';
import { StatusBarController } from './ui/statusBar';
import { ConflictTreeDataProvider } from './ui/treeView';
import { DecorationController } from './ui/decorations';
import { ConflictHoverProvider } from './ui/hover';
import { DiagnosticsController } from './ui/diagnostics';
import { ConflictFileDecorationProvider } from './ui/fileDecorations';
import {
  ConflictPreviewProvider,
  SCHEME,
  openConflictPreview,
  openThreeWayDiff,
} from './ui/conflictPreview';
import { ConflictCodeLensProvider } from './ui/codeLens';
import { suggestMergeOrder } from './core/mergeOptimizer';
import { NotificationManager } from './ui/notifications';
import {
  detectSCMType,
  registerSCMProviderFactory,
  createSCMProvider,
} from './scm/provider';
import type { SCMProvider } from './scm/provider';
import { createGitHubProvider } from './scm/github';
import { createGitLabProvider } from './scm/gitlab';
import { createBitbucketProvider } from './scm/bitbucket';
import { createAzureDevOpsProvider } from './scm/azureDevops';
import { getPRBranchesToScan, enrichWithPRMetadata, formatPRDescription } from './core/prAwareAnalysis';
import type { PRInfoMap } from './core/prAwareAnalysis';
import { getTeamActivity, buildFileTeamActivity, formatTeamActivity } from './core/teamAwareness';
import { MultiRootManager } from './core/multiRootManager';
import { TelemetryService } from './core/telemetry';

// Lazy-loaded dashboard — only imported when the dashboard is first opened
let DashboardPanelClass: typeof import('./ui/dashboard').DashboardPanel | undefined;

let logger: Logger;
let telemetry: TelemetryService;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const activationStart = Date.now();
  logger = new Logger();
  context.subscriptions.push(logger);

  telemetry = new TelemetryService();
  context.subscriptions.push(telemetry);

  logger.info('Merge Guard activating...');

  // ── Workspace trust check ────────────────────
  if (!vscode.workspace.isTrusted) {
    logger.info('Workspace is not trusted. Merge Guard will remain inactive.');
    return;
  }

  // Detect git repositories in the workspace
  let gitRoots: string[];
  try {
    gitRoots = await findGitRoots();
  } catch (err) {
    logger.error('Failed to detect git repositories.', err);
    vscode.window.showErrorMessage(
      vscode.l10n.t('Could not detect git repositories. Ensure git is installed and in your PATH.'),
    );
    return;
  }

  if (gitRoots.length === 0) {
    logger.info('No git repositories found in workspace. Merge Guard will remain inactive.');
    return;
  }

  const gitRoot = gitRoots[0];
  logger.info(`Found ${gitRoots.length} git repository(s): ${gitRoots.join(', ')}`);

  // ── Git version check ────────────────────────
  const gitVersion = await getGitVersion(gitRoot);
  if (!gitVersion) {
    logger.warn('Could not determine git version. Some features may not work correctly.');
    vscode.window.showWarningMessage(
      vscode.l10n.t('Git is not installed or not found in PATH.') + ' [Install Git](https://git-scm.com/downloads)',
    );
    return;
  }
  logger.info(`Git version: ${gitVersion}`);

  // ── Core components ──────────────────────────
  const branchMonitor = new BranchMonitor(gitRoot);
  const cache = new CacheManager(context.workspaceState);
  const orchestrator = new ScanOrchestrator(branchMonitor, cache, logger, gitRoot);

  context.subscriptions.push(branchMonitor, orchestrator);

  // ── UI components ────────────────────────────
  const statusBar = new StatusBarController();
  const treeProvider = new ConflictTreeDataProvider();
  const decorations = new DecorationController();
  const diagnostics = new DiagnosticsController();
  const fileDecorations = new ConflictFileDecorationProvider();

  const codeLens = new ConflictCodeLensProvider();
  const notifications = new NotificationManager(context.workspaceState);

  // Dashboard is lazy-loaded — created on first use
  let dashboard: InstanceType<typeof import('./ui/dashboard').DashboardPanel> | undefined;
  const getDashboard = async () => {
    if (!dashboard) {
      if (!DashboardPanelClass) {
        const mod = await import('./ui/dashboard.js');
        DashboardPanelClass = mod.DashboardPanel;
      }
      dashboard = new DashboardPanelClass!(context.globalState);
      context.subscriptions.push(dashboard);
    }
    return dashboard;
  };

  context.subscriptions.push(statusBar, decorations, diagnostics, fileDecorations, codeLens, notifications);

  // ── SCM provider detection ───────────────────
  registerSCMProviderFactory('github', createGitHubProvider);
  registerSCMProviderFactory('gitlab', (info) => createGitLabProvider(info, context.secrets));
  registerSCMProviderFactory('bitbucket', (info) => createBitbucketProvider(info, context.secrets));
  registerSCMProviderFactory('azureDevops', (info) => createAzureDevOpsProvider(info, context.secrets));

  let scmProvider: SCMProvider | undefined;
  try {
    const remoteInfo = await detectSCMType(gitRoot);
    if (remoteInfo) {
      scmProvider = await createSCMProvider(remoteInfo);
      if (scmProvider) {
        logger.info(`SCM provider detected: ${scmProvider.type} (${remoteInfo.owner}/${remoteInfo.repo})`);
        context.subscriptions.push({ dispose: () => scmProvider?.dispose() });
      }
    }
  } catch (err) {
    logger.info(`SCM detection skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Register tree views
  const conflictsTreeView = vscode.window.createTreeView('mergeguard.conflictsView', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(conflictsTreeView);

  // Register file decoration provider
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(fileDecorations),
  );

  // Register hover provider for all files
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ scheme: 'file' }, new ConflictHoverProvider(decorations, gitRoot)),
  );

  // Register CodeLens provider for all files
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLens),
  );

  // Register conflict preview content provider
  const previewProvider = new ConflictPreviewProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, previewProvider),
    previewProvider,
  );

  // ── Wire scan results to all UI ──────────────
  orchestrator.onScanComplete((scan, root) => {
    try {
      statusBar.updateFromScan(scan);
      treeProvider.update(scan, root);
      decorations.update(scan, root);
      diagnostics.update(scan, root);
      fileDecorations.update(scan, root);
      codeLens.update(scan, root);
      void notifications.processScan(scan);

      // Update dashboard only if already loaded
      if (dashboard) {
        dashboard.update(scan, root);
      }

      // Log scan telemetry
      telemetry.logScan({
        durationMs: scan.durationMs,
        branchCount: scan.results.length,
        conflictFiles: scan.totalConflictFiles,
        cachedCount: 0,
        analyzedCount: scan.results.length,
      });

      // Update tree view badge with conflict count
      const count = treeProvider.getVisibleConflictCount();
      conflictsTreeView.badge = count > 0
        ? { value: count, tooltip: `${count} predicted conflict${count === 1 ? '' : 's'}` }
        : undefined;
    } catch (err) {
      logger.error('Error updating UI after scan.', err);
    }
  });

  // ── Read settings & react to changes ─────────
  const applySettings = () => {
    const config = vscode.workspace.getConfiguration('mergeguard');
    decorations.setEnabled(config.get<boolean>('showInlineDecorations', true));
    diagnostics.setEnabled(config.get<boolean>('showInProblemsPanel', true));
    codeLens.setEnabled(config.get<boolean>('showCodeLens', true));
  };
  applySettings();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('mergeguard')) {
        logger.info('Configuration changed — reapplying settings.');
        applySettings();

        // If tracked branches changed, invalidate cache and rescan
        if (e.affectsConfiguration('mergeguard.trackedBranches')) {
          cache.invalidateAll();
          void orchestrator.runScan();
        }
      }
    }),
  );

  // ── Commands ─────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('mergeguard.scan', async () => {
      logger.info('Scan current branch requested.');
      statusBar.setScanning();
      try {
        await orchestrator.runScan();
      } catch (err) {
        logger.error('Scan failed.', err);
        telemetry.logError('scan');
        statusBar.setError(err instanceof Error ? err.message : 'Scan failed');
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergeguard.scanAll', async () => {
      logger.info('Scan all tracked branches requested.');
      statusBar.setScanning();
      try {
        await orchestrator.runScan();
      } catch (err) {
        logger.error('Scan all failed.', err);
        telemetry.logError('scan');
        statusBar.setError(err instanceof Error ? err.message : 'Scan failed');
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergeguard.configure', async () => {
      logger.info('Configure tracked branches requested.');
      try {
        const [localBranches, remoteBranches] = await Promise.all([
          branchMonitor.listLocalBranches(),
          branchMonitor.listRemoteBranches(),
        ]);

        const allBranches = [
          ...localBranches.map((b) => b.name),
          ...remoteBranches.map((b) => b.name),
        ];

        const config = vscode.workspace.getConfiguration('mergeguard');
        const currentTracked = config.get<string[]>('trackedBranches', ['main', 'master', 'develop']);

        const items: vscode.QuickPickItem[] = allBranches.map((name) => ({
          label: name,
          picked: currentTracked.includes(name),
        }));

        const selected = await vscode.window.showQuickPick(items, {
          canPickMany: true,
          placeHolder: vscode.l10n.t('Select branches to monitor for conflicts'),
          title: vscode.l10n.t('MergeGuard: Configure Tracked Branches'),
        });

        if (selected) {
          const names = selected.map((s) => s.label);
          await config.update('trackedBranches', names, vscode.ConfigurationTarget.Workspace);
          logger.info(`Tracked branches updated: ${names.join(', ')}`);
          vscode.window.showInformationMessage(vscode.l10n.t('Now tracking {0} branch(es).', names.length));
        }
      } catch (err) {
        vscode.window.showErrorMessage(
          `MergeGuard: Failed to list branches — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mergeguard.toggleAutoScan', async () => {
      const config = vscode.workspace.getConfiguration('mergeguard');
      const current = config.get<boolean>('autoScanOnSave', true);
      await config.update('autoScanOnSave', !current, vscode.ConfigurationTarget.Workspace);
      const state = !current ? vscode.l10n.t('enabled') : vscode.l10n.t('disabled');
      logger.info(`Auto-scan ${state}.`);
      vscode.window.showInformationMessage(vscode.l10n.t('Auto-scan {0}.', state));
      if (!current) {
        statusBar.setReady();
      } else {
        statusBar.setDisabled();
      }
    }),
  );

  // Preview conflict diff (called from tree view inline button or command palette)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mergeguard.previewConflict',
      async (filePathOrTreeItem?: string, branch?: string) => {
        // Resolve arguments — may come from tree view (FileItem) or command palette
        let filePath: string | undefined;
        let targetBranch: string | undefined;

        if (typeof filePathOrTreeItem === 'string') {
          filePath = filePathOrTreeItem;
          targetBranch = branch;
        } else if (filePathOrTreeItem && typeof filePathOrTreeItem === 'object') {
          // FileItem from tree view
          const item = filePathOrTreeItem as { file?: { path: string }; branch?: string };
          filePath = item.file?.path;
          targetBranch = item.branch;
        }

        if (!filePath || !targetBranch) {
          // Prompt user to pick from current scan results
          const lastScan = orchestrator.getLastScan();
          if (!lastScan || lastScan.totalConflictFiles === 0) {
            vscode.window.showInformationMessage(vscode.l10n.t('No conflicts to preview. Run a scan first.'));
            return;
          }
          const picks = lastScan.results.flatMap((r) =>
            r.files.map((f) => ({
              label: f.path,
              description: vscode.l10n.t('conflicts with {0}', r.branch),
              filePath: f.path,
              branch: r.branch,
            })),
          );
          const pick = await vscode.window.showQuickPick(picks, {
            placeHolder: vscode.l10n.t('Select a file to preview conflict'),
          });
          if (!pick) return;
          filePath = pick.filePath;
          targetBranch = pick.branch;
        }

        const currentRef = await branchMonitor.getCurrentBranch();
        await openConflictPreview(filePath, targetBranch, currentRef, gitRoot);
      },
    ),
  );

  // Three-way diff (called from tree view inline button or command palette)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mergeguard.threeWayDiff',
      async (filePathOrTreeItem?: string, branch?: string) => {
        let filePath: string | undefined;
        let targetBranch: string | undefined;

        if (typeof filePathOrTreeItem === 'string') {
          filePath = filePathOrTreeItem;
          targetBranch = branch;
        } else if (filePathOrTreeItem && typeof filePathOrTreeItem === 'object') {
          const item = filePathOrTreeItem as { file?: { path: string }; branch?: string };
          filePath = item.file?.path;
          targetBranch = item.branch;
        }

        if (!filePath || !targetBranch) {
          const lastScan = orchestrator.getLastScan();
          if (!lastScan || lastScan.totalConflictFiles === 0) {
            vscode.window.showInformationMessage(vscode.l10n.t('No conflicts to diff. Run a scan first.'));
            return;
          }
          const picks = lastScan.results.flatMap((r) =>
            r.files.map((f) => ({
              label: f.path,
              description: vscode.l10n.t('conflicts with {0}', r.branch),
              filePath: f.path,
              branch: r.branch,
            })),
          );
          const pick = await vscode.window.showQuickPick(picks, {
            placeHolder: vscode.l10n.t('Select a file for three-way diff'),
          });
          if (!pick) return;
          filePath = pick.filePath;
          targetBranch = pick.branch;
        }

        const currentRef = await branchMonitor.getCurrentBranch();
        await openThreeWayDiff(filePath, targetBranch, currentRef, gitRoot);
      },
    ),
  );

  // Open dashboard command (lazy-loads dashboard module on first use)
  context.subscriptions.push(
    vscode.commands.registerCommand('mergeguard.openDashboard', async () => {
      try {
        const dash = await getDashboard();
        dash.show(orchestrator.getLastScan(), gitRoot);
        telemetry.logFeatureUsed('dashboard');
      } catch (err) {
        logger.error('Failed to open dashboard.', err);
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to open dashboard.'));
      }
    }),
  );

  // Suggest merge order command
  context.subscriptions.push(
    vscode.commands.registerCommand('mergeguard.suggestMergeOrder', async () => {
      const lastScan = orchestrator.getLastScan();
      if (!lastScan || lastScan.results.length === 0) {
        vscode.window.showInformationMessage(vscode.l10n.t('No scan results available. Run a scan first.'));
        return;
      }
      const suggestion = suggestMergeOrder(lastScan);
      if (suggestion.steps.length === 0) {
        vscode.window.showInformationMessage(vscode.l10n.t('No branches to merge.'));
        return;
      }
      const items = suggestion.steps.map((s, i) => ({
        label: `${i + 1}. ${s.branch}`,
        description: s.conflictFiles === 0 ? vscode.l10n.t('no conflicts') : vscode.l10n.t('{0} conflict(s)', s.conflictFiles),
        detail: s.reason,
      }));
      await vscode.window.showQuickPick(items, {
        placeHolder: vscode.l10n.t('Suggested merge order (top = merge first)'),
        title: vscode.l10n.t('MergeGuard: Optimal Merge Order'),
      });
    }),
  );

  // Dismiss conflict (called from tree view inline button)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mergeguard.dismissConflict',
      (fileItem?: { file?: { path: string }; branch?: string }) => {
        if (fileItem?.file?.path && fileItem?.branch) {
          treeProvider.dismissConflict(fileItem.branch, fileItem.file.path);
          void notifications.dismissBranch(fileItem.branch);
          const count = treeProvider.getVisibleConflictCount();
          conflictsTreeView.badge = count > 0
            ? { value: count, tooltip: `${count} predicted conflict${count === 1 ? '' : 's'}` }
            : undefined;
        }
      },
    ),
  );

  // Sort conflicts (quick pick)
  context.subscriptions.push(
    vscode.commands.registerCommand('mergeguard.sortConflicts', async () => {
      const current = treeProvider.getSortMode();
      const items: vscode.QuickPickItem[] = [
        { label: vscode.l10n.t('By Severity'), description: current === 'severity' ? vscode.l10n.t('(current)') : '' },
        { label: vscode.l10n.t('By File Name'), description: current === 'fileName' ? vscode.l10n.t('(current)') : '' },
        { label: vscode.l10n.t('By Branch'), description: current === 'branch' ? vscode.l10n.t('(current)') : '' },
      ];
      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: vscode.l10n.t('Sort conflicts by…'),
        title: vscode.l10n.t('MergeGuard: Sort Conflicts'),
      });
      if (pick) {
        const modeMap: Record<string, 'severity' | 'fileName' | 'branch'> = {
          'By Severity': 'severity',
          'By File Name': 'fileName',
          'By Branch': 'branch',
        };
        const mode = modeMap[pick.label];
        if (mode) {
          treeProvider.setSortMode(mode);
          logger.info(`Conflicts sorted by ${mode}.`);
        }
      }
    }),
  );

  // Toggle high-risk filter
  context.subscriptions.push(
    vscode.commands.registerCommand('mergeguard.toggleHighRiskFilter', () => {
      const current = treeProvider.getFilterMode();
      const next = current === 'all' ? 'highRisk' : 'all';
      treeProvider.setFilterMode(next);
      const count = treeProvider.getVisibleConflictCount();
      conflictsTreeView.badge = count > 0
        ? { value: count, tooltip: `${count} predicted conflict${count === 1 ? '' : 's'}` }
        : undefined;
      const msg = next === 'highRisk' ? vscode.l10n.t('Showing high-risk conflicts only') : vscode.l10n.t('Showing all conflicts');
      vscode.window.showInformationMessage(msg);
      logger.info(`Filter mode: ${next}.`);
    }),
  );

  // ── PR-aware scanning & team awareness ───────
  let prInfoMap: PRInfoMap = new Map();

  orchestrator.onScanComplete(async (scan, _root) => {
    const config = vscode.workspace.getConfiguration('mergeguard');

    // Enrich with PR metadata if an SCM provider is available
    if (scmProvider && config.get<boolean>('scanOpenPRs', true)) {
      try {
        prInfoMap = await enrichWithPRMetadata(scan, scmProvider);
        if (prInfoMap.size > 0) {
          logger.info(`PR metadata enriched: ${prInfoMap.size} branch(es) linked to PRs.`);
        }
      } catch (err) {
        // Network errors are non-critical — use stale data if available
        logger.warn(`PR enrichment failed (using cached data): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Team awareness: log activity if enabled
    if (scmProvider && config.get<boolean>('showTeamActivity', false)) {
      try {
        const currentBranch = await branchMonitor.getCurrentBranch();
        const activities = await getTeamActivity(scmProvider, gitRoot, currentBranch);
        const fileActivity = buildFileTeamActivity(activities);
        if (fileActivity.length > 0) {
          logger.info(`Team awareness: ${fileActivity.length} file(s) also being modified by teammates.`);
        }
      } catch (err) {
        // Non-critical — don't block scan flow
        logger.warn(`Team awareness failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  // ── Multi-root manager (for monorepos) ───────
  const multiRootManager = new MultiRootManager(logger, context);
  context.subscriptions.push(multiRootManager);

  if (gitRoots.length > 1) {
    await multiRootManager.initialize();
    logger.info(`Multi-root mode: managing ${gitRoots.length} git roots.`);
  }

  // ── Start monitoring ─────────────────────────
  branchMonitor.startWatching();
  orchestrator.startAutoScan();
  await branchMonitor.snapshotTrackedBranches();

  const activationMs = Date.now() - activationStart;
  logger.info(`Merge Guard activated successfully in ${activationMs}ms.`);
  telemetry.logActivation(activationMs);
}

export function deactivate(): void {
  // Cleanup handled by disposables registered in context.subscriptions
}
