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
# Tauri 2.x --bundles accepts platform-specific target lists. Passing an
# unknown bundle identifier ("app") fails with `invalid value 'app' for
# '--bundles'` at parse time. Pick the host-appropriate targets so the
# bundling code path (incl. signing if `plugins.updater.pubkey` is set)
# actually exercises the right targets. Pair with --no-bundle so we
# skip writing installer artefacts (this is a dry-run, not a real build).
# Keep MSYS* in the glob: standalone MSYS2 installs (installed via
# msys2.org installer, no MINGW overlay) emit `MSYS_NT-...` from
# `uname -s`, which `MINGW*` does NOT match. Two MSYS-family bundles
# coexist; keeping both globs is harmless redundancy on overlapped hosts.
case "$(uname -s 2>/dev/null)" in
  Darwin|darwin)      BUNDLES="app,dmg" ;;
  Linux|linux)        BUNDLES="deb,rpm,appimage" ;;
  CYGWIN*|MINGW*|MSYS*) BUNDLES="msi,nsis" ;;
  *)
    echo "[release-dry-run] unsupported host: $(uname -s); skipping step 4" >&2
    ;;
esac
if [[ -n "${BUNDLES:-}" ]]; then
  (cd src-tauri && npx tauri build --bundles "$BUNDLES" --no-bundle)
fi

echo "[release-dry-run] DONE"
echo "[release-dry-run] inspect artefacts under src-tauri/target/release/bundle/"
