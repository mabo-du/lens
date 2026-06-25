// src-tauri/src/commands/analytics.rs
//
// v0.2 analytics: counts and co-occurrence over a project's annotations.
//
// Co-occurrence uses the any-overlap definition (Key Query #6) restricted
// to text_selection rows so audio/video annotations don't pollute the
// co-occurrence matrix. Pair ordering (`a.code_id < b.code_id`) ensures
// each pair appears once.
//
// IPC contract:
//   - invoke('analytics_code_frequency', { projectId }) -> CodeFrequencyRow[]
//   - invoke('analytics_co_occurrence',  { projectId }) -> CoOccurrenceRow[]
// Both gated on `state.db` being Some (project open).
//
// Integration-test slot: src-tauri/tests/analytics_tests.rs would
// exercise these commands against an in-memory SQLite fixture seeded
// with overlapping selections; not added in this commit.

use super::projects::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{command, State};

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CodeFrequencyRow {
    pub code_id: String,
    pub count: i32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoOccurrenceRow {
    pub code_a: String,
    pub code_b: String,
    pub count: i32,
}

/// Code-frequency per project: annotation counts per code_id.
/// Returns rows ordered by descending count so the JS reuses the slice
/// without resorting (rows[0..N] is "top N" used by the dashboard).
#[command]
pub async fn analytics_code_frequency(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<CodeFrequencyRow>, String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    let rows = sqlx::query_as::<_, CodeFrequencyRow>(
        "SELECT s.code_id AS code_id, COUNT(*) AS count
         FROM selection s
         JOIN document d ON s.document_id = d.id
         WHERE d.project_id = ?
         GROUP BY s.code_id
         ORDER BY count DESC, s.code_id ASC",
    )
    .bind(&project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows)
}

/// Co-occurrence: pairs of distinct codes whose text selections overlap
/// in the same document, deduplicated by `(code_a, code_b)` with
/// `code_a < code_b`. Capped at the top 200 pairs by count to keep the
/// matrix tractable on dashboards.
#[command]
pub async fn analytics_co_occurrence(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<CoOccurrenceRow>, String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    // s1.code_id < s2.code_id ensures unordered emission; the join on
    // SELECTION_ID != SELECTION_ID and the OVERLAP test (start < end
    // AND end > start, the standard interval-intersection form) yield
    // every overlapping pair exactly once.
    let overlaps: Vec<(String, String)> = sqlx::query_as(
        "SELECT s1.code_id AS code_a, s2.code_id AS code_b
         FROM text_selection ts1
         JOIN selection s1 ON s1.id = ts1.selection_id
         JOIN text_selection ts2
              ON ts2.selection_id <> ts1.selection_id
         JOIN selection s2 ON s2.id = ts2.selection_id
         JOIN document d ON s1.document_id = d.id
         WHERE d.project_id = ?
           AND s1.document_id = s2.document_id
           AND s1.code_id <> s2.code_id
           AND s1.code_id < s2.code_id
           AND ts1.start_char < ts2.end_char
           AND ts1.end_char   > ts2.start_char",
    )
    .bind(&project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut counts: HashMap<(String, String), i32> = HashMap::new();
    for (a, b) in overlaps {
        *counts.entry((a, b)).or_insert(0) += 1;
    }

    let mut results: Vec<CoOccurrenceRow> = counts
        .into_iter()
        .map(|((code_a, code_b), count)| CoOccurrenceRow { code_a, code_b, count })
        .collect();

    results.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.code_a.cmp(&b.code_a)));
    results.truncate(200);

    Ok(results)
}
