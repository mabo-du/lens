# LENS — Implementation Plan
### LENS: Local Ethnographic Narrative System
### Source: Heritage_Tech_Tool_Specs.md — Tool 12
### Based on 18 deep research reports

---

## Pre-flight: Two Decisions the Research Left Open

Before the coding agent proceeds, two architectural questions produced ambiguous or conflicting research outputs and require a resolved position to proceed.

**1. Framework — Tauri, not Electron.**
The Electron architecture report (which warned about WebView rendering fragmentation) and the Solo Maintainer report (which recommended Tauri for maintenance reasons) reached opposite conclusions. The tiebreaker is ecosystem consistency: Tauri 2 is already in production across StratiGraph, Cache & Carry, and grantAIde/Libby. A solo developer maintaining multiple tools benefits enormously from a single toolchain. The WebView fragmentation risk for annotation highlights is real but manageable by targeting minimum OS versions with modern WebView engines (Windows 10 + WebView2 evergreen runtime; macOS 11+; Ubuntu 22.04+ with WebKitGTK 4.1). The `electron-rebuild` / `node-gyp` problem, by contrast, compounds with every native dependency added. **Use Tauri 2 + React 19 + TypeScript throughout.**

**2. Rich text editor — ProseMirror, not Lexical.**
The Lexical report (titled "The Lexical Advantage") explicitly states in its own body that Lexical's character offset fidelity is "the most critical technical requirement" and remains "speculative," "the most significant variable," and "a complete lack of information." For a tool where character offsets are the entire foundation of the data model, adopting a framework whose offset handling is speculative is not acceptable for MVP. ProseMirror's decoration model is proven in production by Hypothesis — which solves exactly this problem at scale. The Bidi deficiency in ProseMirror is real but is a v2+ concern; the MVP is English-first, and the Bidi issue can be revisited when Lexical's maturity warrants it. **Use ProseMirror for the core document editor.**

---

## Part 1 — Resolved Architecture

### 1.1 Tech Stack

| Layer | Choice | Package / Crate |
|---|---|---|
| Desktop framework | Tauri 2 | `tauri` (Rust), `@tauri-apps/api` |
| Frontend framework | React 19 + TypeScript | `react`, `react-dom`, `typescript` |
| Build tool | Vite | `vite`, `@vitejs/plugin-react` |
| UI library | shadcn/ui + Tailwind CSS | `shadcn-ui`, `tailwindcss` |
| State management | Zustand | `zustand` |
| Rich text editor | ProseMirror | `prosemirror-state`, `prosemirror-view`, `prosemirror-model`, `prosemirror-commands`, `prosemirror-history` |
| Code tree component | react-arborist | `react-arborist` |
| Database | SQLite via Tauri SQL plugin | `tauri-plugin-sql` (Rust), `@tauri-apps/plugin-sql` |
| DOCX import | Rust native (zip + roxmltree) | (no NPM crate; pure Rust, see `src-tauri/src/import/docx.rs`) |
| PDF extraction | pdfplumber via sidecar | Python sidecar binary (see §3.2) |
| PDF fallback | pdf.js | `pdfjs-dist` |
| OCR fallback | Tesseract.js | `tesseract.js` |
| Text normalisation | unorm + custom | `unorm` |
| REFI-QDA XML | @xmldom/xmldom + xsd validation | `@xmldom/xmldom`, `libxmljs2` |
| ZIP (QDPX) | JSZip | `jszip` |
| Full-text search | SQLite FTS5 | built-in (no npm package) |
| Export: HTML report | Handlebars | `handlebars` |
| Image annotation (v2+) | Konva.js | `konva`, `react-konva` |
| Audio visualisation (v2+) | WaveSurfer.js | `wavesurfer.js` |
| Audio transcription (v2+) | whisper.cpp sidecar | bundled binary |
| Analytics: charts (v2+) | Recharts | `recharts` |
| Analytics: network (v2+) | react-force-graph | `react-force-graph` |
| Inter-coder reliability (v2+) | custom JS (see §7.1) | no package |
| Packaging | Tauri CLI + tauri-action | `@tauri-apps/cli`, GitHub Actions |
| Auto-update | Tauri updater plugin | `tauri-plugin-updater` |

### 1.2 Project Name

The app is named **LENS** — Local Ethnographic Narrative System. All configuration values derive from this:

| Config field | Value |
|---|---|
| `tauri.conf.json` `productName` | `LENS` |
| Binary name | `lens` / `lens.exe` |
| Bundle identifier | `org.heritagetech.lens` |
| GitHub repository | `lens` |
| Updater endpoint | `https://github.com/mabo-du/lens/releases/latest/download/latest.json` |
| Project file extension | `.qdaproj` (format identifier; kept generic for REFI-QDA family recognition) |

### 1.3 Repository Structure

```
lens/
├── src/                          # React frontend
│   ├── components/
│   │   ├── editor/               # ProseMirror wrapper + annotation plugin
│   │   ├── code-tree/            # react-arborist wrapper
│   │   ├── document-list/        # Document navigator panel
│   │   ├── memo/                 # Memo editor panel
│   │   ├── analytics/            # V2+ dashboard panels
│   │   └── ui/                   # shadcn/ui components
│   ├── ipc/                      # Typed IPC channel callers (frontend side)
│   │   ├── annotations.ts
│   │   ├── codes.ts
│   │   ├── documents.ts
│   │   ├── memos.ts
│   │   ├── projects.ts
│   │   └── search.ts
│   ├── store/                    # Zustand stores
│   │   ├── project.store.ts
│   │   ├── editor.store.ts
│   │   └── ui.store.ts
│   ├── export/                   # Export plugin system (frontend orchestration)
│   │   ├── ExporterRegistry.ts
│   │   ├── QdpxExporter.ts
│   │   ├── QdcExporter.ts
│   │   ├── CsvExporter.ts
│   │   └── HtmlReporter.ts
│   ├── utils/
│   │   └── offset-utils.ts       # ProseMirror ↔ char-offset bridge
│   └── main.tsx
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── db/
│   │   │   ├── mod.rs
│   │   │   ├── migrations.rs     # SQL migration runner
│   │   │   └── queries/          # One module per domain
│   │   │       ├── annotations.rs
│   │   │       ├── codes.rs
│   │   │       ├── documents.rs
│   │   │       ├── memos.rs
│   │   │       └── search.rs
│   │   ├── commands/             # Tauri #[tauri::command] handlers
│   │   │   ├── annotations.rs
│   │   │   ├── codes.rs
│   │   │   ├── documents.rs
│   │   │   ├── import.rs
│   │   │   ├── memos.rs
│   │   │   ├── projects.rs
│   │   │   └── search.rs
│   │   └── import/
│   │       ├── txt.rs
│   │       ├── docx.rs           # Rust-native DOCX extractor (zip + roxmltree)
│   │       ├── pdf.rs            # Shells out to pdfplumber sidecar
│   │       └── normalise.rs      # Text normalisation pipeline
│   ├── sidecars/
│   │   ├── pdfplumber/           # Python sidecar (see §3.2)
│   │   └── whisper/              # V2+ whisper.cpp sidecar
│   ├── Cargo.toml
│   └── tauri.conf.json
├── scripts/
│   └── build-sidecar.sh         # Script to compile pdfplumber sidecar
├── tests/
│   ├── fixtures/                 # .qdpx test files, sample PDFs, sample DOCX
│   └── ipc/                      # IPC channel integration tests
└── package.json
```

