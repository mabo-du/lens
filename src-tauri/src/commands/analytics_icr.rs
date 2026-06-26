// src-tauri/src/commands/analytics_icr.rs
//
// Inter-coder reliability: Cohen's kappa computed server-side from
// text_selection rows. The algorithm mirrors src/utils/icr.ts exactly
// (sort-then-sweep binary vector, observed/expected agreement, Landis & Koch label)
// so the JS test suite and the Rust command produce identical results.
//
// IPC contract:
//   invoke('analytics_icr', { projectId, coderA, coderB, codeId, documentId })
//     -> IcrResult | null
//   invoke('analytics_icr_matrix', { projectId })
//     -> Vec<IcrResultRow>  (all coder-pair × code × doc combos)
//
// Returns null when the denominator collapses (both coders tagged 0% or 100%
// of the document text for this code).

use super::projects::AppState;
use serde::{Deserialize, Serialize};
use tauri::{command, State};

// ---------------------------------------------------------------------------
// IPC types — mirror the TypeScript IRResult / IRAnnotation shapes
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IcrResult {
    pub coverage_a: i32,
    pub coverage_b: i32,
    pub agreement: f64,
    pub expected: f64,
    pub kappa: f64,
    pub labelled: String,
}

/// One cell in a bulk ICR matrix: coder A × coder B × code × document.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IcrResultRow {
    pub coder_a: String,
    pub coder_b: String,
    pub code_id: String,
    pub document_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<IcrResult>,
}

// ---------------------------------------------------------------------------
// Raw SQL row for a single text selection span
// ---------------------------------------------------------------------------

#[derive(Debug, sqlx::FromRow)]
struct SelectionSpan {
    created_by: Option<String>,
    code_id: String,
    document_id: String,
    start_char: i32,
    end_char: i32,
}

// ---------------------------------------------------------------------------
// Cohen's kappa — Rust port of src/utils/icr.ts
// ---------------------------------------------------------------------------

/// Sort-then-sweep binary vector: 1 = character covered by any span.
/// Explicitly sorts by start position — mirrors the JS `annotationToBinaryVector`
/// contract exactly so the two implementations stay interchangeable.
pub fn spans_to_binary(spans: &[(usize, usize)], doc_len: usize) -> Vec<u8> {
    let mut sorted = spans.to_vec();
    sorted.sort_by_key(|(s, _)| *s);
    let mut out = vec![0u8; doc_len];
    let mut cursor = 0usize;
    for &(start, end) in &sorted {
        cursor = cursor.max(start);
        if cursor < end {
            out[cursor..end].fill(1);
            cursor = end;
        }
    }
    out
}

pub fn kappa_label(k: f64) -> &'static str {
    if k < 0.0 {
        "poor"
    } else if k <= 0.2 {
        "slight"
    } else if k <= 0.4 {
        "fair"
    } else if k <= 0.6 {
        "moderate"
    } else if k <= 0.8 {
        "substantial"
    } else {
        "almost perfect"
    }
}

