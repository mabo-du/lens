pub mod migrations;

use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use std::path::Path;
use std::str::FromStr;

pub async fn init_db(
    db_path: &Path,
    encryption_key: Option<&str>,
) -> Result<SqlitePool, String> {
    let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", db_path.display()))
        .map_err(|e| e.to_string())?
        .create_if_missing(true);

    let pool = SqlitePool::connect_with(options)
        .await
        .map_err(|e| e.to_string())?;

    // If an encryption key is provided, run PRAGMA key as the first
    // operation on the connection. On SQLCipher builds this enables
    // encryption/decryption; on regular SQLite it's a no-op.
    if let Some(key) = encryption_key {
        sqlx::query("PRAGMA key = ?")
            .bind(key)
            .execute(&pool)
            .await
            .map_err(|e| format!("Failed to set encryption key: {}", e))?;
    }

    migrations::run_migrations(&pool).await?;

    Ok(pool)
}
