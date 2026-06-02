#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Usage: $0 [options]

Builds the Titus Notes desktop app (Tauri + Vite).

Options:
  -t, --target <t>   Build target. One of:
                       host       native arch only (default)
                       universal  macOS universal (arm64 + x86_64)
                       arm        aarch64-apple-darwin
                       intel      x86_64-apple-darwin
  -c, --clean        Remove dist/ and src-tauri/target/release bundles first
  -d, --debug        Debug build (faster, unoptimized, no signing)
  -n, --no-install   Skip the dependency install check
  -h, --help         Show this help

Signing (optional, picked up from environment if set):
  TAURI_SIGNING_PRIVATE_KEY            base64 minisign private key
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD   password for the key (empty allowed)

Examples:
  $0                       # native build, signed if env keys present
  $0 -t universal          # macOS universal binary
  $0 -c -t arm             # clean, then build for Apple Silicon
  $0 -d                    # quick debug build
EOF
  exit "${1:-1}"
}

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

TARGET="host"
CLEAN=false
DEBUG=false
INSTALL=true

while [ $# -gt 0 ]; do
  case "$1" in
    -t|--target)     TARGET="${2:-}"; shift 2;;
    -c|--clean)      CLEAN=true; shift;;
    -d|--debug)      DEBUG=true; shift;;
    -n|--no-install) INSTALL=false; shift;;
    -h|--help)       usage 0;;
    *) echo "error: unknown option '$1'"; usage;;
  esac
done

# Map friendly target names to Tauri --target triples.
TAURI_ARGS=()
case "$TARGET" in
  host)      ;;
  universal) TAURI_ARGS+=(--target universal-apple-darwin);;
  arm)       TAURI_ARGS+=(--target aarch64-apple-darwin);;
  intel)     TAURI_ARGS+=(--target x86_64-apple-darwin);;
  *) echo "error: invalid target '$TARGET'"; usage;;
esac

$DEBUG && TAURI_ARGS+=(--debug)

# --- Preflight ------------------------------------------------------------
command -v npm   >/dev/null 2>&1 || { echo "error: npm not found in PATH"; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "error: cargo not found in PATH"; exit 1; }

VERSION="$(grep -m1 '"version"' package.json | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
echo "==> Titus Notes v${VERSION}"
echo "    target: ${TARGET}  debug: ${DEBUG}  clean: ${CLEAN}"

if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  echo "    signing: enabled (key from environment)"
else
  echo "    signing: disabled (TAURI_SIGNING_PRIVATE_KEY not set)"
fi

# --- Clean ----------------------------------------------------------------
if $CLEAN; then
  echo "==> Cleaning previous build artifacts..."
  rm -rf dist
  rm -rf src-tauri/target/release/bundle
  rm -rf src-tauri/target/*/release/bundle
fi

# --- Dependencies ---------------------------------------------------------
if $INSTALL; then
  if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ] 2>/dev/null; then
    echo "==> Installing npm dependencies..."
    npm install
  else
    echo "==> node_modules up to date (skip install)"
  fi
fi

# --- Build ----------------------------------------------------------------
echo "==> Running tauri build..."
npm run tauri build -- "${TAURI_ARGS[@]}"

# --- Report ---------------------------------------------------------------
echo ""
echo "==> Build finished. Artifacts:"
find src-tauri/target -path '*/release/bundle/*' \
  \( -name '*.dmg' -o -name '*.app.tar.gz' -o -name '*.deb' -o -name '*.AppImage' -o -name '*.msi' -o -name '*.exe' \) \
  -type f 2>/dev/null | sed 's/^/    /' || true

echo ""
echo "Done."