pub fn compute_kappa(spans_a: &[(usize, usize)], spans_b: &[(usize, usize)], doc_len: usize) -> Option<IcrResult> {
    if doc_len == 0 {
        return None;
    }

    let a = spans_to_binary(spans_a, doc_len);
    let b = spans_to_binary(spans_b, doc_len);

    let mut covered_a = 0i32;
    let mut covered_b = 0i32;
    let mut agreement = 0i32;
    for i in 0..doc_len {
        let av = a[i];
        let bv = b[i];
        covered_a += av as i32;
        covered_b += bv as i32;
        if av == bv {
            agreement += 1;
        }
    }

    let p_o = agreement as f64 / doc_len as f64;
    let p_a = covered_a as f64 / doc_len as f64;
    let p_b = covered_b as f64 / doc_len as f64;
    let p_e = p_a * p_b + (1.0 - p_a) * (1.0 - p_b);
    let denom = 1.0 - p_e;
    if denom <= 1e-9 {
        return None;
    }
    let k = (p_o - p_e) / denom;
    let k = k.clamp(-1.0, 1.0);
    Some(IcrResult {
        coverage_a: covered_a,
        coverage_b: covered_b,
        agreement: p_o,
        expected: p_e,
        kappa: k,
        labelled: kappa_label(k).to_string(),
    })
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Tauri command wrapper — delegates to the internal variant.
#[command]
pub async fn analytics_icr(
    state: State<'_, AppState>,
    project_id: String,
    coder_a: String,
    coder_b: String,
    code_id: String,
    document_id: String,
) -> Result<Option<IcrResult>, String> {
    analytics_icr_internal(&state, project_id, coder_a, coder_b, code_id, document_id).await
}

/// Internal variant (not a Tauri command) so integration tests can call it directly.
pub async fn analytics_icr_internal(
    state: &AppState,
    project_id: String,
    coder_a: String,
    coder_b: String,
    code_id: String,
    document_id: String,
) -> Result<Option<IcrResult>, String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    // Fetch spans for the given (code, document) filtered by created_by.
    let rows: Vec<SelectionSpan> = sqlx::query_as(
        "SELECT s.created_by, s.code_id, s.document_id, ts.start_char, ts.end_char
         FROM selection s
         JOIN text_selection ts ON ts.selection_id = s.id
         JOIN document d ON d.id = s.document_id
         WHERE d.project_id = ?
           AND s.code_id = ?
           AND s.document_id = ?
           AND s.selection_type = 'text'
           AND (s.created_by = ? OR s.created_by = ?)
         ORDER BY ts.start_char",
    )
    .bind(&project_id)
    .bind(&code_id)
    .bind(&document_id)
    .bind(&coder_a)
    .bind(&coder_b)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Get document length.
    let doc_len: Option<i32> = sqlx::query_scalar(
        "SELECT LENGTH(plain_text) FROM document WHERE id = ?",
    )
    .bind(&document_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let doc_len = match doc_len {
        Some(l) if l > 0 => l as usize,
        _ => return Ok(None),
    };

    // Split spans by coder.
    let spans_a: Vec<(usize, usize)> = rows
        .iter()
        .filter(|r| r.created_by.as_deref() == Some(&coder_a))
        .map(|r| (r.start_char.max(0) as usize, (r.end_char as usize).min(doc_len)))
        .filter(|(s, e)| e > s)
        .collect();

    let spans_b: Vec<(usize, usize)> = rows
        .iter()
        .filter(|r| r.created_by.as_deref() == Some(&coder_b))
        .map(|r| (r.start_char.max(0) as usize, (r.end_char as usize).min(doc_len)))
        .filter(|(s, e)| e > s)
        .collect();

    Ok(compute_kappa(&spans_a, &spans_b, doc_len))
}

/// Tauri command wrapper — delegates to the internal variant.
#[command]
pub async fn analytics_icr_matrix(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<IcrResultRow>, String> {
    analytics_icr_matrix_internal(&state, project_id).await
}

/// Internal variant for integration tests.
pub async fn analytics_icr_matrix_internal(
    state: &AppState,
    project_id: String,
) -> Result<Vec<IcrResultRow>, String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    // Fetch all text-selection spans for the project.
    let all_rows: Vec<SelectionSpan> = sqlx::query_as(
        "SELECT s.created_by, s.code_id, s.document_id, ts.start_char, ts.end_char
         FROM selection s
         JOIN text_selection ts ON ts.selection_id = s.id
         JOIN document d ON d.id = s.document_id
         WHERE d.project_id = ?
           AND s.selection_type = 'text'
           AND s.created_by IS NOT NULL
         ORDER BY s.document_id, s.code_id, s.created_by, ts.start_char",
    )
    .bind(&project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Fetch document lengths.
    let doc_lens: Vec<(String, i32)> = sqlx::query_as(
        "SELECT id, LENGTH(plain_text) FROM document WHERE project_id = ? AND LENGTH(plain_text) > 0",
    )
    .bind(&project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let doc_len_map: std::collections::HashMap<String, usize> = doc_lens
        .into_iter()
        .map(|(id, len)| (id, len as usize))
        .collect();

    // Group spans by (created_by, code_id, document_id).
    // Key: (coder, code_id, doc_id) -> Vec<(start, end)>
    let mut groups: std::collections::HashMap<(String, String, String), Vec<(usize, usize)>> =
        std::collections::HashMap::new();

    for r in &all_rows {
        let coder = match &r.created_by {
            Some(c) => c.clone(),
            None => continue,
        };
        let doc_len = *doc_len_map.get(&r.document_id).unwrap_or(&0);
        if doc_len == 0 {
            continue;
        }
        let group_key = (coder, r.code_id.clone(), r.document_id.clone());
        groups.entry(group_key).or_default().push((
            r.start_char.max(0) as usize,
            (r.end_char as usize).min(doc_len),
        ));
    }

    // Collect all unique (code_id, doc_id) combos that have at least 2 coders.
    let mut code_doc_pairs: std::collections::HashSet<(String, String)> =
        std::collections::HashSet::new();
    let mut coders_for_pair: std::collections::HashMap<
        (String, String),
        std::collections::HashSet<String>,
    > = std::collections::HashMap::new();

    for (coder, code_id, doc_id) in groups.keys() {
        code_doc_pairs.insert((code_id.clone(), doc_id.clone()));
        coders_for_pair
            .entry((code_id.clone(), doc_id.clone()))
            .or_default()
            .insert(coder.clone());
    }

    let mut results: Vec<IcrResultRow> = Vec::new();

    for (code_id, doc_id) in &code_doc_pairs {
        let coders: Vec<&String> = coders_for_pair
            .get(&(code_id.clone(), doc_id.clone()))
            .map(|s| s.iter().collect())
            .unwrap_or_default();
        let doc_len = *doc_len_map.get(doc_id).unwrap_or(&0);
        if doc_len == 0 || coders.len() < 2 {
            continue;
        }

        for i in 0..coders.len() {
            for j in (i + 1)..coders.len() {
                let ca = coders[i];
                let cb = coders[j];
                let spans_a = groups
                    .get(&(ca.clone(), code_id.clone(), doc_id.clone()))
                    .map(|v| v.as_slice())
                    .unwrap_or(&[]);
                let spans_b = groups
                    .get(&(cb.clone(), code_id.clone(), doc_id.clone()))
                    .map(|v| v.as_slice())
                    .unwrap_or(&[]);

                let result = compute_kappa(spans_a, spans_b, doc_len);
                results.push(IcrResultRow {
                    coder_a: ca.clone(),
                    coder_b: cb.clone(),
                    code_id: code_id.clone(),
                    document_id: doc_id.clone(),
                    result,
                });
            }
        }
    }

    // Sort: highest kappa first.
    results.sort_by(|a, b| {
        let ka = a.result.as_ref().map(|r| r.kappa).unwrap_or(-2.0);
        let kb = b.result.as_ref().map(|r| r.kappa).unwrap_or(-2.0);
        kb.partial_cmp(&ka)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.code_id.cmp(&b.code_id))
    });

    Ok(results)
}
