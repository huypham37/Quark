#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
context="$(mktemp -d "$root/.container-build-context.XXXXXX")"
trap 'rm -rf "$context"' EXIT

rsync -a \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='.DS_Store' \
  --exclude='.quark/' \
  --exclude='.ruff_cache/' \
  --exclude='.container-build-context.*/' \
  --exclude='logs/' \
  --exclude='test-results/' \
  "$root/" "$context/"

# Apple container 1.3.1 can fail to package contexts carrying macOS metadata.
xattr -cr "$context"

container build --tag quark-local "$context"