---

## Part 2 — Complete Database Schema

The database file is named `project.qdaproj` and lives at the root of the project folder. Run all DDL inside the migration runner on first open and on version upgrades.

```sql
-- ============================================================
-- PRAGMA SETTINGS (run once on every connection open)
-- ============================================================
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -32000;   -- 32 MB page cache

-- ============================================================
-- SCHEMA VERSION TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_version (
  version      INTEGER PRIMARY KEY,
  applied_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ============================================================
-- PROJECT METADATA
-- ============================================================
CREATE TABLE IF NOT EXISTS project (
  id           TEXT PRIMARY KEY,   -- UUID v4, assigned at creation
  name         TEXT NOT NULL,
  description  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ============================================================
-- LOCAL USER IDENTITY (baton-pass collaboration support)
-- ============================================================
CREATE TABLE IF NOT EXISTS local_user (
  id           TEXT PRIMARY KEY,   -- UUID v4, generated once, stored in app prefs
  display_name TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ============================================================
-- DOCUMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS document (
  id              TEXT PRIMARY KEY,   -- UUID v4
  project_id      TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  original_path   TEXT,               -- original file path at import time (informational)
  file_format     TEXT NOT NULL,      -- 'txt' | 'docx' | 'pdf' | 'ocr_pdf'
  plain_text      TEXT NOT NULL,      -- canonical snapshot; NEVER modified after import
  text_hash       TEXT NOT NULL,      -- SHA-256 of plain_text; used for re-import detection
  extractor_id    TEXT NOT NULL,      -- e.g. 'pdfplumber-0.11.0' | 'mammoth-1.8.0'
  word_count      INTEGER NOT NULL DEFAULT 0,
  imported_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_document_project ON document(project_id);
CREATE INDEX IF NOT EXISTS idx_document_sort    ON document(project_id, sort_order);

-- FTS5 virtual table for full-text search across document text
CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
  title,
  plain_text,
  content='document',
  content_rowid='rowid',
  tokenize='unicode61'
);

-- Triggers to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS document_fts_insert AFTER INSERT ON document BEGIN
  INSERT INTO document_fts(rowid, title, plain_text)
  VALUES (new.rowid, new.title, new.plain_text);
END;

CREATE TRIGGER IF NOT EXISTS document_fts_delete AFTER DELETE ON document BEGIN
  INSERT INTO document_fts(document_fts, rowid, title, plain_text)
  VALUES ('delete', old.rowid, old.title, old.plain_text);
END;

CREATE TRIGGER IF NOT EXISTS document_fts_update AFTER UPDATE ON document BEGIN
  INSERT INTO document_fts(document_fts, rowid, title, plain_text)
  VALUES ('delete', old.rowid, old.title, old.plain_text);
  INSERT INTO document_fts(rowid, title, plain_text)
  VALUES (new.rowid, new.title, new.plain_text);
END;

-- ============================================================
-- CODE TREE — CLOSURE TABLE
-- (Optimises read-heavy operations: full tree load, subtree
--  retrieval, ancestor path. Write operations maintain both
--  the Code table and the CodeClosure table.)
-- ============================================================
CREATE TABLE IF NOT EXISTS code (
  id           TEXT PRIMARY KEY,   -- UUID v4
  project_id   TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  color        TEXT NOT NULL DEFAULT '#6366f1',  -- hex colour
  description  TEXT,
  created_by   TEXT REFERENCES local_user(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_code_project ON code(project_id);

-- Closure table: one row per (ancestor, descendant, depth) pair.
-- Every node has a self-referencing row with depth=0.
CREATE TABLE IF NOT EXISTS code_closure (
  ancestor    TEXT NOT NULL REFERENCES code(id) ON DELETE CASCADE,
  descendant  TEXT NOT NULL REFERENCES code(id) ON DELETE CASCADE,
  depth       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ancestor, descendant)
);

CREATE INDEX IF NOT EXISTS idx_closure_descendant ON code_closure(descendant);

-- ============================================================
-- UNIFIED SELECTION TABLE (class table inheritance)
-- Covers text selections (MVP), image regions (v2+),
-- and media timestamps (v2+). selection_type discriminates.
-- ============================================================
CREATE TABLE IF NOT EXISTS selection (
  id               TEXT PRIMARY KEY,   -- UUID v4; also used as REFI-QDA Selection GUID
  document_id      TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  code_id          TEXT NOT NULL REFERENCES code(id) ON DELETE CASCADE,
  selection_type   TEXT NOT NULL CHECK (selection_type IN ('text', 'image_region', 'media_ts')),
  memo             TEXT,               -- inline annotation memo
  created_by       TEXT REFERENCES local_user(id),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_selection_document ON selection(document_id);
CREATE INDEX IF NOT EXISTS idx_selection_code     ON selection(code_id);
CREATE INDEX IF NOT EXISTS idx_selection_type     ON selection(selection_type);

-- TEXT SELECTION extension (MVP)
CREATE TABLE IF NOT EXISTS text_selection (
  selection_id  TEXT PRIMARY KEY REFERENCES selection(id) ON DELETE CASCADE,
  start_char    INTEGER NOT NULL,
  end_char      INTEGER NOT NULL,
  CHECK (start_char >= 0 AND end_char > start_char)
);

-- Index for rendering all annotations on a document open
-- (retrieve all text spans for a given document, ordered by position)
CREATE INDEX IF NOT EXISTS idx_ts_document_range
  ON text_selection(selection_id, start_char, end_char);

-- IMAGE REGION extension (v2+)
-- Coordinates are proportional (0.0–1.0) relative to image dimensions.
-- region_data stores a JSON polygon: [[x,y],[x,y],...] for freehand regions.
-- bbox_* stores the bounding-box envelope for REFI-QDA AreaReference export.
CREATE TABLE IF NOT EXISTS image_selection (
  selection_id   TEXT PRIMARY KEY REFERENCES selection(id) ON DELETE CASCADE,
  region_type    TEXT NOT NULL CHECK (region_type IN ('bbox', 'polygon')),
  region_data    TEXT NOT NULL,   -- JSON; polygon array or bbox object
  bbox_left      REAL,            -- REFI-QDA AreaReference fields (proportional)
  bbox_top       REAL,
  bbox_right     REAL,
  bbox_bottom    REAL
);

-- MEDIA TIMESTAMP extension (v2+)
CREATE TABLE IF NOT EXISTS media_selection (
  selection_id   TEXT PRIMARY KEY REFERENCES selection(id) ON DELETE CASCADE,
  start_ms       INTEGER NOT NULL,
  end_ms         INTEGER NOT NULL,
  CHECK (start_ms >= 0 AND end_ms > start_ms)
);

-- ============================================================
-- TRANSCRIPT SEGMENTS (v2+)
-- Word-level timestamps from Whisper / WebVTT / SRT import.
-- Linked to a document. Enables audio-to-text sync.
-- ============================================================
CREATE TABLE IF NOT EXISTS transcript_segment (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  word          TEXT NOT NULL,
  start_ms      INTEGER NOT NULL,
  end_ms        INTEGER NOT NULL,
  char_offset   INTEGER NOT NULL    -- position of word in document.plain_text
);

CREATE INDEX IF NOT EXISTS idx_ts_seg_document ON transcript_segment(document_id);

-- ============================================================
-- MEMOS
-- Standalone memos linked optionally to a code or a selection.
-- ============================================================
CREATE TABLE IF NOT EXISTS memo (
  id                  TEXT PRIMARY KEY,   -- UUID v4
  project_id          TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  linked_code_id      TEXT REFERENCES code(id) ON DELETE SET NULL,
  linked_selection_id TEXT REFERENCES selection(id) ON DELETE SET NULL,
  body                TEXT NOT NULL DEFAULT '',
  created_by          TEXT REFERENCES local_user(id),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_memo_project   ON memo(project_id);
CREATE INDEX IF NOT EXISTS idx_memo_code      ON memo(linked_code_id);
CREATE INDEX IF NOT EXISTS idx_memo_selection ON memo(linked_selection_id);

-- FTS5 for memo search
CREATE VIRTUAL TABLE IF NOT EXISTS memo_fts USING fts5(
  body,
  content='memo',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS memo_fts_insert AFTER INSERT ON memo BEGIN
  INSERT INTO memo_fts(rowid, body) VALUES (new.rowid, new.body);
END;

CREATE TRIGGER IF NOT EXISTS memo_fts_delete AFTER DELETE ON memo BEGIN
  INSERT INTO memo_fts(memo_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
END;

CREATE TRIGGER IF NOT EXISTS memo_fts_update AFTER UPDATE ON memo BEGIN
  INSERT INTO memo_fts(memo_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
  INSERT INTO memo_fts(rowid, body) VALUES (new.rowid, new.body);
END;

-- ============================================================
-- KEY QUERIES (implement these as named Rust query functions)
-- ============================================================

-- 1. Retrieve all children of a code node (one level)
--    SELECT c.* FROM code c
--    JOIN code_closure cc ON cc.descendant = c.id
--    WHERE cc.ancestor = :code_id AND cc.depth = 1;

-- 2. Retrieve full subtree of a code node (all depths)
--    SELECT c.*, cc.depth FROM code c
--    JOIN code_closure cc ON cc.descendant = c.id
--    WHERE cc.ancestor = :code_id AND cc.depth > 0
--    ORDER BY cc.depth, c.name;

-- 3. Retrieve all ancestor path to root (for breadcrumbs / REFI-QDA serialisation)
--    SELECT c.*, cc.depth FROM code c
--    JOIN code_closure cc ON cc.ancestor = c.id
--    WHERE cc.descendant = :code_id AND cc.depth > 0
--    ORDER BY cc.depth DESC;

-- 4. Retrieve all text segments tagged with a given code (Code View)
--    SELECT s.*, ts.start_char, ts.end_char, d.title, d.plain_text
--    FROM selection s
--    JOIN text_selection ts ON ts.selection_id = s.id
--    JOIN document d ON d.id = s.document_id
--    WHERE s.code_id = :code_id
--    ORDER BY d.sort_order, ts.start_char;

-- 5. Retrieve all annotations for a document (for rendering highlights on open)
--    SELECT s.id, s.code_id, c.color, c.name,
--           ts.start_char, ts.end_char, s.memo
--    FROM selection s
--    JOIN text_selection ts ON ts.selection_id = s.id
--    JOIN code c ON c.id = s.code_id
--    WHERE s.document_id = :doc_id
--    ORDER BY ts.start_char;

-- 6. Code co-occurrence (any-overlap definition) — V2+ analytics
--    SELECT a.code_id AS code_a, b.code_id AS code_b, COUNT(*) AS co_count
--    FROM text_selection ta
--    JOIN text_selection tb ON ta.selection_id <> tb.selection_id
--                          AND ta.start_char < tb.end_char
--                          AND ta.end_char   > tb.start_char
--    JOIN selection a ON a.id = ta.selection_id
--    JOIN selection b ON b.id = tb.selection_id
--    WHERE a.document_id = b.document_id
--      AND a.code_id < b.code_id       -- prevent duplicate pairs
--    GROUP BY a.code_id, b.code_id
--    ORDER BY co_count DESC;

-- 7. Combined full-text search (documents + memos), corpus-ordered
--    SELECT 'document' AS source_type, d.id, d.title, d.sort_order,
--           snippet(document_fts, 1, '<mark>', '</mark>', '...', 32) AS excerpt
--    FROM document_fts
--    JOIN document d ON d.rowid = document_fts.rowid
--    WHERE document_fts MATCH :query
--    UNION ALL
--    SELECT 'memo' AS source_type, m.id, 'Memo' AS title, 0 AS sort_order,
--           snippet(memo_fts, 0, '<mark>', '</mark>', '...', 32) AS excerpt
--    FROM memo_fts
--    JOIN memo m ON m.rowid = memo_fts.rowid
--    WHERE memo_fts MATCH :query
--    ORDER BY sort_order, source_type;
```

