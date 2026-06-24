#!/usr/bin/env bash
#
# scripts/set-release-secrets.sh -- wire the GitHub Actions release secrets
# needed to ship signed LENS releases.
#
# What this script does automatically:
#   - TAURI_SIGNING_PRIVATE_KEY              (from ~/.tauri/lens.key)
#   - TAURI_SIGNING_PRIVATE_KEY_PASSWORD     (from ~/.tauri/lens.key.passphrase)
#
# What this script CANNOT do automatically (requires Mac Keychain access):
#   - APPLE_CERTIFICATE / APPLE_CERTIFICATE_PASSWORD
#   - APPLE_SIGNING_IDENTITY / APPLE_ID / APPLE_PASSWORD
# See docs/onboarding-apple-developer.md §5-6 for the Apple-side flow.
#
# Re-runnable: `gh secret set` is idempotent.
#
# Usage:
#   ./scripts/set-release-secrets.sh                       # default repo mabo-du/lens
#   LENS_REPO=mabo-du/lens ./scripts/set-release-secrets.sh
#   TAURI_KEY_FILE=/path/key LENS_REPO=owner/repo ./scripts/set-release-secrets.sh

set -euo pipefail

REPO="${LENS_REPO:-mabo-du/lens}"
KEY_FILE="${TAURI_KEY_FILE:-$HOME/.tauri/lens.key}"
PASSPHRASE_FILE="${TAURI_PASSWORD_FILE:-$HOME/.tauri/lens.key.passphrase}"

echo "=== Wiring release secrets for $REPO ==="
gh auth status --hostname github.com >/dev/null 2>&1 || {
  echo "error: gh CLI not authenticated; run: gh auth login"
  exit 1
}

if [ -r "$KEY_FILE" ]; then
  gh secret set TAURI_SIGNING_PRIVATE_KEY --repo "$REPO" < "$KEY_FILE"
  echo "  TAURI_SIGNING_PRIVATE_KEY set from $KEY_FILE ($(wc -c < "$KEY_FILE") bytes)"
else
  echo "  (skipped: $KEY_FILE not readable)"
  echo "    To set manually: gh secret set TAURI_SIGNING_PRIVATE_KEY --repo $REPO < $KEY_FILE"
  echo "    Or override the path: TAURI_KEY_FILE=/abs/path/to/key $0"
fi

if [ -r "$PASSPHRASE_FILE" ]; then
  gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo "$REPO" < "$PASSPHRASE_FILE"
  echo "  TAURI_SIGNING_PRIVATE_KEY_PASSWORD set from $PASSPHRASE_FILE"
else
  echo "  (skipped: $PASSPHRASE_FILE not readable)"
  echo "    Passphrase fallback paths searched: TAURI_PASSWORD_FILE env,"
  echo "    default $PASSPHRASE_FILE. To set manually:"
  echo "      gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo $REPO"
  echo "    (then paste the passphrase on stdin)"
  echo "    Or override the path: TAURI_PASSWORD_FILE=/abs/path/to/pp $0"
fi

cat <<'RUNBOOK'

============================== Apple-side runbook ==============================

These five secrets are not derivable from local files; the .p12 comes from
your Mac Keychain (see docs/onboarding-apple-developer.md §4 for the export
flow). Each is set with the same pattern:

  gh secret set <NAME> --repo mabo-du/lens
  #   paste / pipe the value on stdin
  #   (base64 -w 0 lens-dev-id.p12 for APPLE_CERTIFICATE)

  APPLE_CERTIFICATE               base64 of lens-dev-id.p12 (single line)
  APPLE_CERTIFICATE_PASSWORD      the .p12 export password
  APPLE_SIGNING_IDENTITY          e.g. "Developer ID Application: Your Name (TEAMID1234)"
  APPLE_ID                        your Apple Developer Program primary email
  APPLE_PASSWORD                  an app-specific password (NOT your Apple ID password)
                                  generated at https://appleid.apple.com

After all seven are in place, validate with:

  gh secret list --repo mabo-du/lens

================================================================================
RUNBOOK

echo
echo "Validate (after setting Apple secrets): gh secret list --repo $REPO"
