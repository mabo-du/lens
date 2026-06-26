#!/usr/bin/env bash
# verify-export-html.sh - SMOKE_TEST §5.3
#
# Round-15 template-copy safety: when copy-pasting this script as a
# template for verify-export-{pdf,tex,qdc}.sh against analogous HTML
# elements (e.g. <header>, <footer>, <CodeBook>), preserve the precision
# rationale below. The naive `grep -q '<element>'` matches `<element-block>`
# (or any 7-char prefix matching `<element`) with equal weight — any
# document whose pseudo-tag matches the literal substring WILL satisfy the
# verifier even when the real element is absent. Use the ERE form
# `grep -Eq '<element(>|/>|[[:space:]])'` so the script only matches
# actual element-openers (regular `>`, self-closing `/>`, or attribute
# whitespace), not arbitrary prefix-tag fictions. Round-14 introduced
# the precision fix here; copy-paste without re-applying will regress.
set -euo pipefail
FILE="${1:-}"
[ -z "$FILE" ] && { echo "Usage: $0 <.html>"; exit 2; }
[ -f "$FILE" ] || { echo "No such file: $FILE"; exit 2; }
# Round-14: BRE `<title>` substring was over-eager — matched `<title-block>`
# too. Tighten to the `<title>` element opener or whitespace variant.
grep -Eq '<title(>|/>|[[:space:]])' "$FILE" || { echo "FAIL: no <title>"; exit 1; }
grep -q 'Coding density' "$FILE" || { echo "FAIL: no coding density block"; exit 1; }
grep -qE '<link[^>]+href="http' "$FILE" && { echo "FAIL: external stylesheet"; exit 1; }
grep -qE '<script[^>]+src="http' "$FILE" && { echo "FAIL: external script"; exit 1; }
echo "PASS: $FILE"
