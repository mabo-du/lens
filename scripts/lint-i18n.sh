#!/usr/bin/env bash
# lint-i18n.sh — CI gate: every msgid in en/messages.po must exist
# in every non-English .po file. Missing keys fail the build.
#
# Rationale: lingui extract --strict (Phase 9a once LinguiJS is
# installed) will replace this script, but the contract is the same:
# no PR may introduce a translation key without a corresponding entry
# in all locale files.
set -euo pipefail

LOCALES_DIR="src/locales"
EN_PO="$LOCALES_DIR/en/messages.po"

if [[ ! -f "$EN_PO" ]]; then
  echo "SKIP: no $EN_PO found — nothing to lint."
  exit 0
fi

# Extract non-empty msgid values from the master English file.
mapfile -t EN_IDS < <(grep -Po '^msgid "\K[^"]+' "$EN_PO" | grep -v '^$')

FAILED=0
for po in "$LOCALES_DIR"/*/messages.po; do
  lang="$(basename "$(dirname "$po")")"
  if [[ "$lang" == "en" ]]; then continue; fi
  echo "  checking $lang ($(basename "$(dirname "$po")"))..."

  for id in "${EN_IDS[@]}"; do
    if ! grep -qF "msgid \"$id\"" "$po"; then
      echo "    MISSING: $id"
      FAILED=1
    fi
  done
done

if [[ $FAILED -eq 1 ]]; then
  echo ""
  echo "lint-i18n: ERROR — keys missing from non-English .po files."
  echo "Add the missing msgid blocks (with a msgstr, even if untranslated)"
  echo "and re-run:  bash scripts/lint-i18n.sh"
  exit 1
fi

echo "lint-i18n: OK — all msgid keys present in all locale files."
