//! Image-region (bbox) selection IPC.
//!
//! Bounding-box annotations on image documents (PNG/JPG/JPEG). Each
//! region is two rows: a `selection` row with `selection_type='image_region'`
//! and an `image_selection` row with `region_type='bbox'` + the four
//! proportional corner coordinates. We deliberately scope this slice to
//! rectangles only — polygon/freehand comes in a later release.
//!
//! Coordinates are stored as 0.0–1.0 ratios relative to the document's
//! intrinsic width/height so REFI-QDA AreaReference export can use them
//! verbatim. Pixel-space → ratio conversion happens at the IPC boundary
//! so the database layer never has to know the pixel space.

use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, State};
use uuid::Uuid;

use super::projects::AppState;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ImageRegionRecord {
    pub id: String,
    pub document_id: String,
    pub code_id: String,
    /// Always `bbox` for this round — left in the struct so the
    /// serialization stays stable when polygon arrives in v0.2.
    pub region_type: String,
    /// JSON object `{"left": f64, "top": f64, "right": f64, "bottom": f64}`.
    /// Mirrors bbox_* columns; stored as text so future polygon types
    /// can extend the schema without another column.
    pub region_data: String,
    pub bbox_left: f64,
    pub bbox_top: f64,
    pub bbox_right: f64,
    pub bbox_bottom: f64,
    pub created_by: Option<String>,
    pub created_at: String,
}

const SLACK: f64 = 1e-9;

fn validate_bbox(
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
) -> Result<(), String> {
    if !left.is_finite() || !top.is_finite() || !right.is_finite() || !bottom.is_finite() {
        return Err("bbox coordinates must be finite numbers".to_string());
    }
    let coords = [left, top, right, bottom];
    if coords.iter().any(|v| *v < -SLACK || *v > 1.0 + SLACK) {
        return Err("bbox coordinates must be in [0.0, 1.0]".to_string());
    }
    if (right - left).abs() < SLACK || (bottom - top).abs() < SLACK {
        return Err("bbox must have non-zero width and height".to_string());
    }
    if right <= left || bottom <= top {
        return Err("bbox right must exceed left, bottom must exceed top".to_string());
    }
    Ok(())
}

#[allow(
    clippy::too_many_arguments,
    reason = "Tauri #[command] — flat arg list required by IPC binding, cannot take a struct"
)]
#[command]
pub async fn image_selection_create(
    _app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
    code_id: String,
    bbox_left: f64,
    bbox_top: f64,
    bbox_right: f64,
    bbox_bottom: f64,
) -> Result<ImageRegionRecord, String> {
    validate_bbox(bbox_left, bbox_top, bbox_right, bbox_bottom)?;

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
                "Regions can only be created on image documents (png/jpg/jpeg); this document is {}",
                other
            ))
        }
        None => return Err("Document not found".to_string()),
    }

    let id = Uuid::new_v4().to_string();
    let region_data = serde_json::json!({
        "left":   bbox_left,
        "top":    bbox_top,
        "right":  bbox_right,
        "bottom": bbox_bottom,
    })
    .to_string();

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Look up the local user id (cursor) for created_by; nullable if no user yet
    let created_by: Option<String> = sqlx::query_scalar("SELECT id FROM local_user LIMIT 1")
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO selection (id, document_id, code_id, selection_type, created_by) \
         VALUES (?, ?, ?, 'image_region', ?)",
    )
    .bind(&id)
    .bind(&document_id)
    .bind(&code_id)
    .bind(&created_by)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO image_selection (selection_id, region_type, region_data, bbox_left, bbox_top, bbox_right, bbox_bottom) \
         VALUES (?, 'bbox', ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&region_data)
    .bind(bbox_left)
    .bind(bbox_top)
    .bind(bbox_right)
    .bind(bbox_bottom)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;

    let record = sqlx::query_as::<_, ImageRegionRecord>(
        "SELECT s.id, s.document_id, s.code_id, i.region_type, i.region_data, \
                i.bbox_left, i.bbox_top, i.bbox_right, i.bbox_bottom, \
                s.created_by, s.created_at \
         FROM selection s \
         JOIN image_selection i ON i.selection_id = s.id \
         WHERE s.id = ?",
    )
    .bind(&id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(record)
}

#[command]
pub async fn image_selection_list_by_document(
    _app: AppHandle,
    state: State<'_, AppState>,
    document_id: String,
) -> Result<Vec<ImageRegionRecord>, String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    let regions = sqlx::query_as::<_, ImageRegionRecord>(
        "SELECT s.id, s.document_id, s.code_id, i.region_type, i.region_data, \
                i.bbox_left, i.bbox_top, i.bbox_right, i.bbox_bottom, \
                s.created_by, s.created_at \
         FROM selection s \
         JOIN image_selection i ON i.selection_id = s.id \
         WHERE s.document_id = ? \
         ORDER BY s.created_at ASC",
    )
    .bind(&document_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(regions)
}

#[command]
pub async fn image_selection_delete(
    _app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    // Deleting from `selection` cascades to `image_selection` via the
    // ON DELETE CASCADE on the FK column.
    sqlx::query("DELETE FROM selection WHERE id = ?")
        .bind(&id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
