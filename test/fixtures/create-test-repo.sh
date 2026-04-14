#!/usr/bin/env bash
# Creates a temporary git repo with known conflict scenarios for testing.
# Usage: source this file or run it, then use $FIXTURE_DIR.

set -euo pipefail

FIXTURE_DIR="${1:-$(mktemp -d)}"
mkdir -p "$FIXTURE_DIR"

cd "$FIXTURE_DIR"
git init -b main
git config user.email "test@example.com"
git config user.name "Test User"

# ── Base commit ────────────────────────────────
cat > app.ts <<'EOF'
export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export function add(a: number, b: number): number {
  return a + b;
}
EOF

cat > config.json <<'EOF'
{
  "version": 1,
  "debug": false
}
EOF

cat > utils.ts <<'EOF'
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
EOF

printf '\x89PNG\r\n\x1a\n' > logo.png

git add -A
git commit -m "Initial commit"

# ── Feature branch: content conflict with main ──
git checkout -b feature/content-conflict
cat > app.ts <<'EOF'
export function greet(name: string): string {
  return `Hi there, ${name}! Welcome!`;
}

export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}
EOF
git add -A
git commit -m "Feature: change greeting and add multiply"

# ── Back to main: conflicting change ──
git checkout main
cat > app.ts <<'EOF'
export function greet(name: string): string {
  return `Good day, ${name}.`;
}

export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}
EOF
git add -A
git commit -m "Main: change greeting and add subtract"

# ── Feature branch: rename conflict ──
git checkout -b feature/rename-conflict HEAD~1
git mv utils.ts helpers.ts
git commit -m "Feature: rename utils to helpers"

git checkout main
git mv utils.ts lib.ts
git commit -m "Main: rename utils to lib"

# ── Feature branch: delete conflict ──
git checkout -b feature/delete-conflict HEAD~1
cat >> config.json <<'EOF2'

EOF2
cat > config.json <<'EOF'
{
  "version": 2,
  "debug": true,
  "feature": "new"
}
EOF
git add -A
git commit -m "Feature: modify config"

git checkout main
git rm config.json
git commit -m "Main: remove config"

# ── Feature branch: binary conflict ──
git checkout -b feature/binary-conflict HEAD~1
printf '\x89PNG\r\n\x1a\nFEATURE' > logo.png
git add -A
git commit -m "Feature: modify logo"

git checkout main
printf '\x89PNG\r\n\x1a\nMAIN' > logo.png
git add -A
git commit -m "Main: modify logo differently"

# ── Clean branch (no conflicts) ──
git checkout -b feature/clean main
cat > new-file.ts <<'EOF'
export const VERSION = '1.0.0';
EOF
git add -A
git commit -m "Feature: add new file (no conflicts)"

git checkout main

echo ""
echo "Fixture repo created at: $FIXTURE_DIR"
echo "Branches:"
git branch -a
echo ""
echo "Conflict scenarios:"
echo "  feature/content-conflict — content conflict in app.ts"
echo "  feature/rename-conflict  — rename conflict (utils.ts renamed differently)"
echo "  feature/delete-conflict  — delete/modify conflict in config.json"
echo "  feature/binary-conflict  — binary conflict in logo.png"
echo "  feature/clean            — no conflicts"
