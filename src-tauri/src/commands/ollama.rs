//! Ollama auto-coding IPC command (v2 axis #4 — local LLM integration).
//!
//! The `autocode_chunk` command:
//!   1. Validates the chunk (non-empty, ≤100_000 chars).
//!   2. Queries the project's codes from the database.
//!   3. POSTs `http://localhost:11434/api/generate` with a codebook prompt.
//!   4. Parses the JSON response.
//!   5. Matches code names found in the LLM response against the codebook,
//!      creates synthetic annotations for each matched code span.
//!   6. Returns the count + list of applied annotations.
//!
//! If Ollama is not running, returns a clear connection error.

use serde::{Deserialize, Serialize};
use tauri::{command, State};

use super::projects::AppState;

/// Expected response shape from Ollama /api/generate with stream=false.
#[derive(Debug, Deserialize)]
struct OllamaGenerateResponse {
    response: String,
    done: bool,
}

/// An auto-code result: one code applied to one text span inside the chunk.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutocodeAnnotation {
    pub code_id: String,
    pub code_name: String,
    pub annotation_id: String,
    /// 0-based start offset within the raw text chunk.
    pub start_offset: usize,
    /// 0-based end offset (exclusive) within the raw text chunk.
    pub end_offset: usize,
}

/// The autocode response sent back to the renderer.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutocodeResult {
    pub applied_count: usize,
    pub annotations: Vec<AutocodeAnnotation>,
}

/// A code row fetched from the DB for prompt-building.
#[derive(Debug, sqlx::FromRow)]
struct CodeRow {
    id: String,
    name: String,
    description: Option<String>,
    color: String,
}

const OLLAMA_URL: &str = "http://localhost:11434/api/generate";
const DEFAULT_MODEL: &str = "llama3.2";
/// Warn if the total prompt exceeds this many characters (llama3.2's
/// 8K-token context is ~6K chars conservatively; we warn at 4K and
/// truncate the codebook at 6K).
const PROMPT_BUDGET_WARN: usize = 4_000;
const PROMPT_BUDGET_HARD: usize = 6_000;

