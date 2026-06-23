use roxmltree::Document;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::io::Read;
use uuid::Uuid;

/// Import a .qdpx file into the currently open project.
///
/// `mode` is either "merge" (add alongside existing data) or "replace"
/// (delete all existing data first).
///
/// For "replace" mode, a backup of the database is saved to
/// `project_folder` / `.qdpx-backup` before the transaction begins,
/// allowing undo via `qdpx_import_undo_internal`.
pub async fn qdpx_import_internal(
    pool: &SqlitePool,
    file_path: &str,
    mode: &str,
    project_folder: Option<&std::path::Path>,
) -> Result<String, String> {
    // 1. Open ZIP and read all relevant files upfront (avoids borrow conflicts)
    let file = std::fs::File::open(file_path)
        .map_err(|e| format!("Failed to open file: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Invalid ZIP: {}", e))?;

    let mut source_texts: HashMap<String, String> = HashMap::new();
    let mut xml_str = String::new();

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("ZIP read error: {}", e))?;
        let name = entry.name().to_string();
        if name == "project.qde" {
            entry
                .read_to_string(&mut xml_str)
                .map_err(|e| format!("Failed to read project.qde: {}", e))?;
        } else if name.starts_with("Sources/") || name.ends_with(".txt") {
            let mut buf = String::new();
            entry.read_to_string(&mut buf).ok();
            source_texts.insert(name, buf);
        }
    }

    if xml_str.is_empty() {
        return Err("project.qde not found in archive".to_string());
    }

    // 2. Parse XML
    let doc = Document::parse(&xml_str)
        .map_err(|e| format!("Invalid XML in project.qde: {}", e))?;

    let root = doc.root_element();

    if mode == "replace" {
        if let Some(folder) = project_folder {
            // Force a WAL checkpoint so all data is in the main DB file
            let _ = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
                .execute(pool)
                .await;
            // Find the actual .qdaproj file in the project folder
            let backup_path = folder.join(".qdpx-backup");
            let db_path: Option<std::path::PathBuf> = std::fs::read_dir(folder)
                .ok()
                .and_then(|entries| {
                    entries.filter_map(|e| e.ok()).find(|e| {
                        e.path()
                            .extension()
                            .map_or(false, |ext| ext == "qdaproj")
                    })
                })
                .map(|e| e.path());
            if let Some(db) = db_path {
                std::fs::copy(&db, &backup_path)
                    .map_err(|e| format!("Failed to create backup: {}", e))?;
            }
        }
    }

    let mut tx = pool.begin().await.map_err(|e| format!("DB error: {}", e))?;

    let project_id: String = {
        let row: (String,) = sqlx::query_as("SELECT id FROM project LIMIT 1")
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| "No project open".to_string())?;
        row.0
    };

    // Replace mode: clear existing data
    if mode == "replace" {
        sqlx::query("DELETE FROM text_selection")
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("{}", e))?;
        sqlx::query("DELETE FROM selection")
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("{}", e))?;
        sqlx::query("DELETE FROM memo")
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("{}", e))?;
        sqlx::query("DELETE FROM code_closure")
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("{}", e))?;
        sqlx::query("DELETE FROM code")
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("{}", e))?;
        sqlx::query("DELETE FROM document")
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("{}", e))?;
    }

    let mut code_count = 0u32;

    // Find CodeBook > Codes
    let codebook = root
        .children()
        .find(|c| c.is_element() && c.has_tag_name("CodeBook"));
    if let Some(cb) = codebook {
        let codes_el = cb
            .children()
            .find(|c| c.is_element() && c.has_tag_name("Codes"));

        if let Some(codes_el) = codes_el {
            async fn import_codes(
                tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
                parent: roxmltree::Node<'_, '_>,
                parent_id: Option<&str>,
                project_id: &str,
                count: &mut u32,
            ) -> Result<(), String> {
                let code_iter = parent
                    .children()
                    .filter(|c: &roxmltree::Node| c.is_element() && c.has_tag_name("Code"));

                for code in code_iter {
                    let guid: String = code
                        .attribute("guid")
                        .unwrap_or(&uuid::Uuid::new_v4().to_string())
                        .to_string();
                    let name: String = code
                        .attribute("name")
                        .unwrap_or("Unnamed")
                        .to_string();
                    let color: String = if let Some(color_attr) = code.attribute("color") {
                        if color_attr.len() >= 9 && color_attr.starts_with('#') {
                            format!("#{}", &color_attr[3..9])
                        } else {
                            color_attr.to_string()
                        }
                    } else {
                        "#6366f1".to_string()
                    };

                    sqlx::query(
                        "INSERT INTO code (id, project_id, name, color) VALUES (?, ?, ?, ?)",
                    )
                    .bind(&guid)
                    .bind(project_id)
                    .bind(&name)
                    .bind(&color)
                    .execute(&mut **tx)
                    .await
                    .map_err(|e| format!("Failed to insert code '{}': {}", name, e))?;

                    *count += 1;

                    // Self-referencing closure row
                    sqlx::query(
                        "INSERT INTO code_closure (ancestor, descendant, depth) VALUES (?, ?, 0)",
                    )
                    .bind(&guid)
                    .bind(&guid)
                    .execute(&mut **tx)
                    .await
                    .map_err(|e| format!("{}", e))?;

                    // Links from ancestors of parent
                    if let Some(pid) = parent_id {
                        sqlx::query(
                            "INSERT INTO code_closure (ancestor, descendant, depth) \
                             SELECT ancestor, ?, depth + 1 FROM code_closure WHERE descendant = ?",
                        )
                        .bind(&guid)
                        .bind(pid)
                        .execute(&mut **tx)
                        .await
                        .map_err(|e| format!("{}", e))?;
                    }

                    // Recurse
                    Box::pin(import_codes(tx, code, Some(&guid), project_id, count))
                        .await?;
                }
                Ok(())
            }

            import_codes(&mut tx, codes_el, None, &project_id, &mut code_count).await?;
        }
    }

    let mut doc_count = 0u32;
    let mut sel_count = 0u32;

    let sources_el = root
        .children()
        .find(|c| c.is_element() && c.has_tag_name("Sources"));
    if let Some(sources) = sources_el {
        let text_sources: Vec<_> = sources
            .children()
            .filter(|c| c.is_element() && c.has_tag_name("TextSource"))
            .collect();

        for source in text_sources {
            let guid = source
                .attribute("guid")
                .unwrap_or(&Uuid::new_v4().to_string())
                .to_string();
            let name = source
                .attribute("name")
                .unwrap_or("Untitled")
                .to_string();
            let plain_text_path = source.attribute("plainTextPath");

            // Read source text from pre-loaded HashMap
            let text = if let Some(path) = plain_text_path {
                let sources_key = if path.starts_with("Sources/") {
                    path.to_string()
                } else {
                    format!("Sources/{}", path)
                };
                source_texts
                    .get(&sources_key)
                    .or_else(|| source_texts.get(path))
                    .cloned()
                    .unwrap_or_default()
            } else {
                String::new()
            };

            let text = normalise_text(&text);

            sqlx::query(
                "INSERT INTO document (id, project_id, title, file_format, plain_text, text_hash, extractor_id, word_count) \
                 VALUES (?, ?, ?, 'txt', ?, '', 'refi-qda-import', ?)",
            )
            .bind(&guid)
            .bind(&project_id)
            .bind(&name)
            .bind(&text)
            .bind(text.split_whitespace().count() as i64)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to insert document '{}': {}", name, e))?;

            doc_count += 1;

            let selections: Vec<_> = source
                .children()
                .filter(|c| c.is_element() && c.has_tag_name("PlainTextSelection"))
                .collect();

            for sel in selections {
                let sel_guid = sel
                    .attribute("guid")
                    .unwrap_or(&Uuid::new_v4().to_string())
                    .to_string();
                let start_pos: i64 = sel
                    .attribute("startPosition")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                let end_pos: i64 = sel
                    .attribute("endPosition")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);

                if start_pos < 0 || end_pos <= start_pos || end_pos > text.len() as i64 {
                    continue;
                }

                let codings: Vec<_> = sel
                    .children()
                    .filter(|c| c.is_element() && c.has_tag_name("Coding"))
                    .collect();

                for coding in codings {
                    let code_ref = coding
                        .children()
                        .find(|c| c.is_element() && c.has_tag_name("CodeRef"));

                    if let Some(cr) = code_ref {
                        if let Some(code_guid) = cr.attribute("targetGUID") {
                            sqlx::query(
                                "INSERT INTO selection (id, document_id, code_id, selection_type) \
                                 VALUES (?, ?, ?, 'text')",
                            )
                            .bind(&sel_guid)
                            .bind(&guid)
                            .bind(code_guid)
                            .execute(&mut *tx)
                            .await
                            .map_err(|e| format!("{}", e))?;

                            sqlx::query(
                                "INSERT INTO text_selection (selection_id, start_char, end_char) \
                                 VALUES (?, ?, ?)",
                            )
                            .bind(&sel_guid)
                            .bind(start_pos)
                            .bind(end_pos)
                            .execute(&mut *tx)
                            .await
                            .map_err(|e| format!("{}", e))?;

                            sel_count += 1;
                        }
                    }
                }
            }
        }
    }

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit import: {}", e))?;

    Ok(format!(
        "Imported {} document(s), {} code(s), {} annotation(s)",
        doc_count, code_count, sel_count
    ))
}

