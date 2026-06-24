#!/usr/bin/env bash
# scripts/release-dry-run.sh
#
# Replicates the CI release pipeline locally WITHOUT publishing:
#   1. Install Rust + Node toolchains (assumed present)
#   2. Build the pdfplumber sidecar (BLOCKING; was previously continue-on-error)
#   3. Run tsc, vitest, cargo test
#   4. Build the Tauri installer for the current host platform
#
# Skipped (this is a dry-run): code-signing uploads, softprops/action-gh-release.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "[release-dry-run] starting on $(uname -s)/$(uname -m) at $(date)"
echo "[release-dry-run] root: $ROOT_DIR"

cd "$ROOT_DIR"

echo "[release-dry-run] step 1/4: type-check + unit tests"
npx tsc --noEmit
echo "  - tsc: clean"
npx vitest run
(cd src-tauri && cargo test)

echo "[release-dry-run] step 2/4: build pdfplumber sidecar (BLOCKING)"
"$ROOT_DIR/scripts/build-sidecar.sh"

echo "[release-dry-run] step 3/4: build front-end"
npm run build

echo "[release-dry-run] step 4/4: build Tauri installer for current host"
# `--bundles app` produces only the host-appropriate installer (.dmg on Mac,
# .msi on Windows, .deb/.AppImage on Linux). This exercises the full Tauri
# bundling pipeline (incl. signing if `bundle.updater.pubkey` is set).
(cd src-tauri && npx tauri build --bundles app --no-bundle)

echo "[release-dry-run] DONE"
echo "[release-dry-run] inspect artefacts under src-tauri/target/release/bundle/"
