#!/usr/bin/env bash
# Pinned dependencies come from src-tauri/sidecars/pdfplumber/requirements.txt
# so the compiled sidecar and the build.rs PDFPLUMBER_VERSION stamp agree on
# the exact pdfplumber version. Keep the file in sync when bumping.
set -e

SIDECAR_DIR="src-tauri/sidecars/pdfplumber"
VENV_DIR="$SIDECAR_DIR/.venv"

echo "Creating Python virtual environment..."
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"

echo "Installing pinned pdfplumber + PyInstaller from $SIDECAR_DIR/requirements.txt..."
pip install --quiet -r "$SIDECAR_DIR/requirements.txt" pyinstaller

echo "Compiling sidecar binary..."
cd "$SIDECAR_DIR"
pyinstaller --onefile --name "pdfplumber-x86_64-unknown-linux-gnu" extract.py

echo "Copying binary to sidecars directory..."
cp dist/pdfplumber-x86_64-unknown-linux-gnu ..

deactivate
echo "Done."
