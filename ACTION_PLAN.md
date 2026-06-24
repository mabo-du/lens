# LENS — Action Plan

> **Source:** Generated from the project review on the four priority fixes (P1–P4) and a complete audit of bugs / stubs / hardcoded data / security gaps across the codebase. This document is the work-list for getting to a defensible v1.

## Status

- Repository state: **no commits, single `main` branch, all untracked.** This plan assumes a clean git init at the start of Phase 1.
- Test baseline: **~22 Rust tests passing, TypeScript clean compile.**
- Plan completeness: mid-Phase 2 / pre-Phase 3 of `LENS_Implementation_Plan.md`.
- All tier labels are local to this document. They are not the same as the historical P1–P4 fixes already merged.

## How to read this document

- **Tier** = priority class (P0 = blocks v1, P1 = quality blocker, P2 = plan-completion backlog, P3 = V2+).
- **Phase** = suggested execution waves, NOT strict Gantt. Phases can overlap if you have parallel agents.
- Each task has: **Scope**, **Files**, **Acceptance**, **Tests**, **Effort**, **Risk**.
- **Dependency** field shows what must land first.

## Priority tiers

| Tier | Meaning | Defensible for v1? |
|------|---------|--------------------|
| **P0 — Block v1 ship** | Will silently break a promised feature, leak user data, or look like a finished feature that isn't | NO |
| **P1 — Quality blocker** | Correctness bugs or invariants without tests; will bite shortly after v1 | NO |
| **P2 — Plan completion** | Architectural-plan features called out but undelivered | Partial (most defer to v1.1) |
| **P3 — V2+** | Explicitly out of scope | NO |

---

## Phase 1 — Triage & Safety (~3 days)

> Goal: stop the bleeding. Fix the false-success exports, path traversal, dead DOCX path, and the floating `greet` stub. Get CI building at all.

### 1.1 [P0] Remove `greet` stub and unused `lib.rs` mobile entry

- **Dependency:** none.
- **Scope:** Remove the scaffold code in `src-tauri/src/lib.rs` (the `greet` command and the `tauri_plugin_opener::init()` invocation, neither of which is referenced from `main.rs`). Decide whether to keep `lib.rs` at all — Tauri 2 mobile requires it; if desktop-only, delete the file and the `[lib]` block in `src-tauri/Cargo.toml`.
- **Files:**
  - `src-tauri/src/lib.rs` (rewrite or delete)
  - `src-tauri/Cargo.toml` (`[lib]` block if removed)
  - `src-tauri/src/main.rs` (no change required)
- **Acceptance:** `cargo build --release` succeeds with no warnings about dead code in the lib target.
- **Tests:** existing `cargo test` passes unchanged.
- **Effort:** 30 min.  **Risk:** low.

### 1.2 [P0] Path traversal fix in `projects_create_internal`

- **Dependency:** none.
- **Scope:** User-controlled `name` is appended to `target_dir` with `PathBuf::push`. Per Rust docs, `push` on an absolute path **replaces** the buffer; on a path containing `..`, it traverses. Both must be rejected.
- **Files:** `src-tauri/src/commands/projects.rs`.
- **Concrete change:**
  - Add a `validate_project_name(name: &str) -> Result<(), String>` helper that:
    1. rejects if `std::path::Path::new(name).is_absolute()` — covers both POSIX (`/etc/...`) and Windows (`C:\...`).
    2. rejects any segment that is `..` or `.`.
    3. rejects any character outside `[A-Za-z0-9 ._-]+`.
    4. rejects empty-string and length > 64.
  - Call it at the top of `projects_create_internal` before any `PathBuf` operation.
- **Acceptance:** `name = "/etc/passwd"`, `name = "../../foo"`, `name = ""`, `name = "name$bad"` all return a user-facing error. `name = "My Project 2025"` succeeds.
- **Tests:** new unit tests in `src-tauri/src/tests.rs` covering all five rejection classes plus the success case. **Effort:** 1 hr.  **Risk:** low.

