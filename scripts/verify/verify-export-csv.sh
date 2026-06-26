#!/usr/bin/env bash
# verify-export-csv.sh - SMOKE_TEST §5.2
set -euo pipefail
FILE="${1:-}"
[ -z "$FILE" ] && { echo "Usage: $0 <.csv>"; exit 2; }
[ -f "$FILE" ] || { echo "No such file: $FILE"; exit 2; }
# UTF-8 BOM (xxd is the preferred hex dumper; od is the POSIX fallback for minimal containers)
if command -v xxd >/dev/null 2>&1; then
  head -c 3 "$FILE" | xxd | grep -q 'efbb bf' || { echo "FAIL: missing UTF-8 BOM"; exit 1; }
else
  BOM=$(head -c 3 "$FILE" | od -An -tx1 | tr -d ' \n')
  [ "$BOM" = 'efbbbf' ] || { echo "FAIL: missing UTF-8 BOM (posix od fallback)"; exit 1; }
fi
EXPECTED="document_title,code_name,code_path,start_char,end_char,segment_text,context_before,context_after,memo,coder,created_at"
# Round-10 fix: strip possibly-multiple leading UTF-8 BOMs (EF BB BF sequences)
# from the header before compare. The 3-byte BOM presence is independently
# verified above (BOM check), so the file IS UTF-8-with-BOM; the strip
# here is purely for accurate byte-equal compare against the literal header.
HEADER=$(head -1 "$FILE" | tr -d '\r' | sed '1s/^\xef\xbb\xbf\+//')
[ "$HEADER" = "$EXPECTED" ] || { echo "FAIL: header does not match expected"; echo "  Got:      $HEADER"; echo "  Expected: $EXPECTED"; exit 1; }
echo "PASS: $FILE"
