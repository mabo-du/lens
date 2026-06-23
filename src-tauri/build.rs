fn main() {
    // Read pdfplumber version for the extractor_id provenance stamp
    // (ACTION_PLAN §2.5). Falls back to "unknown" if python3 isn't
    // available at build time (e.g., in CI without the sidecar).
    let pdfplumber_version = std::process::Command::new("python3")
        .args([
            "-c",
            "import pdfplumber; print(pdfplumber.__version__, end='')",
        ])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .unwrap_or_else(|| "unknown".to_string());

    println!("cargo:rustc-env=PDFPLUMBER_VERSION={}", pdfplumber_version);

    tauri_build::build()
}