### 1.3 [P0] Remove unused `tauri-plugin-sql` registration

- **Dependency:** none.
- **Scope:** `tauri-plugin-sql` is registered (`main.rs:24`) but **no Rust code holds the connection** — the `AppState::db: SqlitePool` is managed via `sqlx` directly. The plugin exists to expose raw DB access to the renderer; loading it widens the IPC attack surface for no benefit. Same for `@tauri-apps/plugin-sql` on the JS side.
- **Files:**
  - `src-tauri/src/main.rs` (remove `.plugin(tauri_plugin_sql::Builder::default().build())`)
  - `src-tauri/Cargo.toml` (remove `tauri-plugin-sql` dependency)
  - `package.json` (remove `@tauri-apps/plugin-sql` dependency)
- **Acceptance:** `grep -rn 'tauri-plugin-sql\|@tauri-apps/plugin-sql' src/ src-tauri/` returns no matches except this plan. App still launches and SQLite still works (via sqlx).
- **Tests:** `cargo build` and `npm run build` succeed.
- **Effort:** 15 min.  **Risk:** low (verify no renderer code calls into the plugin first).

### 1.4 [P0] Fix DOCX import regression from P4.3 cleanup

- **Dependency:** architecture decision (choose option from below).
- **Scope:** Mammoth was removed from `package.json` in the P4.3 dependency sweep. After the sweep, the DOCX import path in `src-tauri/src/commands/import.rs` was broken — `raw_text` was expected from the frontend, but the frontend had no Mammoth anymore, so DOCX import was silently dead. **Resolved:** option A below was implemented — a Rust-native extractor at `src-tauri/src/import/docx.rs` reads the DOCX with `zip` + `roxmltree`, called from `documents_import_internal` when `raw_text` is `None`. An in-module integration test (`documents_import_native_docx_round_trip`) verifies the end-to-end DOCX path with a hand-rolled fixture, including duplicate-detection (the `UNIQUE(project_id, text_hash)` constraint from migration 02) and asset copy to `assets/{id}.docx`. The IPC `raw_text` parameter is retained as a renderer-side escape hatch but is no longer the canonical DOCX path.
- **Decision options:**
  - **(A) Recommended: pure-Rust DOCX extractor.** Add the `docx-rs` crate (`cargo add docx-rs`) and write `src-tauri/src/import/docx.rs` that opens the DOCX as a zip, walks `word/document.xml`, concatenates `<w:t>` text runs, applies the same normalisation pipeline as `.txt`. Pros: no Node sidecar, no JS extraction in the renderer, no DPI/version drift. Cons: doesn't handle tracked changes, comments, footnotes as cleanly as Mammoth — but neither did the broken path.
  - **(B) Re-add Mammoth.js + a Node sidecar.** This is what the original architecture plan called for. Requires a Node runtime on the user's machine, plus a Tauri sidecar build for three platforms. Largest surface area.
  - **(C) Accept broken DOCX; remove the file_format case entirely.** This is the "acknowledge the regression" path. The DOCX file_format keyword would become a typed error: `"DOCX import is not implemented in this build"`. Saves the most time but breaks the architectural plan's promised feature surface.
- **Files (option A):**
  - `src-tauri/Cargo.toml`: add `docx-rs = "..."`
  - `src-tauri/src/import/docx.rs`: new module, normalise parity with `txt.rs`
  - `src-tauri/src/import/mod.rs`: re-export the new extractor
  - `src-tauri/src/commands/import.rs`: route `"docx"` to `docx::extract_text(&file_path)?` instead of requiring `raw_text`
  - `src-tauri/src/commands/import.rs`: change `extractor_id` to `format!("docx-rs-{}", env!("CARGO_PKG_VERSION"))`
