use std::fs;
use std::path::Path;

pub fn extract_text(file_path: &str) -> Result<String, String> {
    fs::read_to_string(Path::new(file_path)).map_err(|e| format!("Failed to read text file: {}", e))
}
