# LENS Action Plan

**Date:** 2026-06-23
**Scope:** Full-stack audit of LENS (Tauri 2 + React 19 + Rust/sqlx + ProseMirror)
**Sources:** 4× LLM audits + manual code review
**Unique Issues Identified:** ~55

---

## Executive Summary

All four LLM reviewers independently identified the same core problem: **the primary user workflow (creating text annotations/codings) is broken at runtime** due to a schema mismatch, and **the export system will crash on first use** due to a column mismatch. The codebase is well-architected (closure tables, FTS5, plugin exports) but lacks any testing or end-to-end verification loop.

The biggest gap all reviewers agree on: **there is no confirmed "happy path"** — the app has likely never been run through project creation → import → coding → export end-to-end.

---

## P0 — Critical (Fix First — App Broken)

| # | Issue | File(s) | Fix | Status |
|---|-------|---------|-----|--------|
| **P0.1** | **`annotations_create` fails on every call** — `INSERT INTO selection` omits `selection_type` which is `NOT NULL CHECK (selection_type IN ('text','image_region','media_ts'))` | `src-tauri/src/commands/annotations.rs:51` | Add `selection_type` column with value `'text'` to the INSERT | ☐ |
| **P0.2** | **`annotations_create` FK violation** — `created_by` hardcoded to `"local_user_id"` but `local_user` table is never populated, and `PRAGMA foreign_keys = ON` | `src-tauri/src/commands/annotations.rs:47` | Seed a `local_user` row on project creation (or make `created_by` nullable and insert `NULL`) | ☐ |
| **P0.3** | **`export_prepare` crashes on any export** — queries `code` table selecting `created_by`, but `Code` struct has no `created_by` field → sqlx `FromRow` deserialization fails | `src-tauri/src/commands/export.rs:61` | Either add `created_by: Option<String>` to `Code` struct, or remove `created_by` from the export query | ☐ |
| **P0.4** | **`export_prepare` crashes if any memo exists** — memo query returns `created_at`/`updated_at` but `Memo` struct expects `createdAt`/`updatedAt` via `#[sqlx(rename)]` | `src-tauri/src/commands/export.rs:93` | Add `AS createdAt` / `AS updatedAt` aliases to the memo query | ☐ |
| **P0.5** | **ProseMirror offset bridge is off-by-one** — `charOffsetToPmPos` returns `charOffset + 1`, but with `doc > paragraph > text` schema, the first character is at ProseMirror position **2** (0=doc, 1=paragraph, 2=first char). Every highlight is shifted left by one position | `src/utils/offset-utils.ts` | Change to `charOffset + 2` and `Math.max(0, pmPos - 2)`. **Verify with a test document.** | ☐ |

---

## P1 — High (Crash / Data Corruption / Major Broken Feature)

| # | Issue | File(s) | Fix | Status |
|---|-------|---------|-----|--------|
| **P1.1** | **`codes_delete` orphans child codes** — UI says "This will also delete any child codes" but only deletes the parent row. Children survive in `code` table but lose closure rows, becoming invisible ghosts with intact annotations | `src-tauri/src/commands/codes.rs:248` | Before delete: `DELETE FROM code WHERE id IN (SELECT descendant FROM code_closure WHERE ancestor = ?)` | ☐ |
| **P1.2** | **`codes_move` can corrupt closure table** — no cycle detection. Moving a parent under its own child creates infinite loops / violates PK constraint | `src-tauri/src/commands/codes.rs:172` | Check `SELECT 1 FROM code_closure WHERE ancestor = ? AND descendant = ?` with swapped params before move | ☐ |
| **P1.3** | **`build_tree` panics on data corruption** — `code_map.get(id).unwrap()` crashes Tauri process if closure table references a deleted code | `src-tauri/src/commands/codes.rs:142` | Replace `.unwrap()` with safe fallback (skip missing node or return `Err`) | ☐ |
| **P1.4** | **`projects_open` can panic** — `db_path.parent().unwrap()` panics if project dir is root | `src-tauri/src/commands/projects.rs:96` | Use `ok_or("Invalid project path")?` | ☐ |
| **P1.5** | **PDF import sidecar lacks permission** — `capabilities/default.json` only grants `shell:default`; Tauri 2 requires scoped `shell:allow-execute` for sidecars | `src-tauri/capabilities/default.json` | Add scoped shell permission for `pdfplumber` sidecar | ☐ |
| **P1.6** | **`codes_get_subtree` is a trap** — registered as a command, frontend has typed IPC wrapper, but always returns `vec![]`. Future developers will waste time debugging their code before discovering the stub | `src-tauri/src/commands/codes.rs:265` | Either implement it properly, or remove from `invoke_handler` and `codesIpc` | ☐ |
| **P1.7** | **Path traversal in `projects_create`** — `name` is frontend-controlled; `../../etc/cron.d` creates directories outside target. Also no collision check | `src-tauri/src/commands/projects.rs:33` | Sanitize name (reject `/`, `..`, leading `.`), check if directory already exists | ☐ |
| **P1.8** | **`projects_create` hardcodes "New Project"** — every project has the same name, and creating a second one in the same parent collides | `src/App.tsx:41` | Add a project name dialog/prompt before create | ☐ |