- **Acceptance:** A fixture DOCX (under `tests/fixtures/sample.docx`, add a small one) imports end-to-end and the resulting `document.plain_text` contains the expected text.
- **Tests:** integration test in `src-tauri/src/tests.rs` covering: existing fixture DOCX (round-trip text content), tracked-changes DOCX (text accepted), DOCX with image (text extracted, image silently dropped).
- **Effort:** 2–4 hrs for option A; 1 day for B; 30 min for C.
- **Risk:** A = low (small Rust crate, deterministic); B = high (Node bundling, cross-platform sidecars); C = low.

### 1.5 [P0] QDPX export must not emit an empty user GUID

- **Dependency:** none.
- **Scope:** `src-tauri/src/commands/export.rs` falls back to `LocalUserFallback { id: String::new(), display_name: "Unknown User".to_string() }` when `local_user` is empty. Per REFI-QDA `Projects.xsd`, `<User guid="..."/>` is required and `""` is invalid GUID. Tools like NVivo, ATLAS.ti, MAXQDA will refuse to import the produced `.qdpx` — the app will report "Export successful" while producing broken output.
- **Concrete change:**
  - Replace the empty fallback with `Uuid::new_v4().to_string()` and a stable display name like `"Local User (unknown)"`.
  - Better: ensure `local_user` always exists by auto-creating one on project creation if missing (one row, generated UUID, default display name `OS User`), and surface the display name in a Settings dialog. This makes the empty-row case unreachable.
- **Files:** `src-tauri/src/commands/export.rs`; optionally `src-tauri/src/commands/projects.rs` (auto-create local_user on projects_create).
- **Acceptance:** An export from a fresh project produces a `.qdpx` whose `project.qde` validates against `Projects.xsd`. The `<User guid="..."/>` element always has a valid UUID v4.
- **Tests:** integration test: build a test project with no `local_user` row, run `export_prepare_internal`, assert `local_user.id` matches UUID v4 regex `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`.
- **Effort:** 30 min (fallback only) to 2 hr (auto-create local_user too).
- **Risk:** low.

### 1.6 [P0] Updater pubkey & endpoint must be real, or updater disabled

- **Dependency:** none. Independently architecture decision.
- **Scope:** `src-tauri/tauri.conf.json` has `"pubkey": ""` and a placeholder endpoint `https://github.com/[owner]/lens/releases/latest/download/latest.json`. Without a real Tauri updater keypair, signature verification will silently fail at every startup, blocking auto-update entirely.
- **Concrete change:**
  - **Recommended:** generate a keypair now via `cargo tauri signer generate -w ~/.tauri/lens.key.pem`, paste the public key into `tauri.conf.json` `plugins.updater.pubkey`, and store the private key in a CI secret (`TAURI_SIGNING_PRIVATE_KEY`) and locally only. Replace `[owner]` with the actual GitHub owner.
  - **Alternative:** leave the updater block as-is but **remove** `tauri-plugin-updater` from `Cargo.toml` and `main.rs` so the app doesn't waste cycles trying. Acknowledge "auto-update ships in v1.1" in the README.
- **Files:** `src-tauri/tauri.conf.json`; optionally `src-tauri/Cargo.toml` and `src-tauri/src/main.rs` if disabling.
- **Acceptance:** Either (a) `cargo build --release` + a CI-built artifact + the matching `latest.json` returns 200 to a check, OR (b) updater is fully removed from the binary.
- **Tests:** none (CI / build artifact verification). **Effort:** 30 min.  **Risk:** low.  **Decision needed from user** before any commit.

### 1.7 [P0] Initialise a real git baseline

- **Dependency:** none.
- **Scope:** Repo is at "no commits yet," `git status` shows everything untracked. There is **no version history to roll back to**. Every change above must land on a baseline.
- **Concrete change:** `git init` (already done) → make an initial commit of the *current* state with tag `pre-action-plan`. Then for each phase, commit per task or per coherent group with conventional-commit messages.
- **Files:** `.git/`, plus one synthetic "snapshot" commit.
- **Acceptance:** `git log --oneline` shows at least three commits: `pre-action-plan`, after Phase 1, after Phase 2.
- **Effort:** 15 min.  **Risk:** low.

