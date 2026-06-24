#!/usr/bin/env bash
# scripts/generate-signing-key.sh <key-path>
#
# Non-interactive Tauri signing-key generator. Pipes a passphrase via stdin so
# the scaffolder works in CI dry-runs where `tauri signer generate`'s
# `rpassword` prompt would hang.
#
# Usage:
#   PASS_PHRASE="<good-passphrase>" scripts/generate-signing-key.sh ~/.tauri/lens.key
#
# Outputs:
#   <key-path>     -- PRIVATE half; paste into TAURI_SIGNING_PRIVATE_KEY
#   <key-path>.pub -- PUBLIC half; paste into bundle.updater.pubkey in
#                     src-tauri/tauri.conf.json
#
# Note: for developer-machine interactive use, run `tauri signer generate`
# directly (no script needed). This wrapper is for CI / dry-run flows only.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <key-path>" >&2
  exit 64
fi

KEY_PATH="$1"
INSTALL_DIR="${TAURI_CLI_INSTALL_DIR:-$HOME/.cargo/bin}"

# Install tauri-cli if not on PATH.
if ! command -v tauri >/dev/null 2>&1; then
  echo "[generate-signing-key] tauri CLI not found; installing to $INSTALL_DIR"
  cargo install tauri-cli --version "^2" --root "$INSTALL_DIR"
  export PATH="$INSTALL_DIR/bin:$PATH"
fi

# Generate a passphrase if not provided. In CI, set PASS_PHRASE explicitly so
# the same passphrase is recoverable across runs.
if [[ -z "${PASS_PHRASE:-}" ]]; then
  PASS_PHRASE="$(openssl rand -base64 32)"
  echo "[generate-signing-key] Generated ephemeral passphrase. STORE THIS NOW:"
  echo "  PASS_PHRASE=$PASS_PHRASE"
fi

# tauri signer generate reads the passphrase twice (new + confirm) via
# rpassword::read_password_from_tty. Pipe both prompts from stdin.
{
  printf '%s\n' "$PASS_PHRASE"
  printf '%s\n' "$PASS_PHRASE"
} | tauri signer generate -w "$KEY_PATH"

echo "[generate-signing-key] key written to $KEY_PATH"
echo "[generate-signing-key] pubkey:"
cat "${KEY_PATH}.pub"
