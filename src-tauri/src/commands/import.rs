use serde::{Deserialize, Serialize};
use sqlx::Executor;
use tauri::{AppHandle, State, command};
use uuid::Uuid;
use std::path::PathBuf;

use super::projects::AppState;
use crate::import::{normalise, txt, pdf};

/// Extractor identifier written to the `document.extractor_id` column for
/// DOCX imports. The current path extracts text in the renderer via Mammoth.js
/// (see `src/components/document-list/DocumentList.tsx`) and passes it through
/// the `raw_text` IPC parameter. Keep this constant in sync with the mammoth
/// version declared in `package.json`.
const MAMMOTH_EXTRACTOR_ID: &str = "mammoth-1.12.0";

/// Extractor identifier for PDF imports. The version is baked in at build
/// time via `build.rs` reading `pdfplumber.__version__`; falls back to
/// "pdfplumber-unknown" if python3 isn't available at build time.
const PDFPLUMBER_EXTRACTOR_ID: &str =
    concat!("pdfplumber-", env!("PDFPLUMBER_VERSION"));

#[derive(Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub original_path: Option<String>,
    pub file_format: String,
    pub plain_text: Option<String>,
    pub text_hash: String,
    pub extractor_id: String,
    pub word_count: i32,
    pub imported_at: String,
    pub sort_order: i32,
}pub async fn documents_import_internal(
    app: Option<&AppHandle>,
    state: &AppState,
    project_id: String,
    file_path: String,
    file_format: String,
    raw_text: Option<String>, // Provided for DOCX
) -> Result<Document, String> {
    // Reject unknown formats early so downstream match arms can use
    // unreachable!() safely — both the extraction and extractor-id
    // matches are guaranteed to only see valid formats.
    match file_format.as_str() {
        "txt" | "docx" | "pdf" => {}
        other => return Err(format!("Unsupported format: {}", other)),
    }

    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    // Determine raw text.
    //
    // DOCX extraction happens in the renderer via Mammoth.js (see
    // DocumentList.tsx). The renderer passes the extracted text as
    // `raw_text`, so DOCX imports must supply this parameter. Direct
    // Rust-side DOCX extraction is deferred to a future phase (Option A
    // in ACTION_PLAN §1.4).
    let text_content = match raw_text {
        Some(text) => text,
        None => {
            match file_format.as_str() {
                "txt" => txt::extract_text(&file_path)?,
                "docx" => {
                    return Err(
                        "DOCX extraction must be performed in the renderer. \
                         Re-import via the Document List panel."
                            .to_string(),
                    );
                }
                "pdf" => {
                    let app = app.ok_or("PDF extraction requires AppHandle")?;
                    pdf::extract_text(app, &file_path).await?
                }
                other => return Err(format!("Unsupported format: {}", other)),
            }
        }
    };

    // Determine extractor ID for provenance tracking.
    let extractor_id = match file_format.as_str() {
        "txt" => "plain-text-1.0",
        "docx" => MAMMOTH_EXTRACTOR_ID,
        "pdf" => PDFPLUMBER_EXTRACTOR_ID,
        _ => unreachable!("extractor_id: format {} should have been rejected above", file_format),
    };

    // Normalise
    let normalised = normalise::normalise_text(&text_content);
    let text_hash = normalise::compute_hash(&normalised);
    let word_count = normalise::compute_word_count(&normalised);

    let id = Uuid::new_v4().to_string();
    let file_name = PathBuf::from(&file_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled")
        .to_string();

    // Wrap duplicate check + INSERT in a transaction. Together with the
    // UNIQUE(project_id, text_hash) index (migration 02), this prevents
    // concurrent imports from inserting duplicate rows (ACTION_PLAN §2.3).
    let mut tx = pool.begin().await.map_err(|e| format!("Failed to begin transaction: {}", e))?;

    let duplicate_exists: Option<i32> = sqlx::query_scalar(
        "SELECT 1 FROM document WHERE text_hash = ? AND project_id = ?"
    )
    .bind(&text_hash)
    .bind(&project_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| format!("Failed to check for duplicates: {}", e))?;

    if duplicate_exists.is_some() {
        return Err("This document has already been imported. To import an updated version, add it as a separate document entry.".to_string());
    }

    // Get max sort_order (inside the transaction so sort_order is
    // consistent with the INSERT).
    let max_sort: Option<i32> = sqlx::query_scalar(
        "SELECT MAX(sort_order) FROM document WHERE project_id = ?"
    )
    .bind(&project_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| format!("Failed to fetch sort_order: {}", e))?;

    let sort_order = max_sort.unwrap_or(-1) + 1;

    // Insert document
    sqlx::query(
        "INSERT INTO document (id, project_id, title, original_path, file_format, plain_text, text_hash, extractor_id, word_count, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&project_id)
    .bind(&file_name)
    .bind(&file_path)
    .bind(&file_format)
    .bind(&normalised)
    .bind(&text_hash)
    .bind(&extractor_id)
    .bind(&word_count)
    .bind(&sort_order)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to insert document: {}", e))?;

    tx.commit().await.map_err(|e| format!("Failed to commit transaction: {}", e))?;

    // Copy original file to assets/ for REFI-QDA export
    if let Ok(folder_guard) = state.project_folder.try_read() {
        if let Some(ref folder) = *folder_guard {
            let assets_dir = folder.join("assets");
            let ext = std::path::Path::new(&file_path)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or(file_format.as_str());
            let dest = assets_dir.join(format!("{}.{}", id, ext));
            // Best-effort: log failure but don't abort the import
            if let Err(e) = std::fs::copy(&file_path, &dest) {
                eprintln!("Warning: could not copy source file to assets/: {}", e);
            }
        }
    }

    // FTS triggers handle indexing automatically

    // Fetch and return document
    let doc = sqlx::query_as::<_, Document>(
        "SELECT id, project_id, title, original_path, file_format, plain_text, text_hash, extractor_id, word_count, imported_at, sort_order FROM document WHERE id = ?"
    )
    .bind(&id)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to fetch created document: {}", e))?;

    Ok(doc)
}

#[command]
pub async fn documents_import(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    file_path: String,
    file_format: String,
    raw_text: Option<String>,
) -> Result<Document, String> {
    documents_import_internal(Some(&app), &state, project_id, file_path, file_format, raw_text).await
}
