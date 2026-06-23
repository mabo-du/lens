use super::projects::AppState;
use serde::{Deserialize, Serialize};
use tauri::{command, State};

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub source_type: String,
    pub source_id: String,
    pub source_name: String,
    pub snippet: String,
    pub sort_order: i32,
}

pub async fn search_query_internal(
    state: &AppState,
    project_id: String,
    query: String,
    code_id_filter: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    // Validate input
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("Search query must not be empty".to_string());
    }

    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    // Escape the query for safe FTS5 phrase search.
    // FTS5 special characters: * " ( ) and leading - ^ are operators.
    // We wrap the user's text in double-quotes for a phrase search,
    // and escape any embedded double-quotes by doubling them per SQLite convention.
    let fts_query = format!("\"{}\"", trimmed.replace("\"", "\"\""));

    let results = if let Some(code_id) = code_id_filter {
        // "Search within code" filter
        // We only want document matches where the matched character offset is within a selection tagged with `code_id`.
        // To do this perfectly in SQLite is very complex because `snippet()` doesn't expose the byte offset easily.
        // For MVP, we'll just restrict document searches to documents that HAVE that code,
        // or we return all FTS matches for documents that have that code and rely on the UI to jump to the right place.
        // Actually, let's just do the document filter: the document must contain an annotation with that code.
        sqlx::query_as::<_, SearchResult>(
            r#"
            SELECT 'document' as source_type, d.id as source_id, d.title as source_name, 
                   snippet(document_fts, 1, '<mark>', '</mark>', '...', 10) as snippet,
                   d.sort_order
            FROM document_fts
            JOIN document d ON document_fts.rowid = d.rowid
            WHERE document_fts MATCH ? AND d.project_id = ?
              AND d.id IN (SELECT document_id FROM selection WHERE code_id = ?)
            
            UNION ALL
            
            SELECT 'memo' as source_type, m.id as source_id, 
                   CASE 
                     WHEN m.linked_code_id IS NOT NULL THEN 'Memo for ' || COALESCE(c.name, 'deleted code')
                     WHEN m.linked_selection_id IS NOT NULL THEN 'Memo for Annotation'
                     ELSE 'Project Journal'
                   END as source_name,
                   snippet(memo_fts, 0, '<mark>', '</mark>', '...', 10) as snippet,
                   9999 as sort_order
            FROM memo_fts
            JOIN memo m ON memo_fts.rowid = m.rowid
            LEFT JOIN code c ON m.linked_code_id = c.id
            WHERE memo_fts MATCH ? AND m.project_id = ?
              AND (m.linked_code_id = ? OR m.linked_selection_id IN (SELECT id FROM selection WHERE code_id = ?))
            ORDER BY sort_order ASC
            "#
        )
        .bind(&fts_query).bind(&project_id).bind(&code_id)
        .bind(&fts_query).bind(&project_id).bind(&code_id).bind(&code_id)
        .fetch_all(pool).await.map_err(|e| e.to_string())?
    } else {
        sqlx::query_as::<_, SearchResult>(
            r#"
            SELECT 'document' as source_type, d.id as source_id, d.title as source_name, 
                   snippet(document_fts, 1, '<mark>', '</mark>', '...', 10) as snippet,
                   d.sort_order
            FROM document_fts
            JOIN document d ON document_fts.rowid = d.rowid
            WHERE document_fts MATCH ? AND d.project_id = ?
            
            UNION ALL
            
            SELECT 'memo' as source_type, m.id as source_id, 
                   CASE 
                     WHEN m.linked_code_id IS NOT NULL THEN 'Memo for ' || COALESCE(c.name, 'deleted code')
                     WHEN m.linked_selection_id IS NOT NULL THEN 'Memo for Annotation'
                     ELSE 'Project Journal'
                   END as source_name,
                   snippet(memo_fts, 0, '<mark>', '</mark>', '...', 10) as snippet,
                   9999 as sort_order
            FROM memo_fts
            JOIN memo m ON memo_fts.rowid = m.rowid
            LEFT JOIN code c ON m.linked_code_id = c.id
            WHERE memo_fts MATCH ? AND m.project_id = ?
            ORDER BY sort_order ASC
            "#
        )
        .bind(&fts_query).bind(&project_id)
        .bind(&fts_query).bind(&project_id)
        .fetch_all(pool).await.map_err(|e| e.to_string())?
    };

    Ok(results)
}

#[command]
pub async fn search_query(
    state: State<'_, AppState>,
    project_id: String,
    query: String,
    code_id_filter: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    search_query_internal(&state, project_id, query, code_id_filter).await
}
