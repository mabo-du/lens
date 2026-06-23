use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[derive(Deserialize)]
struct PdfResult {
    success: bool,
    text: Option<String>,
    error: Option<String>,
}

pub async fn extract_text(app: &AppHandle, file_path: &str) -> Result<String, String> {
    // Shell out to the pdfplumber sidecar
    let sidecar_command = app
        .shell()
        .sidecar("pdfplumber")
        .map_err(|e| format!("Failed to create pdfplumber sidecar command: {}", e))?;

    let output = sidecar_command
        .args([file_path])
        .output()
        .await
        .map_err(|e| format!("Failed to execute pdfplumber: {}", e))?;

    let stdout_str = String::from_utf8(output.stdout)
        .map_err(|e| format!("Failed to decode sidecar output: {}", e))?;

    let result: PdfResult = serde_json::from_str(&stdout_str).map_err(|e| {
        format!(
            "Failed to parse JSON from sidecar: {} (Output: {})",
            e, stdout_str
        )
    })?;

    if result.success {
        Ok(result.text.unwrap_or_default())
    } else {
        Err(result
            .error
            .unwrap_or_else(|| "Unknown error from pdfplumber".to_string()))
    }
}
