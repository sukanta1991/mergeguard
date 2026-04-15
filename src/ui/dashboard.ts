import * as vscode from 'vscode';
import type { ScanResult } from '../core/types';

/** Maximum number of historical risk scores to retain. */
const MAX_HISTORY = 50;
const GLOBAL_STATE_KEY = 'mergeguard.riskHistory';

export interface RiskHistoryEntry {
  score: number;
  timestamp: number;
}

/**
 * Webview panel that displays a risk dashboard.
 *
 * Sections:
 *  - Risk Gauge (circular gauge 0–100)
 *  - Branch Breakdown table
 *  - File Heatmap (most-conflicted files)
 *  - Conflict Type Distribution (pie chart)
 *  - Timeline (risk score history)
 */
export class DashboardPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private lastScan: ScanResult | undefined;
  private gitRoot = '';

  constructor(private readonly globalState: vscode.Memento) {}

  /** Open or reveal the dashboard. */
  show(scan: ScanResult | undefined, gitRoot: string): void {
    this.lastScan = scan;
    this.gitRoot = gitRoot;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      this.refresh();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'mergeguard.dashboard',
      'MergeGuard Dashboard',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    this.panel.iconPath = new vscode.ThemeIcon('shield');

    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      null,
      this.disposables,
    );

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      (msg: { command: string; filePath?: string; branch?: string }) => {
        if (msg.command === 'openFile' && msg.filePath) {
          const uri = vscode.Uri.file(`${this.gitRoot}/${msg.filePath}`);
          vscode.commands.executeCommand('vscode.open', uri);
        } else if (msg.command === 'previewConflict' && msg.filePath && msg.branch) {
          vscode.commands.executeCommand('mergeguard.previewConflict', msg.filePath, msg.branch);
        }
      },
      null,
      this.disposables,
    );

    this.refresh();
  }

  /** Update the dashboard with new scan data. */
  update(scan: ScanResult, gitRoot: string): void {
    this.lastScan = scan;
    this.gitRoot = gitRoot;

    // Record history
    this.appendHistory({ score: scan.overallRiskScore, timestamp: scan.timestamp });

    if (this.panel) {
      this.refresh();
    }
  }

  /** Is the dashboard panel currently visible? */
  get isVisible(): boolean {
    return this.panel?.visible ?? false;
  }

  private refresh(): void {
    if (!this.panel) return;
    const history = this.getHistory();
    this.panel.webview.html = buildDashboardHtml(this.lastScan, history);
  }

  // ── Risk history persistence ─────────────────

  private getHistory(): RiskHistoryEntry[] {
    return this.globalState.get<RiskHistoryEntry[]>(GLOBAL_STATE_KEY, []);
  }

  private appendHistory(entry: RiskHistoryEntry): void {
    const history = this.getHistory();
    history.push(entry);
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }
    void this.globalState.update(GLOBAL_STATE_KEY, history);
  }

  dispose(): void {
    this.panel?.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

// ────────────────────────────────────────────────────
// Dashboard HTML builder
// ────────────────────────────────────────────────────

function buildDashboardHtml(
  scan: ScanResult | undefined,
  history: RiskHistoryEntry[],
): string {
  const data = scan ? buildDataPayload(scan) : null;
  const historyJson = JSON.stringify(history);
  const dataJson = data ? JSON.stringify(data) : 'null';

  // Use a nonce for CSP
  const nonce = getNonce();

  return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MergeGuard Dashboard</title>
  <style nonce="${nonce}">
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border, #444);
      --card-bg: var(--vscode-sideBar-background, #1e1e1e);
      --accent: var(--vscode-focusBorder, #007acc);
      --danger: #e74c3c;
      --warning: #f39c12;
      --ok: #27ae60;
      --info: #3498db;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family, sans-serif); background: var(--bg); color: var(--fg); padding: 20px; }
    h1 { font-size: 1.5em; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
    h2 { font-size: 1.1em; margin-bottom: 8px; color: var(--fg); opacity: 0.85; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px; padding: 16px; }
    .gauge-container { display: flex; justify-content: center; align-items: center; padding: 16px 0; }
    .gauge { position: relative; width: 160px; height: 160px; }
    .gauge svg { transform: rotate(-90deg); }
    .gauge-label { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .gauge-score { font-size: 2.2em; font-weight: bold; }
    .gauge-level { font-size: 0.85em; opacity: 0.7; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
    th { opacity: 0.7; font-weight: 600; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.8em; font-weight: 600; }
    .badge-high { background: var(--danger); color: #fff; }
    .badge-medium { background: var(--warning); color: #000; }
    .badge-low { background: var(--info); color: #fff; }
    .badge-none { background: var(--ok); color: #fff; }
    .bar-chart { display: flex; flex-direction: column; gap: 6px; }
    .bar-row { display: flex; align-items: center; gap: 8px; }
    .bar-label { min-width: 160px; font-size: 0.85em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
    .bar-label:hover { text-decoration: underline; }
    .bar-track { flex: 1; height: 14px; background: var(--border); border-radius: 3px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 3px; }
    .bar-count { min-width: 32px; text-align: right; font-size: 0.85em; opacity: 0.7; }
    .pie-container { display: flex; justify-content: center; align-items: center; gap: 24px; flex-wrap: wrap; }
    .pie-legend { display: flex; flex-direction: column; gap: 4px; font-size: 0.85em; }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
    .timeline-container { height: 120px; display: flex; align-items: flex-end; gap: 2px; padding-top: 8px; }
    .timeline-bar { flex: 1; min-width: 4px; max-width: 16px; border-radius: 2px 2px 0 0; transition: height 0.3s; }
    .empty-state { text-align: center; padding: 40px 20px; opacity: 0.6; }
    .empty-state p { margin-top: 8px; }
    .link { color: var(--accent); cursor: pointer; text-decoration: none; }
    .link:hover, .link:focus { text-decoration: underline; outline: 2px solid var(--accent); outline-offset: 1px; }
    .meta { font-size: 0.8em; opacity: 0.6; margin-top: 12px; }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  </style>
</head>
<body>
  <h1>🛡️ MergeGuard Dashboard</h1>
  <div id="app" role="main" aria-label="Merge Guard risk dashboard"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const data = ${dataJson};
    const history = ${historyJson};
    const app = document.getElementById('app');

    function render() {
      if (!data) {
        app.innerHTML = '<div class="empty-state"><h2>No scan data</h2><p>Run a scan to see risk analysis.</p></div>';
        return;
      }

      app.innerHTML = \`
        <div class="grid">
          \${renderGauge()}
          \${renderBranchBreakdown()}
          \${renderFileHeatmap()}
          \${renderPieChart()}
          \${renderTimeline()}
        </div>
        <div class="meta">
          Last scan: \${new Date(data.timestamp).toLocaleString()} · Duration: \${data.durationMs}ms ·
          \${data.totalConflictFiles} file(s) across \${data.branches.length} branch(es)
        </div>
      \`;
    }

    function renderGauge() {
      const score = data.overallRiskScore;
      const level = data.overallRiskLevel;
      const color = levelColor(level);
      const circumference = 2 * Math.PI * 68;
      const offset = circumference - (score / 100) * circumference;
      return \`
        <div class="card" role="region" aria-label="Risk score gauge">
          <h2>Risk Score</h2>
          <div class="gauge-container">
            <div class="gauge" role="meter" aria-valuenow="\${score}" aria-valuemin="0" aria-valuemax="100" aria-label="Risk score \${score} out of 100, level \${level}">
              <svg width="160" height="160" viewBox="0 0 160 160" aria-hidden="true">
                <circle cx="80" cy="80" r="68" fill="none" stroke="var(--border)" stroke-width="12" />
                <circle cx="80" cy="80" r="68" fill="none" stroke="\${color}" stroke-width="12"
                  stroke-dasharray="\${circumference}" stroke-dashoffset="\${offset}"
                  stroke-linecap="round" />
              </svg>
              <div class="gauge-label">
                <span class="gauge-score" style="color:\${color}">\${score}</span>
                <span class="gauge-level">\${level}</span>
              </div>
            </div>
          </div>
        </div>
      \`;
    }

    function renderBranchBreakdown() {
      if (data.branches.length === 0) return '';
      const rows = data.branches.map(b => \`
        <tr>
          <td>\${esc(b.branch)}</td>
          <td>\${b.fileCount}</td>
          <td>\${b.riskScore}</td>
          <td><span class="badge badge-\${b.riskLevel}">\${b.riskLevel}</span></td>
        </tr>
      \`).join('');
      return \`
        <div class="card" role="region" aria-label="Branch breakdown">
          <h2>Branch Breakdown</h2>
          <table aria-label="Conflict details by branch">
            <thead><tr><th>Branch</th><th>Files</th><th>Score</th><th>Risk</th></tr></thead>
            <tbody>\${rows}</tbody>
          </table>
        </div>
      \`;
    }

    function renderFileHeatmap() {
      if (data.files.length === 0) return '';
      const maxCount = Math.max(...data.files.map(f => f.branchCount));
      const bars = data.files.slice(0, 15).map(f => {
        const pct = maxCount > 0 ? (f.branchCount / maxCount) * 100 : 0;
        const color = f.branchCount >= 3 ? 'var(--danger)' : f.branchCount >= 2 ? 'var(--warning)' : 'var(--info)';
        return \`
          <div class="bar-row">
            <span class="bar-label link" tabindex="0" role="link" aria-label="Open file \${esc(f.path)}" onclick="openFile('\${escAttr(f.path)}')" onkeydown="if(event.key==='Enter')openFile('\${escAttr(f.path)}');">\${esc(f.path)}</span>
            <div class="bar-track"><div class="bar-fill" style="width:\${pct}%;background:\${color}"></div></div>
            <span class="bar-count">\${f.branchCount}</span>
          </div>
        \`;
      }).join('');
      return \`
        <div class="card" role="region" aria-label="File heatmap">
          <h2>File Heatmap</h2>
          <div class="bar-chart">\${bars}</div>
        </div>
      \`;
    }

    function renderPieChart() {
      const types = data.conflictTypes;
      if (types.length === 0) return '';
      const total = types.reduce((s, t) => s + t.count, 0);
      const colors = { content: '#e74c3c', rename: '#f39c12', delete: '#9b59b6', binary: '#3498db', directory: '#1abc9c', 'mode-change': '#95a5a6' };
      let cumulative = 0;
      const slices = types.map(t => {
        const startAngle = (cumulative / total) * 360;
        cumulative += t.count;
        const endAngle = (cumulative / total) * 360;
        return { type: t.type, count: t.count, startAngle, endAngle, color: colors[t.type] || '#888' };
      });
      const size = 140, cx = 70, cy = 70, r = 60;
      const paths = slices.map(s => {
        if (s.endAngle - s.startAngle >= 359.99) {
          return \`<circle cx="\${cx}" cy="\${cy}" r="\${r}" fill="\${s.color}" />\`;
        }
        const start = polarToCartesian(cx, cy, r, s.startAngle);
        const end = polarToCartesian(cx, cy, r, s.endAngle);
        const largeArc = s.endAngle - s.startAngle > 180 ? 1 : 0;
        return \`<path d="M\${cx},\${cy} L\${start.x},\${start.y} A\${r},\${r} 0 \${largeArc} 1 \${end.x},\${end.y} Z" fill="\${s.color}" />\`;
      }).join('');
      const legend = types.map(t => \`
        <div class="legend-item">
          <span class="legend-dot" style="background:\${colors[t.type] || '#888'}"></span>
          \${esc(t.type)} (\${t.count})
        </div>
      \`).join('');
      return \`
        <div class="card" role="region" aria-label="Conflict type distribution">
          <h2>Conflict Types</h2>
          <div class="pie-container">
            <svg width="\${size}" height="\${size}" viewBox="0 0 \${size} \${size}" role="img" aria-label="Conflict type pie chart">\${paths}</svg>
            <div class="pie-legend">\${legend}</div>
          </div>
        </div>
      \`;
    }

    function renderTimeline() {
      if (history.length < 2) return '';
      const maxScore = Math.max(...history.map(h => h.score), 1);
      const bars = history.map(h => {
        const pct = (h.score / maxScore) * 100;
        const color = h.score >= 70 ? 'var(--danger)' : h.score >= 40 ? 'var(--warning)' : 'var(--ok)';
        return \`<div class="timeline-bar" style="height:\${Math.max(pct, 2)}%;background:\${color}" title="Score: \${h.score}"></div>\`;
      }).join('');
      return \`
        <div class="card" style="grid-column: 1 / -1;" role="region" aria-label="Risk score timeline">
          <h2>Risk Timeline</h2>
          <div class="timeline-container" role="img" aria-label="Risk score history chart">\${bars}</div>
        </div>
      \`;
    }

    function polarToCartesian(cx, cy, r, angleDeg) {
      const rad = (angleDeg - 90) * (Math.PI / 180);
      return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
    }

    function levelColor(level) {
      switch (level) {
        case 'high': return 'var(--danger)';
        case 'medium': return 'var(--warning)';
        case 'low': return 'var(--info)';
        default: return 'var(--ok)';
      }
    }

    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function escAttr(s) { return s.replace(/'/g, "\\\\'").replace(/"/g, '&quot;'); }

    function openFile(path) {
      vscode.postMessage({ command: 'openFile', filePath: path });
    }

    render();
  </script>
</body>
</html>`;
}

// ────────────────────────────────────────────────────

interface DashboardData {
  overallRiskScore: number;
  overallRiskLevel: string;
  totalConflictFiles: number;
  timestamp: number;
  durationMs: number;
  branches: Array<{
    branch: string;
    fileCount: number;
    riskScore: number;
    riskLevel: string;
    status: string;
  }>;
  files: Array<{
    path: string;
    branchCount: number;
    types: string[];
  }>;
  conflictTypes: Array<{
    type: string;
    count: number;
  }>;
}

function buildDataPayload(scan: ScanResult): DashboardData {
  // Branch breakdown
  const branches = scan.results.map((r) => ({
    branch: r.branch,
    fileCount: r.files.length,
    riskScore: r.riskScore,
    riskLevel: r.riskLevel,
    status: r.status,
  }));

  // File heatmap: aggregate across branches
  const fileMap = new Map<string, { branchCount: number; types: Set<string> }>();
  for (const result of scan.results) {
    for (const file of result.files) {
      const entry = fileMap.get(file.path);
      if (entry) {
        entry.branchCount++;
        entry.types.add(file.conflictType);
      } else {
        fileMap.set(file.path, { branchCount: 1, types: new Set([file.conflictType]) });
      }
    }
  }

  const files = [...fileMap.entries()]
    .map(([path, info]) => ({
      path,
      branchCount: info.branchCount,
      types: [...info.types],
    }))
    .sort((a, b) => b.branchCount - a.branchCount);

  // Conflict type distribution
  const typeCounts = new Map<string, number>();
  for (const result of scan.results) {
    for (const file of result.files) {
      typeCounts.set(file.conflictType, (typeCounts.get(file.conflictType) ?? 0) + 1);
    }
  }
  const conflictTypes = [...typeCounts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  return {
    overallRiskScore: scan.overallRiskScore,
    overallRiskLevel: scan.overallRiskLevel,
    totalConflictFiles: scan.totalConflictFiles,
    timestamp: scan.timestamp,
    durationMs: scan.durationMs,
    branches,
    files,
    conflictTypes,
  };
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

// ────────────────────────────────────────────────────
// Sidebar webview view provider
// ────────────────────────────────────────────────────

/**
 * WebviewViewProvider for the sidebar "Dashboard" panel.
 * Renders a compact version of the risk dashboard inside the sidebar.
 */
export class DashboardViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private lastScan: ScanResult | undefined;

  constructor(private readonly globalState: vscode.Memento) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [] };
    webviewView.webview.onDidReceiveMessage((msg: { command: string; filePath?: string; branch?: string }) => {
      if (msg.command === 'openFile' && msg.filePath) {
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(msg.filePath));
      } else if (msg.command === 'previewConflict' && msg.filePath && msg.branch) {
        vscode.commands.executeCommand('mergeguard.previewConflict', msg.filePath, msg.branch);
      }
    });
    this.refresh();
  }

  update(scan: ScanResult, _gitRoot: string): void {
    this.lastScan = scan;
    this.refresh();
  }

  private refresh(): void {
    if (!this.view) return;
    const history = this.globalState.get<RiskHistoryEntry[]>(GLOBAL_STATE_KEY, []);
    this.view.webview.html = buildDashboardHtml(this.lastScan, history);
  }
}
