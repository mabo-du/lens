-- Phase 2.3: Prevent duplicate document imports at the schema level.
-- The duplicate check in documents_import_internal runs inside a transaction,
-- but the UNIQUE index is the final defense against races in WAL mode.
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_unique_text_hash
  ON document(project_id, text_hash);