### 2.1 Closure Table Maintenance

When inserting a new code node, run these two INSERTs atomically in a transaction:

```sql
-- Step 1: self-referencing row (depth=0)
INSERT INTO code_closure (ancestor, descendant, depth)
VALUES (:new_id, :new_id, 0);

-- Step 2: rows linking all ancestors of the parent to this new node
INSERT INTO code_closure (ancestor, descendant, depth)
SELECT ancestor, :new_id, depth + 1
FROM code_closure
WHERE descendant = :parent_id;
```

When moving a subtree to a new parent, DELETE all closure rows where the descendant is in the subtree and the ancestor is NOT in the subtree, then re-insert using the same pattern above for the new parent.

---

## Part 3 — Phase-by-Phase Implementation Plan

### PHASE 0 — Project Scaffold and IPC Architecture

**Goal:** A compilable Tauri 2 + React + TypeScript application with SQLite connected, migrations running, and typed IPC channels established. No user-facing features.

**Tasks:**

0.1. Scaffold with the official Tauri 2 React + TypeScript template:
```bash
npm create tauri-app@latest lens -- --template react-ts
```

0.2. Add dependencies:
```bash
# Frontend
npm install zustand prosemirror-state prosemirror-view prosemirror-model \
  prosemirror-commands prosemirror-history react-arborist \
  mammoth jszip @xmldom/xmldom handlebars tailwindcss

# Tauri plugins
cargo add tauri-plugin-sql tauri-plugin-dialog tauri-plugin-fs \
  tauri-plugin-updater tauri-plugin-shell
```

