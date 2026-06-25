//! **Migration round-trip integration test** — the v0.1.5 / v2-prep
//! safety net for every SQL migration in `src-tauri/src/db/migrations/`.
//!
//! ## What this confirms
//!
//! For EVERY migration file:
//!
//! 1. **Forward apply succeeds.** `init_db` on a fresh empty `.qdaproj`
//!    must apply all migrations in order without errors.
//! 2. **Schema-version table records every step.** `SELECT version,
//!    applied_at FROM schema_version` returns one row per migration with
//!    a parseable ISO-8601 `applied_at` and a 1-based auto-incrementing
//!    `version`.
//! 3. **Core invariant tables exist.** `project`, `document`,
//!    `selection`, `code`, `code_closure`, `memo_*`, `image_selection`,
//!    `image_polygon`, `project_settings`, etc. are present and
//!    queryable after the migration set completes.
//! 4. **Re-apply is idempotent.** Opening the same `.qdaproj` twice
//!    does NOT add a new `schema_version` row.
//! 5. **User data survives an upgrade.** INSERT-then-reopen round-trips.

use lens::db::init_db;
use lens::db::migrations::MIGRATIONS;

/// Pulls migration count from the array itself so adding a new migration
/// only requires touching `migrations.rs` — no two-place sync.
const EXPECTED_MIGRATION_COUNT: i64 = MIGRATIONS.len() as i64;

/// **Required core tables.** `image_selection` (NOT `image_region` — the
/// historical name in `01_initial_schema.sql` is `image_selection`; the
/// IPC client types call them `ImageRegionRecord` for product-language
/// reasons, but the on-disk table is `image_selection`). `image_polygon`
/// is added by migration 06 alongside the `transcript_segment` /
/// `media_selection` v2-prep tables.
const REQUIRED_TABLES: &[&str] = &[
    "project",
    "document",
    "selection",
    "code",
    "code_closure",
    "memo",
    "text_selection",
    "image_selection",
    "media_selection",
    "transcript_segment",
    "image_polygon",
    "project_settings",
    "schema_version",
];

#[tokio::test]
async fn migration_runner_applies_all_migrations() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("round-trip.qdaproj");
    let pool = init_db(&db_path, None)
        .await
        .expect("init_db must apply all migrations");

    let applied: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schema_version")
        .fetch_one(&pool)
        .await
        .expect("count schema_version rows");
    assert_eq!(
        applied, EXPECTED_MIGRATION_COUNT,
        "schema_version row count must equal MIGRATIONS.len() ({EXPECTED_MIGRATION_COUNT}); \
         if you added a migration file, ensure it's wired into the array in migrations.rs",
    );

    pool.close().await;
}

#[tokio::test]
async fn migration_runner_records_version_and_iso8601_timestamps() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("timestamps.qdaproj");
    let pool = init_db(&db_path, None)
        .await
        .expect("init_db must apply all migrations");

    let rows: Vec<(i64, String)> = sqlx::query_as(
        "SELECT version, applied_at FROM schema_version ORDER BY version ASC",
    )
    .fetch_all(&pool)
    .await
    .expect("read schema_version");

    assert_eq!(
        rows.len() as i64,
        EXPECTED_MIGRATION_COUNT,
        "row count must match MIGRATIONS length"
    );

    for (i, (version, ts)) in rows.iter().enumerate() {
        assert_eq!(
            *version,
            (i + 1) as i64,
            "schema_version[{i}].version must be 1-based auto-incrementing (got: {version})",
        );
        assert!(!ts.is_empty(), "schema_version[{i}].applied_at must not be empty");
        // Cheap sanity: applied_at must be ISO-8601-ish (YYYY-MM-DDTHH:MM:SSZ).
        assert!(
            ts.len() >= 20 && ts.contains('T') && ts.ends_with('Z'),
            "schema_version[{i}].applied_at must look like ISO-8601 (got: {ts})",
        );
    }

    pool.close().await;
}

#[tokio::test]
async fn migration_runner_creates_required_core_tables() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("core-tables.qdaproj");
    let pool = init_db(&db_path, None)
        .await
        .expect("init_db must apply all migrations");

    let existing: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
    )
    .fetch_all(&pool)
    .await
    .expect("enumerate sqlite_master");

    for required in REQUIRED_TABLES {
        assert!(
            existing.iter().any(|t| t == required),
            "required table `{required}` is missing after migration set — \
             if you renamed it, update REQUIRED_TABLES; \
             existing tables: {existing:?}",
        );
    }

    pool.close().await;
}

#[tokio::test]
async fn migration_runner_handles_reopen_without_re_applying() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("reopen.qdaproj");

    let pool = init_db(&db_path, None)
        .await
        .expect("first init_db must apply all migrations");
    let first_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schema_version")
        .fetch_one(&pool)
        .await
        .expect("first count");
    assert_eq!(first_count, EXPECTED_MIGRATION_COUNT);
    pool.close().await;

    let second = init_db(&db_path, None)
        .await
        .expect("second init_db must succeed");
    let second_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schema_version")
        .fetch_one(&second)
        .await
        .expect("second count");
    assert_eq!(
        second_count, EXPECTED_MIGRATION_COUNT,
        "reopening must NOT add a new schema_version row — re-apply is a no-op"
    );
    second.close().await;
}

#[tokio::test]
async fn migration_runner_preserves_user_data_through_upgrade() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("preserve.qdaproj");

    let pool_first = init_db(&db_path, None)
        .await
        .expect("init_db v0");
    sqlx::query("INSERT INTO project (id, name, description) VALUES (?, ?, ?)")
        .bind("preserve-1")
        .bind("Original Project")
        .bind(Some("seeded before reopen"))
        .execute(&pool_first)
        .await
        .expect("insert project");
    sqlx::query("INSERT INTO code (id, project_id, name, color) VALUES (?, ?, ?, ?)")
        .bind("code-1")
        .bind("preserve-1")
        .bind("Theme 1")
        .bind("#ff0000")
        .execute(&pool_first)
        .await
        .expect("insert code");
    pool_first.close().await;

    let pool_second = init_db(&db_path, None)
        .await
        .expect("init_db reopen");
    let name: String = sqlx::query_scalar("SELECT name FROM project WHERE id = ?")
        .bind("preserve-1")
        .fetch_one(&pool_second)
        .await
        .expect("read project name");
    assert_eq!(name, "Original Project", "project data preserved through reopen");
    let code_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM code WHERE project_id = ?")
        .bind("preserve-1")
        .fetch_one(&pool_second)
        .await
        .expect("count codes");
    assert_eq!(code_count, 1, "code data preserved through reopen");
    pool_second.close().await;
}
