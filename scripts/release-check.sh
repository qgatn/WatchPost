#!/usr/bin/env bash
# Run the same checks a release build needs, locally, before pushing a tag.
# Usage:  npm run release:check
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Version manifests"
node -e "
const fs=require('fs');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const tauri=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8'));
const cargo=fs.readFileSync('src-tauri/Cargo.toml','utf8').match(/^version = \"([^\"]+)\"/m)?.[1];
const v=pkg.version;
if(tauri.version!==v||cargo!==v){console.error('Version mismatch — run: node scripts/sync-version.mjs',v);process.exit(1)}
console.log('OK  version',v);
"

echo "==> Frontend + Rust tests"
npm test

echo "==> Production frontend build"
npm run build

echo "==> Tauri release build (current OS / CPU only)"
npm run package

echo ""
echo "OK — installers are in src-tauri/target/release/bundle/"
echo "If that succeeded, pushing a version tag should pass GitHub Actions."