0.3. In `tauri.conf.json`, configure:
- `productName`: `LENS`
- `identifier`: `org.heritagetech.lens`
- `tauri.security.csp`: strict CSP disabling remote script loading
- `tauri.bundle.externalBin`: path to the pdfplumber sidecar binary
- `tauri.updater`: endpoint `https://github.com/[owner]/lens/releases/latest/download/latest.json`

0.4. Implement the migration runner in `src-tauri/src/db/migrations.rs`. On every app launch, open the DB, read `schema_version`, and run any unapplied migration SQL files in order. Store migration SQL files as numbered constants embedded in the Rust binary (use `include_str!` macros).

0.5. Implement IPC channel structure. Every command follows the naming convention `domain:operation` — e.g. `codes:create`, `annotations:list-by-code`, `search:query`. Define the TypeScript interface layer in `src/ipc/` so the frontend never calls raw Tauri invoke with untyped strings.

TypeScript IPC contract pattern (implement this for every domain):
```typescript
// src/ipc/codes.ts
import { invoke } from '@tauri-apps/api/core';

export interface Code {
  id: string;
  projectId: string;
  name: string;
  color: string;
  description: string | null;
  createdAt: string;
}

export interface CodeTreeNode extends Code {
  children: CodeTreeNode[];
  depth: number;
}

export interface CreateCodePayload {
  projectId: string;
  parentId: string | null;
  name: string;
  color: string;
}

export const codesIpc = {
  create:      (p: CreateCodePayload)          => invoke<Code>('codes_create', p),
  getTree:     (projectId: string)             => invoke<CodeTreeNode[]>('codes_get_tree', { projectId }),
  move:        (id: string, newParentId: string | null) => invoke<void>('codes_move', { id, newParentId }),
  update:      (id: string, patch: Partial<Pick<Code, 'name' | 'color' | 'description'>>) =>
                                                 invoke<Code>('codes_update', { id, ...patch }),
  delete:      (id: string)                    => invoke<void>('codes_delete', { id }),
  getSubtree:  (id: string)                    => invoke<CodeTreeNode[]>('codes_get_subtree', { id }),
};
```

Implement the corresponding `#[tauri::command]` handler in Rust for each IPC function. All commands receive the `AppHandle` and `State<DbPool>` as injected parameters. All return `Result<T, String>` where the error string is a user-facing message.

0.6. Implement a project creation/open flow. A project is a folder containing `project.qdaproj` (the SQLite file) and an `assets/` subfolder. On "New Project," open a native folder picker, create the folder structure, create and migrate the DB, and write the initial `project` table row.

**Checkpoint:** App launches, creates a project folder with a valid SQLite DB, and basic IPC round-trips work (create a code, retrieve it back) via the Tauri devtools console.

---

### PHASE 1 — Document Import Pipeline

**Goal:** Users can import `.txt`, `.docx`, and `.pdf` files. Each produces a normalised plain-text canonical snapshot stored in SQLite, with a SHA-256 hash for re-import detection.

**Tasks:**

1.1. **Text normalisation pipeline** (implement in `src-tauri/src/import/normalise.rs`).
Apply these steps in order to every extracted text, regardless of source format:
  - Strip UTF-8 BOM (`\xEF\xBB\xBF`)
  - Unicode NFC normalisation (use the `unicode-normalization` Rust crate)
  - Soft hyphen removal (`\u{00AD}`)
  - Ligature expansion: `ﬁ→fi`, `ﬀ→ff`, `ﬃ→ffi`, `ﬄ→ffl`, `ﬅ→ſt`, `ﬆ→st`
  - Line ending normalisation to `\n` (strip `\r`)
  - Collapse runs of 3+ consecutive newlines to exactly 2 (`\n\n`)
  - Strip leading/trailing whitespace from the entire text
  - Compute SHA-256 hash of the normalised text (use `sha2` crate)
  - Compute word count (split on whitespace, count non-empty tokens)

1.2. **TXT import** (`src-tauri/src/import/txt.rs`). Read the file as UTF-8, run normalisation, store result. Set `file_format = 'txt'`, `extractor_id = 'plain-text-1.0'`.

1.3. **DOCX import** (`src-tauri/src/import/docx.rs`). The Rust-side extractor unzips the DOCX with `zip`, parses `word/document.xml` with `roxmltree`, and walks `<w:r>` runs in `<w:p>` paragraphs of `<w:body>` to emit plain text. Paragraph boundaries become `\n`; run-internal line breaks (`<w:br/>`) become `\n`; tab markers (`<w:tab/>`) become `\t`. The `<w:t>` text is read with `xml:space="preserve"` honoured so authoring whitespace survives. Hidden runs (`<w:vanish/>`) and spell-check artefact runs (`<w:proofErr>`) are skipped. Run the result through the normalise pipeline. Set `file_format = 'docx'`, `extractor_id = 'lens-docx-1.0.0'`. The IPC `raw_text` parameter is retained as a renderer-side escape hatch but the canonical path is Rust-native.

Known MVP limitations (listed in the same order as the inline rustdoc at the bottom of `docx.rs`):

- **Revision history** is out of scope: only the live-edit view in `word/document.xml` is read, and earlier revisions that some DOCX files keep in `document2.xml`, `document3.xml`, … are silently ignored.
- **Top-level tables** have their `<w:p>` paragraphs inlined into the body output stream, losing row/column structure.
- **Tracked changes** (`<w:ins>` / `<w:del>`) are descended into but **accept/reject semantics are NOT applied** — both insertion and deletion text read as if accepted. Author/date metadata from `<w:ins>` / `<w:del>` does NOT survive.
- **Footnotes** live in `footnotes.xml`, which the MVP never opens. Footnote text is silently dropped from the output.
- **Comments** (and endnotes) follow the same pattern — §bodies live in `comments.xml` / `endnotes.xml` which are never read, so anchored comment text is also silently dropped, while body-internal `<w:commentRangeStart>` / `<w:commentReference>` markers survive (potentially producing empty inline runs).

The output's character offset space approximates the live edit view but is NOT guaranteed to match NVivo or ATLAS.ti interpretations of the same source. Non-Latin character sets (Arabic, Chinese, Devanagari) round-trip correctly because the parser reads the raw UTF-8 text strings inside `<w:t>` elements.

1.4. **PDF import** (`src-tauri/src/import/pdf.rs`). Two-path strategy:

**Primary path — pdfplumber sidecar:**
The pdfplumber sidecar is a compiled Python script (using PyInstaller or Nuitka) that accepts a PDF path as a CLI argument, extracts text using `pdfplumber`, and outputs to stdout. Build one binary per platform and ship them in `src-tauri/sidecars/pdfplumber/`. Register the binary in `tauri.conf.json` under `externalBin`.

