-- ============================================================
-- Migration 06: Image polygon annotations.
--
-- Step A: Expand the `selection.selection_type` CHECK constraint to
-- include 'image_polygon' alongside the existing 'text', 'image_region',
-- 'media_ts'. SQLite has no ALTER CONSTRAINT, so we use the same
-- 12-step CREATE TABLE _new rebuild pattern that migration 05 used to
-- relax `document.plain_text NOT NULL` (round-70 proved ALTER COLUMN
-- DROP NOT NULL is not portable across bundled SQLite builds — same
-- concern applies to CHECK edits, hence the rebuild).
--
-- Step B: Add the `image_polygon` extension table for free-form polygon
-- annotations. The extension table (1:1 to a polygon selection row)
-- holds the 0..1 proportional vertex list as JSON: [[x0,y0],[x1,y1],...].
--
-- No FTS5 changes needed: polygon's textual content is routed through
-- `selection.memo` (already searchable via the existing FTS index tied
-- to the document table).
-- ============================================================

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- Step 1: Rebuild selection with the expanded CHECK constraint.
-- Columns match the v01 schema verbatim; only the CHECK enum grows.
CREATE TABLE selection_new (
  id              TEXT PRIMARY KEY,                                          -- UUID v4; also REFI-QDA Selection GUID
  document_id     TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  code_id         TEXT NOT NULL REFERENCES code(id) ON DELETE CASCADE,
  selection_type  TEXT NOT NULL CHECK (selection_type IN ('text', 'image_region', 'media_ts', 'image_polygon')),
  memo            TEXT,                                                       -- inline annotation memo
  created_by      TEXT REFERENCES local_user(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Step 2: Copy all rows over.
INSERT INTO selection_new SELECT * FROM selection;

-- Step 3: Drop the old table and rename the new one into place.
DROP TABLE selection;
ALTER TABLE selection_new RENAME TO selection;

-- Step 4: Recreate the three indexes from v01 (PK index is rebuilt
-- automatically; these three secondary indexes must be re-declared).
CREATE INDEX IF NOT EXISTS idx_selection_document ON selection(document_id);
CREATE INDEX IF NOT EXISTS idx_selection_code     ON selection(code_id);
CREATE INDEX IF NOT EXISTS idx_selection_type     ON selection(selection_type);

COMMIT;

PRAGMA foreign_keys = ON;

-- Step 5: Add the new image_polygon extension table.
-- No existing rows reference this table; it is brand-new and need not
-- be wrapped in BEGIN/COMMIT.
CREATE TABLE IF NOT EXISTS image_polygon (
  selection_id  TEXT PRIMARY KEY REFERENCES selection(id) ON DELETE CASCADE,
  vertices_json TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_image_polygon_created_at
  ON image_polygon(created_at);
