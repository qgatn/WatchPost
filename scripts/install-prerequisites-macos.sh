#!/usr/bin/env bash
# WatchPost — install macOS build prerequisites (Xcode CLT, Node.js 20+, Rust).
# Run from the repo root:
#   bash scripts/install-prerequisites-macos.sh
#
# Options and WATCHPOST_* env vars are documented in show_help.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIN_NODE_MAJOR=20
RUSTUP_URL="https://sh.rustup.rs"
NODE_INDEX_URL="https://nodejs.org/dist/index.json"

# Defaults (override with flags or env)
BREW_PREFIX="${WATCHPOST_BREW_PREFIX:-}"
CARGO_HOME="${WATCHPOST_CARGO_HOME:-$HOME/.cargo}"
DOWNLOAD_DIR="${WATCHPOST_DOWNLOAD_DIR:-$HOME/Library/Caches/WatchPostInstall}"

SKIP_XCODE=0
SKIP_NODE=0
SKIP_RUST=0
CHECK_ONLY=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

FAILED_STEPS=()

show_help() {
  cat <<'EOF'
WatchPost — macOS prerequisite installer

Usage:
  bash scripts/install-prerequisites-macos.sh [options]

Installs (or verifies):
  • Xcode Command Line Tools (clang, SDK)
  • Node.js LTS 20+ (includes npm)
  • Rust stable via rustup (includes cargo)

Options:
  --brew-prefix PATH    Homebrew prefix (/opt/homebrew or /usr/local). Auto-detected if omitted.
  --cargo-home PATH     Rust/cargo install location (default: ~/.cargo)
  --download-dir PATH   Cache for downloaded installers (default: ~/Library/Caches/WatchPostInstall)
  --skip-xcode          Skip Xcode Command Line Tools
  --skip-node           Skip Node.js
  --skip-rust           Skip Rust
  --check-only          Verify tools only; do not download or install
  -h, --help            Show this help

Environment (same as flags):
  WATCHPOST_BREW_PREFIX, WATCHPOST_CARGO_HOME, WATCHPOST_DOWNLOAD_DIR

After this script succeeds, from the WatchPost repo run:
  npm run setup
  npm run start

Manual fallback: wiki/Build-from-source.md
EOF
}

log_step() { echo -e "\n${CYAN}==>${NC} $*"; }
log_ok()   { echo -e "${GREEN}OK${NC}  $*"; }
log_warn() { echo -e "${YELLOW}WARN${NC} $*"; }
log_fail() { echo -e "${RED}FAIL${NC} $*" >&2; }

record_failure() {
  local step="$1"
  local detail="$2"
  FAILED_STEPS+=("$step")
  log_fail "$step — $detail"
}

detect_brew_prefix() {
  if [ -n "$BREW_PREFIX" ]; then
    return 0
  fi
  if [ -x "/opt/homebrew/bin/brew" ]; then
    BREW_PREFIX="/opt/homebrew"
  elif [ -x "/usr/local/bin/brew" ]; then
    BREW_PREFIX="/usr/local"
  fi
}

apply_path() {
  detect_brew_prefix
  if [ -n "$BREW_PREFIX" ]; then
    export PATH="$BREW_PREFIX/bin:$BREW_PREFIX/sbin:$PATH"
  fi
  if [ -d "$CARGO_HOME/bin" ]; then
    export PATH="$CARGO_HOME/bin:$PATH"
  fi
  # Common Node.js installer location
  export PATH="/usr/local/bin:$PATH"
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --brew-prefix)
        BREW_PREFIX="$2"
        shift 2
        ;;
      --cargo-home)
        CARGO_HOME="$2"
        shift 2
        ;;
      --download-dir)
        DOWNLOAD_DIR="$2"
        shift 2
        ;;
      --skip-xcode) SKIP_XCODE=1; shift ;;
      --skip-node)  SKIP_NODE=1; shift ;;
      --skip-rust)  SKIP_RUST=1; shift ;;
      --check-only) CHECK_ONLY=1; shift ;;
      -h|--help)
        show_help
        exit 0
        ;;
      *)
        echo "Unknown option: $1" >&2
        show_help >&2
        exit 2
        ;;
    esac
  done
}

node_major_version() {
  node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'
}

