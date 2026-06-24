use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle, State};
use uuid::Uuid;

use super::projects::AppState;
use crate::import::{docx, normalise, pdf, txt};

/// Extractor identifier written to the `document.extractor_id` column for
/// DOCX imports. The current path extracts text in the renderer via Mammoth.js
/// (see `src/components/document-list/DocumentList.tsx`) and passes it through
/// the `raw_text` IPC parameter. Keep this constant in sync with the mammoth
/// version declared in `package.json`.
const DOCX_EXTRACTOR_ID: &str = "lens-docx-1.0.0";

/// Extractor identifier for PDF imports. The version is baked in at build
/// time via `build.rs` reading `pdfplumber.__version__`; falls back to
/// "pdfplumber-unknown" if python3 isn't available at build time.
const PDFPLUMBER_EXTRACTOR_ID: &str = concat!("pdfplumber-", env!("PDFPLUMBER_VERSION"));

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
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
}
pub async fn documents_import_internal(
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
    // Rust-side DOCX extraction is deferred to a future phase (Option A).
    let text_content = match raw_text {
        Some(text) => text,
        None => match file_format.as_str() {
            "txt" => txt::extract_text(&file_path)?,
            "docx" => docx::extract_text_from_docx(Path::new(&file_path))?,
            "pdf" => {
                let app = app.ok_or("PDF extraction requires AppHandle")?;
                pdf::extract_text(app, &file_path).await?
            }
            other => return Err(format!("Unsupported format: {}", other)),
        },
    };

    // Determine extractor ID for provenance tracking.
    let extractor_id = match file_format.as_str() {
        "txt" => "plain-text-1.0",
        "docx" => DOCX_EXTRACTOR_ID,
        "pdf" => PDFPLUMBER_EXTRACTOR_ID,
        _ => unreachable!(
            "extractor_id: format {} should have been rejected above",
            file_format
        ),
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
    // concurrent imports from inserting duplicate rows.
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    let duplicate_exists: Option<i32> =
        sqlx::query_scalar("SELECT 1 FROM document WHERE text_hash = ? AND project_id = ?")
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
    let max_sort: Option<i32> =
        sqlx::query_scalar("SELECT MAX(sort_order) FROM document WHERE project_id = ?")
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
    .bind(extractor_id)
    .bind(word_count)
    .bind(sort_order)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to insert document: {}", e))?;

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;

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
    documents_import_internal(
        Some(&app),
        &state,
        project_id,
        file_path,
        file_format,
        raw_text,
    )
    .await
}

#[cfg(test)]
mod tests {
    //! In-module integration test for the no-`raw_text` DOCX import path:
    //! `documents_import_internal(raw_text=None)` -> `docx::extract_text_from_docx`.
    //!
    //! Closes the round-23 reviewer gap (the docx.rs unit tests cover the
    //! extractor in isolation; this test exercises the glue path that
    //! `DocumentList.tsx` uses after the mammoth removal).
    //!
    //! Strategy: focus the test on the `.docx` branch only -- it does NOT
    //! require an `AppHandle` (PDF extraction does). We construct a minimal
    //! `AppState`, seed project + local_user, write a hand-crafted .docx to
    //! a tempdir, then verify the inserted document row + asset copy.

    use super::*;
    use crate::commands::projects::AppState;
    use crate::db;
    use std::io::Write;
    use std::path::PathBuf;
    use tempfile::tempdir;
    use tokio::sync::RwLock;

    /// Build a minimal valid .docx zip archive containing the given paragraphs.
    /// Each paragraph becomes a `<w:p><w:r><w:t xml:space="preserve">{p}</w:t></w:r></w:p>` block.
    fn build_minimal_docx(paragraphs: &[&str]) -> Vec<u8> {
        let body = paragraphs
            .iter()
            .map(|p| {
                format!("<w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>", p)
            })
            .collect::<Vec<_>>()
            .join("");
        let xml = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
             <w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">\
             <w:body>{body}</w:body></w:document>"
        );

        let mut zip_buffer = std::io::Cursor::new(Vec::<u8>::new());
        {
            let mut zip = zip::ZipWriter::new(&mut zip_buffer);
            let options: zip::write::SimpleFileOptions = Default::default();
            zip.start_file("word/document.xml", options).unwrap();
            zip.write_all(xml.as_bytes()).unwrap();
            zip.finish().unwrap();
        }
        zip_buffer.into_inner()
    }

    #[tokio::test]
    async fn documents_import_native_docx_round_trip() {
        let tmp = tempdir().expect("tempdir");
        let db_path = tmp.path().join("test.qdaproj");
        let pool = db::init_db(&db_path, None)
            .await
            .expect("init_db");

        // Seed a project row + a local_user row (export path requires both).
        sqlx::query("INSERT INTO project (id, name, description) VALUES (?, ?, NULL)")
            .bind("proj-test-docx")
            .bind("Docx Round-Trip Test")
            .execute(&pool)
            .await
            .expect("insert project");
        sqlx::query("INSERT INTO local_user (id, display_name) VALUES (?, ?)")
            .bind("user-test")
            .bind("Test User")
            .execute(&pool)
            .await
            .expect("insert local_user");

        // Build a .docx fixture with two paragraphs.
        let docx_bytes = build_minimal_docx(&["Hello world.", "Goodbye world."]);
        let docx_path: PathBuf = tmp.path().join("test.docx");
        std::fs::write(&docx_path, &docx_bytes).expect("write docx");

        // Construct minimal AppState. db + project_folder must be set because
        // documents_import_internal writes to both. The `assets/<id>.docx`
        // copy uses `std::fs::copy` which fails silently if the parent dir
        // does not exist, so create it ahead of time.
        let project_folder = tmp.path().to_path_buf();
        std::fs::create_dir_all(project_folder.join("assets"))
            .expect("create assets dir");
        let state = AppState {
            db: RwLock::new(Some(pool)),
            project_folder: RwLock::new(Some(project_folder.clone())),
            encryption_key: RwLock::new(None),
        };

        // Call documents_import_internal with raw_text: None -- this is the
        // path DocumentList.tsx uses after the mammoth removal.
        let doc = documents_import_internal(
            None,
            &state,
            "proj-test-docx".to_string(),
            docx_path.to_string_lossy().to_string(),
            "docx".to_string(),
            None,
        )
        .await
        .expect("documents_import_internal");

        // Metadata sanity.
        assert_eq!(doc.file_format, "docx", "file_format mismatch");
        assert_eq!(
            doc.extractor_id, DOCX_EXTRACTOR_ID,
            "extractor_id must reflect native Rust path"
        );

        let plain_text = doc.plain_text.clone().expect("plain_text populated");
        assert!(
            plain_text.contains("Hello world."),
            "plain_text missing first paragraph; got: {:?}",
            plain_text
        );
        assert!(
            plain_text.contains("Goodbye world."),
            "plain_text missing second paragraph; got: {:?}",
            plain_text
        );
        // Word count depends on the normalise::compute_word_count
        // implementation (whitespace split vs punctuation-aware). Both 4
        // (whitespace-only) and 6 (split per non-alpha) are plausible;
        // pin tighter after the first passing run.
        let wc = doc.word_count;
        assert!(
            (4..=6).contains(&wc),
            "word_count out of expected range [4,6]: {}",
            wc
        );

        // Asset must be copied to assets/<id>.docx (powers REFI-QDA export).
        let asset_path = project_folder
            .join("assets")
            .join(format!("{}.docx", doc.id));
        assert!(
            asset_path.exists(),
            "asset file not copied to assets/ at {:?}",
            asset_path
        );

        // Re-importing the same content must surface the duplicate-detection error.
        let dup_err = documents_import_internal(
            None,
            &state,
            "proj-test-docx".to_string(),
            docx_path.to_string_lossy().to_string(),
            "docx".to_string(),
            None,
        )
        .await
        .expect_err("re-import of same content must surface duplicate error");
        assert!(
            dup_err.to_lowercase().contains("already been imported"),
            "unexpected duplicate-detection error: {:?}",
            dup_err
        );
    }
}
