#!/bin/bash
set -e
cd "$(dirname "$0")/../.."
bun build --compile src/web/index.ts --outfile quark-desktop/src-tauri/binaries/quark-server-aarch64-apple-darwin
chmod +x quark-desktop/src-tauri/binaries/quark-server-aarch64-apple-darwin
echo "Sidecar built: quark-desktop/src-tauri/binaries/quark-server-aarch64-apple-darwin"