have_xcode_clt() {
  xcode-select -p &>/dev/null && command -v clang &>/dev/null
}

have_node() {
  command -v node &>/dev/null && command -v npm &>/dev/null || return 1
  local major
  major="$(node_major_version)"
  [ -n "$major" ] && [ "$major" -ge "$MIN_NODE_MAJOR" ]
}

have_rust() {
  command -v rustc &>/dev/null && command -v cargo &>/dev/null
}

fetch_node_lts_version() {
  if ! command -v python3 &>/dev/null; then
    echo "22.16.0"
    return 0
  fi
  python3 - <<'PY' 2>/dev/null || echo "22.16.0"
import json, urllib.request
with urllib.request.urlopen("https://nodejs.org/dist/index.json", timeout=60) as r:
    for entry in json.load(r):
        if entry.get("lts"):
            print(entry["version"].lstrip("v"))
            break
PY
}

step_xcode() {
  log_step "Xcode Command Line Tools"
  if have_xcode_clt; then
    log_ok "clang — $(clang --version | head -n1)"
    log_ok "xcode-select — $(xcode-select -p)"
    return 0
  fi
  if [ "$CHECK_ONLY" -eq 1 ]; then
    record_failure "Xcode CLT" "not installed (run without --check-only to install)"
    return 1
  fi
  echo "A macOS dialog should appear — click Install and wait for the download (~1 GB)."
  echo "If no dialog appears, install manually: xcode-select --install"
  if ! xcode-select --install 2>&1 | grep -q "already installed"; then
    :
  fi
  local waited=0
  local max_wait=600
  while ! have_xcode_clt && [ "$waited" -lt "$max_wait" ]; do
    sleep 5
    waited=$((waited + 5))
    printf "\r  Waiting for Command Line Tools... %ds " "$waited"
  done
  echo ""
  if have_xcode_clt; then
    log_ok "Xcode Command Line Tools installed"
    return 0
  fi
  record_failure "Xcode CLT" "not detected after ${max_wait}s"
  echo "  Manual: xcode-select --install"
  echo "  Docs:   https://developer.apple.com/download/all/"
  return 1
}

step_node() {
  log_step "Node.js (>= v${MIN_NODE_MAJOR})"
  apply_path
  if have_node; then
    log_ok "node — $(node --version)"
    log_ok "npm  — $(npm --version)"
    return 0
  fi
  if [ "$CHECK_ONLY" -eq 1 ]; then
    record_failure "Node.js" "not found or version < ${MIN_NODE_MAJOR} (run without --check-only)"
    return 1
  fi
  mkdir -p "$DOWNLOAD_DIR"
  if command -v brew &>/dev/null; then
    log_step "Installing Node.js via Homebrew"
    if brew install node; then
      apply_path
      if have_node; then
        log_ok "node — $(node --version)"
        return 0
      fi
    fi
    log_warn "Homebrew install did not produce a usable node; trying nodejs.org pkg..."
  fi
  local ver arch pkg pkg_url
  ver="$(fetch_node_lts_version)"
  arch="$(uname -m)"
  case "$arch" in
    arm64) pkg="node-v${ver}.pkg" ;;
    x86_64) pkg="node-v${ver}.pkg" ;;
    *) record_failure "Node.js" "unsupported architecture: $arch"; return 1 ;;
  esac
  pkg_url="https://nodejs.org/dist/v${ver}/${pkg}"
  log_step "Downloading $pkg_url"
  if ! curl -fsSL --retry 3 --retry-delay 2 -o "$DOWNLOAD_DIR/$pkg" "$pkg_url"; then
    record_failure "Node.js" "download failed — $pkg_url"
    echo "  Manual: https://nodejs.org/ (LTS .pkg installer)"
    return 1
  fi
  echo "Installing Node.js (requires administrator password)..."
  if ! sudo installer -pkg "$DOWNLOAD_DIR/$pkg" -target /; then
    record_failure "Node.js" "installer failed — $DOWNLOAD_DIR/$pkg"
    echo "  Manual: open the .pkg in Finder and run the wizard"
    return 1
  fi
  apply_path
  if have_node; then
    log_ok "node — $(node --version)"
    return 0
  fi
  record_failure "Node.js" "installed but not on PATH — open a new terminal or add /usr/local/bin"
  echo "  Try: export PATH=\"/usr/local/bin:\$PATH\""
  return 1
}

