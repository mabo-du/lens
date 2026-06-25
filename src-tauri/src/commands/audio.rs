// src-tauri/src/commands/audio.rs
//
// v2 audio: read-only IPC for media annotations and whisper transcripts.
// The PDF sidecar handles bulk transcription writes — these commands
// only fetch what the renderer needs to display the metadata.
//
// IPC contract:
//   - invoke('audio_media_segments', { documentId }) -> MediaSegment[]
//   - invoke('audio_transcript',     { documentId }) -> TranscriptLine[]
//
// Integration-test slot: src-tauri/tests/audio_tests.rs would exercise
// fixture rows inserted into selection + media_selection + transcript_segment.

use super::projects::AppState;
use serde::{Deserialize, Serialize};
use tauri::{command, State};

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MediaSegment {
    pub id: String,
    pub document_id: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub code_id: Option<String>,
    pub memo: Option<String>,
    pub created_by: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptLine {
    pub id: String,
    pub document_id: String,
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub char_offset: i32,
}

/// Media annotations for a given document, restricted to media_ts
/// selections so image-region rows don't bleed into the audio panel.
#[command]
pub async fn audio_media_segments(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<Vec<MediaSegment>, String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    let rows = sqlx::query_as::<_, MediaSegment>(
        "SELECT s.id           AS id,
                s.document_id  AS document_id,
                ms.start_ms    AS start_ms,
                ms.end_ms      AS end_ms,
                s.code_id      AS code_id,
                s.memo         AS memo,
                s.created_by   AS created_by
         FROM selection s
         JOIN media_selection ms ON ms.selection_id = s.id
         WHERE s.document_id = ?
           AND s.selection_type = 'media_ts'
         ORDER BY ms.start_ms ASC",
    )
    .bind(&document_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows)
}

/// Ordered transcript lines for the renderer. Word-level rows from the
/// Whisper sidecar; joined in time order. The frontend collapses this
/// into display lines (paragraphs) on the render side.
#[command]
pub async fn audio_transcript(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<Vec<TranscriptLine>, String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    let rows = sqlx::query_as::<_, TranscriptLine>(
        "SELECT id,
                document_id,
                word           AS text,
                start_ms,
                end_ms,
                char_offset
         FROM transcript_segment
         WHERE document_id = ?
         ORDER BY start_ms ASC",
    )
    .bind(&document_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows)
}
