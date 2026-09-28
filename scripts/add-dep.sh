#!/bin/sh
# Serialised dependency installs for parallel work: scripts/add-dep.sh npm|npm-dev|cargo <names…>
set -e
cd "$(dirname "$0")/.."
kind=$1; shift
LOCK=.dep-lock
# A lock older than 10 minutes belongs to an install that died; take it over.
until mkdir "$LOCK" 2>/dev/null; do
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null; fi
  sleep 1
done
trap 'rmdir "$LOCK"' EXIT
case $kind in
  npm) npm install --no-audit --no-fund "$@" ;;
  npm-dev) npm install --no-audit --no-fund -D "$@" ;;
  cargo) cd src-tauri && PATH="$HOME/.cargo/bin:$PATH" cargo add "$@" ;;
  *) echo "usage: $0 npm|npm-dev|cargo <names…>"; exit 2 ;;
esac
