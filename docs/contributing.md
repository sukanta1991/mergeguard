# Contributing to Merge Guard

Thank you for your interest in contributing to Merge Guard! This guide will help you get started.

## Code of Conduct

Please read and follow our [Code of Conduct](../CODE_OF_CONDUCT.md) before participating.

## How to Contribute

### Reporting Bugs

Use the [Bug Report](https://github.com/sukanta1991/mergeguard/issues/new?template=bug_report.md) issue template. Include:

- VS Code version
- Git version (`git --version`)
- Operating system
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs from the MergeGuard output channel

### Suggesting Features

Use the [Feature Request](https://github.com/sukanta1991/mergeguard/issues/new?template=feature_request.md) issue template.

### Submitting Code

1. **Fork** the repository and clone your fork.
2. **Create a branch**: `git checkout -b feature/my-improvement`
3. **Install dependencies**: `npm install`
4. **Make changes** with appropriate tests.
5. **Validate**:
   ```bash
   npm run typecheck   # TypeScript compilation
   npm run lint         # ESLint
   npm test             # Vitest test suite
   npm run build        # esbuild production bundle
   ```
6. **Commit** with a clear, descriptive message.
7. **Push** and open a Pull Request against `main`.

### First-Time Contributors

Look for issues labeled [`good first issue`](https://github.com/sukanta1991/mergeguard/labels/good%20first%20issue) — these are scoped, well-documented tasks ideal for getting started.

## Development Setup

See [development.md](development.md) for detailed setup instructions.

## Code Style

- **TypeScript strict mode** — All code must pass `tsc --noEmit` with strict settings.
- **Prettier** — Auto-formatting via `npm run format`.
- **ESLint** — Linting via `npm run lint:fix`.
- **No production dependencies** — All Git operations use `child_process.spawn`. The extension bundles to a single file.
- **Test coverage** — All new features and bug fixes must include tests.

## Commit Messages

Use clear, imperative-mood commit messages:

- `Add incremental scanning for branch analysis`
- `Fix status bar crash when scan is aborted`
- `Update README with performance benchmarks`

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR.
- Include tests for all code changes.
- Update documentation if user-facing behavior changes.
- Ensure all CI checks pass before requesting review.

## Internationalization (i18n)

All user-facing strings use `vscode.l10n.t()`. The English base bundle is at `l10n/bundle.l10n.json`.

To add a new language:

1. Create `l10n/bundle.l10n.<locale>.json` (e.g., `bundle.l10n.fr.json` for French).
2. Translate all keys from the base bundle.
3. Submit a PR with the new bundle file.

## Architecture

See [architecture.md](architecture.md) for a detailed overview of the codebase structure and data flow.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](../LICENSE).