---

## Phase 2 — MVP Reliability (~4 days)

> Goal: prove the closures, the offset bridge, and the import pipeline work end-to-end with tests, not just faith.

### 2.1 [P1] Closure-table invariant test (per plan §Part 5)

- **Dependency:** 1.7 (baseline exists).
- **Scope:** `LENS_Implementation_Plan.md` explicitly mandates: *"Write a test that creates a 3-level hierarchy, moves the middle node to a different parent, and verifies all six ancestor-descendant relationships in the closure table are correct."* This test does not exist.
- **Files:** `src-tauri/src/tests.rs` (new test module) plus a helper in `tests/` if cleaner.
- **Acceptance:** Test creates root A → child B → grandchild C, asserts the closure table contains the expected 6 rows (self-references plus all ancestor/descendant pairs). Then moves B under a new root X. Assert the closure table now contains exactly the rewritten 4 self-rows plus all required ancestor links, no stale `A→B` or `A→C` rows remain.
- **Tests:** rust integration test calling `codes_create_internal`, `codes_move_internal`, then `SELECT * FROM code_closure ORDER BY ancestor, depth` and comparing to a hand-built expected matrix.
- **Effort:** 2 hr.  **Risk:** low.

### 2.2 [P1] ProseMirror offset-bridge round-trip test (per plan §Part 5)

- **Dependency:** Vitest setup functional (`vitest run` already in `package.json`).
- **Scope:** `src/utils/offset-utils.ts` is the bridge between `start_char`/`end_char` and ProseMirror positions. Plan mandates: *"take a known string, create a ProseMirror document from it, select a substring by known char offsets, and verify the reconstructed substring is identical."*
- **Files:** `src/utils/offset-utils.test.ts` (new).
- **Acceptance:** Test builds a ProseMirror doc from `"Hello world. This is a sentence with many words."`. Subsets at positions 0–5 (`"Hello"`), 6–11 (`"world"`), 24–34 (`"sentence"`) reconstruct identically. Same exercise against UTF-8 multi-byte text (e.g., Japanese or Arabic) to catch code-unit vs code-point mistakes.
- **Tests:** vitest, 4 cases (ASCII prefix, ASCII middle, ASCII suffix, non-Latin).
- **Effort:** 2 hr.  **Risk:** low.

### 2.3 [P1] Race-condition guard in `documents_import_internal`

- **Dependency:** none.
- **Scope:** `documents_import_internal` runs a `SELECT 1 FROM document WHERE text_hash = ?` followed by an `INSERT document (...)`. Between them, two concurrent imports could both pass the duplicate check and produce two rows with the same `text_hash`. The architecture says `text_hash` is the re-import detection key.
- **Concrete change:** Wrap the duplicate-check + insert in a single `tx = pool.begin()` and add a `UNIQUE (project_id, text_hash)` constraint via a new migration (`migrations/02_unique_hash.sql`). The transaction isolation alone is insufficient in SQLite WAL mode.
- **Files:**
  - `src-tauri/src/db/migrations/02_unique_text_hash.sql` (new)
  - `src-tauri/src/migrations.rs` (registers the new file)
  - `src-tauri/src/commands/import.rs` (begin transaction before hash check)
- **Acceptance:** Two concurrent import attempts with the same content produce exactly one `document` row and one of the calls returns the existing-duplicate error.
- **Tests:** new integration test fanning out two parallel `documents_import_internal` calls with the same file content using `tokio::join!`.
- **Effort:** 2 hr.  **Risk:** low.

### 2.4 [P1] Asset cleanup must use a known path

