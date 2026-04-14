# Contributing to MergeGuard

Thanks for your interest in contributing! Here's how to get started.

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/sukanta1991/mergeguard.git
cd mergeguard

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Type-check
npm run typecheck

# Lint
npm run lint
```

## Project Structure

```
src/
├── core/           # Core engine (git ops, analysis, caching, scoring)
│   ├── gitOps.ts          # Git CLI wrapper
│   ├── analyzer.ts        # Conflict analysis via merge-tree
│   ├── branchMonitor.ts   # Branch change detection
│   ├── cache.ts           # SHA-keyed LRU cache
│   ├── riskScorer.ts      # Risk score calculation
│   ├── scanOrchestrator.ts # Scan lifecycle management
│   ├── types.ts           # Type definitions
│   └── logger.ts          # Output channel logger
├── ui/             # VS Code UI components
│   ├── statusBar.ts       # Status bar controller
│   ├── treeView.ts        # TreeView data provider
│   ├── decorations.ts     # Editor inline decorations
│   ├── hover.ts           # Hover tooltip provider
│   ├── diagnostics.ts     # Problems panel integration
│   └── fileDecorations.ts # Explorer file badges
└── extension.ts    # Entry point (activate/deactivate)

test/
├── __mocks__/vscode.ts    # VS Code API mock
├── core/                  # Unit tests for core modules
├── ui/                    # Unit tests for UI modules
├── integration/           # Integration tests with real git repos
└── fixtures/              # Test fixture scripts
```

## Running Tests

```bash
# Run all tests once
npm test

# Watch mode
npm run test:watch
```

Tests use [Vitest](https://vitest.dev/) with a custom vscode module mock. Integration tests create temporary git repos with scripted conflict scenarios.

## Submitting Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes with tests
4. Run `npm run typecheck && npm run lint && npm test`
5. Commit with a clear message
6. Open a Pull Request

## Code Style

- TypeScript strict mode
- Prettier for formatting (`npm run format`)
- ESLint for linting (`npm run lint:fix`)
- No production dependencies — all git operations use `child_process.spawn`

## Reporting Issues

Use the [GitHub Issues](https://github.com/sukanta1991/mergeguard/issues) page. Please include:

- VS Code version
- Git version (`git --version`)
- OS
- Steps to reproduce
- Expected vs actual behavior

## More Information

- [Architecture Overview](docs/architecture.md)
- [Development Setup](docs/development.md)
- [API Documentation](docs/api.md)
