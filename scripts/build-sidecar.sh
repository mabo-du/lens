#!/usr/bin/env bash
set -e

SIDECAR_DIR="src-tauri/sidecars/pdfplumber"
VENV_DIR="$SIDECAR_DIR/.venv"

echo "Creating Python virtual environment..."
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"

echo "Installing pdfplumber and PyInstaller..."
pip install --quiet pdfplumber pyinstaller

echo "Compiling sidecar binary..."
cd "$SIDECAR_DIR"
pyinstaller --onefile --name "pdfplumber-x86_64-unknown-linux-gnu" extract.py

echo "Copying binary to sidecars directory..."
cp dist/pdfplumber-x86_64-unknown-linux-gnu ..

deactivate
echo "Done."
