// LENS Tauri 2 backend - library crate.
//
// This crate is BOTH a binary (src/main.rs -> lens executable) AND a
// library (this file -> `lens` library crate). The library is needed
// so integration tests under `tests/` can import the public surface
// (notably `DbKey` for the panic-freedom regression suite at
// `tests/dbkey_panic_safety.rs`). Without `lib.rs`, a binary-only
// crate's internals are inaccessible to integration tests.
//
// Module visibility:
//   - `pub` so integration tests + the binary can reach them.
//   - `#[cfg(test)]` blocks stay package-internal (still `mod ...`,
//     not `pub mod ...`), so the existing `tests.rs` + `test_helpers.rs`
//     keep their internal-only access.
//
// Import path from integration tests:
//   use lens::commands::projects::DbKey;
//   use lens::commands::projects::AppState;
pub mod colors;
pub mod commands;
pub mod db;
pub mod import;

#[cfg(test)]
pub mod test_helpers;
#[cfg(test)]
mod tests;

/// Public re-exports of the most-tested types for integration tests
/// under `tests/`. This avoids the long path `lens::commands::projects::DbKey`
/// for the common panic-freedom regression suite.
pub use commands::projects::{AppState, DbKey};

/// Best-effort logger init. `try_init` returns Err if another
/// test/binary already installed a logger — that's fine, just
/// suppress the error. `RUST_LOG=warn` is the default; `info` adds
/// node-rs plumbing noise we don't want. Production builds set
/// `RUST_LOG=lens=warn` via cmd.exe env or systemd unit.
///
/// Exposed as a public helper so integration tests can opt in to
/// `RUST_LOG=lens=debug` capturing without going through `lens::run()`.
pub fn init_logger() {
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn"))
        .format_timestamp_secs()
        .try_init();
}

use tauri::Manager;

/// Tauri application entry point used by `src/main.rs::main()`. Kept
/// in the library (rather than the binary) so library-level tests can
/// exercise the build pipeline + plugin manifests.
pub fn run() {
    init_logger();

    tauri::Builder::default()
        .manage(commands::projects::AppState {
            db: tokio::sync::RwLock::new(None),
            project_folder: tokio::sync::RwLock::new(None),
            encryption_key: tokio::sync::RwLock::new(commands::projects::DbKey::default()),
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .setup(|app| {
            // **Periodic WAL checkpoint.** Flush the WAL every 300s (5 min)
            // so a crash or forced quit does not leave a stale -wal sidecar.
            // The task is cheap: a single PRAGMA wal_checkpoint(TRUNCATE) that
            // no-ops when no project is open or the WAL is idle.
            //
            // Tauri 2 requires `use tauri::Manager` (imported at top of file)
            // to bring `AppHandle::state()` into scope.
            let app_handle = app.handle().clone();
            tokio::task::spawn(async move {
                // Delay first checkpoint by 300s — no need to flush a
                // freshly-opened project.
                tokio::time::sleep(std::time::Duration::from_secs(300)).await;
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
                loop {
                    interval.tick().await;
                    let Some(state) = app_handle.try_state::<commands::projects::AppState>() else {
                        // AppHandle was dropped — app is shutting down.
                        break;
                    };
                    let pool_guard = state.db.read().await;
                    if let Some(ref pool) = *pool_guard {
                        if let Err(e) = db::autosave_checkpoint(pool).await {
                            log::warn!(target: "lens::db", "background checkpoint failed: {e}");
                        }
                    }
                    drop(pool_guard);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::projects::projects_create,
            commands::projects::projects_open,
            commands::projects::projects_close,
            commands::projects::projects_rename,
            commands::codes::codes_create,
            commands::codes::codes_get_tree,
            commands::codes::codes_move,
            commands::codes::codes_update,
            commands::codes::codes_delete,
            commands::codes::codes_get_subtree,
            commands::import::documents_import,
            commands::documents::documents_list,
            commands::documents::document_get_content,
            commands::documents::document_delete,
            commands::annotations::annotations_create,
            commands::annotations::annotations_delete,
            commands::annotations::annotations_list_by_document,
            commands::annotations::annotations_list_by_code,
            commands::image_regions::image_selection_create,
            commands::image_regions::image_selection_list_by_document,
            commands::image_regions::image_selection_delete,
            commands::image_polygons::image_polygon_create,
            commands::image_polygons::image_polygon_list_by_document,
            commands::image_polygons::image_polygon_delete,
            commands::documents::document_get_asset_base64,
            commands::memos::memos_save,
            commands::memos::memos_get,
            commands::memos::memos_list_by_project,
            commands::search::search_query,
            commands::export::export_prepare,
            commands::qdpx_import::qdpx_import,
            commands::qdpx_import::qdpx_import_undo,
            commands::projects::local_user_get_name,
            commands::projects::local_user_update_name,
            commands::projects::projects_is_encrypted,
            commands::projects::projects_check_lock,
            commands::sample_project::projects_create_sample,
            commands::encryption::encryption_available,
            commands::encryption::recovery_key_generate,
            commands::backup::backup_export,
            commands::backup::backup_restore,
            commands::project_settings::project_setting_get,
            commands::project_settings::project_setting_set,
            commands::ollama::autocode_chunk,
            commands::analytics::analytics_code_frequency,
            commands::analytics::analytics_co_occurrence,
            commands::analytics_icr::analytics_icr,
            commands::analytics_icr::analytics_icr_matrix,
            commands::audio::audio_media_segments,
            commands::audio::audio_media_selection_create,
            commands::audio::audio_transcript,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.try_state::<commands::projects::AppState>() {
                    if let Some(ref folder) = *state.project_folder.blocking_read() {
                        commands::projects::remove_lock_file(folder);
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
