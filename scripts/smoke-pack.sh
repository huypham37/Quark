#!/usr/bin/env bash
# Packed-install smoke test.
#
# Packs @quark/runner + quark, installs the tarballs into a throwaway project
# with a strict (isolated) linker, then proves:
#   1. the installed `quark` binary boots (all runtime deps resolve),
#   2. Node can import @quark/runner root and a supported subpath,
#   3. both resolve to ONE runner instance (no bundled duplicate).
#
# Usage: bash scripts/smoke-pack.sh   (PKG_MANAGER=npm to use npm instead)
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
pm=${PKG_MANAGER:-pnpm}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

bun run --cwd "$root" build

app="$tmp/app"
mkdir -p "$app"
runner_tar=$(cd "$root/packages/runner" && npm pack --silent --pack-destination "$app")
quark_tar=$(cd "$root/packages/quark" && npm pack --silent --pack-destination "$app")

# The tarballs satisfy quark's "@quark/runner": "0.1.0" dependency via an
# explicit override, because that version is not (yet) on the registry.
cat > "$app/package.json" <<EOF
{
  "name": "quark-smoke",
  "private": true,
  "dependencies": {
    "@quark/runner": "file:./$runner_tar",
    "quark": "file:./$quark_tar"
  },
  "overrides": { "@quark/runner": "file:./$runner_tar" },
  "pnpm": { "overrides": { "@quark/runner": "file:./$runner_tar" } }
}
EOF

cd "$app"
"$pm" install

./node_modules/.bin/quark --help >/dev/null
echo "quark --help: OK"

node --input-type=module -e '
import { bus as rootBus, createRunner } from "@quark/runner";
import { bus as subBus } from "@quark/runner/session/events";
if (typeof createRunner !== "function" || rootBus !== subBus) {
  throw new Error("@quark/runner root/subpath exports broken or duplicated");
}
console.log("@quark/runner root + subpath import (one instance): OK");
'
