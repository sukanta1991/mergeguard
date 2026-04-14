# Development Setup

This guide covers everything needed to develop and test Merge Guard locally.

## Prerequisites

- **Node.js** 18+ (LTS recommended)
- **npm** 9+
- **Git** 2.38+ (for `merge-tree --write-tree` support)
- **VS Code** 1.85+ (for running and debugging the extension)

## Getting Started

```bash
# Clone the repository
git clone https://github.com/sukanta1991/mergeguard.git
cd mergeguard

# Install dependencies
npm install
```

## Build

```bash
# Production build (single-file bundle)
npm run build

# Watch mode (auto-rebuild on changes)
npm run watch
```

The extension is bundled with [esbuild](https://esbuild.github.io/) into `dist/extension.js`.

## Run & Debug

1. Open the project in VS Code.
2. Press **F5** to launch the Extension Development Host.
3. The extension activates automatically in any workspace with a Git repository.
4. View logs in the **Output** panel → **MergeGuard** channel.

## Testing

```bash
# Run all tests once
npm test

# Watch mode (re-runs on file changes)
npm run test:watch
```

Tests use [Vitest](https://vitest.dev/) with a custom VS Code API mock at `test/__mocks__/vscode.ts`.

### Test Structure

```
test/
├── __mocks__/vscode.ts       # VS Code API mock
├── core/                      # Unit tests for core modules
│   ├── analyzer.test.ts
│   ├── branchMonitor.test.ts
│   ├── cache.test.ts
│   ├── errorHandling.test.ts
│   ├── gitOps.test.ts
│   ├── performance.test.ts
│   ├── riskScorer.test.ts
│   ├── scanOrchestrator.test.ts
│   └── ...
├── ui/                        # Unit tests for UI components
│   ├── statusBar.test.ts
│   ├── treeView.test.ts
│   ├── dashboard.test.ts
│   ├── accessibility.test.ts
│   └── ...
├── scm/                       # SCM provider tests
├── integration/               # Integration tests (real git repos)
└── fixtures/                  # Test fixture scripts
```

### Integration Tests

Integration tests in `test/integration/` create temporary Git repositories with scripted conflict scenarios. They test the full pipeline from `analyzeConflicts()` through risk scoring.

## Code Quality

```bash
# TypeScript type-checking
npm run typecheck

# ESLint
npm run lint
npm run lint:fix

# Prettier formatting
npm run format
```

## Packaging

```bash
# Build and package into a .vsix file
npm run build
npx @vscode/vsce package --no-dependencies
```

The resulting `.vsix` can be installed locally: **Extensions** → **…** → **Install from VSIX**.

## Project Structure

```
mergeguard/
├── src/
│   ├── core/           # Core engine (git ops, analysis, caching)
│   ├── ui/             # VS Code UI components
│   ├── scm/            # SCM platform integrations
│   └── extension.ts    # Entry point
├── test/               # Test suite
├── l10n/               # Localization bundles
├── docs/               # Documentation
├── dist/               # Build output (gitignored)
├── images/             # Extension icon
├── package.json        # Extension manifest
├── tsconfig.json       # TypeScript configuration
├── esbuild.mjs         # Build script
└── vitest.config.ts    # Test configuration
```
