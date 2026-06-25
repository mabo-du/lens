-- ============================================================
-- 07_project_settings (v0.1.3+)
-- ============================================================
-- Key-value metadata store for per-project settings that don't
-- belong on the `project` row itself. Currently used for:
--
--   * `kdf_version` — the identifier of the on-disk key
--     derivation function `db::init_db` used when linking
--     SQLCipher. Bumping `KDF_VERSION_CURRENT` (see `db/mod.rs`)
--     is how a future LENS build declares an in-place KDF
--     migration; older projects keep the value they were tagged
--     with at their last open so a future build can detect (and
--     refuse to open, or auto-migrate) an unsupported version.
--
-- Row lifetime: written by `init_db` (sqlcipher-gated, only when
-- a passphrase is supplied) after migrations complete. Read by
-- future migration code; no current read path.
-- ============================================================

CREATE TABLE IF NOT EXISTS project_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
