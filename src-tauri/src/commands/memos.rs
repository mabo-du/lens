use serde::{Deserialize, Serialize};
use tauri::{State, command};
use uuid::Uuid;
use super::projects::AppState;

#[derive(Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Memo {
    pub id: String,
    pub project_id: String,
    pub linked_code_id: Option<String>,
    pub linked_selection_id: Option<String>,
    pub body: String,
    pub created_by: Option<String>,
    #[sqlx(rename = "createdAt")]
    pub created_at: String,
    #[sqlx(rename = "updatedAt")]
    pub updated_at: String,
}

pub async fn memos_save_internal(
    state: &AppState,
    project_id: String,
    linked_code_id: Option<String>,
    linked_selection_id: Option<String>,
    body: String,
) -> Result<Memo, String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    // Check if one exists
    let existing: Option<String> = if linked_code_id.is_none() && linked_selection_id.is_none() {
        sqlx::query_scalar("SELECT id FROM memo WHERE project_id = ? AND linked_code_id IS NULL AND linked_selection_id IS NULL")
            .bind(&project_id)
            .fetch_optional(pool).await.map_err(|e| e.to_string())?
    } else if let Some(ref c) = linked_code_id {
        sqlx::query_scalar("SELECT id FROM memo WHERE linked_code_id = ?")
            .bind(c)
            .fetch_optional(pool).await.map_err(|e| e.to_string())?
    } else if let Some(ref s) = linked_selection_id {
        sqlx::query_scalar("SELECT id FROM memo WHERE linked_selection_id = ?")
            .bind(s)
            .fetch_optional(pool).await.map_err(|e| e.to_string())?
    } else {
        None
    };

    let memo_id = if let Some(id) = existing {
        sqlx::query("UPDATE memo SET body = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?")
            .bind(&body)
            .bind(&id)
            .execute(pool).await.map_err(|e| e.to_string())?;
        id
    } else {
        // Look up the local user ID for authorship attribution
        let created_by: Option<String> = sqlx::query_scalar(
            "SELECT id FROM local_user LIMIT 1"
        )
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;

        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO memo (id, project_id, linked_code_id, linked_selection_id, body, created_by)
             VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&project_id)
        .bind(&linked_code_id)
        .bind(&linked_selection_id)
        .bind(&body)
        .bind(&created_by)
        .execute(pool).await.map_err(|e| e.to_string())?;
        id
    };

    let memo = sqlx::query_as::<_, Memo>(
        "SELECT id, project_id, linked_code_id, linked_selection_id, body, created_by, created_at as createdAt, updated_at as updatedAt
         FROM memo WHERE id = ?"
    )
    .bind(&memo_id)
    .fetch_one(pool).await.map_err(|e| e.to_string())?;

    Ok(memo)
}

#[command]
pub async fn memos_save(
    state: State<'_, AppState>,
    project_id: String,
    linked_code_id: Option<String>,
    linked_selection_id: Option<String>,
    body: String,
) -> Result<Memo, String> {
    memos_save_internal(&state, project_id, linked_code_id, linked_selection_id, body).await
}

#[command]
pub async fn memos_get(
    state: State<'_, AppState>,
    project_id: String,
    linked_code_id: Option<String>,
    linked_selection_id: Option<String>,
) -> Result<Option<Memo>, String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    let q = if linked_code_id.is_none() && linked_selection_id.is_none() {
        sqlx::query_as::<_, Memo>(
            "SELECT id, project_id, linked_code_id, linked_selection_id, body, created_by, created_at as createdAt, updated_at as updatedAt
             FROM memo WHERE project_id = ? AND linked_code_id IS NULL AND linked_selection_id IS NULL"
        ).bind(&project_id)
    } else if let Some(ref c) = linked_code_id {
        sqlx::query_as::<_, Memo>(
            "SELECT id, project_id, linked_code_id, linked_selection_id, body, created_by, created_at as createdAt, updated_at as updatedAt
             FROM memo WHERE linked_code_id = ?"
        ).bind(c)
    } else if let Some(ref s) = linked_selection_id {
        sqlx::query_as::<_, Memo>(
            "SELECT id, project_id, linked_code_id, linked_selection_id, body, created_by, created_at as createdAt, updated_at as updatedAt
             FROM memo WHERE linked_selection_id = ?"
        ).bind(s)
    } else {
        return Ok(None);
    };

    let memo = q.fetch_optional(pool).await.map_err(|e| e.to_string())?;
    Ok(memo)
}

#[command]
pub async fn memos_list_by_project(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<Memo>, String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;
    let memos = sqlx::query_as::<_, Memo>(
        "SELECT id, project_id, linked_code_id, linked_selection_id, body, created_by, created_at as createdAt, updated_at as updatedAt
         FROM memo WHERE project_id = ?"
    )
    .bind(&project_id)
    .fetch_all(pool).await.map_err(|e| e.to_string())?;
    Ok(memos)
}