- **Dependency:** none.
- **Scope:** `document_delete_internal` does an O(n) `read_dir` over `assets/` and `starts_with("{id}.")`. This is correct under UUID naming but defeats the project's determinism claim and would silently delete the wrong file if two asset IDs ever shared a prefix. The right primitive is to record the asset filename at import time.
- **Concrete change:** add a `document.original_path` lookup that already exists in the schema, plus a lookup from the `document.id` to the canonical `format!("{}.{}", id, ext)` path written by `documents_import_internal`. Delete that exact path.
- **Files:**
  - `src-tauri/src/commands/documents.rs` (replace the `read_dir` loop with `std::fs::remove_file(assets_dir.join(format!("{}.{}", id, ext)))` where `ext` is read from `document.original_path` or hardcoded to `document.file_format` as a fallback)
  - Reuse the same naming convention in `documents_import_internal` so `document_delete_internal` knows what to look for.
- **Acceptance:** Document delete removes only the one asset file. The `assets/` directory is not scanned.
- **Tests:** integration test: import a TXT, assert `assets/{id}.txt` exists, call `document_delete_internal`, assert the file is gone (and not any other file).
- **Effort:** 1 hr.  **Risk:** low.

### 2.5 [P1] `extractor_id` versioning for `pdfplumber`

- **Dependency:** none.
- **Scope:** `documents_import_internal` writes `extractor_id: "pdfplumber-sidecar"` (no version). The architecture plan calls for `pdfplumber-{version}`. The version is not deterministic across builds.
- **Concrete change:** Read the sidecar's `pdfplumber.__version__` once at app startup and store in `AppState`, OR bake the sidecar's package version into a `build.rs`-generated constant. Stamping `pdfplumber-0.11.x` is sufficient.
- **Files:** `src-tauri/src/import/pdf.rs`; possibly `src-tauri/build.rs` (new).
- **Acceptance:** Every imported PDF stores `extractor_id LIKE 'pdfplumber-%'`. The same sidecar produces the same string across launches.
- **Tests:** integration test imports a fixture PDF and asserts `extractor_id == "pdfplumber-{version}"`.
- **Effort:** 2 hr (need to read sidecar metadata, possibly via `std::process::Command` once at startup).  **Risk:** low.

### 2.6 [P1] `documents_import` DOCX routing cleanup (post-1.4)

- **Dependency:** 1.4 (DOCX extractor chosen).
- **Scope:** Once a real DOCX extractor exists, `documents_import_internal`'s `raw_text: Option<String>` parameter becomes redundant. Either remove the parameter (rejected by IPC clients), or keep it as a documented override for edge cases. Recommend remove.
- **Files:** `src-tauri/src/commands/import.rs`; `src/ipc/import.ts` if it exists; verify no frontend callers pass `raw_text`.
- **Acceptance:** Only the canonical extractor path runs for DOCX. Optional: surface a clear error if `raw_text` is non-empty AND `file_format == "docx"` — explicit ambiguity.
- **Tests:** typecheck, existing tests pass.
- **Effort:** 1 hr.  **Risk:** low.

---

## Phase 3 — Plan completion (P2 backlog, ~10 days)

> Goal: deliver what the architectural plan promised and what's missing from the current surface. Most of this is V2+ style work; explicitly mark which items are land-able in v1 vs v1.1.

### 3.1 [P2] `.qdpx` importer (Plan §4.3)

