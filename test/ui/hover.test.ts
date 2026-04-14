import { describe, it, expect } from 'vitest';
import { ConflictHoverProvider, conflictDescription } from '../../src/ui/hover';
import { DecorationController } from '../../src/ui/decorations';
import { ConflictType, RiskLevel } from '../../src/core/types';
import type { ConflictFile, ConflictResult, ScanResult } from '../../src/core/types';
import { Position } from 'vscode';

// ── Helpers ──────────────────────────────

function makeFile(
  path: string,
  type: ConflictType = ConflictType.Content,
  lineRanges: Array<{ startLine: number; endLine: number }> = [],
): ConflictFile {
  return { path, conflictType: type, lineRanges, stages: {} };
}

function makeResult(branch: string, files: ConflictFile[] = []): ConflictResult {
  return {
    branch,
    currentSHA: 'aaa',
    targetSHA: 'bbb',
    files,
    riskScore: 0,
    riskLevel: RiskLevel.None,
    timestamp: Date.now(),
    status: 'success',
  };
}

function makeScan(results: ConflictResult[]): ScanResult {
  return {
    results,
    overallRiskScore: 0,
    overallRiskLevel: RiskLevel.None,
    totalConflictFiles: results.reduce((s, r) => s + r.files.length, 0),
    timestamp: Date.now(),
    durationMs: 50,
  };
}

const GIT_ROOT = '/repo';

function makeDocument(relativePath: string) {
  return {
    uri: { fsPath: `${GIT_ROOT}/${relativePath}` },
    languageId: 'typescript',
  } as any;
}

// ── conflictDescription ──────────────────

describe('conflictDescription', () => {
  it('describes Content', () => {
    expect(conflictDescription(ConflictType.Content)).toContain('Content conflict');
  });
  it('describes Rename', () => {
    expect(conflictDescription(ConflictType.Rename)).toContain('Rename conflict');
  });
  it('describes Delete', () => {
    expect(conflictDescription(ConflictType.Delete)).toContain('Delete conflict');
  });
  it('describes Binary', () => {
    expect(conflictDescription(ConflictType.Binary)).toContain('Binary conflict');
  });
  it('describes Directory', () => {
    expect(conflictDescription(ConflictType.Directory)).toContain('Directory');
  });
  it('describes ModeChange', () => {
    expect(conflictDescription(ConflictType.ModeChange)).toContain('Mode change');
  });
});

// ── ConflictHoverProvider ────────────────

describe('ConflictHoverProvider', () => {
  let decCtrl: DecorationController;
  let provider: ConflictHoverProvider;

  beforeEach(() => {
    decCtrl = new DecorationController();
    provider = new ConflictHoverProvider(decCtrl, GIT_ROOT);
  });

  it('returns undefined for file with no conflicts', () => {
    const hover = provider.provideHover(makeDocument('clean.ts'), new Position(0, 0));
    expect(hover).toBeUndefined();
  });

  it('returns undefined for file outside git root', () => {
    const doc = { uri: { fsPath: '/other/path/file.ts' }, languageId: 'typescript' } as any;
    const hover = provider.provideHover(doc, new Position(0, 0));
    expect(hover).toBeUndefined();
  });

  it('returns hover when position is within a conflict range', () => {
    const f = makeFile('src/a.ts', ConflictType.Content, [{ startLine: 10, endLine: 20 }]);
    decCtrl.update(makeScan([makeResult('main', [f])]), GIT_ROOT);

    // Line 14 (0-indexed) = line 15 (1-indexed), within 10-20
    const hover = provider.provideHover(makeDocument('src/a.ts'), new Position(14, 0));
    expect(hover).toBeDefined();
    expect(hover!.contents[0].value).toContain('main');
    expect(hover!.contents[0].value).toContain('Content conflict');
  });

  it('returns undefined when position is outside conflict range', () => {
    const f = makeFile('src/a.ts', ConflictType.Content, [{ startLine: 10, endLine: 20 }]);
    decCtrl.update(makeScan([makeResult('main', [f])]), GIT_ROOT);

    // Line 0 (0-indexed) = line 1, outside 10-20
    const hover = provider.provideHover(makeDocument('src/a.ts'), new Position(0, 0));
    expect(hover).toBeUndefined();
  });

  it('shows hover for whole-file conflict (no line ranges)', () => {
    const f = makeFile('src/a.ts', ConflictType.Delete);
    decCtrl.update(makeScan([makeResult('main', [f])]), GIT_ROOT);

    const hover = provider.provideHover(makeDocument('src/a.ts'), new Position(0, 0));
    expect(hover).toBeDefined();
    expect(hover!.contents[0].value).toContain('Delete conflict');
  });

  it('shows multiple branches in hover separated by dividers', () => {
    const f1 = makeFile('src/a.ts', ConflictType.Content, [{ startLine: 1, endLine: 10 }]);
    const f2 = makeFile('src/a.ts', ConflictType.Rename, [{ startLine: 1, endLine: 10 }]);
    decCtrl.update(
      makeScan([makeResult('main', [f1]), makeResult('develop', [f2])]),
      GIT_ROOT,
    );

    const hover = provider.provideHover(makeDocument('src/a.ts'), new Position(5, 0));
    expect(hover).toBeDefined();
    const text = hover!.contents[0].value;
    expect(text).toContain('main');
    expect(text).toContain('develop');
    expect(text).toContain('---');
  });

  it('hover contains action link', () => {
    const f = makeFile('src/a.ts', ConflictType.Content, [{ startLine: 1, endLine: 5 }]);
    decCtrl.update(makeScan([makeResult('main', [f])]), GIT_ROOT);

    const hover = provider.provideHover(makeDocument('src/a.ts'), new Position(2, 0));
    expect(hover!.contents[0].value).toContain('command:mergeguard.previewConflict');
  });
});

import { beforeEach } from 'vitest';
