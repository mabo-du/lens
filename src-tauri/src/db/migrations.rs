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
];

pub async fn run_migrations(pool: &SqlitePool) -> Result<(), String> {
    for (name, sql) in MIGRATIONS {
        // Run PRAGMAS
        sqlx::query("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -32000;")
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to set pragmas: {}", e))?;

        // Initialize schema_version table
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
        // We'll use the index in the array + 1 as the version number
        let version = MIGRATIONS.iter().position(|&(n, _)| n == *name).unwrap() as i32 + 1;

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
