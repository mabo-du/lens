-- Phase C: Image coding MVP backend support.
-- Adds intrinsic width/height columns to `document` so future rendering
-- layers (Phase C-2 frontend viewer, Phase D region annotations) can
-- size images and compute percentage coordinates without re-decoding.
-- These columns are NULL for non-image documents (txt/docx/pdf/ocr_pdf).
--
-- NOTE: plain_text remains NOT NULL for all rows. The Rust dispatcher
-- writes Some(String::new()) for image imports (semantically: "no text
-- was extracted, but a row was inserted") — keeping the NOT NULL
-- constraint avoids the SQLite >= 3.35 ALTER COLUMN DEPENDS syntax.

ALTER TABLE document ADD COLUMN intrinsic_w INTEGER;
ALTER TABLE document ADD COLUMN intrinsic_h INTEGER;

-- Index speeds up enumeration of image documents inside a project, used
-- by the upcoming media-type filter in the document list.
CREATE INDEX IF NOT EXISTS idx_document_file_format
  ON document(project_id, file_format);
