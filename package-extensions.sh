#!/usr/bin/env bash
# Quiz AI Analyzer — build & package script for Linux / macOS / WSL
# Linux/macOS equivalent of package-extensions.ps1
#
# Creates:
# - dist/chrome-unpacked
# - dist/firefox-unpacked
# - dist/quiz-ai-chrome.zip
# - dist/quiz-ai-firefox.zip
# - dist/quiz-ai-firefox.xpi   (copy of the Firefox zip; signing is a STUB for now)
#
# Usage:
#   chmod +x package-extensions.sh
#   ./package-extensions.sh
#
# Requires: bash and either `zip` or `python3` (fallback for zipping).
# Zip entries always use forward slashes (bg/models.js), so browsers read folders correctly.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$PROJECT_DIR/src"
DIST_DIR="$PROJECT_DIR/dist"
CHROME_MANIFEST="$PROJECT_DIR/manifests/chrome/manifest.json"
FIREFOX_MANIFEST="$PROJECT_DIR/manifests/firefox/manifest.json"
CHROME_UNPACKED="$DIST_DIR/chrome-unpacked"
FIREFOX_UNPACKED="$DIST_DIR/firefox-unpacked"
CHROME_ZIP="$DIST_DIR/quiz-ai-chrome.zip"
FIREFOX_ZIP="$DIST_DIR/quiz-ai-firefox.zip"
FIREFOX_XPI="$DIST_DIR/quiz-ai-firefox.xpi"

fail() { echo "Packaging failed: $1" >&2; exit 2; }

copy_build_files() {
  # copy_build_files <manifest> <target-dir>
  local manifest="$1" target="$2"
  rm -rf "$target"
  mkdir -p "$target"
  cp -a "$SRC_DIR"/. "$target"/
  cp -f "$manifest" "$target/manifest.json"
}

new_zip_archive() {
  # new_zip_archive <source-dir> <zip-path>
  local dir="$1" out="$2"
  rm -f "$out"
  if command -v zip >/dev/null 2>&1; then
    (cd "$dir" && zip -qr "$out" .)
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$dir" "$out" <<'PY'
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(src):
        for f in files:
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, src).replace(os.sep, "/"))
PY
  else
    fail "neither 'zip' nor 'python3' found (try: sudo apt install zip)"
  fi
}

invoke_firefox_sign() {
  # STUB: real signing is not wired up yet — just copies zip -> xpi (UNSIGNED).
  # Later replace with e.g.:
  #   web-ext sign --source-dir "$FIREFOX_UNPACKED" --artifacts-dir "$DIST_DIR" --channel unlisted \
  #     --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET"
  echo "Signing Firefox build: STUB (not signed, copying zip -> xpi)"
  cp -f "$FIREFOX_ZIP" "$FIREFOX_XPI"
}

[ -d "$SRC_DIR" ]          || fail "Missing source folder: $SRC_DIR"
[ -f "$CHROME_MANIFEST" ]  || fail "Missing Chrome manifest: $CHROME_MANIFEST"
[ -f "$FIREFOX_MANIFEST" ] || fail "Missing Firefox manifest: $FIREFOX_MANIFEST"

mkdir -p "$DIST_DIR"
rm -f "$CHROME_ZIP" "$FIREFOX_ZIP" "$FIREFOX_XPI"

echo "Preparing unpacked Chrome extension..."
copy_build_files "$CHROME_MANIFEST" "$CHROME_UNPACKED"

echo "Preparing unpacked Firefox extension..."
copy_build_files "$FIREFOX_MANIFEST" "$FIREFOX_UNPACKED"

echo "Creating $CHROME_ZIP (with auth.json)"
new_zip_archive "$CHROME_UNPACKED" "$CHROME_ZIP"

echo "Creating $FIREFOX_ZIP (with auth.json)"
new_zip_archive "$FIREFOX_UNPACKED" "$FIREFOX_ZIP"

echo "Creating $FIREFOX_XPI"
invoke_firefox_sign

echo "Packaging complete."
echo "Chrome folder:  $CHROME_UNPACKED"
echo "Firefox folder: $FIREFOX_UNPACKED"
echo "Chrome zip:     $CHROME_ZIP"
echo "Firefox zip:    $FIREFOX_ZIP"
echo "Firefox xpi:    $FIREFOX_XPI (unsigned stub)"
