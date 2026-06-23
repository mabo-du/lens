use super::annotations::AnnotationRecord;
use super::codes::CodeTreeNode;
use super::import::Document;
use super::memos::Memo;
use super::projects::{AppState, Project};
use serde::Serialize;
use tauri::{command, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPayload {
    pub project: Project,
    pub documents: Vec<Document>,
    pub codes: Vec<CodeTreeNode>,
    pub annotations: Vec<AnnotationRecord>,
    pub memos: Vec<Memo>,
    pub local_user: LocalUserFallback,
    pub project_folder_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalUserFallback {
    pub id: String,
    pub display_name: String,
}

pub async fn export_prepare_internal(
    state: &AppState,
    project_id: String,
) -> Result<ExportPayload, String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    let folder_guard = state.project_folder.read().await;
    let folder = folder_guard.as_ref().ok_or("No project folder open")?;
    let project_folder_path = folder.to_string_lossy().to_string();

    let project = sqlx::query_as::<_, Project>(
        "SELECT id, name, description, created_at as createdAt, updated_at as updatedAt FROM project WHERE id = ?"
    )
    .bind(&project_id)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to fetch project: {}", e))?;

    let documents = sqlx::query_as::<_, Document>(
        "SELECT id, project_id, title, original_path, file_format, plain_text, text_hash, extractor_id, word_count, imported_at, sort_order 
         FROM document WHERE project_id = ? ORDER BY sort_order ASC"
    )
    .bind(&project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch documents: {}", e))?;

    // Codes require building the tree. We can reuse the logic from codes.rs, but we'll just call it directly
    // Wait, we can't easily call another tauri command directly unless we extract the logic.
    // Let's just fetch all codes and build the tree.
    let all_codes = sqlx::query_as::<_, super::codes::Code>(
        "SELECT id, project_id, name, color, description, created_by, created_at as createdAt 
         FROM code WHERE project_id = ?",
    )
    .bind(&project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch codes: {}", e))?;

    let edges = sqlx::query_as::<_, (String, String)>(
        "SELECT ancestor, descendant FROM code_closure WHERE depth = 1 AND ancestor IN (SELECT id FROM code WHERE project_id = ?)"
    )
    .bind(&project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch code edges: {}", e))?;

    let code_tree = super::codes::build_tree(all_codes, edges);

    let annotations = sqlx::query_as::<_, AnnotationRecord>(
        "SELECT s.id, s.document_id, s.code_id, ts.start_char, ts.end_char, s.created_by, s.created_at
         FROM selection s
         JOIN text_selection ts ON ts.selection_id = s.id
         JOIN document d ON d.id = s.document_id
         WHERE d.project_id = ?
         ORDER BY ts.start_char ASC"
    )
    .bind(&project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch annotations: {}", e))?;

    let memos = sqlx::query_as::<_, Memo>(
        "SELECT id, project_id, linked_code_id, linked_selection_id, body, created_by, created_at AS createdAt, updated_at AS updatedAt
         FROM memo WHERE project_id = ?"
    )
    .bind(&project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch memos: {}", e))?;

    // Look up the actual local_user from the DB.
    // A row is auto-created on project creation
    // and on project open, so the fallback here should be unreachable.
    // We generate a UUID v4 as a defense-in-depth measure — an empty
    // GUID would violate REFI-QDA Projects.xsd.
    let local_user =
        sqlx::query_as::<_, (String, String)>("SELECT id, display_name FROM local_user LIMIT 1")
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to fetch local user: {}", e))?
            .map(|(id, display_name)| LocalUserFallback { id, display_name })
            .unwrap_or_else(|| LocalUserFallback {
                id: uuid::Uuid::new_v4().to_string(),
                display_name: "Local User (fallback)".to_string(),
            });

    Ok(ExportPayload {
        project,
        documents,
        codes: code_tree,
        annotations,
        memos,
        local_user,
        project_folder_path,
    })
}

#[command]
pub async fn export_prepare(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<ExportPayload, String> {
    export_prepare_internal(&state, project_id).await
}
