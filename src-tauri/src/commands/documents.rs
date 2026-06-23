use super::import::Document;
use super::projects::AppState;
use tauri::{command, AppHandle, State};

pub async fn document_delete_internal(state: &AppState, id: String) -> Result<(), String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    // Fetch the document row to get original_path (for the asset extension)
    // before the DELETE cascade removes it.
    let row: Option<(Option<String>, String)> =
        sqlx::query_as("SELECT original_path, file_format FROM document WHERE id = ?")
            .bind(&id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;

    let (original_path, file_format) = match row {
        Some(r) => r,
        None => return Err("Document not found".to_string()),
    };

    // Delete the DB row. Cascade deletes:
    //   - selection / text_selection (annotations)
    //   - transcript_segment
    //   - document_fts index (via trigger)
    sqlx::query("DELETE FROM document WHERE id = ?")
        .bind(&id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    // Direct delete the asset file using the known naming convention
    // ({id}.{ext}) — O(1) instead of scanning the entire assets/ directory.
    if let Ok(folder_guard) = state.project_folder.try_read() {
        if let Some(ref folder) = *folder_guard {
            let assets_dir = folder.join("assets");
            let ext = original_path
                .as_deref()
                .and_then(|p| std::path::Path::new(p).extension())
                .and_then(|e| e.to_str())
                .unwrap_or(&file_format);
            let asset_path = assets_dir.join(format!("{}.{}", id, ext));
            // Best-effort: log failure but don't abort the delete.
            if asset_path.exists() {
                if let Err(e) = std::fs::remove_file(&asset_path) {
                    eprintln!(
                        "Warning: could not delete asset file {:?}: {}",
                        asset_path, e
                    );
                }
            }
        }
    }

    Ok(())
}

#[command]
pub async fn document_delete(
    _app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    document_delete_internal(&state, id).await
}

#[command]
pub async fn documents_list(
    _app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<Document>, String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    // Use the exact same SQL output mapping as import
    let docs = sqlx::query_as::<_, Document>(
        "SELECT id, project_id, title, original_path, file_format, plain_text, text_hash, extractor_id, word_count, imported_at, sort_order FROM document WHERE project_id = ? ORDER BY sort_order"
    )
    .bind(&project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(docs)
}

#[command]
pub async fn document_get_content(
    state: State<'_, AppState>,
    id: String,
) -> Result<String, String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No active database connection")?;    let plain_text: Option<String> = sqlx::query_scalar(
        "SELECT plain_text FROM document WHERE id = ?"
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to fetch document content: {}", e))?;

    Ok(plain_text.unwrap_or_default())
}