fn normalise_text(text: &str) -> String {
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut result = String::with_capacity(text.len());
    let mut nl = 0u32;
    for ch in text.chars() {
        if ch == '\n' {
            nl += 1;
            if nl <= 2 {
                result.push(ch);
            }
        } else {
            nl = 0;
            result.push(ch);
        }
    }
    result.trim().to_string()
}

#[tauri::command]
pub async fn qdpx_import(
    _app: tauri::AppHandle,
    state: tauri::State<'_, super::projects::AppState>,
    file_path: String,
    mode: String,
) -> Result<String, String> {
    let pool = state.db.read().await;
    let pool = pool.as_ref().ok_or("No project open")?;
    let folder = state.project_folder.read().await;
    qdpx_import_internal(pool, &file_path, &mode, folder.as_deref()).await
}

/// Restore the database from the backup created before a replace-mode import.
pub async fn qdpx_import_undo_internal(
    state: &super::projects::AppState,
) -> Result<String, String> {
    let folder = state.project_folder.read().await;
    let folder = folder.as_ref().ok_or("No project open")?;
    let backup_path = folder.join(".qdpx-backup");

    if !backup_path.exists() {
        return Err("No import backup found to undo".to_string());
    }

    // Find the actual .qdaproj file in the project folder
    let db_path: std::path::PathBuf = std::fs::read_dir(folder)
        .map_err(|e| format!("Failed to read project folder: {}", e))?
        .filter_map(|e| e.ok())
        .find(|e| e.path().extension().map_or(false, |ext| ext == "qdaproj"))
        .map(|e| e.path())
        .ok_or("No .qdaproj database file found in project folder")?;

    // Close the current pool before replacing the file
    if let Some(pool) = state.db.write().await.take() {
        pool.close().await;
    }

    std::fs::copy(&backup_path, &db_path)
        .map_err(|e| format!("Failed to restore backup: {}", e))?;

    std::fs::remove_file(&backup_path).ok();

    let encryption_key = state.encryption_key.read().await.clone();
    let pool = crate::db::init_db(&db_path, encryption_key.as_deref()).await?;
    *state.db.write().await = Some(pool);

    Ok("Import undone. Previous data restored.".to_string())
}

/// Restore the database from the backup created before a replace-mode import.
#[tauri::command]
pub async fn qdpx_import_undo(
    _app: tauri::AppHandle,
    state: tauri::State<'_, super::projects::AppState>,
) -> Result<String, String> {
    qdpx_import_undo_internal(&state).await
}