---

## P2 — Medium (Incorrect Behavior / Security / UX)

| # | Issue | File(s) | Fix | Status |
|---|-------|---------|-----|--------|
| **P2.1** | **`codes_update` is not transactional** — three separate UPDATE queries; partial updates possible on failure | `src-tauri/src/commands/codes.rs:226` | Wrap in `pool.begin()` transaction | ☐ |
| **P2.2** | **Memo autosave race conditions** — 1s debounce timeout not cleaned on unmount/dialog close. State update on unmounted component | `AnnotationMemoDialog.tsx`, `ProjectJournalDialog.tsx`, `CodeTree.tsx` | Clear timeout in `useEffect` cleanup and on dialog close | ☐ |
| **P2.3** | **`documents_list` omits `plain_text`** — causes frontend to need separate `document_get_content` calls for every document | `src-tauri/src/commands/documents.rs:19` | Add `plain_text` to SELECT, or remove it from `Document` struct if intentionally deferred | ☐ |
| **P2.4** | **FTS5 query escaping is incomplete** — only escapes `"`; `*`, `(`, `)`, `OR`, `AND`, `NOT`, `NEAR` are treated as operators by FTS5 | `src-tauri/src/commands/search.rs:27` | Strip or escape all FTS5 special characters, or use a dedicated sanitizer | ☐ |
| **P2.5** | **No input validation on IPC parameters** — empty names, extremely long bodies, unbounded search queries accepted | All command handlers | Add length/content validation at command entry points | ☐ |
| **P2.6** | **`dangerouslySetInnerHTML` with incomplete sanitization** — search snippets use `escapeSnippet` but only escapes `&<>"'`. FTS5 `<mark>` tags preserved | `src/components/search/SearchDialog.tsx:136` | Consider DOMPurify for extra safety, or validate that snippet only contains expected tags | ☐ |
| **P2.7** | **Broad filesystem permissions** — `fs:default` + `shell:default` grants significant access | `src-tauri/capabilities/default.json` | Tighten to minimum required permissions (scope `fs:allow-read` to project dir, `fs:allow-write-file` to project dir) | ☐ |
| **P2.8** | **Updater is misconfigured / insecure** — placeholder `[owner]` in endpoint (now `mabo-du`), empty `pubkey` (replaced in round-59), missing `updater:default` capability | `src-tauri/tauri.conf.json:26`, `capabilities/default.json` | Wire up `updater:default` capability in `capabilities/default.json` before the first signed release (or remove the updater plugin until ready) | ☐ |
| **P2.9** | **`document_get_content` uses `fetch_one` instead of `fetch_optional`** — unhandled error on stale document ID | `src-tauri/src/commands/documents.rs:35` | Change to `fetch_optional` and return empty string gracefully | ☐ |
| **P2.10** | **`annotations_list_by_code` transfers redundant data** — includes full `d.plain_text` for every annotation segment | `src-tauri/src/commands/annotations.rs:140` | Extract segment text server-side with `substr()` or return only needed fields | ☐ |
| **P2.11** | **Context menu "Assign code..." doesn't check selection** — right-click without text selection dispatches Ctrl+K but nothing happens, no feedback | `src/components/editor/DocumentEditor.tsx:175` | Check `textSelection` before dispatching; show toast if none | ☐ |
| **P2.12** | **No `updated_at` on `code` table** — `memo` has both timestamps; `code` only has `created_at` | Schema + `codes.rs` | Add `updated_at` column; update it in `codes_update` | ☐ |

---

