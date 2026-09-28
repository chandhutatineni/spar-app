#!/bin/sh
# Rebuilds the SPAR CLI wheel shipped inside the app from ../spar on every build (the CLI
# changes far more often than anything else; a stale wheel ships a stale CLI). Keeps the
# existing wheel when ../spar or uv isn't available.
set -eu
cd "$(dirname "$0")/.."
OUT=src-tauri/resources/wheels
[ -d ../spar ] && command -v uv >/dev/null 2>&1 || { echo "  (no ../spar or uv; keeping $(ls $OUT 2>/dev/null))"; exit 0; }
TMP=$(mktemp -d)
if (cd ../spar && uv build --wheel --out-dir "$TMP" >/dev/null 2>&1); then
  rm -f "$OUT"/*.whl && mkdir -p "$OUT" && cp "$TMP"/*.whl "$OUT"/
  echo "  · SPAR wheel: $(ls $OUT)"
else
  echo "  (could not build the SPAR wheel; keeping $(ls $OUT 2>/dev/null))"
fi
rm -rf "$TMP"
