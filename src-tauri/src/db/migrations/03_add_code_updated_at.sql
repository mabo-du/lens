-- ACTION_PLAN P2.12: Add updated_at column for code audit trail
ALTER TABLE code ADD COLUMN updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

-- Backfill existing rows with created_at as the initial updated_at
UPDATE code SET updated_at = created_at;

-- Trigger to auto-update updated_at on any change
CREATE TRIGGER IF NOT EXISTS code_updated_at AFTER UPDATE ON code
BEGIN
  UPDATE code SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
END;
