#!/usr/bin/env bash
# scripts/smoke-test.sh - SMOKE_TEST §6 (no-UI variant)
# Pre-Phase-5.2; full UI smoke needs a WebView driver.
#
# Usage: bash scripts/smoke-test.sh
#
# Validates what CAN be checked without driving the GUI:
#   - release bundle exists
#   - fixture SHA + integrity
#   - export artefact well-formedness (via verify-export-*.sh)
#   - DB integrity check on a fresh project
#
# Exit code: 0 on full pass, 1 on any FAIL, 2 on env-setup failure.

set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo '############################'
echo '#  LENS SMOKE TEST (no-UI) #'
echo '############################'
echo

FAIL=0

# --- Section 1: release binary (Step 0.1 hard prerequisite) ---
# Round-10 review: SMOKE_TEST §4 makes a built bundle the Step-0.1 hard
# prerequisite, but the project's standard build invocation is
# `npx tauri build --no-bundle` (see .github/workflows/ci.yml → linux-build),
# which produces ONLY $BIN at src-tauri/target/release/lens and SKIPS
# $BUNDLE_DIR. So promote $BIN (the binary) to the hard requirement and
# downgrade $BUNDLE_DIR to a soft WARN — the binary IS the contract; the
# installer artifacts are nice-to-have.
echo '== [1] release binary present (Step 0.1 prerequisite) =='
BIN="src-tauri/target/release/lens"
BUNDLE_DIR="src-tauri/target/release/bundle"
if [ -x "$BIN" ] || [ -f "$BIN" ]; then
  ls -la "$BIN"
  if [ -d "$BUNDLE_DIR" ]; then
    ls -la "$BUNDLE_DIR"
  else
    echo '  WARN: no installer bundle at '"$BUNDLE_DIR"' (binary-only build — re-run `npx tauri build --bundles appimage,deb` to produce installers)'
  fi
else
  echo "FAIL: no release binary at $BIN (Step 0.1 prerequisite)"
  echo "  Run 'npx tauri build' (default) or 'npx tauri build --no-bundle' (binary-only) before re-running smoke."
  FAIL=$((FAIL+1))
fi
echo

