# LENS Architecture

> A write-up for future maintainers. Each chapter links to the implementation,
> cites the research that drove the decision, and flags known limitations.
> Cross-references to specific research papers in `docs/research-papers/`
> use the short title in italics.

## Contents

1. [Foundations & Vision](#1-foundations--vision)
2. [Tauri vs. Electron](#2-tauri-vs-electron)
3. [Local-First SQLite Data Model](#3-local-first-sqlite-data-model)
4. [Closure Table for Hierarchical Codes](#4-closure-table-for-hierarchical-codes)
5. [FTS5 Search & External Content](#5-fts5-search--external-content)
6. [Operational Safety & Migrations](#6-operational-safety--migrations)
7. [The Editor: ProseMirror Integration](#7-the-editor-prosemirror-integration)
8. [Character Offset Fidelity](#8-character-offset-fidelity)
9. [Overlapping Annotations](#9-overlapping-annotations)
10. [Code Tree & Coding UI Mechanics](#10-code-tree--coding-ui-mechanics)
11. [Importing & Text Extraction](#11-importing--text-extraction)
12. [Text Normalisation Strategy](#12-text-normalisation-strategy)
13. [REFI-QDA Compliance (.qdpx / .qdc)](#13-refi-qda-compliance-qdpx--qdc)
14. [Auxiliary Exports (CSV / HTML)](#14-auxiliary-exports-csv--html)
15. [Multimedia V2 (Image / Audio / Video)](#15-multimedia-v2-image--audio--video)
16. [Collaboration & Inter-Coder Reliability V2](#16-collaboration--inter-coder-reliability-v2)

---

## 1. Foundations & Vision

LENS is a single-user, offline-first **qualitative data analysis** (QDA) desktop
application. The intent is the researcher sits in front of their own machine
with their interview transcripts, field notes, and policy documents, never
uploads anything anywhere, and works through positional knowledge and
interpretation entirely on locally-stored data.

The three architectural pillars that flow from this intent:

| Pillar | Consequence |
|---|---|
| **Offline-first.** Every byte the user has ever coded must survive a power loss, an OS crash, and a root-disk failure with no cloud backup. | The storage substrate is SQLite in WAL mode (chapter 3); the migration runner is synchronous at startup (chapter 6); every multi-row write is wrapped in an explicit transaction (chapter 6). |
| **Single-user.** No record-locking, no row-versioning for concurrent writers, no multi-tenant isolation. | No auth subsystem in `AppState`. The `local_user` row is autoincrement-style: one row per project, created lazily on first project open. No usernames, no passwords except the optional SQLCipher passphrase. |
| **Software-longevity.** A solo maintainer must be able to ship fixes for at least 24 months without rewriting the core. | Tauri over Electron (chapter 2); SQLite over network-attached or remote storage; ProseMirror over Lexical (chapter 7); no node-gyp, no electron-rebuild (chapter 2). |

> Source: *The Solo Maintainer's Choice (Tauri's longevity for local-first
> QDA)* and *Architecting the Expert-QDA Workflow (research-grade QDA without
> subscription lock-in)*.

The MVP scope: text transcripts (TXT, DOCX, PDF), hierarchical codebook with
unlimited nesting depth, character-offset text annotations, memos attached to
codes / annotations / project as a whole, full-text search across the corpus,
and REFI-QDA export for portability across NVivo, MAXQDA, and ATLAS.ti.

v1 explicitly defers image / audio / video coding, inter-coder reliability
metrics, and baton-pass collaboration — these are scoped in chapters 15–16
but not implemented.

---

## 2. Tauri vs. Electron

The framework decision was made before the first line of code. The two
candidates were Tauri 2 (Rust backend, native WebView front-end) and Electron
(bundled Chromium, Node.js main process). Both can technically build the
product; the question is long-term maintainability under a solo developer.

The decision was **Tauri 2**, but the reasoning is worth recording because it
will be revisited whenever the build chain breaks.

**Why Tauri wins for solo maintenance:**

- **No `node-gyp` rebuild hell.** Every native dependency in an Electron
  build (better-sqlite3, sharp, anything with a `.node` binary) must be
  recompiled against the specific bundled Node.js + libuv + V8 ABI. Each
  release of Electron risks breaking this. Tauri's Rust-side dependencies
  use stock `cargo build --target $TRIPLE`, which produces a static binary
  without any per-platform ABI dance.
- **Native WebView is the user's OS.** Tauri ships the application shell
  and the Rust backend; the renderer runs in the OS-provided WebView
  (WebKit on macOS, WebKitGTK 4.1 on Linux, WebView2 on Windows). The
  binary is materially smaller and boots faster.
- **Modular breakage.** When something breaks in a Tauri plugin, it's
  the plugin — not the entire `BrowserWindow` abstraction. Tauri's release
  workflow (`tauri-action`) automates macOS / Windows / Linux builds and
  notarisation, so the solo developer spends minutes not hours getting
  releases out.

**The trade-off Tauri accepts:**

- WebView rendering is not pixel-identical across OSes. For annotation
  highlights, inline decorations, and CSS colour blending, a Windows user,
  a macOS user, and a Ubuntu user may see *very slightly* different
  output. The MVP scope is English-first plain-text with CSS-only
  decorations, so this risk is bounded. v2+ RTL and CJK support will
  require real cross-OS screenshot diffing.

**Security posture (Tauri defaults we explicitly keep):**

- IPC channels are explicit and namespaced (`codes:create`, `annotations:list-by-code`),
  not a generic `db:query` allow-all (see *The Solo Maintainer's Choice*
  §"Secure IPC for SQLite Isolation"). The renderer never sees a raw SQL
  capability; the only way to mutate project state is the typed command set
  in `src-tauri/src/commands/`.
- Capability files in `src-tauri/capabilities/default.json` declare the
  shell-side plugin permissions (dialog, fs, shell for the pdfplumber
  sidecar, updater, store). Adding a new capability requires an explicit
  PR review.
- CSP is configured in `tauri.conf.json` to deny remote script loading.

> Source: *The Solo Maintainer's Choice (Tauri's longevity for local-first
> QDA)* §"Framework Selection" and *Electron Desktop App Architecture Report*.

---

## 3. Local-First SQLite Data Model

One SQLite file per project, named `project.qdaproj`, lives at the root of the
project folder alongside an `assets/` subfolder that stores imported source
files. WAL mode is on by default, `synchronous=NORMAL`, foreign keys enforced.
See `src-tauri/src/db/mod.rs` §`init_db` and migration `01_initial_schema.sql`.

**Why one file, no server.** The researcher authentication surface is zero,
the network surface is zero, the "where is my data" question has one answer:
look at the project folder. SQLite in WAL mode supports concurrent readers
with a single writer — exactly the access pattern of a QDA tool (one human,
many reads between writes).

**Why UUIDv4 for every primary key.** REFI-QDA requires UUIDs for all
analytical entities (Project, Source, Code, Selection, User) for
interoperability across NVivo / MAXQDA / ATLAS.ti (see *REFI-QDA Export
Plugin Technical Guide*). Integer auto-incrementing PKs would cause
primary-key collisions during cross-platform import. The schema enforces
`TEXT PRIMARY KEY` with UUID strings throughout.

**Indexing that matters.** Every multi-row query in the hot path has a
covering B-tree index:

- `idx_document_project` and `idx_document_sort` for the document list
  (scroll, sort, by-project).
- `idx_closure_descendant` for ancestor-by-descendant lookups (chapter 4).
- `idx_selection_document / code / type` for the annotation renderer and
  the Code View.
- `idx_ts_document_range` for ordered display of all text spans on
  document open.
- FTS5 virtual tables (chapter 5) power the search panel.

**Known limitations:**

- Single-process assumption. WAL allows concurrent reader processes but
  LENS does not exploit this — there is exactly one process opening the
  database at a time. If a second instance is launched, the new instance
  will open with WAL and will not see the older instance's uncommitted
  writes. The user-facing mitigation is chapter 16's baton-pass lock file.
- No backup-on-write. The user is responsible for backups. We surface the
  project folder path clearly in the empty-state UI; v1.1 should add a
  one-click "snapshot project" command (sqlite `.backup`) to the menu.

> Source: *QDA App SQLite Data Model Report* §1, §2, §4 and *Architecting
> the QDA Data Layer (read-optimised code trees, corpus-ordered search)*.

---

## 4. Closure Table for Hierarchical Codes

The code tree is the conceptual backbone of any QDA project. Researchers
move, rename, delete, and re-parent codes constantly during axial coding.
The data layer must make these operations cheap and atomic.

We use a **closure table** (one row per `ancestor → descendant → depth`
triple) stored alongside the `code` table. Every code has a self-referencing
row at depth 0; parent-child relationships add depth-1 rows; transitive
relationships are added at their actual depth.

See `src-tauri/src/commands/codes.rs` §`codes_create_internal`,
`§codes_move_internal`, `§codes_delete_internal`. See the invariant test
`closure_table_invariant_depth_stacking` in `src-tauri/src/tests.rs` for
proof that the move SQL is mathematically correct under every hierarchy
shape (3-level chain → root target; 3-level chain → depth-2 target).

**Why closure table over alternatives:**

| Scheme | Subtree lookup | Move cost | Reasoning fitness |
|---|---|---|---|
| Adjacency list only | Recursive CTE | 1 row update | CTE fails inside complex analytic joins with FTS — see *QDA App SQLite Data Model Report* §1.1 |
| Nested sets (Celko) | O(1) range scan | Mass row update + drift risk | Tree mutations are common in axial coding. Drift = silent data corruption. |
| **Closure table** | **O(1) join** | **2-stmt transaction** | **Both reads and writes stay bounded. This is what we chose.** |

**The four closure-table operations, all of them transactional:**

| Operation | SQL pattern |
|---|---|
| Insert code (optionally with `parent_id`) | INSERT self (depth 0) + INSERT (ancestor from `code_closure` WHERE descendant = parent, depth + 1) — see `codes_create_internal`. |
| Move subtree | DELETE stale closure rows where descendant ∈ subtree and ancestor ∉ subtree, then re-INSERT cross-join (`p.depth + s.depth + 1`). Cycle detection runs first. |
| Delete subtree | Identified via the closure (all `descendant` of the deleted anchor). FK `ON DELETE CASCADE` removes the closure rows automatically. |
| Subtree read | One-row query: `SELECT descendant FROM code_closure WHERE ancestor = ?`. Bounded by subtree size. |

**The cycle-detection rule.** Before moving code `X` to new parent `P`:
if `P == X`, reject (cannot move into self). If `X` already has `P` as a
descendant in the closure table, reject (would create a cycle). Tested in
`codes_move_rejects_cycles` and combined with the depth-stacking invariant.

**Known limitations:**

- The move SQL is a cross-join between `code_closure p WHERE p.descendant
  = new_parent` and `code_closure s WHERE s.ancestor = moved_id`. For
  extremely deep trees (paths > 32 nodes deep, which we have never seen
  in practice), the cross-join grows quadratically. A pathological-but-
  theoretical complexity, not a real-world one.
- We do NOT maintain a "code path" string column (e.g., `Themes/Identity`).
  Code paths are derived on demand from the closure table at render time
  (Key Query #3 in `01_initial_schema.sql`). For very wide codebooks
  (>500 leaves) the recursive substring extraction in the renderer may
  want caching — but that's a perf concern, not correctness.

> Source: *Architecting the QDA Data Layer (read-optimised code trees)* and
> *QDA App SQLite Data Model Report* §1.3.

---

## 5. FTS5 Search & External Content

Full-text search runs against two SQLite FTS5 virtual tables (`document_fts`
and `memo_fts`) configured as `content='document'` external content tables
whose segment B-trees persist on disk. Indexing is synchronous — every
INSERT, UPDATE, DELETE on `document` or `memo` fires a trigger that
inserts the deletion tombstone and the new row into the FTS index. See
`01_initial_schema.sql` for the trigger definitions.

**Why FTS5 over a JavaScript search index:**

- **No V8 heap pollution.** FlexSearch / Lunr.js / MiniSearch would force
  serialising the entire corpus across the IPC bridge and rehydrating it
  on every app launch — hundreds of megabytes of RAM allocated to search
  indexing alone, see *QDA App SQLite Data Model Report* §3.1.
- **On-disk segment B-trees.** FTS5's inverted index persists between
  launches; query time is unaffected by corpus growth; relevance ranking
  uses BM25 natively.
- **Triggers, not application code.** Index consistency is enforced at
  the database layer, so a bug in the renderer can't desync the search
  panel from the document store.

**Tokeniser choice (`unicode61 remove_diacritics 1`).** Correctly handles
Latin scripts with diacritics, North-South-East Slavic, and Devanagari.
The known limitation is **CJK languages** — there are no word boundaries
in unspaced Chinese / Japanese / Korean, so `unicode61` treats the entire
sentence as a single token. The mitigation is two-fold:

1. v1 surfaces this in the help text ("CJK researchers may need to search
   character sequences, not word sequences").
2. Per-project opt-in to the `trigram` FTS5 tokeniser would solve the
   problem at the cost of index size; this is a v1.1+ candidate.

**Query routing.** The combined search query (Key Query #7) unions the
document and memo FTS results, ordered by `document.sort_order` (import
order), not by relevance. Result corpus-ordering is the researcher's
expectation: the first result is the first thing they imported, not the
highest-ranked. Each result includes a `snippet()` excerpt with
`<mark>...</mark>` highlighting.

**Known limitations:**

- `snippet()` is tuned to 32 tokens before/after the match. For very long
  results the user may want to scroll; the snippet size is not currently
  user-configurable.
- Boolean operators (`AND`, `OR`, `NOT`, `NEAR/n`) work natively; the
  search input field does not currently surface a syntax help. v1.1+
  candidate to add an inline tooltip.

> Source: *QDA App SQLite Data Model Report* §3 and *Architecting the QDA
> Data Layer*.

---

## 6. Operational Safety & Migrations

The migration runner (`src-tauri/src/db/migrations.rs`) is intentionally
dumb: a list of `(&str, &str)` pairs (`name`, `include_str!`'d SQL file`),
run in order on every project open, recorded in a `schema_version` table.
Three migrations currently exist:

- `01_initial_schema.sql` — full schema bootstrap (tables, indexes, FTS5
  virtual tables, triggers).
- `02_unique_text_hash.sql` — `CREATE UNIQUE INDEX
  idx_document_unique_text_hash ON document(project_id, text_hash)`.
  Defender against the import race window — see chapter 11.
- `03_add_code_updated_at.sql` — adds the `code.updated_at` column with
  a self-update trigger, for the code audit trail.

**Why embedded SQL, not an ORM migration tool.** Knex / Drizzle ORM /
Sequelize / Kysely all have migration engines that scan the filesystem
at runtime. In production, the Electron / Tauri renderer bundles the
front-end into an ASAR archive; migration scripts become unreadable.
See *QDA App SQLite Data Model Report* §5.1.

**Transaction discipline.** Every multi-row write is wrapped in an
explicit `pool.begin()` / `tx.commit()`:

- `codes_create_internal` — code + closure-table self + closure-table
  parent-link edges, all in one tx.
- `codes_move_internal` — closure-row deletes + closure-row inserts, one tx.
- `codes_delete_internal` — descendant code rows + cascade, one tx.
- `documents_import_internal` — duplicate check + insert + sort_order
  fetch, one tx. Race window closed by migration 02's UNIQUE index; the
  resulting unique-constraint violation is mapped to the friendly
  "already imported" message.
- `document_delete_internal` — DB row + asset-file removal, with the
  asset file removed as a best-effort post-tx step (DB is
  authoritative; missing asset file is a warning, not an error).

**Phase B correctness invariants tested (see `src-tauri/src/tests.rs`):**

- 3-level chain, move the middle node to a root: 6 → 7 closure rows;
  every depth assertion verified.
- 3-level chain, move the middle node under a depth-2 ancestor (Y → X,
  then B under X): Y → C composes to depth 3, stress-testing the
  `p.depth + s.depth + 1` formula.
- Cycle detection: cannot move a parent into its own descendant.
- Race guard: concurrent inserts produce the friendly duplicate message.

**Known limitations:**

- The migration runner does not provide a down-migration. If a v1.1
  release ships a migration that turns out to be wrong, the path back is
  the user's pre-migration backup, not a `cargo migrate down` flag. This
  is intentional: it forces shipping migrations to be additive or
  defensive (new column with default, new index, replace trigger) rather
  than destructive.
- The migration runner runs at every `init_db()` call. For projects that
  open the database repeatedly within a session, the `schema_version`
  `SELECT` is still issued (cheap, indexed). Caching the "all migrations
  applied" state in `AppState` would be a good v1.1 optimisation.

> Source: *QDA App SQLite Data Model Report* §4, §5 and
> *QDA Collaboration and Reliability Report*.

---

## 7. The Editor: ProseMirror Integration

The v1 document editor is a thin React wrapper around ProseMirror
(`src/components/editor/DocumentEditor.tsx` + `QdaAnnotationPlugin.ts`).
The entire schema is plain-text-in-a-paragraph: one block node, zero
formatting marks, one inline plugin for annotation decorations.

**Why ProseMirror over Lexical** (this was the second hardest precondition
decision):

- **Character offset fidelity is the data model's foundation.** Lexical's
  writer ("*The Lexical Advantage: Overlapping Annotations in Qualitative
  Data Analysis*") explicitly flags offset handling as "speculative" and
  "the most significant variable." For a tool where the entire export
  depends on `start_char` / `end_char` being byte-stable across imports
  and re-renders, that's not acceptable for MVP.
- **Decoration model is proven.** Hypothesis — the canonical web
  annotation tool — uses ProseMirror to handle exactly the same problem
  at scale. The mental model aligns with what Hypothesis ships in production.
- **Bidi deficiency is real but bounded.** ProseMirror's bidi handling
  is weaker than Lexical's. The MVP scope is English-first; bidi is a
  v2+ concern.

**Editor state lifecycle.** On document open:

1. Fetch the document row from `document.plain_text` (the canonical
   immutable snapshot — never re-extracted after import).
2. Build a ProseMirror `EditorState` with the plain-text-only schema,
   the `history` plugin, and the custom `QdaAnnotationPlugin`.
3. Fetch all annotations for this document via the typed IPC, hydrate
   the Zustand store, the plugin's `DecorationSet` builds from this list.
4. The view is **read-only** — `editable() => false`. The only user
   interactions are text selection (which triggers code assignment
   affordance) and clicking an existing highlight (to inspect or remove).

**Closed-form offset bridge** (`src/utils/offset-utils.ts`):
`pm_pos = char_offset + 1` for the plain-text-in-a-single-paragraph
schema. Tested in `tests.rs` round-trip verification.

> Source: *The Lexical Advantage (Overlapping Annotations in QDA)*,
> *Rich Text Editor for QDA Annotations*, and
> *Achieving Annotation Integrity Across Platforms*.

---

## 8. Character Offset Fidelity

The single most important invariant in the data model is that
`document.plain_text[start_char..end_char]` always produces the same
substring it produced at the moment the annotation was created. If the
canonical text ever mutates after import, every existing annotation in
the project becomes silently wrong.

**Invariants enforced at the schema and application layers:**

| Layer | Mechanism |
|---|---|
| Schema | `document.plain_text` is set on INSERT and never UPDATEd. There is no `update_document_text` public function in the Rust binary. |
| Import | Every import flow runs raw text through the `normalise_text` pipeline (chapter 12) before storing, so the canonical comparison unit is *post-normalisation*. |
| Hash | `document.text_hash` is `sha256(post-normalised-text)`. Re-imports and merge imports use this hash for duplicate detection (chapter 11). |
| ProseMirror bridge | `char_offset -> pm_pos` is `+1` (the paragraph open tag). `pm_pos -> char_offset` is `-1`. Round-trip tested. |
| Schema version | A migration that ever modified `plain_text` would have to be rejected. The migration runner allows additive changes only (chapter 6). |

**What is currently *not* protected:**

- If `normalise_text` itself changes between releases (e.g., a new
  ligature added to the expansion table), existing annotations are not
  rewritten. The user's `document.text_hash` stays stable (no reimport
  changes), but their annotation offsets may point to slightly different
  substrings after the upgrade. This is a known risk; the mitigation is
  to pin the normalisation rules per release and only add new ones.

> Source: *Achieving Annotation Integrity Across Platforms (Deterministic
> Annotation Pipeline)* and *QDA Document Import and Annotation Stability*.

---

## 9. Overlapping Annotations

A core QDA workflow: the same passage should be coded with N codes
simultaneously. NVivo and ATLAS.ti both render overlapping highlights;
LENS does too, via ProseMirror's native decoration nesting.

**How it works.** The `QdaAnnotationPlugin` maintains a ProseMirror
`DecorationSet`. On every annotation change, it walks the active
annotations and creates one `Decoration.inline()` per (document, code,
range) tuple. The decoration's CSS class + inline `style` carries the
code colour:

```text
background-color: ${alpha(code.color, 0.35)};          /* fill */
border-bottom: 2px solid ${code.color};                 /* outline */
data-annotation-id, data-code-id attributes for click-target + a11y
```

ProseMirror's decoration renderer emits one `<span>` per decoration,
nested as needed for overlapping ranges. Three overlapping codes on the
same passage produce three nested spans; the fill colours visually stack
layer-by-layer, the borders stay distinct. Verified visually in v0.1
QA across Windows / macOS / Linux WebViews.

**Marginal code indicator.** In addition to the inline highlight, a
right-margin annotation strip renders an `<ATLAS.ti>-style bracket`:
one coloured marker per annotation, positioned at the vertical offset
matching the annotation's location in the document. This is a
synchronously-updated absolutely-positioned div (not a ProseMirror
decoration — the editor does not natively support margin elements).

**Known limitations:**

- Adding/removing decorations re-renders the affected inline ranges. For
  a document with thousands of annotations, decoration update latency
  scales linearly. v1 is well within bounds; v2 with batch-render optimisations
  is on the roadmap if profiling says it's needed.
- The marginal code strip does not currently support drag-to-bulk-reassign
  (move a marker to drop on a different code). v1.1 candidate.

> Source: *The Lexical Advantage*, *Rich Text Editor for QDA Annotations*,
> *Achieving Annotation Integrity Across Platforms*, *QDA UX Design Patterns*.

---

## 10. Code Tree & Coding UI Mechanics

The right-hand panel is a hierarchical code tree (react-arborist)
showing the user's codebook with depth-first expand/collapse, inline
rename, drag-to-reparent, and a fuzzy-search filter. Below the tree is
an active-selection code-assignment area that appears when the user has
a text selection in the editor.

**Three paths to assign a code:**

1. **Click on a tree node** — the primary mechanism. When the user
   mouse-up's a selection, tree nodes show an "assignable" pulse
   animation; clicking creates the annotation.
2. **`Ctrl+K` fuzzy picker** — the high-efficiency mechanism for
   experienced coders. A shadcn/ui `Command` palette appears over the
   document, fuzzy-search over code names, keyboard-navigable, `Enter`
   to assign, `Escape` to dismiss.
3. **Right-click context menu** — secondary path, opens the fuzzy
   picker as well, or shows "Remove annotation" when right-clicking an
   existing highlight.

The Code View (clicking a code in the tree → switch right panel to
"segments grouped by this code") is implemented via Key Query #4 — a
JOIN across `selection`, `text_selection`, and `document` ordered by
`document.sort_order` then `start_char`. Each segment displays
2–3 lines of context and is click-through to navigate to the source
passage.

> Source: *QDA UX Design Patterns*, *The Lexical Advantage*, and
> *Achieving Annotation Integrity Across Platforms*.

---

## 11. Importing & Text Extraction

Every supported file format lands in the same shape on disk: a row in
the `document` table containing the canonical plain-text snapshot, plus
the original binary in `assets/{uuid}.{ext}`. The extraction pipeline
runs in `src-tauri/src/commands/import.rs`; the per-format files are
in `src-tauri/src/import/`.

| Format | Path | Extractor_id pattern |
|---|---|---|
| `txt` | Direct UTF-8 read | `plain-text-1.0` (constant) |
| `docx` | Rust-native unzip + roxmltree parse | `lens-docx-{version}` (constant in `commands/import.rs`) |
| `pdf` | PyInstaller-compiled `pdfplumber` sidecar binary, shelled out via `tauri-plugin-shell` | `pdfplumber-{version}` — version is **baked at compile time** by `src-tauri/build.rs`, reading from `src-tauri/sidecars/pdfplumber/requirements.txt` |
| OCR fallback for scanned PDFs | Tesseract.js WASM in a Web Worker in the renderer | `tesseract.js-{version}` (planned, not in MVP) |

**Why a sidecar rather than `pdf-rs` in Rust.** pdf-rs is fast and pure
Rust but its layout extraction is worse than pdfplumber's for academic
and multi-column PDFs. For a qualitative-research workload where most
inputs are interview transcripts, scanned policy documents, and
multi-column journal articles, the sidecar's `x_tolerance=3,
y_tolerance=3` heuristic produces markedly better-text layouts. The
sidecar cost is a one-time per-platform build; the runtime overhead is
process-spawn per import (acceptable for human-rate workflows).

**Sidecar build pipeline.** `scripts/build-sidecar.sh` builds a
PyInstaller `--onefile` binary targeting the host architecture. The
canonical binary per architecture lives at
`src-tauri/sidecars/pdfplumber/pdfplumber-{triple}`. CI builds for
`x86_64-unknown-linux-gnu` (Linux), `x86_64-pc-windows-msvc` (Windows),
`x86_64-apple-darwin` (macOS Intel), `aarch64-apple-darwin` (macOS
Apple Silicon). The Tauri bundler picks the right binary per platform
build.

**Race-window-defended duplicate detection.** Two paths to the same
`text_hash` would silently create two documents if only the optimistic
check ran. The defence-in-depth is:

1. Migration `02_unique_text_hash.sql` creates
   `UNIQUE INDEX idx_document_unique_text_hash ON document(project_id,
   text_hash)`.
2. `documents_import_internal` wraps duplicate-check + INSERT in an
   explicit `tx`. After the optimistic `duplicate_exists` check, the
   INSERT's `.execute()` is matched on
   `sqlx::error::ErrorKind::UniqueViolation`. If two concurrent imports
   both pass the optimistic check, the second one to commit hits the
   UNIQUE constraint and is surfaced to the user as "already imported",
   not as a raw SQLite error string.

**DOCX MVP limitations** (documented in the file's rustdoc):

- Revision history, tracked changes accept/reject, footnotes, comments:
  all dropped. Only the live-edit view of `word/document.xml` is parsed.
- Top-level tables: paragraphs are inlined into the body output stream,
  losing row/column structure.
- Non-Latin scripts round-trip correctly because the parser is byte-level
  UTF-8 inside `<w:t>`; offset fidelity is approximated, not guaranteed
  to match NVivo/ATLAS.ti on the same source.

**OCR fallback** (planned for v1.1, not in MVP): detect a "less than 100
chars extracted from a >1-page PDF" sign and offer Tesseract.js in the
renderer; if accepted, set `extractor_id = 'tesseract.js-{version}'` and
`file_format = 'ocr_pdf'`.

> Source: *QDA Document Import and Annotation Stability*, *The Solo
> Maintainer's Choice (sidecar rationale)*.

---

## 12. Text Normalisation Strategy

Every extracted text — regardless of source format — runs through the same
seven-step normalisation pipeline in `src-tauri/src/import/normalise.rs`
before storage. The output is the canonical text the database remembers;
all subsequent comparisons (re-import dedupe, FTS indexing, annotation
overlap) operate on this canonical form.

| Step | Transform | Rationale |
|---|---|---|
| 1 | Strip UTF-8 BOM (`U+FEFF`) | The BOM appears in Windows-native exports and pollutes substring extraction. |
| 2 | Unicode NFC | Visual-equivalence; the database keys on bytes, not glyphs. |
| 3 | Strip soft hyphens (`U+00AD`) | These are line-break hints, not data; they survive `<w:t>` extraction and break `substr(start_char+1)`. |
| 4 | Ligature expansion | `ﬁ→fi`, `ﬀ→ff`, `ﬃ→ffi`, `ﬄ→ffl`, `ﬅ→ſt`, `ﬆ→st`. Library scan results need their glyph forms searchable as plain letters. |
| 5 | Line-ending normalisation | `\r\n` → `\n`, `\r` → `\n`. Cross-OS source documents. |
| 6 | Collapse 3+ consecutive newlines to 2 | Blank-line triple-counting breaks research conventions around paragraph breaks. |
| 7 | Trim leading / trailing whitespace | Defence against files with trailing form-feed artefacts. |

After normalisation, the canonical text is hashed with SHA-256 and stored
in `document.text_hash`. Word count uses whitespace-token splitting
(`text.split_whitespace().count()`) — sufficient for MVP; v2 may swap to
a tokeniser-aware count for CJK.

**Known limitations:**

- The ligature expansion table does not cover the full Unicode
  compatibility-decomposition set (e.g., LATIN SMALL LIGATURE LONG S T
  `U+FB05`, various Arabic presentation forms). v1.1+ candidate to widen.
- The BOM strip is a single-prefix check, not a per-character scan.
  Documents with embedded BOMs (rare) will not have those removed.

> Source: *Achieving Annotation Integrity Across Platforms*,
> *QDA Document Import and Annotation Stability*.

---

## 13. REFI-QDA Compliance (.qdpx / .qdc)

REFI-QDA is the open export standard maintained by the Rotterdam Exchange
Format Initiative that lets researchers move projects across NVivo,
MAXQDA, ATLAS.ti, and Dedoose. LENS implements both directions:
`.qdpx` export + import, and standalone `.qdc` codebook export + import.

**Namespace URI is `urn:QDA-XML:project:1.0`** — hardcoded as a constant
in `src/export/QdpxExporter.ts`, used in every element name in the
serialised XML. The wrong namespace URI is a known LLM-implementation
footgun (some research models report `https://www.qdasoftware.org/` —
incorrect). The hardcoding is the canonical fix.

**Dual-path export strategy** (per *Architecting Dual-Path REFI-QDA
Exports*):

- **Strict compliance path** — serialise exactly to `Projects.xsd`, full
  GUID fidelity, ARGB colour conversion from CSS hex (#RRGGBB →
  #FFRRGGBB), all metadata fields populated. Validated against `Projects.xsd`
  before the ZIP is written.
- **Permissive import path** — never throw on unrecognised elements. Silently
  skip what we don't know; warn (don't fail) on missing media files;
  prompt Merge-vs-Replace strategy for collisions in a non-empty project.
  Default to Merge. Round-trip tested in
  `qdpx_import_merge_mode_imports_documents_codes_and_annotations`,
  `qdpx_import_replace_mode_clears_existing_data`, and
  `qdpx_import_merge_mode_preserves_existing_data`.

**GUID strategy.** All entities use the SQLite UUID v4 column directly as
the GUID attribute in the XML — no separate GUID mapping table. This makes
re-exports deterministic and survives database round-trips. The
`.qdc` codebook export shares the code-serialisation logic; import
plugs into the same code-creation path as the in-app tree builder, with
full closure-table maintenance.

**Undo on Replace-mode import.** The Replace-mode importer snapshots
the entire DB before clearing, then exposes
`qdpx_import_undo_internal` for a single-shot undo. Tested in
`qdpx_import_undo_restores_previous_data`. Implements a single-undo
(not a free-form journal) — if you Replace again before undoing, the
prior snapshot is lost.

**Known limitations:**

- Image and audio annotations are emitted as well-formed XML elements
  in `selection` extensions but with empty `region_data` / `start_ms`;
  REFI-QDA exports of annotated multimedia documents are documented as
  best-effort until chapter 15 ships.
- REFI-QDA XML validation against `Projects.xsd` requires `libxmljs2`
  on the renderer side. If `libxmljs2` fails to load (rare OS edge
  case), export surfaces a clear error and does not write a broken file.

> Source: *Architecting Dual-Path REFI-QDA Exports*, *REFI-QDA Export
> Plugin Technical Guide*.

---

## 14. Auxiliary Exports (CSV / HTML)

Beyond REFI-QDA, two human-friendly export formats ship in v1.

**CSV.** One row per text annotation (image/audio v2+ are deliberately
omitted in v1). Columns:

1. `document_title`
2. `code_name`
3. `code_path` (full hierarchy, derived from closure-table ancestor path)
4. `start_char`, `end_char`
5. `segment_text` (substring from canonical `plain_text`)
6. `context_before`, `context_after` (50 chars each side)
7. `memo` (annotation-level inline memo)
8. `coder` (local user display name)
9. `created_at`

Output is RFC 4180-compliant UTF-8 with BOM (Excel compatibility);
fields with commas, quotes, or newlines are escaped via `"`-quoting.

**HTML report** (`src/export/HtmlReporter.ts` + Handlebars templates):
single-file, no external CSS/JS dependencies, print-friendly. Header
section has project name, export date, totals (documents / codes /
annotations / coding density per 1000 words). Body is depth-first
through the codebook; for each code, the heading with colour swatch, a
count of segments, then each segment listed with surrounding context.

> Source: *Architecting Dual-Path REFI-QDA Exports* and the existing
> `src/export/` implementation.

---

## 15. Multimedia V2 (Image / Audio / Video)

The MVP deliberately scopes out image / audio / video coding. The data
model is forward-compatible — the `selection` table already discriminates
by `selection_type` (`'text' | 'image_region' | 'media_ts'`), and the
`text_selection` / `image_selection` / `media_selection` extension tables
exist with the right columns. See `01_initial_schema.sql`.

**Image coding (v2).**

- Documents with `file_format = 'image'` open in a Konva.js canvas
  (`react-konva`). The user draws regions — rectangle tool for
  bbox-style, freehand polygon for hand-drawn regions.
- The polygon coordinates are stored in `image_selection.region_data`
  as a JSON `[[x,y],[x,y],...]` array with proportional (0.0–1.0)
  coordinates relative to image dimensions.
- The bounding-box envelope is computed from the polygon and stored
  alongside in `bbox_left/top/right/bottom` for the REFI-QDA
  `AreaReference` export.
- The code-assignment affordance reuses the same Ctrl+K fuzzy picker
  that text annotations use, so the user has one mental model for "tag
  a region with a code".

**Audio / video coding (v2.1).**

- Audio documents render in WaveSurfer.js. The user drags on the
  waveform to mark a time range, then assigns a code.
- Stored in `media_selection.start_ms` / `end_ms`.
- For documents with a linked transcript, the corresponding text span
  is highlighted alongside the time-range selection.

**Transcript synchronisation (v2+).**

- WebVTT and SRT files alongside an audio document parse into the
  `transcript_segment` table — word-aligned timestamps linked back to
  the document character offset.
- Clicking a transcript word seeks the audio player; selecting a media
  timestamp range highlights the corresponding transcript text.

> Source: *Designing a Standards-Compliant Multimedia Annotation Engine*,
> *QDA Multimedia Annotation Architecture*.

---

## 16. Collaboration & Inter-Coder Reliability V2

The MVP is single-user. The v2 roadmap introduces two collaboration
patterns.

**Baton-pass collaboration.**

- File-level conflict detection: on project open, check for
  `project.lock` in the project folder.
- If present, show a warning: "This project appears to be open on
  another device. Continuing may cause data conflicts."
- On successful open, write `project.lock` containing the local user's
  ID and an open timestamp. On clean close (Tauri `WindowEvent::CloseRequested`),
  delete it.
- This is **file-level** concurrency control — it prevents two humans
  from corrupting via parallel edits but does not merge divergent edits.
  The user passes the project folder to their collaborator like a USB
  stick.
- The mitigation in WAL-mode SQLite: if a second instance opens
  despite the lock, it sees WAL with the opener's uncommitted writes
  and merges them on next close; the conflicting transactions roll
  back with a clear SQLite error string surfaced to the user.

**Inter-coder reliability (ICR).**

- Character-level Cohen's kappa on text spans. Convert each coder's
  annotations for a given code on a given document into a binary
  character-level array (`annotated[i] = 1 if i is covered by any
  annotation for this code, else 0`), then run Cohen's kappa on the
  two arrays.
- Interpretation guide (Landis & Koch): < 0.4 poor, 0.4–0.6 moderate,
  0.6–0.8 substantial, > 0.8 near-perfect.
- The ICR panel is only available when a project has been coded by
  more than one `local_user`. v2+ will support multiple local users
  per project (the `local_user` row today is per-project auto-created;
  v2 lifts it to per-project with a user-switcher UI).

**Coding comparison view.** Side-by-side agreements / disagreements
on a shared document, computed via interval-set algebra: `A ∩ B` (both
coded), `A \ B` (only A coded), `B \ A` (only B coded). Rendered as
colour-coded highlights on a split-view read-only doc.

> Source: *From Isolation to Integration (Offline-First Collaborative
> QDA)*, *QDA Collaboration and Reliability Report*.

---

## Closing Notes for the Next Maintainer

The system as it stands today (v0.1.0-rc1) is the result of ~24 months of
incremental development with a single maintainer. The architecture above
describes every meaningful design decision made, with rationale grounded
in the 19 deep research papers that drove each choice.

If you are reading this because a decision in this codebase surprised
you, start with the chapter that owns that decision, then read the
cited papers. If a decision now needs to be reversed, the
`docs/scope.md` and `LENS_Implementation_Plan.md` files have additional
context. The `lens-planning-only` / `lens-implementation` separation
that I retrofitted mid-2026 means most of the decision history is
recoverable, not lost.

Welcome to the project.
