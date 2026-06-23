use sqlx::{Executor, SqlitePool};

const MIGRATIONS: &[(&str, &str)] = &[
    (
        "01_initial_schema",
        include_str!("migrations/01_initial_schema.sql"),
    ),
    (
        "02_unique_text_hash",
        include_str!("migrations/02_unique_text_hash.sql"),
    ),
    (
        "03_add_code_updated_at",
        include_str!("migrations/03_add_code_updated_at.sql"),
    ),
];

pub async fn run_migrations(pool: &SqlitePool) -> Result<(), String> {
    for (i, (name, sql)) in MIGRATIONS.iter().enumerate() {
        let version = i as i32 + 1;

        sqlx::query("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -32000;")
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to set pragmas: {}", e))?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS schema_version (
                version      INTEGER PRIMARY KEY,
                applied_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            );",
        )
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to create schema_version table: {}", e))?;

        // Check if migration is already applied

        let applied: Option<i32> =
            sqlx::query_scalar("SELECT version FROM schema_version WHERE version = ?")
                .bind(version)
                .fetch_optional(pool)
                .await
                .map_err(|e| format!("Failed to check migration version: {}", e))?;

        if applied.is_none() {
            // Apply migration
            pool.execute(*sql)
                .await
                .map_err(|e| format!("Failed to run migration {}: {}", name, e))?;

            // Record migration
            sqlx::query("INSERT INTO schema_version (version) VALUES (?)")
                .bind(version)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to record migration {}: {}", name, e))?;
        }
    }

    Ok(())
}