The pdfplumber extraction strategy: use `page.extract_text(x_tolerance=3, y_tolerance=3)` with layout analysis enabled. For multi-column documents, use `page.extract_text_simple()` if layout detection fails. Write output as UTF-8. Set `file_format = 'pdf'`, `extractor_id = 'pdfplumber-{version}'`.

**Fallback path — pdf.js in the renderer:**
If the sidecar fails (e.g., platform binary missing, encrypted PDF), fall back to `pdfjs-dist` running in a hidden iframe in the renderer. This path is less consistent but ensures the import doesn't fail completely. Mark the document with `file_format = 'pdf'`, `extractor_id = 'pdfjs-{version}'`. Surface a visible warning to the user that PDF text quality may be lower on this path.

**Re-import protection:** Before creating a new `document` row, compute the normalised text hash. If a document already exists in the project with the same `text_hash`, surface a clear error: "This document has already been imported. To import an updated version, add it as a separate document entry." Do not silently create a duplicate. Do not attempt annotation remapping.

1.5. **OCR fallback for scanned PDFs.** If pdfplumber extraction produces a text of fewer than 100 characters for a PDF with more than 1 page (indicating a scanned/image PDF with no text layer), surface a dialog: "This appears to be a scanned PDF. Run OCR to extract text?" If the user confirms, run Tesseract.js in a Web Worker in the renderer (using the WASM build; do not bundle the native Tesseract binary). Set `file_format = 'ocr_pdf'`, `extractor_id = 'tesseract.js-{version}'`. Surface a clear caveat that OCR output may contain errors.

1.6. **Document import UI.** The import is triggered from the document list panel via a native file picker (`tauri-plugin-dialog`). Support multi-file selection. Show a progress indicator per file during import. On completion, refresh the document list. On failure, show a per-file error alongside the success count.

**Checkpoint:** Import a .txt, a .docx, and a two-column PDF. Verify in the SQLite DB that `plain_text`, `text_hash`, `word_count`, and `extractor_id` are correctly populated. Verify that re-importing the same file triggers the re-import error and creates no duplicate row.

---

### PHASE 2 — Core Coding Interface

**Goal:** The three-panel coding workspace is fully functional. A researcher can open a document, select text, assign one or more codes, and see highlights rendered correctly — including overlapping highlights from multiple codes.

**Tasks:**

2.1. **Three-panel layout.** The main workspace is a resizable three-column layout:
  - **Left panel:** Document list navigator (§2.5)
  - **Centre panel:** ProseMirror document editor with annotation highlights (§2.2–2.3)
  - **Right panel:** Code tree (§2.4) + below it, an active-selection code assignment area

