#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Usage: $0 <version | patch | minor | major>

Bumps the version in:
  - package.json
  - src-tauri/tauri.conf.json
  - src-tauri/Cargo.toml

Then runs cargo check to refresh Cargo.lock, commits and tags v<version>.

Examples:
  $0 0.3.1     # set exact version
  $0 patch     # 0.2.0 -> 0.2.1
  $0 minor     # 0.2.0 -> 0.3.0
  $0 major     # 0.2.0 -> 1.0.0
EOF
  exit 1
}

[ $# -eq 1 ] || usage

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

PKG="package.json"
TAURI="src-tauri/tauri.conf.json"
CARGO="src-tauri/Cargo.toml"
LOCK="src-tauri/Cargo.lock"

for f in "$PKG" "$TAURI" "$CARGO"; do
  [ -f "$f" ] || { echo "error: $f not found"; exit 1; }
done

CURRENT="$(grep -m1 '"version"' "$PKG" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
[ -n "$CURRENT" ] || { echo "error: could not parse current version from $PKG"; exit 1; }

ARG="$1"
case "$ARG" in
  patch|minor|major)
    IFS='.' read -r MA MI PA <<< "$CURRENT"
    case "$ARG" in
      patch) PA=$((PA + 1));;
      minor) MI=$((MI + 1)); PA=0;;
      major) MA=$((MA + 1)); MI=0; PA=0;;
    esac
    NEW="${MA}.${MI}.${PA}"
    ;;
  *)
    if [[ ! "$ARG" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]; then
      echo "error: '$ARG' is not a valid semver or bump type"
      usage
    fi
    NEW="$ARG"
    ;;
esac

if [ "$CURRENT" = "$NEW" ]; then
  echo "error: new version equals current ($CURRENT)"
  exit 1
fi

TAG="v${NEW}"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "error: tag $TAG already exists"
  exit 1
fi

echo "Bumping ${CURRENT} -> ${NEW}"

# macOS sed needs '' after -i; portable form: write to tmp then move.
bump_file() {
  local file="$1" pattern="$2" replace="$3"
  local tmp
  tmp="$(mktemp)"
  sed -E "s/${pattern}/${replace}/" "$file" > "$tmp"
  mv "$tmp" "$file"
}

bump_file "$PKG"   '"version"[[:space:]]*:[[:space:]]*"'"$CURRENT"'"' '"version": "'"$NEW"'"'
bump_file "$TAURI" '"version"[[:space:]]*:[[:space:]]*"'"$CURRENT"'"' '"version": "'"$NEW"'"'
bump_file "$CARGO" '^version[[:space:]]*=[[:space:]]*"'"$CURRENT"'"'   'version = "'"$NEW"'"'

# Verify all three updated
for f in "$PKG" "$TAURI" "$CARGO"; do
  if ! grep -q "$NEW" "$f"; then
    echo "error: $f was not updated to $NEW"
    exit 1
  fi
done

echo "Refreshing Cargo.lock..."
( cd src-tauri && cargo check --quiet )

FILES_TO_STAGE=("$PKG" "$TAURI" "$CARGO")
[ -f "$LOCK" ] && FILES_TO_STAGE+=("$LOCK")

git add "${FILES_TO_STAGE[@]}"

if git diff --cached --quiet; then
  echo "error: nothing staged — files may already match $NEW"
  exit 1
fi

git commit -m "chore: bump version to ${TAG}"
git tag -a "$TAG" -m "Release ${TAG}"

echo ""
echo "Done. Created commit + tag ${TAG}."
echo "To publish:"
echo "  git push origin $(git rev-parse --abbrev-ref HEAD) --follow-tags"
