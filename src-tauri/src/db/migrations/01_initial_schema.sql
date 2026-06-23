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

