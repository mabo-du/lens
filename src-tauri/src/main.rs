// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod import;
mod colors;

#[cfg(test)]
mod test_helpers;
#[cfg(test)]
mod tests;

fn main() {
    tauri::Builder::default()
        .manage(commands::projects::AppState {
            db: tokio::sync::RwLock::new(None),
            project_folder: tokio::sync::RwLock::new(None),
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::projects::projects_create,
            commands::projects::projects_open,
            commands::projects::projects_close,
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
            commands::memos::memos_save,
            commands::memos::memos_get,
            commands::memos::memos_list_by_project,
            commands::search::search_query,
            commands::export::export_prepare,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