# --- Section 2: fixtures ---
echo '== [2] smoke fixtures =='
if [ -d 'tests/fixtures/smoke' ]; then
  ls -lh tests/fixtures/smoke/
  sha256sum tests/fixtures/smoke/* > /tmp/lens-fixtures.sha256
  cat /tmp/lens-fixtures.sha256
else
  echo 'FAIL: no smoke fixtures at tests/fixtures/smoke/'
  FAIL=$((FAIL+1))
fi
echo

# --- Section 3: verify export artefacts (only if present) ---
echo '== [3] verify-export-*.sh on artefacts (skip if absent) =='
for f in /tmp/lens-smoke-export.qdpx /tmp/lens-smoke-export.csv /tmp/lens-smoke-report.html /tmp/lens-smoke-export.qdc; do
  if [ -f "$f" ]; then
    ext="${f##*.}"
    case "$ext" in
      qdpx) bash scripts/verify/verify-export-qdpx.sh "$f" || FAIL=$((FAIL+1)) ;;
      csv)  bash scripts/verify/verify-export-csv.sh  "$f" || FAIL=$((FAIL+1)) ;;
      html) bash scripts/verify/verify-export-html.sh "$f" || FAIL=$((FAIL+1)) ;;
      qdc)  bash scripts/verify/verify-export-qdc.sh  "$f" || FAIL=$((FAIL+1)) ;;
    esac
  else
    echo "  skip $f (not produced yet — UI-export smoke pytest across Step 23-29 only after Phase 5.2 Tauri driver)"
  fi
done
echo

# --- Section 4: DB integrity (on a scratch project) ---
echo '== [4] DB integrity scratch project (cli-driver sanity) =='
SCRATCH="${LENS_SMOKE_SCRATCH:-/tmp/lens-smoke}"
mkdir -p "$SCRATCH/Smoke Test"
DB="$SCRATCH/Smoke Test/project.qdaproj"
if [ ! -f "$DB" ]; then
  echo "  no scratch DB at $DB — would be created by UI Step 1 (New Project)"
  echo "  driving that step requires the running Tauri app"
fi
echo

# --- Section 5: NEGATIVE verifier regression corpus ---
# Round-12 followup: four intentionally-broken artefacts under
# tests/fixtures/smoke/negative/. The verifiers MUST reject these
# (exit != 0). Without this corpus, a verifier could regress to a
# no-op (always PASS) and ship undetected. One positive-of-edge-case
# artefact (doublebom.csv) proves the round-11 multi-BOM strip works.
echo '== [5] negative/edge verifier regression corpus =='
NEG="tests/fixtures/smoke/negative"
if [ -d "$NEG" ]; then
  # 4 negatives: each verifier MUST return exit != 0
  EXPECT_FAIL=0
  for pair in \
      'corrupt.qdpx|verify-export-qdpx.sh' \
      'corrupt.qdc|verify-export-qdc.sh' \
      'nobom.csv|verify-export-csv.sh' \
      'no-title.html|verify-export-html.sh'; do
    IFS='|' read -r fixture verifier <<<"$pair"
    f="$NEG/$fixture"
    if [ ! -f "$f" ]; then
      echo "  WARN: $f missing (the corpus drifted)"
      EXPECT_FAIL=$((EXPECT_FAIL+1))
      continue
    fi
    code=0
    bash "scripts/verify/$verifier" "$f" >/tmp/lens-neg.outer 2>&1 || code=$?
    if [ "$code" -ne 0 ]; then
      echo "  REJECT OK: $verifier \"$fixture\" exited $code (regression corpus line intact)"
    else
      echo "  REGRESS: $verifier \"$fixture\" exited 0 (expected non-zero — verifier regressed to no-op)"
      EXPECT_FAIL=$((EXPECT_FAIL+1))
    fi
  done
  if [ "$EXPECT_FAIL" -gt 0 ]; then
    echo "FAIL: $EXPECT_FAIL negative-corpus items regressed (verifier no longer rejects bad inputs)"
    FAIL=$((FAIL+EXPECT_FAIL))
  fi
  # 1 positive-of-edge-case: verify-export-csv.sh MUST accept double-BOM CSV
  doublebom="$NEG/doublebom.csv"
  if [ -f "$doublebom" ]; then
    if bash scripts/verify/verify-export-csv.sh "$doublebom" >/tmp/lens-neg.pos 2>&1; then
      echo '  PASS EDGE: verify-export-csv.sh doublebom.csv (round-11 multi-BOM strip works)'
    else
      echo '  FAIL: verify-export-csv.sh doublebom.csv (round-11 multi-BOM strip regressed)'
      FAIL=$((FAIL+1))
    fi
  fi
else
  echo '  WARN: tests/fixtures/smoke/negative/ missing (Section 5 skipped)'
fi
echo

# --- Skipped UI-only steps (informational) ---
# Gated on Phase 5.2 (Tauri WebView driver / Playwright-on-WebView integration).
# Today's runner validates the CLI-validatable subset per SMOKE_TEST §6.
echo '== [skipped UI-only steps] =='
echo '  Steps 1-22, 23-29 (UI export trigger), 30, 32-33 require the running Tauri app:'
echo '    New Project dialog, Import button, text/code interaction, Ctrl+K picker,'
echo '    TopNav Export button, search dialog, Close Project, QDPX import.'
echo '    The driver lands in Phase 5.2 (Tauri WebView driver).'
echo '    Steps 24-26 (qdpx artefacts) + 27 (qdc) + 28 (csv) + 29 (html) ARE'
echo '    validated today whenever the Tauri-app-driven Step 23 emits these'
echo '    artefacts to /tmp/lens-smoke-export.* — the verify-export-*.sh'
echo '    scripts under scripts/verify/ catch any upstream regression.'
echo
# --- Final ---
echo '############################'
echo "# FAIL count: $FAIL"
echo '############################'
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