## P3 — Low (Polish / Quality / Dead Code)

| # | Issue | File(s) | Fix | Status |
|---|-------|---------|-----|--------|
| **P3.1** | **`lib.rs` is dead template code** — `greet` command and `run()` never used; `main.rs` is the real entry point | `src-tauri/src/lib.rs` | Delete or repurpose | ☐ |
| **P3.2** | **Application title is wrong** — `index.html` says "Tauri + React + Typescript"; `tauri.conf.json` window title is lowercase "lens" | `index.html`, `tauri.conf.json` | Set to "LENS" / "LENS — Qualitative Data Analysis" | ☐ |
| **P3.3** | **README.md is default Tauri template** — no LENS-specific content | `README.md` | Write project description, setup instructions, features | ☐ |
| **P3.4** | **ARCHITECTURE.md is placeholder** — only contains "Describe the system's purpose" | `ARCHITECTURE.md` | Write actual architecture overview or delete | ☐ |
| **P3.5** | **Empty directories** — `schemas/`, `migrations/` (root), `seeds/`, `src/components/dialogs/`, `src-tauri/src/db/queries/` | Multiple | Delete empty dirs or add `.gitkeep` + purpose comments | ☐ |
| **P3.6** | **TypeScript `any` types** — 7+ instances across IPC and export files | `src/ipc/annotations.ts`, `src/ipc/codes.ts`, `src/export/*.ts`, `src/components/memos/AnnotationMemoDialog.tsx` | Replace with proper types | ☐ |
| **P3.7** | **Error handling uses raw `alert()`** — 6 instances; no structured error system | `App.tsx`, `CodeTree.tsx`, `DocumentEditor.tsx` | Replace with `sonner` toasts (already installed) | ☐ |
| **P3.8** | **Search `code:` prefix is UI-only** — banner shows but prefix is never stripped or sent to backend | `src/components/search/SearchDialog.tsx:100` | Parse `code:` prefix, extract code name/ID, pass as `codeIdFilter` | ☐ |
| **P3.9** | **Memo search result click does nothing** — only logs to console | `src/components/search/SearchDialog.tsx:76` | Open relevant memo dialog or navigate to linked code/annotation | ☐ |
| **P3.10** | **CSV export crashes on missing `plainText`** — `doc.plainText.substring()` without null check | `src/export/CsvExporter.ts:39` | Add null check or use `doc.plainText ?? ''` | ☐ |
| **P3.11** | **`shadcn` installed as npm package** — shadcn/ui components are usually copied, not installed as a package | `package.json` | Verify this is intentional; may cause version conflicts | ☐ |
| **P3.12** | **`next-themes` installed but unused** — dark mode CSS variables exist but no toggle | `package.json`, `App.css` | Either add dark mode toggle or remove dependency | ☐ |
| **P3.13** | **`tauri-plugin-sql` included but unused** — app uses `sqlx` directly | `src-tauri/Cargo.toml`, `main.rs` | Remove if not needed, or document why both exist | ☐ |

---

## P4 — Missing Features / Infrastructure (Strategic)

| # | Issue | Priority | Status |
|---|-------|----------|--------|
| **P4.1** | **No annotation deletion UI** | High | ☐ |
| **P4.2** | **No project close button** | High | ☐ |
| **P4.3** | **No document deletion** | Medium | ☐ |
| **P4.4** | **No project rename** | Medium | ☐ |
| **P4.5** | **No recent projects list** | Medium | ☐ |
| **P4.6** | **No undo/redo for annotations** | Medium | ☐ |
| **P4.7** | **No code co-occurrence matrix / analytics** | Low | ☐ |
| **P4.8** | **No REFI-QDA import** | Low | ☐ |
| **P4.9** | **Zero test coverage** | **Critical** | ✅ Partially addressed — test harness installed |
| **P4.10** | **No CI/CD pipeline** | High | ☐ |
| **P4.11** | **No loading states** | Medium | ☐ |
| **P4.12** | **No i18n** | Low | ☐ |
| **P4.13** | **Image/media annotation schema has zero implementation** | Low | ☐ |

---

## Manual Review Findings (Not Caught by 4 LLMs)

