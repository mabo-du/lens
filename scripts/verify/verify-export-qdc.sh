#!/usr/bin/env bash
# verify-export-qdc.sh - SMOKE_TEST §5.4
set -euo pipefail
FILE="${1:-}"
[ -z "$FILE" ] && { echo "Usage: $0 <.qdc>"; exit 2; }
[ -f "$FILE" ] || { echo "No such file: $FILE"; exit 2; }
# Round-9 fix: pass the path to python3 via env var so unusual characters
# (single quote, $, space) in the path can't break the python -c literal.
export LENS_VERIFY_XML="$FILE"
xmllint --noout "$FILE" 2>/dev/null \
  || python3 -c "import os, xml.etree.ElementTree as ET; ET.parse(os.environ['LENS_VERIFY_XML']); print('  xml: well-formed (python etree fallback)')" \
  || { echo "FAIL: not well-formed"; exit 1; }
grep -q 'xmlns="urn:QDA-XML:project:1.0"' "$FILE" || { echo "FAIL: missing REFI-QDA namespace"; exit 1; }
grep -q '<CodeBook>' "$FILE" || { echo "FAIL: no <CodeBook> root"; exit 1; }
echo "PASS: $FILE"
