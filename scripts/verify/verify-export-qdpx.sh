#!/usr/bin/env bash
# verify-export-qdpx.sh - SMOKE_TEST §5.1
set -euo pipefail
FILE="${1:-}"
[ -z "$FILE" ] && { echo "Usage: $0 <.qdpx>"; exit 2; }
[ -f "$FILE" ] || { echo "No such file: $FILE"; exit 2; }
unzip -l "$FILE" | grep -q "project.qde" || { echo "FAIL: project.qde missing"; exit 1; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
unzip -p "$FILE" project.qde > "$TMP/qde.xml"
# Round-9 fix: pass the path to python3 via env var so unusual characters
# (single quote, $, space) in the path can't break the python -c literal.
export LENS_VERIFY_XML="$TMP/qde.xml"
xmllint --noout "$TMP/qde.xml" 2>/dev/null \
  || python3 -c "import os, xml.etree.ElementTree as ET; ET.parse(os.environ['LENS_VERIFY_XML']); print('  xml: well-formed (python etree fallback)')" \
  || { echo "FAIL: project.qde not well-formed"; exit 1; }
grep -q 'xmlns="urn:QDA-XML:project:1.0"' "$TMP/qde.xml" || { echo "FAIL: missing REFI-QDA namespace"; exit 1; }
GUIDS=$(grep -o 'guid="[^"]*"' "$TMP/qde.xml" | grep -v 'guid=""' | wc -l)
[ "$GUIDS" -ge 1 ] || { echo "FAIL: no populated <User guid=...>"; exit 1; }
echo "PASS: $FILE"
