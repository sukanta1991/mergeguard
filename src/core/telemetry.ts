import * as vscode from 'vscode';

/**
 * Opt-in telemetry service for Merge Guard.
 *
 * Respects `vscode.env.isTelemetryEnabled` and the user's VS Code telemetry settings.
 * Uses `vscode.env.createTelemetryLogger` for privacy-safe telemetry delivery.
 *
 * Tracked events:
 *  - activation: Extension activation time
 *  - scan: Scan duration, branch count, conflict count
 *  - feature: Feature usage (dashboard, CodeLens, etc.)
 *  - error: Error counts by type
 */
export class TelemetryService implements vscode.Disposable {
  private logger: vscode.TelemetryLogger | undefined;
  private errorCounts = new Map<string, number>();

  constructor() {
    try {
      // createTelemetryLogger is available from VS Code 1.85+
      if (typeof vscode.env.createTelemetryLogger === 'function') {
        this.logger = vscode.env.createTelemetryLogger({
          sendEventData: () => {
            // In a real deployment, this would send to an ingestion endpoint.
            // For now, telemetry events are only emitted locally via the logger.
          },
          sendErrorData: () => {
            // Error telemetry sender stub.
          },
        });
      }
    } catch {
      // Telemetry creation failed — continue without it.
    }
  }

  /** Check if telemetry is enabled by the user. */
  get isEnabled(): boolean {
    return vscode.env.isTelemetryEnabled;
  }

  /** Log extension activation event. */
  logActivation(durationMs: number): void {
    this.logEvent('activation', { durationMs: String(durationMs) });
  }

  /** Log a completed scan. */
  logScan(data: {
    durationMs: number;
    branchCount: number;
    conflictFiles: number;
    cachedCount: number;
    analyzedCount: number;
  }): void {
    this.logEvent('scan', {
      durationMs: String(data.durationMs),
      branchCount: String(data.branchCount),
      conflictFiles: String(data.conflictFiles),
      cachedCount: String(data.cachedCount),
      analyzedCount: String(data.analyzedCount),
    });
  }

  /** Log a feature usage event. */
  logFeatureUsed(feature: 'dashboard' | 'codeLens' | 'preview' | 'threeWayDiff' | 'mergeOrder' | 'sort' | 'filter'): void {
    this.logEvent('feature', { feature });
  }

  /** Log an error occurrence. */
  logError(errorType: string): void {
    const count = (this.errorCounts.get(errorType) ?? 0) + 1;
    this.errorCounts.set(errorType, count);
    this.logEvent('error', { errorType, count: String(count) });
  }

  /** Get current error counts by type (useful for testing). */
  getErrorCounts(): ReadonlyMap<string, number> {
    return this.errorCounts;
  }

  private logEvent(eventName: string, data: Record<string, string>): void {
    if (!this.isEnabled || !this.logger) return;
    try {
      this.logger.logUsage(eventName, data);
    } catch {
      // Silently ignore telemetry failures.
    }
  }

  dispose(): void {
    this.logger?.dispose();
  }
}
