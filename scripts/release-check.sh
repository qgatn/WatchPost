#!/usr/bin/env bash
# Run the same checks a release build needs, locally, before pushing a tag.
# Usage:  npm run release:check
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Frontend + Rust tests"
npm test

echo "==> Production frontend build"
npm run build

echo "==> Tauri release build (current OS / CPU only)"
npm run package

echo ""
echo "OK — installers are in src-tauri/target/release/bundle/"
echo "If that succeeded, pushing a version tag should pass GitHub Actions."