step_rust() {
  log_step "Rust (rustup)"
  export CARGO_HOME
  export RUSTUP_HOME="${WATCHPOST_RUSTUP_HOME:-$HOME/.rustup}"
  apply_path
  if have_rust; then
    log_ok "rustc — $(rustc --version)"
    log_ok "cargo — $(cargo --version)"
    return 0
  fi
  if [ "$CHECK_ONLY" -eq 1 ]; then
    record_failure "Rust" "not installed (run without --check-only)"
    return 1
  fi
  log_step "Downloading rustup"
  if ! curl --proto '=https' --tlsv1.2 -sSf "$RUSTUP_URL" -o "$DOWNLOAD_DIR/rustup-init.sh"; then
    record_failure "Rust" "could not download $RUSTUP_URL"
    echo "  Manual: https://rustup.rs/"
    return 1
  fi
  chmod +x "$DOWNLOAD_DIR/rustup-init.sh"
  if ! CARGO_HOME="$CARGO_HOME" RUSTUP_HOME="$RUSTUP_HOME" \
    "$DOWNLOAD_DIR/rustup-init.sh" -y --default-toolchain stable; then
    record_failure "Rust" "rustup-init failed"
    return 1
  fi
  # shellcheck source=/dev/null
  [ -f "$CARGO_HOME/env" ] && source "$CARGO_HOME/env"
  apply_path
  if have_rust; then
    log_ok "rustc — $(rustc --version)"
    log_ok "cargo — $(cargo --version)"
    echo "  Cargo home: $CARGO_HOME (add to shell profile if a new terminal misses cargo)"
    return 0
  fi
  record_failure "Rust" "rustup finished but cargo not found"
  echo "  Add to ~/.zshrc:  export PATH=\"$CARGO_HOME/bin:\$PATH\""
  return 1
}

print_summary() {
  apply_path
  echo ""
  echo "================================"
  echo "WatchPost prerequisite summary"
  echo "================================"
  local all_ok=1
  if [ "$SKIP_XCODE" -eq 0 ]; then
    have_xcode_clt && log_ok "Xcode CLT" || { log_fail "Xcode CLT"; all_ok=0; }
  fi
  if [ "$SKIP_NODE" -eq 0 ]; then
    have_node && log_ok "Node.js $(node --version 2>/dev/null)" || { log_fail "Node.js"; all_ok=0; }
  fi
  if [ "$SKIP_RUST" -eq 0 ]; then
    have_rust && log_ok "Rust $(rustc --version 2>/dev/null)" || { log_fail "Rust"; all_ok=0; }
  fi
  if [ "${#FAILED_STEPS[@]}" -gt 0 ]; then
    echo ""
    echo -e "${RED}Steps that failed:${NC}"
    for s in "${FAILED_STEPS[@]}"; do
      echo "  • $s"
    done
    echo ""
    echo "See wiki/Build-from-source.md for manual install steps."
    return 1
  fi
  if [ "$all_ok" -eq 1 ]; then
    echo ""
    echo -e "${GREEN}All prerequisites ready.${NC}"
    echo ""
    echo "Next (from $ROOT):"
    echo "  cd \"$ROOT\""
    echo "  npm run setup"
    echo "  npm run start"
    return 0
  fi
  return 1
}

main() {
  parse_args "$@"
  apply_path
  mkdir -p "$DOWNLOAD_DIR"

  echo "WatchPost — macOS prerequisites"
  echo "Repo: $ROOT"
  echo "Cache: $DOWNLOAD_DIR"
  [ -n "$BREW_PREFIX" ] && echo "Homebrew prefix: $BREW_PREFIX"
  echo "Cargo home: $CARGO_HOME"
  [ "$CHECK_ONLY" -eq 1 ] && echo "Mode: check only (no installs)"

  [ "$SKIP_XCODE" -eq 0 ] && step_xcode || log_warn "Skipping Xcode CLT"
  [ "$SKIP_NODE" -eq 0 ] && step_node || log_warn "Skipping Node.js"
  [ "$SKIP_RUST" -eq 0 ] && step_rust || log_warn "Skipping Rust"

  print_summary
}

main "$@"
