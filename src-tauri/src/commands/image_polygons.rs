//! Image-polygon selection IPC.
//!
//! Free-form polygon annotations on image documents (PNG/JPG/JPEG).
//! Each polygon keeps a list of 3..64 vertices in [0.0, 1.0]² proportional
//! coordinates (relative to the document's intrinsic width/height).
//!
//! Schema layout (parallel of `image_selection` for bbox regions):
//! - `selection` row with `selection_type='image_polygon'`
//! - `image_polygon` extension row with `vertices_json` + FK to `selection(id)`
//!
//! `ON DELETE CASCADE` on the FK means deleting a `selection` row removes
//! its `image_polygon` extension row automatically. Validation rules
//! live below and surface as `Result<_, String>` IPC errors so the FE gets
//! actionable messages.

use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, State};
use uuid::Uuid;

use super::projects::AppState;

const SLACK: f64 = 1e-9;
const MIN_VERTICES: usize = 3;
const MAX_VERTICES: usize = 64;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PolygonVertex {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImagePolygonRecord {
    pub id: String,
    pub document_id: String,
    pub code_id: String,
    /// `Vec<Vec<f64>>` serialised as `[[x0,y0],[x1,y1],...]` — a typed
    /// array of vertex coordinates (vs. a raw JSON string) so the FE
    /// gets parsed coordinates directly with no further `JSON.parse` work.
    pub vertices: Vec<Vec<f64>>,
    pub created_by: Option<String>,
    pub created_at: String,
}

/// Internal row mapping for sqlx::FromRow — vertices kept as the raw
/// JSON string here; `raw_to_record` parses it into the typed
/// `Vec<Vec<f64>>` field on `ImagePolygonRecord`.
#[derive(sqlx::FromRow)]
struct ImagePolygonRowRaw {
    id: String,
    document_id: String,
    code_id: String,
    vertices_json: String,
    created_by: Option<String>,
    created_at: String,
}

fn raw_to_record(raw: ImagePolygonRowRaw) -> Result<ImagePolygonRecord, String> {
    let vertices: Vec<Vec<f64>> = serde_json::from_str(&raw.vertices_json)
        .map_err(|e| format!("stored vertices_json invalid: {}", e))?;
    Ok(ImagePolygonRecord {
        id: raw.id,
        document_id: raw.document_id,
        code_id: raw.code_id,
        vertices,
        created_by: raw.created_by,
        created_at: raw.created_at,
    })
}

/// Validates a polygon's `vertices_json` payload. Returns the parsed
/// `Vec<Vec<f64>>` so callers avoid reparsing on the success path.
///
/// Validation rules:
///   * JSON parseable as an array (not an object, not a scalar).
///   * Length ∈ [3, 64].
///   * Each entry has exactly two finite f64 coordinates in [0,1].
fn validate_polygon(vertices_json: &str) -> Result<Vec<Vec<f64>>, String> {
    let vertices: serde_json::Value = serde_json::from_str(vertices_json).map_err(|e| {
        format!("vertices must be a JSON array of [x, y] pairs: {}", e)
    })?;

    let arr = vertices
        .as_array()
        .ok_or_else(|| "vertices must be a JSON array (got non-array)".to_string())?;

    if arr.len() < MIN_VERTICES {
        return Err(format!(
            "polygon needs at least {} vertices",
            MIN_VERTICES
        ));
    }
    if arr.len() > MAX_VERTICES {
        return Err(format!(
            "polygon cannot exceed {} vertices",
            MAX_VERTICES
        ));
    }

    let mut out: Vec<Vec<f64>> = Vec::with_capacity(arr.len());
    for (i, v) in arr.iter().enumerate() {
        let pair = v
            .as_array()
            .ok_or_else(|| format!("vertex {} must be a 2-element [x, y] array", i))?;
        if pair.len() != 2 {
            return Err(format!(
                "vertex {} must be exactly 2 coordinates [x, y], got {}",
                i,
                pair.len()
            ));
        }
        let x = pair[0]
            .as_f64()
            .ok_or_else(|| format!("vertex {} x must be a finite number", i))?;
        let y = pair[1]
            .as_f64()
            .ok_or_else(|| format!("vertex {} y must be a finite number", i))?;
        if !x.is_finite() || !y.is_finite() {
            return Err(format!("vertex {} has non-finite coordinates", i));
        }
        if !(-SLACK..=1.0 + SLACK).contains(&x) || !(-SLACK..=1.0 + SLACK).contains(&y) {
            return Err(format!(
                "vertex {} out of [0.0, 1.0] range (got [{}, {}])",
                i, x, y
            ));
        }
        out.push(vec![x, y]);
    }

    Ok(out)
}

#[command]
pub async fn image_polygon_create(
    _app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    code_id: String,
    vertices_json: String,
) -> Result<ImagePolygonRecord, String> {
    let _validated = validate_polygon(&vertices_json)?;

    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    // Verify document exists and is an image document before opening a tx
    let format: Option<String> = sqlx::query_scalar(
        "SELECT file_format FROM document WHERE id = ?",
    )
    .bind(&document_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    match format.as_deref() {
        Some("png") | Some("jpg") | Some("jpeg") => {}
        Some(other) => {
            return Err(format!(
                "Polygons can only be created on image documents (png/jpg/jpeg); this document is {}",
                other
            ))
        }
        None => return Err("Document not found".to_string()),
    }

    let id = Uuid::new_v4().to_string();

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let created_by: Option<String> = sqlx::query_scalar("SELECT id FROM local_user LIMIT 1")
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO selection (id, document_id, code_id, selection_type, created_by) \
         VALUES (?, ?, ?, 'image_polygon', ?)",
    )
    .bind(&id)
    .bind(&document_id)
    .bind(&code_id)
    .bind(&created_by)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO image_polygon (selection_id, vertices_json) VALUES (?, ?)",
    )
    .bind(&id)
    .bind(&vertices_json)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;

    let raw: ImagePolygonRowRaw = sqlx::query_as(
        "SELECT s.id, s.document_id, s.code_id, p.vertices_json, s.created_by, s.created_at \
         FROM selection s \
         JOIN image_polygon p ON p.selection_id = s.id \
         WHERE s.id = ?",
    )
    .bind(&id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    raw_to_record(raw)
}

#[command]
pub async fn image_polygon_list_by_document(
    _app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
) -> Result<Vec<ImagePolygonRecord>, String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    let raw_rows: Vec<ImagePolygonRowRaw> = sqlx::query_as(
        "SELECT s.id, s.document_id, s.code_id, p.vertices_json, s.created_by, s.created_at \
         FROM selection s \
         JOIN image_polygon p ON p.selection_id = s.id \
         WHERE s.document_id = ? \
         AND s.selection_type = 'image_polygon' \
         ORDER BY p.created_at ASC",
    )
    .bind(&document_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut records = Vec::with_capacity(raw_rows.len());
    for raw in raw_rows {
        records.push(raw_to_record(raw)?);
    }
    Ok(records)
}

#[command]
pub async fn image_polygon_delete(
    _app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    // `image_polygon.delete` only deletes polygon-type selection rows
    // (parallel to `image_selection.delete`). The CASCADE on the FK
    // removes the image_polygon row automatically.
    sqlx::query("DELETE FROM selection WHERE id = ? AND selection_type = 'image_polygon'")
        .bind(&id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
