use serde::{Deserialize, Serialize};
use tauri::{command, State};

use super::projects::AppState;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSetting {
    pub key: String,
    pub value: String,
}

/// Read a single project setting by key. Returns null if not found.
#[command]
pub async fn project_setting_get(
    state: State<'_, AppState>,
    key: String,
) -> Result<Option<String>, String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    let value: Option<String> = sqlx::query_scalar(
        "SELECT value FROM project_settings WHERE key = ?",
    )
    .bind(&key)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to read project setting '{}': {}", key, e))?;

    Ok(value)
}

/// Upsert a project setting. Empty keys are rejected. Values are
/// bounded to 128 chars to prevent abuse via devtools (the Settings
/// UI's HTML maxLength=64 is a client-side convenience, not a
/// server-side guard).
#[command]
pub async fn project_setting_set(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    if value.len() > 128 {
        return Err(format!(
            "Setting value must be <= 128 chars; got {}",
            value.len()
        ));
    }
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    crate::db::set_project_setting(pool, &key, &value).await
}
