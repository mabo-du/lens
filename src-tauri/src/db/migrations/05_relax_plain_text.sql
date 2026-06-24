-- ============================================================
-- Migration 05: Relax `document.plain_text NOT NULL` so image rows
-- (PNG/JPG/JPEG bound via migration 04) can store NULL instead of
-- a sentinel empty string. After this migration lands the round-71+
-- dispatcher can bind `plain_text: None` directly.
--
-- Implementation: 12-step `CREATE TABLE _new` rebuild. Round-70
-- proved `ALTER TABLE document ALTER COLUMN plain_text DROP NOT NULL`
-- is NOT portable across bundled SQLite builds (broke 34 of 53
-- integration tests on the test harness's SQLite 3.x). This rebuild
-- pattern is portable across every reasonable SQLite ≥ 3.7 since
-- it relies only on native CREATE / INSERT / DROP / ALTER RENAME.
-- ============================================================

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- Step 1: Build document_new with the relaxed schema.
-- Includes the two columns added in migration 04 (intrinsic_w/h)
-- so the row-set shape is identical to the live table — INSERT
-- below does a straight SELECT without projection hacks.
CREATE TABLE document_new (
  id              TEXT PRIMARY KEY,                                       -- UUID v4
  project_id      TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  original_path   TEXT,                                                   -- original file path at import time (informational)
  file_format     TEXT NOT NULL,                                          -- 'txt' | 'docx' | 'pdf' | 'ocr_pdf' | 'png' | 'jpg' | 'jpeg'
  plain_text      TEXT,                                                   -- RELAXED: was NOT NULL in migration 01
  text_hash       TEXT NOT NULL,                                          -- SHA-256 of plain_text (or file bytes for images); UNIQUE(project_id, text_hash)
  extractor_id    TEXT NOT NULL,                                          -- e.g. 'pdfplumber-0.11.0' | 'mammoth-1.8.0' | 'image-dec-{pkg_version}'
  word_count      INTEGER NOT NULL DEFAULT 0,
  imported_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  intrinsic_w     INTEGER,                                                -- Added in migration 04 (image documents only)
  intrinsic_h     INTEGER                                                 -- Added in migration 04 (image documents only)
);

-- Step 2: Copy all rows over (preserves both intrinsic_w/h and the
-- UNIQUE(project_id, text_hash) constraint from migration 02).
INSERT INTO document_new
SELECT id, project_id, title, original_path, file_format, plain_text, text_hash,
       extractor_id, word_count, imported_at, sort_order, intrinsic_w, intrinsic_h
FROM document;

-- Step 3: Drop the old table. The PRIMARY KEY + UNIQUE indexes from
-- migration 01 / 02 are dropped automatically with the table.
DROP TABLE document;

-- Step 4: Rename document_new into place. The rowid values from the
-- new INSERT carry over (no renumbering) so any external references
-- survive; FTS5 rebuild in step 8 will re-derive from the new docs.
ALTER TABLE document_new RENAME TO document;

-- Step 5: Recreate indexes (preserve the original three from 01 plus
-- the file_format index added in 04). IF NOT EXISTS so a re-run of
-- this migration on an already-migrated DB is a no-op.
CREATE INDEX IF NOT EXISTS idx_document_project
  ON document(project_id);
CREATE INDEX IF NOT EXISTS idx_document_sort
  ON document(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_document_file_format
  ON document(project_id, file_format);

-- Step 6: Drop the old FTS sync triggers (they reference the OLD
-- constraint indirectly; we want fresh triggers tied to the new
-- NULL-able schema). IF EXISTS guards against double-migration.
DROP TRIGGER IF EXISTS document_fts_insert;
DROP TRIGGER IF EXISTS document_fts_delete;
DROP TRIGGER IF EXISTS document_fts_update;

-- Step 7: Recreate the FTS5 sync triggers. COALESCE(plain_text, '')
-- guards against NULL on image rows so the FTS table never holds
-- a NULL token (FTS5 silently ignores NULL inserts but explicit
-- COALESCE makes the intent obvious + future-proof).
CREATE TRIGGER document_fts_insert AFTER INSERT ON document BEGIN
  INSERT INTO document_fts(rowid, title, plain_text)
  VALUES (new.rowid, new.title, COALESCE(new.plain_text, ''));
END;

CREATE TRIGGER document_fts_delete AFTER DELETE ON document BEGIN
  INSERT INTO document_fts(document_fts, rowid, title, plain_text)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.plain_text, ''));
END;

CREATE TRIGGER document_fts_update AFTER UPDATE ON document BEGIN
  INSERT INTO document_fts(document_fts, rowid, title, plain_text)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.plain_text, ''));
  INSERT INTO document_fts(rowid, title, plain_text)
  VALUES (new.rowid, new.title, COALESCE(new.plain_text, ''));
END;

-- Step 8: Re-populate the FTS inverted index from the existing rows.
-- FTS5's 'rebuild' command is the documented hook for re-deriving
-- the index from the parent content table — it deletes everything
-- and re-inserts all rows according to the latest triggers.
INSERT INTO document_fts(document_fts) VALUES('rebuild');

COMMIT;

PRAGMA foreign_keys = ON;