- **v1 or v1.1?** **v1.1** (the export-to-import round-trip is a Phase 4 checkpoint per the plan, but the plan also says v1 ships with sample project, not QDPX import).
- **Scope:** Permissive REFI-QDA `.qdpx` parser using `@xmldom/xmldom` and `jszip`. Maps `<TextSource>` → `document`, `<Code>` → recursive `code` + closure rows, `<PlainTextSelection>` → `selection` + `text_selection`, `<Memo>` → `memo`. Merge/Replace prompt on conflict.
- **Files:** `src/import/QdpxImporter.ts` (new); `src/ipc/import.ts` (new); frontend wire-up in `DocumentList.tsx`.
- **Acceptance:** A `.qdpx` produced by LENS re-imports cleanly. An NVivo-produced `.qdpx` (if a sample is available) imports without crashing; missing elements are logged.
- **Tests:** unit test on a fixture `.qdpx` round-trip; second test on a structurally-broken `.qdpx` showing graceful skip.
- **Effort:** 1.5 days.  **Risk:** medium (XSD edge cases).

### 3.2 [P2] Settings panel (Plan §5.3, sans SQLCipher)

- **v1 or v1.1?** **v1** (without SQLCipher; SQLCipher is its own P3 item).
- **Scope:** Display-name editor that writes to `local_user.display_name`, theme toggle persisted to a Tauri-store plugin or `localStorage`, default-code-colour dropdown wired to the palette. **Skip SQLCipher for v1** (defer to P3).
- **Files:** `src/components/settings/SettingsDialog.tsx` (new); `src/ipc/projects.ts` (extend with `set_local_user_display_name` or similar IPC).
- **Acceptance:** Editor updates `local_user.display_name`, exports use the new name.
- **Tests:** UI integration smoke test via the manual smoke flow (Phase 4 below).
- **Effort:** 1 day.  **Risk:** low.

### 3.3 [P2] Sample project (Plan §5.1)

- **v1 or v1.1?** **v1** (architecture plan calls for it in v1; without it the empty-state UX is cold).
- **Scope:** Bundle a read-only `.qdaproj` under `resources/sample-project/` (3–4 short public-domain interview transcripts, 10–15 codes in 2-level hierarchy, 30–40 example annotations). Add to Tauri bundle config. Add an "Open Sample Project" button on the empty-state screen.
- **Files:** `resources/sample-project/` (new folder, ~1 MB); `src/App.tsx` (empty-state button).
- **Acceptance:** Sample project opens, all annotations render, all searches return hits.
- **Tests:** automated: import the sample project programmatically and assert row counts; manual smoke (Phase 4).
- **Effort:** 1 day.  **Risk:** low (the content is the only creative work).

### 3.4 [P2] Cross-platform build pipeline (Plan §5.4–5.5)

