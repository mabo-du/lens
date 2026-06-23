pub mod migrations;

use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use std::path::Path;
use std::str::FromStr;

pub async fn init_db(db_path: &Path) -> Result<SqlitePool, String> {
    let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", db_path.display()))
        .map_err(|e| e.to_string())?
        .create_if_missing(true);

    let pool = SqlitePool::connect_with(options)
        .await
        .map_err(|e| e.to_string())?;

    migrations::run_migrations(&pool).await?;

    Ok(pool)
}
