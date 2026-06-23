use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, command};
use uuid::Uuid;

use super::projects::AppState;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationRecord {
    pub id: String,
    pub document_id: String,
    pub code_id: String,
    pub start_char: i32,
    pub end_char: i32,
    pub created_by: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationSegmentRecord {
    pub id: String,
    pub document_id: String,
    pub code_id: String,
    pub created_by: Option<String>,
    pub created_at: String,
    pub start_char: i32,
    pub end_char: i32,
    pub title: String,
    pub plain_text: String,
}

pub async fn annotations_create_internal(
    state: &AppState,
    document_id: String,
    code_id: String,
    start_char: i32,
    end_char: i32,
) -> Result<AnnotationRecord, String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    // Range validation
    if start_char < 0 {
        return Err("start_char must be >= 0".to_string());
    }
    if end_char <= start_char {
        return Err("end_char must be greater than start_char".to_string());
    }

    // Verify the annotation fits within the document text
    let doc_length: Option<i32> = sqlx::query_scalar(
        "SELECT LENGTH(plain_text) FROM document WHERE id = ?"
    )
    .bind(&document_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    match doc_length {
        Some(len) if end_char > len => {
            return Err(format!(
                "end_char ({}) exceeds document length ({})",
                end_char, len
            ));
        }
        None => return Err("Document not found".to_string()),
        _ => {}
    }

    let id = Uuid::new_v4().to_string();

    // Look up the local user ID; fall back to NULL if none exists yet
    let created_by: Option<String> = sqlx::query_scalar(
        "SELECT id FROM local_user LIMIT 1"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO selection (id, document_id, code_id, selection_type, created_by) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&document_id)
    .bind(&code_id)
    .bind("text")
    .bind(&created_by)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO text_selection (selection_id, start_char, end_char) VALUES (?, ?, ?)"
    )
    .bind(&id)
    .bind(start_char)
    .bind(end_char)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;

    let annotation = sqlx::query_as::<_, AnnotationRecord>(
        "SELECT s.id, s.document_id, s.code_id, s.created_by, s.created_at, ts.start_char, ts.end_char 
         FROM selection s 
         JOIN text_selection ts ON ts.selection_id = s.id 
         WHERE s.id = ?"
    )
    .bind(&id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(annotation)
}

#[command]
pub async fn annotations_create(
    _app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    code_id: String,
    start_char: i32,
    end_char: i32,
) -> Result<AnnotationRecord, String> {
    annotations_create_internal(&state, document_id, code_id, start_char, end_char).await
}

#[command]
pub async fn annotations_delete(
    _app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    sqlx::query("DELETE FROM selection WHERE id = ?")
        .bind(&id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    // text_selection is deleted via ON DELETE CASCADE

    Ok(())
}

#[command]
pub async fn annotations_list_by_document(
    _app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
) -> Result<Vec<AnnotationRecord>, String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    let annotations = sqlx::query_as::<_, AnnotationRecord>(
        "SELECT s.id, s.document_id, s.code_id, s.created_by, s.created_at, ts.start_char, ts.end_char 
         FROM selection s 
         JOIN text_selection ts ON ts.selection_id = s.id 
         WHERE s.document_id = ?"
    )
    .bind(&document_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(annotations)
}

#[command]
pub async fn annotations_list_by_code(
    _app: AppHandle,
    state: State<'_, AppState>,
    code_id: String,
) -> Result<Vec<AnnotationSegmentRecord>, String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    let segments = sqlx::query_as::<_, AnnotationSegmentRecord>(
        "SELECT s.id, s.document_id, s.code_id, s.created_by, s.created_at, 
                ts.start_char, ts.end_char, 
                d.title, d.plain_text
         FROM selection s
         JOIN text_selection ts ON ts.selection_id = s.id
         JOIN document d ON d.id = s.document_id
         WHERE s.code_id = ?
         ORDER BY d.sort_order, ts.start_char"
    )
    .bind(&code_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(segments)
}
