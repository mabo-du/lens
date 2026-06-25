#!/usr/bin/env bash
# Pinned dependencies come from src-tauri/sidecars/pdfplumber/requirements.txt
# so the compiled sidecar and the build.rs PDFPLUMBER_VERSION stamp agree on
# the exact pdfplumber version. Keep the file in sync when bumping.
#
# FU1 cross-platform build (release.yml run 28201896992 followup): previously
# hardcoded both the Python interpreter (`python3`, missing on Windows under
# Git Bash even after `choco install python3 -y` because PATH wasn't refreshed
# for the current shell) and the binary name (`pdfplumber-x86_64-unknown-linux-gnu`,
# which only matched the Linux matrix entry — Tauri's `externalBin` lookup
# expects `pdfplumber-<TARGET>` on every host triple). Three changes here:
#   1. Accept the target triple via $1 (called from release.yml with
#      `${{ matrix.target }}`; defaults to linux-gnu so the bare
#      `bash scripts/build-sidecar.sh` invocation in ci.yml::linux-build still works).
#   2. Probe for `python3` first, fall back to `python` (`actions/setup-python@v5`
#      on Windows runners installs `python.exe`, not `python3.exe`).
#   3. Source the venv's activate script from `Scripts/activate` on Windows or
#      `bin/activate` on unix so the same script works under Git Bash.
set -e

SIDECAR_DIR="src-tauri/sidecars/pdfplumber"
VENV_DIR="$SIDECAR_DIR/.venv"
TARGET=${1:-x86_64-unknown-linux-gnu}

# Probe `python3` first because the legacy `linux-build:` CI job that does NOT
# run `actions/setup-python` is on a pre-installed Python 3 (no `python`
# alias); on Windows `setup-python@v5` provides `python`, so probe `python`
# only as a fallback. Either way the result is recorded in $PYTHON_CMD.
PYTHON_CMD="python3"
if ! command -v python3 >/dev/null 2>&1; then
    if command -v python >/dev/null 2>&1; then
        PYTHON_CMD="python"
    else
        echo "::error::Neither 'python3' nor 'python' is on PATH on this runner."
        exit 1
    fi
fi

echo "Creating Python virtual environment at $VENV_DIR (using $PYTHON_CMD, target=$TARGET)..."
"$PYTHON_CMD" -m venv "$VENV_DIR"

# Windows venv layout is `.venv/Scripts/activate`; unix is `.venv/bin/activate`.
# Source whichever exists so the script is portable across both.
# shellcheck disable=SC1091
if [ -f "$VENV_DIR/Scripts/activate" ]; then
    # shellcheck disable=SC1091
    source "$VENV_DIR/Scripts/activate"
else
    source "$VENV_DIR/bin/activate"
fi

echo "Installing pinned pdfplumber + PyInstaller from $SIDECAR_DIR/requirements.txt..."
pip install --quiet --upgrade pip
pip install --quiet -r "$SIDECAR_DIR/requirements.txt" pyinstaller

echo "Compiling sidecar binary for target $TARGET..."
cd "$SIDECAR_DIR"
# Round-6 review item F: `--clean` wipes dist/ + build/ from any prior
# pyinstaller invocation on this runner so a stale `dist/*.spec` (or any
# other prefix-matched sibling from a previous partial run) cannot bleed
# into the explicit-extension copy step below — the sidecars directory
# ONLY ever receives the single binary Tauri's externalBin expects.
pyinstaller --clean --onefile --name "pdfplumber-$TARGET" extract.py
# Round-7 review item B: explicitly delete the sidecar-dir `.spec` file
# that PyInstaller writes next to extract.py. `--clean` only wipes
# dist/ + build/ — NOT the `.spec` dropped beside the source entry —
# and across re-builds on the same runner the macOS/Windows matrix
# entries would accumulate `pdfplumber-*.spec` next to the binary.
# Tauri's `externalBin` glob (default `["sidecars/*"]`) picks that
# stray spec file up and breaks the downstream Tauri bundler.
rm -f "$SIDECAR_DIR/pdfplumber-$TARGET.spec"

echo "Copying binary to sidecars directory..."
# Round-6 review item F + round-7 review item C: PyInstaller appends
# `.exe` only on Windows; on macOS/Linux the binary is bare. Brace
# expansion `pdfplumber-$TARGET{,.exe}` lists both candidate names;
# `2>/dev/null || true` swallows cp's missing-source error so the
# script keeps running when only one variant exists (the same
# silent-fallback contract the prior `if/else` provided, but in
# one line). This is safe here because Tauri's externalBin only
# ever globs the single binary Tauri's externalBin expects — a
# stray non-existent cp source is harmless noise, not a build failure.
cp "dist/pdfplumber-$TARGET"{,.exe} .. 2>/dev/null || true

deactivate
echo "Done."
