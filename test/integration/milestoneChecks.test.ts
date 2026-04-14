import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../');

describe('i18n Preparation (M4.4)', () => {
  it('l10n/bundle.l10n.json exists and is valid JSON', () => {
    const bundlePath = path.join(ROOT, 'l10n', 'bundle.l10n.json');
    expect(fs.existsSync(bundlePath)).toBe(true);

    const content = fs.readFileSync(bundlePath, 'utf-8');
    const bundle = JSON.parse(content);
    expect(typeof bundle).toBe('object');
    expect(Object.keys(bundle).length).toBeGreaterThan(10);
  });

  it('all bundle values are strings', () => {
    const bundlePath = path.join(ROOT, 'l10n', 'bundle.l10n.json');
    const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));
    for (const [key, value] of Object.entries(bundle)) {
      expect(typeof value).toBe('string');
    }
  });

  it('package.json has l10n field', () => {
    const pkgPath = path.join(ROOT, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    expect(pkg.l10n).toBe('./l10n');
  });
});

describe('Documentation (M4.6)', () => {
  it('docs/architecture.md exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'docs', 'architecture.md'))).toBe(true);
  });

  it('docs/contributing.md exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'docs', 'contributing.md'))).toBe(true);
  });

  it('docs/development.md exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'docs', 'development.md'))).toBe(true);
  });

  it('docs/api.md exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'docs', 'api.md'))).toBe(true);
  });

  it('README has Comparison with Alternatives section', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf-8');
    expect(readme).toContain('Comparison with Alternatives');
  });

  it('README has Performance Benchmarks section', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf-8');
    expect(readme).toContain('Performance Benchmarks');
  });

  it('README has Troubleshooting section', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf-8');
    expect(readme).toContain('Troubleshooting');
  });

  it('README has FAQ section', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf-8');
    expect(readme).toContain('FAQ');
  });
});

describe('Community Readiness (M4.7)', () => {
  it('CODE_OF_CONDUCT.md exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'CODE_OF_CONDUCT.md'))).toBe(true);
  });

  it('bug report issue template exists', () => {
    expect(fs.existsSync(path.join(ROOT, '.github', 'ISSUE_TEMPLATE', 'bug_report.md'))).toBe(true);
  });

  it('feature request issue template exists', () => {
    expect(fs.existsSync(path.join(ROOT, '.github', 'ISSUE_TEMPLATE', 'feature_request.md'))).toBe(true);
  });

  it('question issue template exists', () => {
    expect(fs.existsSync(path.join(ROOT, '.github', 'ISSUE_TEMPLATE', 'question.md'))).toBe(true);
  });

  it('PR template exists', () => {
    expect(fs.existsSync(path.join(ROOT, '.github', 'PULL_REQUEST_TEMPLATE.md'))).toBe(true);
  });

  it('CI workflow has lint + test + build jobs', () => {
    const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf-8');
    expect(ci).toContain('npm run typecheck');
    expect(ci).toContain('npm run lint');
    expect(ci).toContain('npm run build');
    expect(ci).toContain('npm test');
  });

  it('CI workflow has auto-publish on tag', () => {
    const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf-8');
    expect(ci).toContain("startsWith(github.ref, 'refs/tags/v')");
    expect(ci).toContain('vsce publish');
    expect(ci).toContain('VSCE_PAT');
  });

  it('CI workflow runs on PR and push', () => {
    const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf-8');
    expect(ci).toContain('pull_request');
    expect(ci).toContain('push');
  });
});
