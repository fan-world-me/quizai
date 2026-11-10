#!/usr/bin/env bash
# Quiz AI Analyzer — build & package script for Linux / macOS / WSL
# Linux/macOS equivalent of package-extensions.ps1
#
# Usage:
#   chmod +x package-extensions.sh
#   ./package-extensions.sh
#
# Requires: bash, cp, and either `zip` or `python3` (used as a fallback for zipping)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$ROOT/src"
MANIFESTS="$ROOT/manifests"
DIST="$ROOT/dist"

if [ ! -f "$SRC/auth.json" ]; then
  echo "[!] src/auth.json not found — copy src/auth.example.json to src/auth.json and add your keys."
  echo "    Building anyway (zip packages never include auth.json)."
fi

zip_dir() {
  # zip_dir <source-dir> <output-zip>
  local dir="$1" out="$2"
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
            z.write(p, os.path.relpath(p, src))
PY
  else
    echo "[x] Neither 'zip' nor 'python3' found. Install one of them (e.g. sudo apt install zip)." >&2
    exit 1
  fi
}

rm -rf "$DIST"
mkdir -p "$DIST"

for browser in chrome firefox; do
  echo "==> Building $browser"
  unpacked="$DIST/$browser-unpacked"
  mkdir -p "$unpacked"

  # 1. copy sources + browser-specific manifest
  cp -r "$SRC"/. "$unpacked"/
  cp "$MANIFESTS/$browser/manifest.json" "$unpacked/manifest.json"

  # 2. zip package without auth.json
  tmp="$(mktemp -d)"
  cp -r "$unpacked"/. "$tmp"/
  rm -f "$tmp/auth.json"
  zip_dir "$tmp" "$DIST/quiz-ai-$browser.zip"
  rm -rf "$tmp"
done

echo
echo "Done. Output in dist/:"
ls -1 "$DIST"
