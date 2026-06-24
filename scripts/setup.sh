#!/usr/bin/env bash
# WatchPost setup — macOS / Linux
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CARGO_HOME="${WATCHPOST_CARGO_HOME:-$HOME/.cargo}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

missing=0

apply_path() {
  if [ -d "/opt/homebrew/bin" ]; then
    export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
  fi
  if [ -d "/usr/local/bin" ]; then
    export PATH="/usr/local/bin:$PATH"
  fi
  if [ -d "$CARGO_HOME/bin" ]; then
    export PATH="$CARGO_HOME/bin:$PATH"
  fi
  if [ -f "$CARGO_HOME/env" ]; then
    # shellcheck source=/dev/null
    source "$CARGO_HOME/env"
  fi
}

check() {
  local label="$1"
  local cmd="$2"
  if command -v "$cmd" >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} $label — $("$cmd" --version 2>&1 | head -n1)"
    return 0
  fi
  if [ "$cmd" = "cargo" ] || [ "$cmd" = "rustc" ]; then
    local exe="$CARGO_HOME/bin/$cmd"
    if [ -x "$exe" ]; then
      export PATH="$CARGO_HOME/bin:$PATH"
      echo -e "${GREEN}✓${NC} $label — $("$exe" --version 2>&1 | head -n1)"
      return 0
    fi
  fi
  echo -e "${RED}✗${NC} $label — not found"
  missing=1
}

apply_path

echo "WatchPost setup (macOS / Linux)"
echo "================================"

check "Node.js" node
check "npm" npm
check "Rust (cargo)" cargo
check "rustc" rustc

if [ "$missing" -ne 0 ]; then
  echo ""
  echo -e "${YELLOW}Cannot continue — install the missing tools first.${NC}"
  echo ""
  echo "Full install guide (downloads, verify, PATH):"
  echo "  wiki/Build-from-source.md"
  echo ""
  echo "After installing, reopen the terminal and run:"
  echo "  bash scripts/install-prerequisites-macos.sh   # install Node, Rust, Xcode CLT"
  echo "  bash scripts/setup.sh                         # or: npm run setup"
  exit 1
fi

echo ""
echo "Installing npm dependencies..."
npm install

echo ""
echo -e "${GREEN}Setup complete.${NC}"
echo ""
echo "  Run the app:     npm run start"
echo "  Run tests:       npm test"
echo "  Build installer: npm run package"
