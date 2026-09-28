#!/bin/sh
# Offline components for documents and diagrams, fetched at build time (and before
# `npm run dev`), never committed:
#   public/drawio/            draw.io web app (viewer + editor)  jgraph/drawio v31.5.3 draw.war
#   src-tauri/resources/bin/  d2 diagram compiler (ELK layout)   d2lang/d2 v0.9.0 (macOS/Linux)
# Downloads are cached in node_modules/.cache/spar-dl. Windows runs diagram tools inside
# WSL, so it gets d2 on first use instead (see src-tauri/src/docs.rs). Needs curl, unzip, tar
# (Git Bash has them on Windows).
set -eu
cd "$(dirname "$0")/.."
ROOT=$(pwd)
DRAWIO_VERSION=31.5.3
D2_VERSION=0.9.0
CACHE=node_modules/.cache/spar-dl
mkdir -p "$CACHE"

# ---- draw.io -----------------------------------------------------------------------------
STAMP="public/drawio/.spar-$DRAWIO_VERSION"
if [ ! -f "$STAMP" ]; then
  WAR="$CACHE/draw-$DRAWIO_VERSION.war"
  if [ ! -f "$WAR" ]; then
    # Reuse the Mac app's build cache when it's next door (same pinned version).
    if [ -f ../spar-app/.build/dl/draw.war ] && [ "$DRAWIO_VERSION" = "31.5.3" ]; then
      cp ../spar-app/.build/dl/draw.war "$WAR"
    else
      echo "  · downloading draw.io $DRAWIO_VERSION"
      curl -fsSL -o "$WAR.part" "https://github.com/jgraph/drawio/releases/download/v$DRAWIO_VERSION/draw.war"
      mv "$WAR.part" "$WAR"
    fi
  fi
  rm -rf public/drawio && mkdir -p public/drawio
  (cd public/drawio && unzip -q -o "$ROOT/$WAR" -x 'WEB-INF/*' 'META-INF/*')
  # Source maps and the service worker aren't needed offline and only bloat the bundle.
  find public/drawio -name '*.map' -delete
  rm -f public/drawio/service-worker.js public/drawio/workbox-*.js
  touch "$STAMP"
  echo "✓ draw.io $DRAWIO_VERSION in public/drawio"
fi

# ---- d2 ----------------------------------------------------------------------------------
case "$(uname -s)" in
  Darwin) OS=macos ;;
  Linux) OS=linux ;;
  *) OS="" ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=amd64 ;;
  *) ARCH="" ;;
esac
BIN=src-tauri/resources/bin
if [ -n "$OS" ] && [ -n "$ARCH" ] && [ ! -x "$BIN/d2" ]; then
  TGZ="$CACHE/d2-$D2_VERSION-$OS-$ARCH.tar.gz"
  if [ ! -f "$TGZ" ]; then
    if [ "$OS-$ARCH" = "macos-arm64" ] && [ -f ../spar-app-old/.build/dl/d2.tar.gz ]; then
      cp ../spar-app-old/.build/dl/d2.tar.gz "$TGZ"
    else
      echo "  · downloading d2 $D2_VERSION ($OS-$ARCH)"
      curl -fsSL -o "$TGZ.part" "https://github.com/d2lang/d2/releases/download/v$D2_VERSION/d2-v$D2_VERSION-$OS-$ARCH.tar.gz"
      mv "$TGZ.part" "$TGZ"
    fi
  fi
  rm -rf "$CACHE/d2" && mkdir -p "$CACHE/d2" "$BIN"
  tar -xzf "$TGZ" -C "$CACHE/d2"
  cp "$(find "$CACHE/d2" -type f -name d2 | head -1)" "$BIN/d2"
  chmod +x "$BIN/d2"
  echo "✓ d2 $D2_VERSION in $BIN"
fi
# ---- micromamba (first-run installer, shipped like the Mac app's, never downloaded at run time)
if [ -n "$OS" ] && [ -n "$ARCH" ] && [ ! -x "$BIN/micromamba" ]; then
  case "$OS-$ARCH" in
    macos-arm64) MPLAT=osx-arm64 ;; macos-amd64) MPLAT=osx-64 ;;
    linux-arm64) MPLAT=linux-aarch64 ;; *) MPLAT=linux-64 ;;
  esac
  MM="$CACHE/micromamba-$MPLAT.tar.bz2"
  if [ ! -f "$MM" ]; then
    if [ "$MPLAT" = "osx-arm64" ] && [ -f ../spar-app-old/.build/dl/micromamba.tar.bz2 ]; then
      cp ../spar-app-old/.build/dl/micromamba.tar.bz2 "$MM"
    else
      echo "  · downloading micromamba ($MPLAT)"
      curl -fsSL -o "$MM.part" "https://micro.mamba.pm/api/micromamba/$MPLAT/latest" && mv "$MM.part" "$MM"
    fi
  fi
  rm -rf "$CACHE/mm" && mkdir -p "$CACHE/mm" "$BIN"
  tar -xjf "$MM" -C "$CACHE/mm" bin/micromamba
  cp "$CACHE/mm/bin/micromamba" "$BIN/micromamba" && chmod +x "$BIN/micromamba"
  echo "✓ micromamba in $BIN"
fi
# Tauri bundles resources/bin; keep the folder present even where d2 isn't shipped.
mkdir -p "$BIN" && touch "$BIN/.keep"