The three panels should be resizable via drag handles. Remember panel widths in the Zustand UI store (persisted to Tauri's app config via `tauri-plugin-store`).

2.2. **ProseMirror setup.** Create a React wrapper component `<DocumentEditor />` in `src/components/editor/`. Initialize the ProseMirror `EditorState` with:
  - A plain-text-only schema (no block formatting, no marks for bold/italic — annotations are decorations, not marks)
  - The `history` plugin for undo/redo
  - The custom `QdaAnnotationPlugin` (§2.3)
  - A `mouseup` handler that detects text selection and triggers the code assignment affordance

The document content is loaded by populating `doc` from `document.plain_text`. The editor is **read-only** — researchers code against the canonical snapshot, they do not edit it. Set `EditorView` with `editable` returning `false`. The only user interactions permitted are: text selection (for code assignment) and clicking on an existing annotation (to inspect or delete it).

2.3. **QdaAnnotationPlugin.** This is the centrepiece of the coding interface. Implement as a ProseMirror plugin in `src/components/editor/QdaAnnotationPlugin.ts`.

The plugin maintains a `DecorationSet` built from the list of `AnnotationHighlight` objects in the editor store. On every `docChanged` or `annotationsChanged` transaction, it calls `DecorationSet.create()` with the full list of active decorations.

Each decoration is an `Decoration.inline()` with:
  - `from` and `to` derived from `start_char` and `end_char` of the stored annotation. Because ProseMirror's position model adds 1 for each node open/close, but for a flat plain-text document (no block formatting) the offset relationship is: `ProseMirror_pos = char_offset + 1`. Implement this in `src/utils/offset-utils.ts` and use it consistently.
  - `{class: 'qda-highlight', style: 'background-color: ${alpha(code.color, 0.35)}; border-bottom: 2px solid ${code.color};'}` as the spec. The alpha function lightens the code colour for the fill while keeping the full-saturation border for visual distinction.
  - A `data-annotation-id` attribute set to the selection UUID, enabling click-to-inspect.
  - A `data-code-id` attribute for accessibility and CSS targeting.

For overlapping annotations, ProseMirror's DecorationSet handles the rendering automatically by stacking `<span>` elements. The visual output for a text span with three codes will be three nested `<span>` elements, each with its own background-color and border-bottom. The innermost span's background will visually blend with the outer ones. This is the correct and expected behaviour.

Marginal code indicators: In addition to inline highlights, render a right-margin annotation strip (a thin column to the right of the text). For each annotation, place a coloured marker at the vertical position corresponding to the annotation's location in the document, labelled with the code name. This is the ATLAS.ti-style bracket pattern. Implement this as a separate absolutely-positioned div overlay, not as ProseMirror decorations, since ProseMirror does not natively support margin elements. Synchronise the margin markers on scroll.

2.4. **Code tree (react-arborist).** Implement in `src/components/code-tree/CodeTree.tsx`.

react-arborist receives its data as a flat array with `id` and `parentId` fields. Transform the `CodeTreeNode[]` from the IPC response (which is already hierarchical) into this flat format for arborist.

Required react-arborist configuration:
  - Enable drag-and-drop: `disableDrag={false}`, `disableDrop={false}`
  - `onMove` callback: call `codesIpc.move(draggedId, newParentId)`, then refresh the tree
  - `renderRow` custom renderer: show the code colour swatch (a small circle), the code name, and an inline edit affordance on double-click
  - `onRename` callback: call `codesIpc.update(id, { name: newName })`
  - Multi-select: pass `selectionFollowsFocus={false}` and handle `Ctrl`+click for multi-select via the `onSelect` callback
  - Search/filter: implement a filter input above the tree; on change, use arborist's `searchTerm` prop (it does fuzzy matching natively)
  - Expand/collapse state: persist expanded node IDs in the Zustand UI store

The tree panel header contains: a "New Code" button (creates a root-level code), a search input, and a "Sort Alphabetically" toggle.

2.5. **Code assignment mechanisms.** Implement three ways to assign a code to the current text selection:

  a. **Click on code tree node:** When the user selects text in the editor (mouseup event), the code tree panel shows a subtle pulsing indicator on each code. Clicking any code node creates an annotation. This is the primary mechanism.

  b. **Fuzzy code picker (Ctrl+K):** A command-palette style floating panel that appears over the document when the user has an active text selection and presses `Ctrl+K`. It contains a text input with live fuzzy search over all codes (use a simple Levenshtein match on code names), and a keyboard-navigable list. Pressing `Enter` or clicking assigns the code. Pressing `Escape` dismisses it without assigning. This is the highest-efficiency mechanism for experienced coders. Implement using shadcn/ui `Command` component.

  c. **Right-click context menu:** Right-clicking on an active text selection shows a context menu with "Assign code…" which opens the fuzzy picker. Also shows "Remove annotation" when right-clicking on an existing highlight.

2.6. **Annotation persistence.** When a code is assigned to a selection:
  1. Compute `start_char` and `end_char` from the ProseMirror selection using the offset-utils bridge (`pm_pos - 1`)
  2. Generate a UUID for the new selection
  3. Call `annotationsIpc.create({ documentId, codeId, startChar, endChar })`
  4. On success, dispatch a transaction to the ProseMirror editor to add the new decoration to the plugin's state
  5. Update the Zustand editor store with the new annotation

On app load and document open, fetch all annotations for the document via `annotationsIpc.listByDocument(documentId)` and populate the editor store. The editor reconstructs all highlight decorations from this list.

2.7. **Code view panel.** When the user clicks on a code in the code tree, the right panel switches to "Code View" mode: a scrollable list of all text segments tagged with that code, across all documents, showing 2–3 lines of surrounding context per segment. Each segment is clickable, navigating to and highlighting the relevant passage in the document panel. Implement using the Key Query #4 defined in the schema section.

**Checkpoint:** Open a document. Select text. Assign a code via all three mechanisms. Verify highlights appear with correct colours. Select overlapping text and assign a second code. Verify both highlights render without breaking the DOM. Click a code in the tree and verify the code view shows all tagged segments.

---

### PHASE 3 — Code and Memo Management

**Goal:** Full code CRUD with colour picker, memo system, and FTS5 search are functional.

**Tasks:**

3.1. **Code CRUD.** New Code dialog with: name field, colour picker (16 preset colours from a research-appropriate palette, plus a hex input), parent code selector (a flat dropdown of existing codes), and description textarea. Edit code: inline via double-click on tree node for name; separate dialog via right-click for colour and description. Delete code: confirmation dialog noting how many annotations will be affected. Implement bulk delete via multi-select + Delete key.

3.2. **Closure table maintenance.** All code CRUD operations must maintain the `code_closure` table atomically. Implement Rust helper functions:
  - `insert_code_with_parent(conn, code_id, parent_id)` — runs the two-step closure insertion from §2.1
  - `move_code_subtree(conn, code_id, new_parent_id)` — deletes stale closure rows and re-inserts for new parent
  - `delete_code_cascade(conn, code_id)` — because `code_closure` has `ON DELETE CASCADE`, deleting the code row automatically removes all closure rows

3.3. **Memo system.** Three memo types:
  - **Code memo:** accessed via right-clicking a code in the tree → "Edit memo." Displayed below the code tree in a simple textarea. Stored with `linked_code_id` set, `linked_selection_id` null.
  - **Annotation memo:** accessed via right-clicking an existing highlight in the document → "Edit memo." Stored with `linked_selection_id` set, `linked_code_id` null. Displayed as a tooltip near the annotation when the user hovers over it.
  - **Project journal:** a free-text scratchpad accessible from the top menu bar. Stored with both link fields null.

All memo bodies support plain text only for MVP. Rich text (bold, italic) is a v2+ feature.

3.4. **Full-text search.** Implement the combined search query (Key Query #7) as the `search:query` IPC command. The search panel is accessible via `Ctrl+F` from anywhere in the app. It shows:
  - A text input with real-time results (debounced 200ms)
  - Results grouped by source type (Documents, Memos)
  - Each result shows a `snippet()` excerpt with the match highlighted
  - Results are ordered by `sort_order` (document import order), not by relevance
  - A "Search within code" filter: shows a code selector; when set, restricts results to segments tagged with that code (requires a subquery joining `selection` to `text_selection` and comparing character offsets to the FTS match position)

**Checkpoint:** Create 10 codes with a mix of root and child nodes. Drag a subtree to a new parent. Verify closure table is correct by running the ancestor query. Add memos to 3 codes and 2 annotations. Search for a word that appears in both documents and memos; verify results are ordered by document sort order.

---

### PHASE 4 — Export Layer

**Goal:** The export plugin system is in place, and all four MVP export formats work correctly.

**Tasks:**

4.1. **Export plugin architecture.** The plugin system is a simple strategy pattern. Define the core TypeScript interface in `src/export/`:

```typescript
// src/export/ExporterPlugin.ts

export interface ExportPayload {
  project: ProjectRecord;
  documents: DocumentRecord[];
  codes: CodeTreeNode[];         // full hierarchy
  selections: SelectionRecord[]; // joined with text_selection fields
  memos: MemoRecord[];
  localUser: LocalUserRecord;
}

export interface ExportPlugin {
  readonly id: string;           // e.g. 'qdpx' | 'qdc' | 'csv' | 'html'
  readonly label: string;        // Human-readable name shown in export menu
  readonly fileExtension: string;
  readonly mimeType: string;
  export(payload: ExportPayload): Promise<Uint8Array | string>;
}

export class ExporterRegistry {
  private plugins = new Map<string, ExportPlugin>();
  register(plugin: ExportPlugin) { this.plugins.set(plugin.id, plugin); }
  get(id: string): ExportPlugin | undefined { return this.plugins.get(id); }
  list(): ExportPlugin[] { return [...this.plugins.values()]; }
}
```

Assemble the `ExportPayload` from IPC calls in a single `export:prepare` command that serialises the entire project state into a plain TypeScript object. The exporter plugins receive this object; they have no direct DB access. Register all plugins at app startup in `main.tsx`.

4.2. **REFI-QDA `.qdpx` export (`QdpxExporter.ts`).** The `.qdpx` format is a ZIP archive containing `project.qde` (an XML document conforming to `Projects.xsd`) and the original source files.

GUID strategy: all entities (Project, Source, Code, Selection, User) carry a UUID v4 stored in the SQLite schema (`id` fields). Use these IDs directly as GUID attributes in the XML. This avoids a separate GUID mapping table and makes re-exports deterministic.

XML structure (build using `@xmldom/xmldom`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Project
  xmlns="urn:QDA-XML:project:1.0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="urn:QDA-XML:project:1.0 http://schema.qdasoftware.org/versions/Project/v1.0/Project.xsd"
  name="{project.name}"
  creatingUserGUID="{localUser.id}"
  creationDateTime="{project.createdAt}"
  modifiedDateTime="{project.updatedAt}">

  <Users>
    <User guid="{user.id}" name="{user.displayName}" />
  </Users>

  <CodeBook>
    <Codes>
      <!-- Recursive: emit each root code, then its children recursively -->
      <Code guid="{code.id}" name="{code.name}" color="{color_to_argb(code.color)}" isCodable="true">
        <Code ... />   <!-- children -->
      </Code>
    </Codes>
  </CodeBook>

  <Sources>
    <TextSource guid="{doc.id}" name="{doc.title}" richTextPath="{doc.id}.txt"
                plainTextPath="{doc.id}.txt" creatingUser="{user.id}"
                creationDateTime="{doc.importedAt}">
      <PlainTextSelection guid="{sel.id}" name="" startPosition="{ts.startChar}"
                          endPosition="{ts.endChar}" creatingUser="{sel.createdBy}"
                          creationDateTime="{sel.createdAt}">
        <Coding guid="{uuid}" creatingUser="{sel.createdBy}" creationDateTime="{sel.createdAt}">
          <CodeRef targetGUID="{sel.codeId}" />
        </Coding>
      </PlainTextSelection>
    </TextSource>
  </Sources>
</Project>
```

Colour conversion: REFI-QDA stores code colours as ARGB hex strings (e.g. `#FF6366F1`). Convert from the stored CSS hex (`#RRGGBB`) by prepending `FF` for full opacity.

After building the XML string, validate it against `Projects.xsd` using `libxmljs2` before writing. If validation fails, surface the specific XSD error to the user and abort — do not write an invalid archive.

Build the ZIP archive using JSZip: add `project.qde` as a string entry, then add each document's plain text as `{doc.id}.txt` in a `Sources/` folder within the ZIP.

4.3. **REFI-QDA `.qdpx` import (`QdpxImporter.ts`).** Permissive parsing — never throw on unrecognised elements:
  - Unzip the archive
  - Parse `project.qde` with `@xmldom/xmldom` using `getElementsByTagNameNS` with the REFI namespace URI (`urn:QDA-XML:project:1.0`)
  - For each `<TextSource>`: create a `document` row using the embedded plain-text file from the archive
  - For each `<Code>`: create a `code` row and recursively process children, inserting closure table rows
  - For each `<PlainTextSelection>` with a `<Coding>`: create a `selection` + `text_selection` row
  - For each `<Memo>` (if present in the XML): create a `memo` row
  - Unknown elements and attributes: silently skip
  - Missing media files referenced in the archive: log a warning but do not fail the import
  - Conflict strategy for importing into a non-empty project: prompt "Merge (add imported items alongside existing ones) or Replace (delete all existing data first)?" Default to Merge.

4.4. **REFI-QDA `.qdc` codebook export/import.** The `.qdc` is a standalone XML file containing only the `<CodeBook>` element with its `<Codes>` hierarchy. Use the same code serialisation logic from the `.qdpx` exporter, extracted as a shared function. Import maps `<Code>` elements to new `code` rows with closure table maintenance.

4.5. **CSV export (`CsvExporter.ts`).** One row per `selection` (text_selection only for MVP). Columns in order:
  1. `document_title`
  2. `code_name`
  3. `code_path` (full hierarchy path, e.g. `Themes > Identity > Self-presentation`, derived from ancestor query)
  4. `start_char`
  5. `end_char`
  6. `segment_text` (substring of `document.plain_text` from `start_char` to `end_char`)
  7. `context_before` (50 characters before start_char, for readability)
  8. `context_after` (50 characters after end_char)
  9. `memo` (the selection's inline memo, if any)
  10. `coder` (local user display name)
  11. `created_at`

Output as RFC 4180-compliant CSV with UTF-8 BOM (for Excel compatibility). Use `"` quoting around any field containing commas, quotes, or newlines.

4.6. **HTML report (`HtmlReporter.ts`).** A self-contained single-file HTML document. Structure:
  - Header section: project name, export date, total documents, total codes, total annotations, coding density (annotations per 1000 words)
  - Code-by-code section: for each code (traversing the hierarchy in depth-first order), a heading showing the code name and colour swatch, a count of segments, then each segment listed with: document title, the quoted text (full segment from `plain_text`), and the context (2 sentences either side where possible)
  - No external CSS or JS dependencies. All styles inlined in a `<style>` tag. Print-friendly CSS included.

Use Handlebars templates compiled at build time (not at runtime). Template file lives in `src/export/templates/report.hbs`.

**Checkpoint:** Export a project with 5 documents, 20 codes (3-level hierarchy), and 100 annotations to `.qdpx`. Validate the ZIP structure and XSD compliance. Re-import the `.qdpx` into a fresh empty project. Verify all documents, codes, and annotations are reconstructed correctly. Export CSV and open in Excel — verify UTF-8 BOM, column headers, segment text, and code path are all correct.

---

### PHASE 5 — Onboarding, Polish, and v1 Release

**Goal:** The application is ready for public release with a bundled sample project, packaging for all three platforms, and auto-update wired up.

**Tasks:**

5.1. **Sample project.** Bundle a read-only sample `.qdaproj` project folder with the installer. It should contain 3–4 short anonymised interview transcripts (public domain or CC-licensed), a starter code tree with 10–15 codes in a 2-level hierarchy, and 30–40 example annotations. The sample project teaches the coding workflow without requiring the user to import their own data on first launch.

5.2. **Empty state and onboarding.** On first launch with no project open, show an empty-state screen with: "New Project" (large primary button), "Open Existing Project," and "Open Sample Project." Add a contextual help tooltip system (shadcn/ui `Tooltip` with `disableHoverableContent={false}`) on: the code tree "New Code" button, the document import button, and the Ctrl+K affordance.

5.3. **Settings panel.** Accessible from the top menu bar. Contains: display name for the local user identity (saved to `local_user` table), colour theme (light/dark/system), default code colour, and a "Enable encryption (SQLCipher)" toggle with password prompt. The SQLCipher path requires building `tauri-plugin-sql` with the `sqlite-cipher` feature flag and using `sqlcipher` as the SQLite backend in the Rust dependency.

5.4. **Cross-platform build and packaging.** Configure GitHub Actions using the official `tauri-action` workflow. The workflow triggers on version tags (`v*`). It builds for Windows (MSI + NSIS), macOS (DMG with universal binary for Intel + Apple Silicon), and Linux (AppImage + .deb). Code signing: generate a Tauri updater key pair via `tauri signer generate` and store the private key as a GitHub Actions secret. The public key goes in `tauri.conf.json`. macOS notarisation: add Apple credentials as GitHub Actions secrets per the `tauri-action` documentation.

5.5. **Auto-update.** The Tauri updater plugin checks `https://github.com/mabo-du/lens/releases/latest/download/latest.json` on app startup (once per day, not on every launch — implement a last-checked timestamp in app storage). When an update is available, show a non-intrusive banner at the bottom of the screen. Clicking "Update Now" downloads and installs the update.

**Checkpoint:** Build distributable installers for all three platforms from CI. Install on each platform. Open the sample project. Verify all Phase 1–4 features work in the installed build, not just in dev mode.

---

## Part 4 — V2+ Roadmap Features

These phases are planned but not part of the initial release. Implement in the order listed after v1 is stable.

### PHASE 6 — Analytics Dashboard (V2+)

6.1. **Co-occurrence matrix.** Run Key Query #6 (any-overlap definition) and display results as a heat-map table using Recharts' custom cell rendering. Default to showing the top 50 codes by annotation frequency. Include a threshold slider to filter by minimum co-occurrence count. The analytics panel is in a dedicated tab, not in the main coding workspace.

6.2. **Code frequency charts.** A sortable bar chart (Recharts `BarChart`) showing annotation count per code. Include a document-breakdown stacked bar view (each bar segment represents one document's contribution). Use the code's stored colour for the bar fill.

6.3. **Network diagram.** Use `react-force-graph` (WebGL rendering) for the co-occurrence network. Nodes are codes, sized by annotation count. Edges are weighted by co-occurrence count. Default view: filter to codes with at least 3 co-occurrences and top 50 codes by frequency. A threshold slider adjusts both filters. Node click highlights all connected edges. Implement the dirty-state indicator: if new annotations have been added since the last computation, show "Analytics outdated — click to refresh" above all charts. No background recomputation.

6.4. **Cheap live counters.** In the status bar at the bottom of the main window, show live-updating counts (O(1) Zustand store reads, not DB queries on every annotation): total annotations in current project, documents coded/not-coded ratio, and active document word count.

### PHASE 7 — Collaborative Coding and ICR (V2+)

7.1. **Inter-coder reliability.** Implement character-level Cohen's kappa in JavaScript (`src/utils/icr.ts`). The calculation for text spans: convert each coder's annotations for a given code on a given document into a binary character-level array (`annotated[i] = 1 if character i is covered by any annotation for this code`), then compute standard Cohen's kappa on the two binary arrays. Surface results in a dedicated ICR panel: coder pair selector, document/code scope selector, and a table showing kappa per code with an interpretation guide (< 0.4 poor, 0.4–0.6 moderate, 0.6–0.8 substantial, > 0.8 near-perfect). The ICR panel is only available when a project has been coded by more than one `local_user`.

7.2. **Baton-pass collaboration.** Implement file-level conflict detection. On project open, check for a lock file (`project.lock`) in the project folder. If it exists, show a warning: "This project appears to be open on another device. Continuing may cause data conflicts." Write the lock file on project open (containing the local user's ID and a timestamp), delete it on project close (using the Tauri `WindowEvent::CloseRequested` handler). This prevents simultaneous access, not concurrent editing. Document the "pass the baton" workflow in the app's help panel.

7.3. **Coding comparison view.** Given two coders' annotations on the same document, render a split-view showing agreement/disagreement regions using the interval set algebra algorithm: compute intersection (both coded), difference A−B (only coder A coded), and difference B−A (only coder B coded). Render these as coloured highlights in a read-only document view alongside each other.

### PHASE 8 — Multimedia Annotation (V2+)

8.1. **Image coding.** When a document is imported with `file_format = 'image'` (add this import path in v2+), open it in a Konva.js canvas. The user draws regions using a rectangle tool or polygon tool. On completion of a region, the code assignment affordance (Ctrl+K picker or code tree click) appears. Store the region in `image_selection` as a polygon JSON array with proportional coordinates. For REFI-QDA export, compute the `bbox_*` envelope from the polygon.

8.2. **Audio/video annotation.** Render WaveSurfer.js for audio visualisation. The user selects a time range by dragging on the waveform, then assigns a code. Store in `media_selection` as `start_ms`/`end_ms`. For documents with a linked transcript, visualise the corresponding text span alongside the waveform region.

8.3. **Transcript synchronisation.** On importing a WebVTT or SRT file alongside an audio document, parse the timestamp data and populate `transcript_segment`. Clicking on a transcript word seeks the audio player. Selecting a media timestamp range highlights the corresponding transcript text. The character-to-millisecond mapping uses the `char_offset` column on `transcript_segment`.

---

## Part 5 — Key Implementation Notes for the Coding Agent

**ProseMirror position bridge.** This is used in every annotation create/read/render operation. For a document with no block-level marks (pure plain text in a single `doc > paragraph` structure), the relationship is `pm_pos = char_offset + 1`. If the schema ever introduces paragraph-breaking (e.g., for very long documents split into blocks), this bridge must be recalculated. Write a unit test that verifies round-trip fidelity: take a known string, create a ProseMirror document from it, select a substring by known char offsets, and verify the reconstructed substring is identical.

**Closure table atomicity.** Every code insert, move, or delete must be wrapped in a SQLite transaction that atomically updates both `code` and `code_closure`. A partial closure table update will cause subtree queries to return wrong results — an error that is very hard to debug retroactively. Write a test that: creates a 3-level hierarchy, moves the middle node to a different parent, and verifies all six ancestor-descendant relationships in the closure table are correct.

**Character offset immutability.** The canonical `plain_text` in the `document` table must never be modified after import. If a bug causes text to be re-extracted or normalised differently after import, all stored `start_char`/`end_char` values become invalid. Add a Rust-level guard: `update_document_text()` should be a private function that panics if called outside of the initial import transaction. There is no legitimate reason to update `plain_text` after first write.

**REFI-QDA namespace URI.** The correct namespace is `urn:QDA-XML:project:1.0`. A prior research report flagged that a wrong namespace URI is a common implementation error (Qwen produced `https://www.qdasoftware.org/` which is incorrect). Hardcode this string as a constant and use it consistently in both export and import.

**Export payload assembly.** The `export:prepare` IPC command assembles the entire project into a typed TypeScript object in one round-trip before handing off to any exporter. This means exporters are pure functions over plain data — they can be unit-tested without a running Tauri instance.

**react-arborist drop target.** The default drag indicator for react-arborist places items as siblings. For a QDA code tree, the user needs to be able to drop an item *into* a parent (making it a child) as well as *between* siblings. Configure the `onDrop` handler to distinguish between `dropPosition === 'inside'` (new child) and `dropPosition === 'before' | 'after'` (sibling reorder). Both cases require different closure table update logic.

**pdfplumber sidecar compilation.** Build the sidecar using PyInstaller with `--onefile` mode. Target platforms: `x86_64-unknown-linux-gnu`, `x86_64-pc-windows-msvc`, `x86_64-apple-darwin`, `aarch64-apple-darwin`. Store binaries at `src-tauri/sidecars/pdfplumber/pdfplumber-{triple}` (or `.exe` for Windows). Register in `tauri.conf.json` using the `externalBin` array with the platform-agnostic path pattern. The Tauri bundler will automatically include the correct binary for each platform build.

**FTS5 tokenizer for non-Latin text.** The `unicode61` tokenizer (specified in the FTS5 schema above) correctly handles Arabic, Chinese, and Devanagari for basic search. For CJK languages where characters are not separated by spaces, FTS5 with `unicode61` will not tokenise at character boundaries — researchers searching for Chinese phrases may need to search for character sequences, not individual characters. This is a known limitation. Do not attempt to fix it in MVP; document it in the help text.