| # | Issue | Location | Why It Matters | Status |
|---|-------|----------|----------------|--------|
| **B1** | **Asset copy uses `try_read()` which fails silently** — if project folder lock is held (concurrent access), asset copy is skipped with only an `eprintln!` | `src-tauri/src/commands/import.rs:103` | Original files may not be in `assets/` for export | ☐ |
| **B2** | **`code_closure` delete in `codes_move` is incorrect** — Step 1 deletes closure rows where ancestor is outside subtree but descendant is inside. This removes ALL parent links for the subtree, not just the old ones | `src-tauri/src/commands/codes.rs:179` | Review closure table move algorithm against standard reference | ☐ |
| **B3** | **`AnnotationMemoDialog` debounce captures stale event target** — `e.target.value` is read inside the `setTimeout` callback | `src/components/memos/AnnotationMemoDialog.tsx:44` | Capture `const value = e.target.value` before timeout | ☐ |
| **B4** | **Same debounce race in `ProjectJournalDialog` and `CodeMemoPanel`** | Multiple | Apply same fix everywhere | ☐ |
| **B5** | **Window dimensions too small** — `tauri.conf.json` sets 800×600 for a QDA app that needs to show document + code tree + annotations side-by-side | `src-tauri/tauri.conf.json:17` | Increase default to at least 1280×800 | ☐ |
| **B6** | **`documents_import` doesn't copy TXT files to assets** — only copies if `fileFormat !== 'txt'`, but REFI-QDA export always writes `${document.id}.txt` | `src-tauri/src/commands/import.rs:97` | Also copy TXT source files to assets dir | ☐ |

---

## Recommended Implementation Order

### Phase 1: Make It Work (Days 1–2)
1. **Fix P0.1 + P0.2** — Add `selection_type = 'text'` to annotation INSERT; seed `local_user` on project creation
2. **Fix P0.3 + P0.4** — Fix export SQL column mismatches
3. **Fix P0.5** — Correct ProseMirror offset bridge (+2, not +1) and test with a real document
4. **Fix P1.1** — Cascade code delete to children
5. **Fix P1.4** — Replace `.unwrap()` in `projects_open`
6. **End-to-end smoke test:** Create project → Import TXT → Create code → Annotate text → Export QDPX

### Phase 2: Make It Safe (Days 3–4)
7. **Fix P1.2** — Add cycle detection to `codes_move`
8. **Fix P1.3** — Replace all `.unwrap()` panics with safe fallbacks
9. **Fix P1.5** — Add PDF sidecar shell permission
10. **Fix P1.7** — Sanitize project names
11. **Fix P2.1** — Wrap `codes_update` in transaction
12. **Fix P2.3** — Include `plain_text` in document list or fix type

### Phase 3: Make It Right (Days 5–7)
13. **Fix P2.2** — Clean up memo debounce race conditions
14. **Fix P3.6** — Remove `any` types
15. **Fix P3.7** — Replace `alert()` with `sonner` toasts
16. **Fix P3.1–P3.5** — Delete dead code, fix titles, clean empty dirs
17. **Add basic test coverage** — At minimum: one Rust unit test for closure table + one TypeScript test for offset bridge

### Phase 4: Make It Complete (Ongoing)
18. Add annotation deletion UI
19. Add project close button
20. Add document deletion
21. Set up CI/CD (GitHub Actions for Rust + TypeScript build)
22. Implement `codes_get_subtree` or remove it
23. Add dark mode toggle (or remove `next-themes`)

---

## Test Harness Status

| Test Suite | Location | Tests | Status |
|-----------|----------|-------|--------|
| Happy path integration | `src-tauri/src/tests.rs` | 3 | ✅ Passing — catches P0.1/P0.2 annotation bug |
| Normalise unit tests | `src-tauri/src/import/normalise.rs` | 5 | ✅ Passing |
| Offset bridge unit | `src/utils/offset-utils.test.ts` | 6 | ✅ Passing |
| Export regression | `src-tauri/src/tests.rs` | 1 | ✅ Passing — catches P0.3/P0.4 export bugs |

**Total: 15 tests passing (9 Rust + 6 TypeScript)**

---

## The "What You're Missing" Consensus

All four reviewers independently converged on the same answer:

> **The app has never been run end-to-end, and there are no tests.** The critical bugs (missing `selection_type`, export column mismatch) are exactly the kind that a single integration test or 30 seconds of manual smoke-testing would have caught. The architecture is solid, but the gap between "it compiles" and "a researcher can code a document" is much wider than it appears. After the ~5 P0 fixes, you'd have a genuinely working MVP.
