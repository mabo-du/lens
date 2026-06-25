// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Entry point delegates to `lens::run()` in `src/lib.rs`. The library
// host owns the Tauri builder + env_logger init + plugin manifests
// because integration tests in `tests/` need library-level access to
// `lens::commands::projects::DbKey` for the panic-freedom regression
// suite.
fn main() {
    lens::run();
}