#[command]
pub async fn autocode_chunk(
    state: State<'_, AppState>,
    project_id: String,
    document_id: String,
    raw_text: String,
) -> Result<AutocodeResult, String> {
    if raw_text.is_empty() {
        return Err("chunk text must not be empty".to_string());
    }
    if raw_text.len() > 100_000 {
        return Err(
            "chunk text exceeds 100_000 character limit for a single Ollama request"
                .to_string(),
        );
    }

    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    // Read the configured Ollama model from project_settings (falls back
    // to llama3.2 if not set, so a user can `ollama pull mistral` and
    // point LENS at it without a rebuild).
    let model: String = sqlx::query_scalar::<_, String>(
        "SELECT value FROM project_settings WHERE key = 'ollama_model'",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to read ollama_model setting: {}", e))?
    .filter(|v| !v.is_empty())
    .unwrap_or_else(|| DEFAULT_MODEL.to_string());

    let codes: Vec<CodeRow> = sqlx::query_as(
        "SELECT id, name, description, color FROM code WHERE project_id = ? ORDER BY name",
    )
    .bind(&project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to read codes for Ollama prompt: {}", e))?;

    drop(pool_guard);

    if codes.is_empty() {
        return Ok(AutocodeResult {
            applied_count: 0,
            annotations: vec![],
        });
    }

    let code_list: String = codes
        .iter()
        .map(|c| {
            format!(
                "- \"{}\"{}",
                c.name,
                c.description
                    .as_ref()
                    .map(|d| format!(": {}", d))
                    .unwrap_or_default()
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    // Guard against exceeding the model's context window. The codebook
    // is less important than the raw text for this task, so truncate it
    // first if the combined prompt is too long.
    let header_len = 350; // approx size of the instruction boilerplate
    let mut code_list = code_list;
    let total_estimate = header_len + code_list.len() + raw_text.len();
    if total_estimate > PROMPT_BUDGET_WARN {
        log::warn!(
            target: "lens::ollama",
            "Prompt size ~{} chars exceeds {} char budget; truncating codebook",
            total_estimate, PROMPT_BUDGET_WARN
        );
        // Truncate code list to keep total under the hard budget.
        let code_budget = PROMPT_BUDGET_HARD.saturating_sub(header_len + raw_text.len());
        if code_list.len() > code_budget {
            // Find a safe cut point at a newline boundary.
            let cutoff = code_list
                .char_indices()
                .take(code_budget)
                .filter(|(_, c)| *c == '\n')
                .last()
                .map(|(i, _)| i)
                .unwrap_or(code_budget);
            code_list.truncate(cutoff);
            code_list.push_str("\n- ... (truncated)");
        }
    }

    let prompt = format!(
        "You are a qualitative data analysis assistant. Given the text below and the \
         codebook, return a JSON array of objects with fields: \"codeName\" (must exactly \
         match one of the code names below), \"startOffset\" (0-based character index), \
         and \"endOffset\" (exclusive). Only return the JSON array, nothing else.\n\n\
         Codebook:\n{code_list}\n\n\
         Text:\n\"\"\"\n{raw_text}\n\"\"\"\n\n\
         JSON:",
        code_list = code_list,
        raw_text = raw_text
    );

    let client = reqwest::Client::new();
    let resp = client
        .post(OLLAMA_URL)
        .json(&serde_json::json!({
            "model": model,
            "prompt": prompt,
            "stream": false,
        }))
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() {
                "Ollama is not running. Start it with `ollama serve` or install it from \
                 https://ollama.com. Then pull a model: `ollama pull llama3.2`."
                    .to_string()
            } else if e.is_timeout() {
                "Ollama request timed out — the model may be too large for your hardware, \
                 or the prompt is too long."
                    .to_string()
            } else {
                format!("Ollama request failed: {}", e)
            }
        })?;

    let body: OllamaGenerateResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    if !body.done {
        return Err("Ollama returned an incomplete response".to_string());
    }

    #[derive(Debug, Deserialize)]
    struct LlmAnnotation {
        #[serde(rename = "codeName")]
        code_name: String,
        #[serde(rename = "startOffset")]
        start_offset: usize,
        #[serde(rename = "endOffset")]
        end_offset: usize,
    }

    let raw_response = body.response.trim();
    // The LLM may wrap the JSON in markdown code fences.
    let json_str = raw_response
        .strip_prefix("```json")
        .or_else(|| raw_response.strip_prefix("```"))
        .map(|s| s.strip_suffix("```").unwrap_or(s))
        .unwrap_or(raw_response)
        .trim();

    let llm_annotations: Vec<LlmAnnotation> =
        serde_json::from_str(json_str).map_err(|e| {
            format!(
                "Failed to parse LLM output as JSON array. Raw response: {}\nError: {}",
                &raw_response[..raw_response.len().min(500)],
                e
            )
        })?;

    let mut annotations: Vec<AutocodeAnnotation> = Vec::new();
    for llm in &llm_annotations {
        // Find exact match in codebook (case-insensitive)
        if let Some(code) = codes
            .iter()
            .find(|c| c.name.eq_ignore_ascii_case(&llm.code_name))
        {
            // Clamp offsets to the raw_text bounds
            let start = llm.start_offset.min(raw_text.len());
            let end = llm.end_offset.min(raw_text.len()).max(start);

            let annotation_id = uuid::Uuid::new_v4().to_string();

            // Create the annotation in the database inside a transaction
            // so a partial insert (selection without text_selection) can't
            // survive.
            let pool_guard2 = state.db.read().await;
            let pool2 = pool_guard2
                .as_ref()
                .ok_or("Project closed during autocode")?;

            let mut tx = pool2.begin().await.map_err(|e| {
                log::warn!(target: "lens::ollama", "tx begin failed: {}", e);
                e.to_string()
            })?;

            if let Err(e) = sqlx::query(
                "INSERT INTO selection (id, document_id, code_id, selection_type, created_by) \
                 VALUES (?, ?, ?, 'text', ?)",
            )
            .bind(&annotation_id)
            .bind(&document_id)
            .bind(&code.id)
            .bind("ollama-auto")
            .execute(&mut *tx)
            .await
            {
                log::warn!(
                    target: "lens::ollama",
                    "Failed to insert auto-annotation selection for code {}: {}",
                    code.name, e
                );
                drop(tx);
                continue;
            }

            if let Err(e) = sqlx::query(
                "INSERT INTO text_selection (selection_id, start_char, end_char) VALUES (?, ?, ?)",
            )
            .bind(&annotation_id)
            .bind(start as i64)
            .bind(end as i64)
            .execute(&mut *tx)
            .await
            {
                log::warn!(
                    target: "lens::ollama",
                    "Failed to insert auto-annotation text_selection for code {}: {}",
                    code.name, e
                );
                drop(tx);
                continue;
            }

            if let Err(e) = tx.commit().await {
                log::warn!(
                    target: "lens::ollama",
                    "Failed to commit auto-annotation tx for code {}: {}",
                    code.name, e
                );
                continue;
            }

            annotations.push(AutocodeAnnotation {
                code_id: code.id.clone(),
                code_name: code.name.clone(),
                annotation_id,
                start_offset: start,
                end_offset: end,
            });
        }
    }

    Ok(AutocodeResult {
        applied_count: annotations.len(),
        annotations,
    })
}
