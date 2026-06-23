use tokio::sync::RwLock;

use crate::commands::projects::AppState;
use crate::db::init_db;

/// Creates a temporary directory with a test database, initializes it,
/// and returns an AppState ready for use in tests.
pub async fn setup_test_state() -> (AppState, tempfile::TempDir) {
    let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
    let db_path = temp_dir.path().join("test.qdaproj");

    let pool = init_db(&db_path, None)
        .await
        .expect("Failed to initialize test database");

    let state = AppState {
        db: RwLock::new(Some(pool)),
        project_folder: RwLock::new(Some(temp_dir.path().to_path_buf())),
        encryption_key: RwLock::new(None),
    };

    (state, temp_dir)
}

/// Return the ID of the auto-created `local_user` row (ACTION_PLAN §1.5).
/// `ensure_local_user_exists` is called during project creation and open,
/// so every test DB already has a row — no need to insert a duplicate.
pub async fn seed_local_user(state: &AppState) -> String {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB in state");

    let (id,): (String,) = sqlx::query_as("SELECT id FROM local_user LIMIT 1")
        .fetch_one(pool)
        .await
        .expect("local_user should be auto-created by project init (§1.5)");

    id
}
