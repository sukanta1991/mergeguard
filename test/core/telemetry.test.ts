import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelemetryService } from '../../src/core/telemetry';

vi.mock('vscode', () => import('../__mocks__/vscode'));

describe('TelemetryService (M4.5)', () => {
  let service: TelemetryService;

  beforeEach(() => {
    service = new TelemetryService();
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  it('reports isEnabled from env', () => {
    expect(service.isEnabled).toBe(true);
  });

  it('logActivation does not throw', () => {
    expect(() => service.logActivation(150)).not.toThrow();
  });

  it('logScan does not throw', () => {
    expect(() =>
      service.logScan({
        durationMs: 200,
        branchCount: 3,
        conflictFiles: 5,
        cachedCount: 1,
        analyzedCount: 2,
      }),
    ).not.toThrow();
  });

  it('logFeatureUsed does not throw', () => {
    expect(() => service.logFeatureUsed('dashboard')).not.toThrow();
    expect(() => service.logFeatureUsed('codeLens')).not.toThrow();
    expect(() => service.logFeatureUsed('preview')).not.toThrow();
    expect(() => service.logFeatureUsed('threeWayDiff')).not.toThrow();
    expect(() => service.logFeatureUsed('mergeOrder')).not.toThrow();
    expect(() => service.logFeatureUsed('sort')).not.toThrow();
    expect(() => service.logFeatureUsed('filter')).not.toThrow();
  });

  it('logError tracks error counts', () => {
    service.logError('scan');
    service.logError('scan');
    service.logError('network');

    const counts = service.getErrorCounts();
    expect(counts.get('scan')).toBe(2);
    expect(counts.get('network')).toBe(1);
  });

  it('dispose does not throw', () => {
    expect(() => service.dispose()).not.toThrow();
  });
});