- **v1 or v1.1?** **v1** (without it, "v1" can't actually ship to anyone).
- **Scope:** GitHub Actions workflow using `tauri-action`, with three matrix targets (Windows MSI+NSIS, macOS DMG universal, Linux AppImage+deb). Code signing via secrets. Requires decisions on signing (1.6 above).
- **Files:** `.github/workflows/release.yml` (new).
- **Acceptance:** Tag `v0.1.0-rc1` produces all three artefacts in CI.
- **Tests:** the workflow itself.
- **Effort:** 1 day.  **Risk:** medium (signing setup is fiddly).

### 3.5 [P2] Workspace empty-state polish

- **v1 or v1.1?** **v1** (cheap; touches the very first user impression).
- **Scope:** Current empty state in `src/App.tsx` is functional but minimal. Add the three buttons as the plan calls for (New / Open / Sample). Add help tooltips on the code-tree "New Code" button and the document-import button.
- **Files:** `src/App.tsx`; possibly `src/components/workspace/Workspace.tsx` (toolbar buttons).
- **Acceptance:** All three flows are reachable from the empty state. Tooltips render on hover.
- **Effort:** 2 hr.  **Risk:** low.

---

## Phase 4 — V2+ deferral list (P3)

> These come from the architectural roadmap and are explicitly **not part of v1**. They are listed here so they aren't lost.

| Item | Plan ref | Notes for v1.1 sequencing |
|------|----------|---------------------------|
| Analytics dashboard (co-occurrence, frequency, network) | Plan §6 | Needs `recharts` + `react-force-graph` |
| Inter-coder reliability (Cohen's kappa) | Plan §7.1 | Pure JS; small surface |
| Baton-pass collaboration lock file | Plan §7.2 | Care needed with crash recovery |
| Coding comparison view | Plan §7.3 | Depends on ICR + multi-coder data |
| Image annotation (Konva.js) | Plan §8.1 | Adds `image_format` import path |
| Audio/video annotation (WaveSurfer + whisper) | Plan §8.2 | Adds `media_format` import path + sidecar |
| Transcript synchronisation | Plan §8.3 | SRT/WebVTT parsing |
| **SQLCipher encryption-at-rest** | Plan §5.3 | Build/runtime complexity; security-sensitive research use case warrants it |

---

## Phase 5 — Continuous: end-to-end smoke test

> Goal: catch what unit tests cannot. Runs after every Phase, not at the end.

### 5.1 Manual smoke test script

Write `docs/SMOKE_TEST.md` (or `scripts/smoke-test.sh` if automatable). The flow, run after each Phase completion:

1. `cargo tauri build` (release); verify the bundle exists.
2. Launch the installed binary.
3. Click **New Project**, pick `target_dir = /tmp/lens-smoke`, name it `Smoke Test`.
4. Click **Open Project**, navigate to a TXT fixture, import. Assert it appears.
5. Click **Open Project**, navigate to a PDF fixture, import. Assert it appears.
6. Click **Open Project**, navigate to a DOCX fixture, import (post-1.4). Assert it appears.
7. Open the TXT document.
8. Create a code named `Test`, default colour.
9. Select the first sentence, assign `Test` via the code-tree click. Assert the highlight appears.
10. Press `Cmd/Ctrl + K`. Fuzzy-pick a code. Assert highlight appears.
11. Add a memo to the annotation.
12. Click the code in the tree, assert the Code View panel shows the segment with context.
13. Search for a word that appears in both documents and the memo.
14. Export as `.qdpx`. Open the file. Assert validity (XML parses, ZIP structure is correct).
15. Re-import the `.qdpx` into a fresh project. Assert everything came back.
16. Export as `.csv`. Open in a spreadsheet. Assert the BOM and column headers.
17. Export as `.html` report. Open in browser. Assert content present.
18. Close the project. Re-open. Assert state persists.

Each step is a pass/fail check. Update `docs/SMOKE_TEST.md` to mark failures red.

### 5.2 CI integration

Once Phase 5.1 is stable, gate releases on the smoke test passing in headless mode (using Tauri's `tauri-driver` or a custom Playwright-on-WebView setup if not impossible — see plan for similar coverage claims).

- **Effort:** smoke-test doc = 2 hr; CI integration = 2 days.  **Risk:** low (doc) / medium (CI).

---

## Risk register

| ID | Risk | Probability | Impact | Mitigation |
|----|------|-------------|--------|------------|
| R1 | DOCX import remains broken after 1.4 if user picks option C | if user picks C | medium | Document explicitly in release notes; add a typed error message in UI |
| R2 | Path-traversal fix 1.2 doesn't catch Windows UNC paths | low | high | Add `\\\\?\\` and `\\\\server\\` rejection in the validator |
| R3 | Updater pubkey not generated before release | medium | medium (no auto-update) | Either generate key per 1.6, or remove per 1.6 |
| R4 | Closure-table drift after a hypothetical cycle-prevention miss | low | high | Covered by 2.1 but also tighten cycle check in `codes_move_internal` to reject if `ancestor == ?` would create path CROSS JOIN blow-up |
| R5 | Sidecar (pdfplumber) not built for all 3 platforms at release | medium | blocks macOS+Windows users either way | Verify sidecar per-platform build artifacts in 3.4 |
| R6 | CSS `'unsafe-inline'` in CSP — fine for desktop apps but bans future CDN use | low | low | Document why; consider `'unsafe-hashes'` with explicit hashes for shadcn styles |
| R7 | `@tauri-apps/plugin-fs` exposes `writeFile` to the renderer with all the IPC surface that brings | low | medium | Permissions capability `default.json` should scope by directory, ideally only into the active project's assets/ folder |
| R8 | Repo with no commits + 1.7 → rebases will be painful | medium | low | Create the baseline commit before any other change |
| R9 | P4.3 cleanup may have been too aggressive — re-add prosemirror-commands to confirm it stays removed | low | low | Confirm no `from 'prosemirror-commands'` imports |
| R10 | The empty-GUID export bug (1.5) may have replicated to non-export paths (everything reading `local_user` assuming not-empty) | low | medium | grep `local_user` after the fix lands; add a helper that auto-creates a default row |

---

## Open questions (need user decisions)

These block forward motion until answered.

| Question | Default if no answer | Affects |
|----------|----------------------|---------|
| **DOCX strategy** (option A vs B vs C in 1.4) | A (pure-Rust) | 1.4, possibly 2.6 |
| **Updater pubkey** (generate vs remove) | generate | 1.6, 3.4 |
| **Sample project content** — write fresh transcripts, license from an existing corpus, or use synthetic quotes | synthetic quotes | 3.3 |
| **MVP scope cut** — ship v1 with Tiers P0+P1 only (no QDPX import, no Settings panel, no sample project, no CI) or include P2 items? | include P2 except 3.1 (QDPX import) | Which Phase 3 items run |
| **CVS (`tauri-plugin-store`) or `localStorage`** for client-side prefs | `tauri-plugin-store` | 3.2 |
| **`local_user` auto-create on `projects_create`** vs only at Settings dialog | auto-create | 1.5 + 3.2 |
| **Repository owner for updater endpoint** | TBD | 1.6 |
| **Mobile target** (`org.heritagetech.lens` suggests cross-platform) — keep `lib.rs` for mobile or remove? | remove (desktop-only) | 1.1 |

---

## Definition of "shippable v1"

LENS v1 is defensible when **all of the following** are true:

- Tier P0 (Phase 1) tasks 1.1–1.7 are complete and merged.
- Tier P1 (Phase 2) tasks 2.1–2.6 are complete.
- Tier P2 tasks 3.2 (Settings) and 3.3 (Sample Project) and 3.4 (CI build) are complete.
- `cargo test` and `vitest run` are green.
- The Phase 5 smoke test runs to step 15 (`qdpx re-import`) without errors.
- README has a "how to build" section that works on a fresh checkout.
- An installer artefact exists for at least one platform.

Items 3.1 (QDPX import), 3.5 (UI polish), and all P3 are v1.1 candidates.

---

## Appendix A — Things this plan deliberately does NOT include

- **Adding new dependencies without `cargo add`/`npm install`** — basehers for that, no manual `Cargo.toml`/`package.json` edits.
- **Touching research papers** — they are reference material.
- **Re-architecting Zustand stores** — they work; improvements are ambient.
- **Refactoring `Workspace.tsx`** — it has its own `PanelErrorBoundary`. Looks fine.
- **Auditing Tailwind/CSS** — out of scope.

---

## Appendix B — Sequencing rationale

Dependency order baked into the phases:

1. **Path traversal (1.2)** — cheap; forbidden to ship without it.
2. **P0 cleanup (1.1, 1.3)** — removes dead attack surface before anything else.
3. **DOCX (1.4)** — chosen before QDPX export tests because the export payload needs every imported document to be reachable.
4. **QDPX export fallback (1.5)** — locks in the contract exporters depend on.
5. **git baseline (1.7)** — established before *any* subsequent code lands.
6. **Smoke test (Phase 5)** — runs continuously after each Phase, not at the end.

If you can run multiple agents in parallel: items 1.1, 1.2, 1.3 are independent and can land simultaneously; 1.4 and 1.5 are independent; 1.6 depends on a user decision.
