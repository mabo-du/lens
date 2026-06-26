#!/usr/bin/env bash
# verify-export-html.sh - SMOKE_TEST §5.3
set -euo pipefail
FILE="${1:-}"
[ -z "$FILE" ] && { echo "Usage: $0 <.html>"; exit 2; }
[ -f "$FILE" ] || { echo "No such file: $FILE"; exit 2; }
grep -q '<title>' "$FILE" || { echo "FAIL: no <title>"; exit 1; }
grep -q 'Coding density' "$FILE" || { echo "FAIL: no coding density block"; exit 1; }
grep -qE '<link[^>]+href="http' "$FILE" && { echo "FAIL: external stylesheet"; exit 1; }
grep -qE '<script[^>]+src="http' "$FILE" && { echo "FAIL: external script"; exit 1; }
echo "PASS: $FILE"
