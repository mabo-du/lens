# LENS — Manual Smoke Test

> **Purpose:** A pass/fail checklist that proves the LENS v1 surface works end-to-end as a coherent user flow — not just at the unit/integration level. Each step ties back to a task in [`ACTION_PLAN.md`](../ACTION_PLAN.md).
>
> **Audience:** A developer or QA reviewer with the built app bundle in hand. Also runnable by an AI agent with shell access (see [§ 6 CI variant](#6-ci-variant--smoke-testsh)).
>
> **When to run this:**
> - After every Phase merge of `ACTION_PLAN.md` (Phase 1 → 2 → 3).
> - Before tagging any release candidate (`v*` tag push).
> - After upgrading `tauri`, `prosemirror-*`, `sqlx`, or `@tauri-apps/*`.
> - After any change to the SQLite schema, the migration runner, or the closure-table logic.

---

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| A built bundle | Run `cargo tauri build` (release) once; the bundle lives in `src-tauri/target/release/bundle/<platform>/` (or `/target/<profile>/...` for dev convenience) |
| A clean scratch directory | Linux/macOS: `/tmp/lens-smoke/`. Windows: `%TEMP%\lens-smoke`. ~500 MB free. |
| Shell tools available | `unzip`, `xmllint` (or `libxml2-utils`), `head`, `python3` |
| Tauri devtools | Optional but recommended; the app's WebView devtools provide extra visibility |

> If `xmllint` is unavailable, use `python3 -c "import xml.etree.ElementTree as ET; ET.parse('…')"` as a substitute.

---

## 2. Fixtures

Place the following under `tests/fixtures/smoke/`:

| Path | Size (approx.) | Contents | Why |
|---|---|---|---|
| `sample.txt` | 2 KB | "Lorem ipsum dolor sit amet…" — 3 paragraphs, deliberate newlines | Tests plain-text import + UTF-8 round-trip |
| `sample.pdf` | 50 KB | A single A4 page; one column; a few headings | Tests pdfplumber sidecar extraction |
| `sample.docx` | 30 KB | 1 paragraph + 1 footnote + 1 inline image | Tests DOCX with structured features (post-Phase 1.4) |
| `sample-multi-doc.pdf` *(optional)* | 80 KB | 5-page multi-page doc | Tests sort_order and search ordering |

### 2.1 Fixture sources

- **sample.txt** — generate locally with `echo` or pull from any public-domain text.
- **sample.pdf** — `pandoc README.md -o sample.pdf` then `pdftk` 1-page extract.
- **sample.docx** — `pandoc README.md -o sample.docx` adds a footnote + image if Markdown source has them.
- **License note:** Use only public-domain or CC-0 content. The sample assets do NOT ship in the v1 install bundle (that's a separate Phase-3.3 sample project).

### 2.2 Verify fixtures

```bash
# From repo root
ls -lh tests/fixtures/smoke/
file tests/fixtures/smoke/sample.docx
unzip -l tests/fixtures/smoke/sample.docx | head -20
pdftotext tests/fixtures/smoke/sample.pdf - | head -10
sha256sum tests/fixtures/smoke/* > /tmp/lens-fixtures.sha256
```

Expected: all four files present; `.docx` unzips to a `word/document.xml`; `.pdf` extracts to readable text; sha256 recorded.

**Regeneration:** To regenerate fixtures without touching the in-tree copies
(e.g., for CI dry-runs), set the `LENS_FIXTURES_DIR` environment variable:

```bash
LENS_FIXTURES_DIR=/tmp/lens-fixtures python3 scripts/build_smoke_fixtures.py
```

Omit the variable to write to the default `tests/fixtures/smoke/` tree.

---

## 3. The checklist (18 steps)

> Mark each step with `[x]` on pass, `[ ]` on skip-with-cause, `[FAIL]` on fail-and-stop. Record deviations in the Notes column. A "fail" anywhere **stops the smoke test** — do not skip past it.

### Pre-flight

| # | Action | Expected | Pass | Notes |
|---|---|---|---|---|
| 0.1 | `cargo tauri build` (release) | Command exits 0. Bundle exists under `src-tauri/target/release/bundle/`. | ☐ | |
| 0.2 | Launch the installed app | Window appears with LENS empty-state screen (or project list). No DevTools console errors. | ☐ | |

### Phase 5.1: Project creation

| # | Action | Expected | Pass | Notes |
|---|---|---|---|---|
| 1 | Click **New Project**. Pick `target_dir=/tmp/lens-smoke`, name `Smoke Test`. | Folder `/tmp/lens-smoke/Smoke Test/` plus `assets/` subfolder plus `project.qdaproj` file are created on disk. | ☐ | |
| 2 | Verify on disk | `ls -la /tmp/lens-smoke/Smoke\ Test/` shows `.`, `..`, `assets/`, `project.qdaproj`. | ☐ | |
| 3 | Verify schema | `sqlite3 /tmp/lens-smoke/Smoke Test/project.qdaproj ".tables"` lists: `code`, `code_closure`, `document`, `local_user`, `memo`, `migrations`, `project`, `schema_version`, `selection`, `text_selection`. | ☐ | |

### TXT import (Plan §1.2)

| # | Action | Expected | Pass | Notes |
|---|---|---|---|---|
| 4 | Click **Import** → select `tests/fixtures/smoke/sample.txt`. | Document appears in Document List panel within ~1 s. Title matches the filename. | ☐ | |
| 5 | Verify row in DB | `sqlite3 .../project.qdaproj "SELECT title, file_format, word_count, extractor_id FROM document;"` returns the TXT filename, `'txt'`, a positive `word_count`, `'plain-text-1.0'`. | ☐ | |

### PDF import (Plan §1.4)

| # | Action | Expected | Pass | Notes |
|---|---|---|---|---|
| 6 | Click **Import** → select `sample.pdf`. | Document appears. Title = filename. | ☐ | |
| 7 | Verify row | `SELECT title, file_format, extractor_id, length(plain_text) FROM document` — `file_format='pdf'`, `extractor_id LIKE 'pdfplumber-%'` (post-Phase 2.5), `length(plain_text) > 100`. | ☐ | |
| 8 | Verify sidecar copy | `ls /tmp/lens-smoke/Smoke Test/assets/` contains one `.pdf` file matching `{id}.pdf`. | ☐ | |

### DOCX import (Plan §1.3 — only after Phase 1.4)

> Skip Steps 9–10 if running pre-Phase 1.4. Record "Phase 1.4 not yet landed" in Notes.

| # | Action | Expected | Pass | Notes |
|---|---|---|---|---|
| 9 | Click **Import** → select `sample.docx`. | Document appears. | ☐ | |
| 10 | Verify row | `file_format='docx'`, `extractor_id LIKE 'docx-rs-%'` (post-Phase 2.5). `length(plain_text) > 100`. Image silently dropped; footnote text appended. | ☐ | |

### Code creation + annotation

| # | Action | Expected | Pass | Notes |
|---|---|---|---|---|
| 11 | Open the TXT document in the centre editor panel. | ProseMirror editor renders the document. Read-only. Plain text. No marks/bold/italic. | ☐ | |
| 12 | Click **New Code** in the Code Tree panel. Name `Test`. Leave colour default. Click Save. | Code `Test` appears as a root node. Default colour (palette index 0: `#6366f1`). | ☐ | |
| 13 | Select the first sentence in the editor (mouse drag). | A subtle code-pulse animation appears on the code tree. | ☐ | |
| 14 | Click the `Test` code in the code tree. | A highlight appears on the selected text in the editor. Background colour lightened (alpha 0.35) over the sentence; bottom border in full colour. | ☐ | |
| 15 | Verify annotations row | `sqlite3 ... "SELECT COUNT(*) FROM selection;"` returns ≥ 1. `SELECT start_char, end_char FROM text_selection` shows the expected span. | ☐ | |

### Fuzzy picker + alternative highlighting

| # | Action | Expected | Pass | Notes |
|---|---|---|---|---|
| 16 | Create a second root code `Other`. | Code appears in tree. | ☐ | |
| 17 | Select a different sentence in the editor. Press **Cmd/Ctrl + K**. | Floating command panel appears above the editor with a search input. | ☐ | |
| 18 | Type `oth` in the picker. Press Enter. | A second highlight appears in the editor with `Other`'s colour. The picker dismisses. | ☐ | |

### Memo + Code View + Search

| # | Action | Expected | Pass | Notes |
|---|---|---|---|---|
| 19 | Right-click the first annotation → **Add Memo**. Type `key quote`. Save. | Memo row appears under the code tree for `Test` (or appears as a tooltip on the highlight when hovered). | ☐ | |
| 20 | Click the `Test` code in the tree. | Code View panel (right side) shows the segment with 2–3 lines of context. The segment's text matches what was selected. | ☐ | |
| 21 | Press **Cmd/Ctrl + F** to open Search. Type a word that appears in `sample.txt`, in `sample.pdf`, AND in the memo you just added (e.g., a word like `the` if you customised the fixture, or the actual word you picked). | Three results appear: the document match (snippet with `<mark>`), the other document match, the memo match. | ☐ | |
| 22 | Verify ordering | Results are ordered by document `sort_order` ascending, not by FTS rank. The TXT match comes before the PDF match. | ☐ | |

### Export round-trip (Plan §4.2 / §4.3)

| # | Action | Expected | Pass | Notes |
|---|---|---|---|---|
| 23 | Top nav → **Export** → **QDPX**. Pick save location `/tmp/lens-smoke-export.qdpx`. | Toast says "Exported successfully." | ☐ | |
| 24 | Verify ZIP structure | `unzip -l /tmp/lens-smoke-export.qdpx` shows `project.qde` at root, plus one `.txt` file per document under `Sources/`. (If text file isn't nested under `Sources/`, log the actual path in Notes.) | ☐ | |
| 25 | Verify QDE schema validity | `xmllint --noout /tmp/lens-smoke-export.qdpx project.qde` (after `unzip -p`) returns 0. Top-level element is `<Project xmlns="urn:QDA-XML:project:1.0">`. | ☐ | |
| 26 | Verify user GUID non-empty | `unzip -p /tmp/lens-smoke-export.qdpx project.qde \| grep -o 'guid="[^"]*"' \| head` — every `<User guid="…">` has a UUID v4 (8-4-4-4-12 hex pattern). | ☐ | |

### Export formats (Plan §4.4, §4.5, §4.6)

| # | Action | Expected | Pass | Notes |
|---|---|---|---|---|
| 27 | **Export** → **QDC** (codebook). Save. | File written. Open in editor: root element `<CodeBook xmlns="urn:QDA-XML:project:1.0">` with a `<Codes>` block containing the codes. | ☐ | |
| 28 | **Export** → **CSV**. Save. | File written. First 3 bytes are `\xEF\xBB\xBF` (UTF-8 BOM). Header row contains: `document_title,code_name,code_path,start_char,end_char,segment_text,context_before,context_after,memo,coder,created_at`. | ☐ | |
| 29 | **Export** → **HTML report**. Save. | File written. Open in browser. Header section shows project name, total documents, total codes, total annotations, coding density. Per-code sections render with colour swatches. | ☐ | |

### Persistence

| # | Action | Expected | Pass | Notes |
|---|---|---|---|---|
| 30 | Close the project (Close Project menu / Quit app). Re-open via **Open Project** → `/tmp/lens-smoke/Smoke Test`. | All documents, codes, annotations, and memos are present. The previously created code tree matches what's on disk. | ☐ | |
| 31 | Verify DB integrity | `sqlite3 .../project.qdaproj "PRAGMA integrity_check;"` returns `ok`. `PRAGMA foreign_key_check;` returns no rows. | ☐ | |

### Re-import round-trip (Plan §4.3 — only after Phase 3.1)

> Skip Steps 32–33 if running pre-Phase 3.1. Record "Phase 3.1 not yet landed."

| # | Action | Expected | Pass | Notes |
|---|---|---|---|---|
| 32 | Create a new fresh project (`Smoke Test 2`). Open it. **Import** → choose `/tmp/lens-smoke-export.qdpx`. | Importer reads the file. Documents, codes, annotations appear. Counts match Step 31. | ☐ | |
| 33 | Verify closure table | `sqlite3 .../project.qdaproj "SELECT COUNT(*) FROM code_closure;"` returns the same count as the original project. Re-run ancestor queries (Key Query #3) to spot-check. | ☐ | |

### Path traversal (Plan §1.2 regression)

| # | Action | Expected | Pass | Notes |
|---|---|---|---|---|
| 34 | Click **New Project**. Name it `../../etc/passwd` (or `/etc/passwd`). | App shows an error toast: "Invalid project name…" (or similar). NO file is created outside `target_dir`. | ☐ | |
| 35 | Verify filesystem | `ls /tmp/lens-smoke/` does NOT contain `etc/` or any file outside the project folder. | ☐ | |

---

## 4. Pass / fail criteria

### ✅ Pass

- All 35 boxes ticked (or all non-skipped boxes ticked if a deliberate `[]` skip is recorded).
- Zero "FAIL" markers.
- All `verify-export-*.sh` commands in § 5 return exit code 0.
- The DB integrity check in Step 31 returns `ok`.
- The CLOSURE table counts in Step 33 match across the round-trip (post-Phase 3.1).

### ❌ Fail — stop-and-triage

Any one of:
- A numbered step results in an unexpected error toast.
- An export file fails `xmllint`, the CSV fails BOM check, or HTML rendering is broken.
- Path traversal in Steps 34–35 succeeds in writing outside `target_dir`.
- The app crashes, hangs for >10 s without progress, or shows a PanelErrorBoundary.

### ⏭ Skip-with-cause (NOT a fail)

- DOCX path (Steps 9–10) — allowed skip if Phase 1.4 not landed.
- QDPX import (Steps 32–33) — allowed skip if Phase 3.1 not landed.
- QDPX importer's GUID round-trip — allowed skip if no QDPX import path implemented yet.

> **Note** any skip in the Notes column with the exact task reference, e.g., "Phase 1.4 not yet landed (ACTION_PLAN §1.4 option C)."

---

## 5. Verification scripts

These are short bash snippets an AI agent or shell-savvy human can run independently to validate the export artefacts.

### 5.1 `verify-export-qdpx.sh`

```bash
#!/usr/bin/env bash
# Usage: verify-export-qdpx.sh <path-to-export.qdpx>
set -euo pipefail
FILE="${1:-}"

[ -z "$FILE" ] && { echo "Usage: $0 <.qdpx>"; exit 2; }
[ -f "$FILE" ] || { echo "No such file: $FILE"; exit 2; }

# 1. ZIP structure
unzip -l "$FILE" | grep -q "project.qde" || { echo "FAIL: project.qde missing"; exit 1; }

# 2. XML well-formedness
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
unzip -p "$FILE" project.qde > "$TMP/qde.xml"
xmllint --noout "$TMP/qde.xml" || { echo "FAIL: project.qde not well-formed"; exit 1; }

# 3. Namespace
grep -q 'xmlns="urn:QDA-XML:project:1.0"' "$TMP/qde.xml" \
  || { echo "FAIL: missing REFI-QDA namespace"; exit 1; }

# 4. At least one non-empty user GUID
GUIDS=$(grep -o 'guid="[^"]*"' "$TMP/qde.xml" | grep -v 'guid=""' | wc -l)
[ "$GUIDS" -ge 1 ] || { echo "FAIL: no populated <User guid=...>"; exit 1; }

echo "PASS: $FILE"
```

### 5.2 `verify-export-csv.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
FILE="${1:-}"
[ -z "$FILE" ] && { echo "Usage: $0 <.csv>"; exit 2; }
[ -f "$FILE" ] || { echo "No such file: $FILE"; exit 2; }

# 1. UTF-8 BOM
head -c 3 "$FILE" | xxd | grep -q 'efbb bf' \
  || { echo "FAIL: missing UTF-8 BOM"; exit 1; }

# 2. Expected header columns
HEADER=$(head -1 "$FILE" | tr -d '\r')
EXPECTED="document_title,code_name,code_path,start_char,end_char,segment_text,context_before,context_after,memo,coder,created_at"
[ "$HEADER" = "$EXPECTED" ] || { echo "FAIL: header does not match expected"; echo "  Got:      $HEADER"; echo "  Expected: $EXPECTED"; exit 1; }

echo "PASS: $FILE"
```

### 5.3 `verify-export-html.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
FILE="${1:-}"
[ -z "$FILE" ] && { echo "Usage: $0 <.html>"; exit 2; }
[ -f "$FILE" ] || { echo "No such file: $FILE"; exit 2; }

grep -q '<title>' "$FILE" || { echo "FAIL: no <title>"; exit 1; }
grep -q 'Coding density' "$FILE" || { echo "FAIL: no coding density block"; exit 1; }

# Should be self-contained — no external stylesheet or script.
grep -qE '<link[^>]+href="http' "$FILE" && { echo "FAIL: external stylesheet"; exit 1; }
grep -qE '<script[^>]+src="http' "$FILE" && { echo "FAIL: external script"; exit 1; }

echo "PASS: $FILE"
```

### 5.4 `verify-export-qdc.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
FILE="${1:-}"
[ -z "$FILE" ] && { echo "Usage: $0 <.qdc>"; exit 2; }

xmllint --noout "$FILE" || { echo "FAIL: not well-formed"; exit 1; }
grep -q 'xmlns="urn:QDA-XML:project:1.0"' "$FILE" \
  || { echo "FAIL: missing REFI-QDA namespace"; exit 1; }
grep -q '<CodeBook>' "$FILE" || { echo "FAIL: no <CodeBook> root"; exit 1; }

echo "PASS: $FILE"
```

### 5.5 DB integrity

```bash
DB="/tmp/lens-smoke/Smoke Test/project.qdaproj"
sqlite3 "$DB" "PRAGMA integrity_check;"     # expect: ok
sqlite3 "$DB" "PRAGMA foreign_key_check;"   # expect: empty
sqlite3 "$DB" "SELECT COUNT(*) FROM code_closure;"
sqlite3 "$DB" "SELECT COUNT(*) FROM code;"
# Closure count should equal sum-of-degrees; spot-check with hierarchy tests.
```

---

## 6. CI variant — `smoke-test.sh`

> Skip this section if running manually. CI runs following a release build. **This script does NOT exercise UI clicks** — it validates export and DB integrity after a sequence of programmatic operations performed by a future automated harness (out of v1 scope). What it *can* run today is the verify-export scripts plus the DB checks.

```bash
#!/usr/bin/env bash
# scripts/smoke-test.sh
# Runs after `cargo tauri build`. Asserts the basic invariants that can be
# checked without driving the GUI. Pre-Phase-5.2; full UI smoke needs a WebView driver.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BUNDLE_DIR="$ROOT/src-tauri/target/release/bundle"
[ -d "$BUNDLE_DIR" ] || { echo "FAIL: no release bundle"; exit 1; }

# Locate an example export if one is committed (smoke fixture).
EXAMPLE_QDPX="${EXAMPLE_QDPX:-/tmp/lens-smoke-export.qdpx}"
EXAMPLE_CSV="${EXAMPLE_CSV:-/tmp/lens-smoke-export.csv}"
EXAMPLE_HTML="${EXAMPLE_HTML:-/tmp/lens-smoke-report.html}"

echo "=== Bundle present ==="
ls "$BUNDLE_DIR"

[ -f "$EXAMPLE_QDPX" ] && bash "$SCRIPT_DIR/verify-export-qdpx.sh" "$EXAMPLE_QDPX"
[ -f "$EXAMPLE_CSV"  ] && bash "$SCRIPT_DIR/verify-export-csv.sh"  "$EXAMPLE_CSV"
[ -f "$EXAMPLE_HTML" ] && bash "$SCRIPT_DIR/verify-export-html.sh" "$EXAMPLE_HTML"

echo "=== Smoke test (no-UI) complete ==="
```

> When Phase 5.2 (Tauri driver / Playwright-on-WebView integration) lands, replace the no-UI prefix with a driver invocation that performs steps 1–35 above.

---

## 7. Tying back to `ACTION_PLAN.md`

Each smoke step maps to one or more action-plan tasks. If a step regresses, look at the matching task first.

| Step(s) | ACTION_PLAN ref |
|---|---|
| 0.1 | (general) ensure build green before any Phase merge |
| 1–3 | §1 (initial scaffold) verified at runtime, not just compile time |
| 4–5 | §1.2 / §2.x |
| 6–8 | §1.4 + §2.5 |
| 9–10 | §1.4 option (A) + §2.6 |
| 11 | §2.2 (`pm_pos = char_offset + 1` contract) |
| 12 | §3.1 (palette auto-assign) |
| 13–15 | §2.5 + §2.6 |
| 16–18 | §2.5(b) (ctrl+K picker) |
| 19 | §3.3 (memo system) |
| 20 | §2.7 (code view) |
| 21–22 | §3.4 (FTS5 combined search) |
| 23–26 | §1.5 (QDPX empty GUID fix) + §4.2 |
| 27 | §4.4 (QDC codebook) |
| 28 | §4.5 (CSV BOM + columns) |
| 29 | §4.6 (HTML report) |
| 30 | §3.x (persistence + state) |
| 31 | §2.1 (closure invariant), §3.x (FK cascade) |
| 32–33 | §3.1 (QDPX importer — v1.1) |
| 34–35 | §1.2 (path traversal fix) |

If a step fails **and** its plan task is not yet merged, expected. If a step fails **after** the task is merged, file a bug.

---

## 8. Pass-rate metrics (track over time)

Once this checklist has been run a few times, capture metrics:

| Metric | How | Target |
|---|---|---|
| Pass rate | (`[x]` count) / (35 − skipped) | 100% by v1 release |
| Steps that needed a workaround | count of "Notes" column entries that say "manual fix" or "had to retry" | 0 |
| Time to run | wall-clock from Step 0.1 to closing the artifact viewer | ≤ 10 min |
| Average steps per blocker | (sum blocker-causing steps) / (blocker count) | trending down |

These belong in a release-readiness review, not in this doc — but worth tracking.

---

## 9. When to update this document

- A new PLAN phase lands. → Add steps for that phase's user-visible features.
- A bug is filed against smoke-test step N. → Update the Notes column template for that step.
- A fixture changes (LICENSE, content source, hash). → Update § 2.
- A verification script is added/changed. → Update § 5.
- An export format is added. → Add a step + a verify-export script.

---

## 10. License and provenance

- The fixtures (if any are committed in `tests/fixtures/smoke/`) MUST be public-domain or CC-0.
- This document is part of the LENS project and is licensed under the project's main LICENSE.
