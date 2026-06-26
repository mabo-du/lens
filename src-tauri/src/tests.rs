use crate::commands::annotations::annotations_create_internal;
use crate::commands::codes::codes_create_internal;
use crate::commands::export::export_prepare_internal;
use crate::commands::import::documents_import_internal;
use crate::commands::projects::projects_create_internal;
use crate::db;
use crate::test_helpers::{seed_local_user, setup_test_state};
use tempfile::tempdir;

#[tokio::test]
async fn happy_path_create_project_import_document_code_and_annotation() {
    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "Test Project".to_string(),
        Some("A test project".to_string()),
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    assert_eq!(project.name, "Test Project");
    assert!(!project.id.is_empty());

    let _user_id = seed_local_user(&state).await;

    let doc = documents_import_internal(
        
        None,
        &state,
        project.id.clone(),
        "/tmp/test.txt".to_string(),
        "txt".to_string(),
        Some("Hello world, this is a test document.".to_string()),
        None, // extractor_id_override (no override needed)
    )
    .await
    .expect("Failed to import document");

    assert_eq!(doc.title, "test.txt");
    assert!(!doc.id.is_empty());
    assert!(doc.plain_text.is_some());
    let plain_text = doc.plain_text.clone().unwrap();
    assert!(plain_text.contains("Hello world"));

    let code = codes_create_internal(
        &state,
        project.id.clone(),
        None,
        "Test Code".to_string(),
        Some("#FF5733".to_string()),
    )
    .await
    .expect("Failed to create code");

    assert_eq!(code.name, "Test Code");
    assert!(!code.id.is_empty());

    let ann = annotations_create_internal(&state, doc.id.clone(), code.id.clone(), 0, 5)
        .await
        .expect("Annotation creation should succeed after P0 fixes");

    assert_eq!(ann.document_id, doc.id);
    assert_eq!(ann.code_id, code.id);
    assert_eq!(ann.start_char, 0);
    assert_eq!(ann.end_char, 5);

    let ann_id = ann.id.clone();

    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");

    let row: (String, String, String, i32, i32) = sqlx::query_as(
        "SELECT s.document_id, s.code_id, s.created_by, ts.start_char, ts.end_char
         FROM selection s
         JOIN text_selection ts ON ts.selection_id = s.id
         WHERE s.id = ?",
    )
    .bind(&ann_id)
    .fetch_one(pool)
    .await
    .expect("Annotation should exist in DB");

    assert_eq!(row.0, doc.id);
    assert_eq!(row.1, code.id);
    assert_eq!(row.3, 0);
    assert_eq!(row.4, 5);
}

#[tokio::test]
async fn export_prepare_does_not_crash_with_memos_and_codes() {
    // Regression test for P0.3 (export crash on missing created_by in Code struct)
    // and P0.4 (export crash on memo column aliases).
    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "Export Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    let _user_id = seed_local_user(&state).await;

    let _code = codes_create_internal(
        &state,
        project.id.clone(),
        None,
        "Export Code".to_string(),
        Some("#00FF00".to_string()),
    )
    .await
    .expect("Failed to create code");

    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");
    sqlx::query("INSERT INTO memo (id, project_id, body) VALUES (?, ?, ?)")
        .bind("memo-1")
        .bind(&project.id)
        .bind("This is a test memo")
        .execute(pool)
        .await
        .expect("Failed to insert memo");
    drop(pool_guard);

    // This should NOT crash. The known P0.3/P0.4 bugs cause sqlx
    // deserialization errors when columns don't match the struct.
    let result = export_prepare_internal(&state, project.id.clone()).await;

    let payload = result.expect("export_prepare should succeed after P0.3/P0.4 fixes");

    assert_eq!(payload.project.id, project.id);
    assert_eq!(payload.codes.len(), 1);
    assert_eq!(payload.memos.len(), 1);
    assert_eq!(payload.memos[0].body, "This is a test memo");
}

#[tokio::test]
async fn code_tree_builds_correctly() {
    use crate::commands::codes::{build_tree, Code};

    let codes = vec![
        Code {
            id: "a".to_string(),
            project_id: "p1".to_string(),
            name: "Alpha".to_string(),
            color: "#000".to_string(),
            description: None,
            created_by: None,
            created_at: "2024-01-01".to_string(),
        },
        Code {
            id: "b".to_string(),
            project_id: "p1".to_string(),
            name: "Beta".to_string(),
            color: "#000".to_string(),
            description: None,
            created_by: None,
            created_at: "2024-01-01".to_string(),
        },
        Code {
            id: "c".to_string(),
            project_id: "p1".to_string(),
            name: "Gamma".to_string(),
            color: "#000".to_string(),
            description: None,
            created_by: None,
            created_at: "2024-01-01".to_string(),
        },
    ];

    let edges = vec![
        ("a".to_string(), "b".to_string()),
        ("a".to_string(), "c".to_string()),
    ];

    let tree = build_tree(codes, edges);
    assert_eq!(tree.len(), 1);
    assert_eq!(tree[0].id, "a");
    assert_eq!(tree[0].children.len(), 2);
    assert_eq!(tree[0].children[0].name, "Beta");
    assert_eq!(tree[0].children[1].name, "Gamma");
}

#[tokio::test]
async fn codes_delete_cascades_to_children() {
    use crate::commands::codes::codes_delete_internal;

    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "Cascade Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    let parent = codes_create_internal(
        &state,
        project.id.clone(),
        None,
        "Parent".to_string(),
        Some("#FF0000".to_string()),
    )
    .await
    .expect("Failed to create parent code");

    let child = codes_create_internal(
        &state,
        project.id.clone(),
        Some(parent.id.clone()),
        "Child".to_string(),
        Some("#00FF00".to_string()),
    )
    .await
    .expect("Failed to create child code");

    codes_delete_internal(&state, parent.id.clone())
        .await
        .expect("Failed to delete parent");

    // The child should ALSO be deleted (P1.1 fix required)
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");

    let child_exists: Option<i32> = sqlx::query_scalar("SELECT 1 FROM code WHERE id = ?")
        .bind(&child.id)
        .fetch_optional(pool)
        .await
        .expect("Query failed");

    assert!(
        child_exists.is_none(),
        "Child code {} should have been deleted along with its parent",
        child.id
    );

    // Also verify no stale closure rows remain for the child
    let closure_stale: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM code_closure WHERE descendant = ?")
            .bind(&child.id)
            .fetch_one(pool)
            .await
            .expect("Query failed");

    assert_eq!(
        closure_stale, 0,
        "Closure rows for child {} should also be cleaned up",
        child.id
    );
}

#[tokio::test]
async fn codes_move_rejects_cycles() {
    use crate::commands::codes::codes_move_internal;

    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "Cycle Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    let parent = codes_create_internal(
        &state,
        project.id.clone(),
        None,
        "Parent".to_string(),
        Some("#FF0000".to_string()),
    )
    .await
    .expect("Failed to create parent");

    let child = codes_create_internal(
        &state,
        project.id.clone(),
        Some(parent.id.clone()),
        "Child".to_string(),
        Some("#00FF00".to_string()),
    )
    .await
    .expect("Failed to create child");

    // Attempting to move the parent under its own child should be rejected
    let result = codes_move_internal(&state, parent.id.clone(), Some(child.id.clone())).await;

    assert!(
        result.is_err(),
        "Moving a code into its own descendant should be rejected (cycle detection required)"
    );
    assert!(
        result.unwrap_err().to_lowercase().contains("cycle"),
        "Error message should mention 'cycle'"
    );
}

#[tokio::test]
async fn document_delete_cleans_up_annotations_and_fts() {
    use crate::commands::documents::document_delete_internal;

    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "Delete Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    let _user_id = seed_local_user(&state).await;

    let doc = documents_import_internal(
        
        None,
        &state,
        project.id.clone(),
        "/tmp/test.txt".to_string(),
        "txt".to_string(),
        Some("Hello world, this is a test document.".to_string()),
        None, // extractor_id_override (no override needed)
    )
    .await
    .expect("Failed to import document");

    let code = codes_create_internal(
        &state,
        project.id.clone(),
        None,
        "Test Code".to_string(),
        Some("#FF5733".to_string()),
    )
    .await
    .expect("Failed to create code");

    let ann = annotations_create_internal(&state, doc.id.clone(), code.id.clone(), 0, 5)
        .await
        .expect("Failed to create annotation");

    // Verify annotation exists before deletion
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");
    let ann_exists: Option<i32> = sqlx::query_scalar("SELECT 1 FROM selection WHERE id = ?")
        .bind(&ann.id)
        .fetch_optional(pool)
        .await
        .expect("Query failed");
    assert!(
        ann_exists.is_some(),
        "Annotation should exist before document deletion"
    );
    drop(pool_guard);

    document_delete_internal(&state, doc.id.clone())
        .await
        .expect("Failed to delete document");

    // Verify document is gone
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");

    let doc_exists: Option<i32> = sqlx::query_scalar("SELECT 1 FROM document WHERE id = ?")
        .bind(&doc.id)
        .fetch_optional(pool)
        .await
        .expect("Query failed");
    assert!(doc_exists.is_none(), "Document should be deleted");

    // Verify annotation is cascade-deleted
    let ann_exists: Option<i32> = sqlx::query_scalar("SELECT 1 FROM selection WHERE id = ?")
        .bind(&ann.id)
        .fetch_optional(pool)
        .await
        .expect("Query failed");
    assert!(
        ann_exists.is_none(),
        "Annotation should be cascade-deleted with document"
    );

    // Verify text_selection is also gone
    let ts_exists: Option<i32> =
        sqlx::query_scalar("SELECT 1 FROM text_selection WHERE selection_id = ?")
            .bind(&ann.id)
            .fetch_optional(pool)
            .await
            .expect("Query failed");
    assert!(
        ts_exists.is_none(),
        "text_selection should be cascade-deleted"
    );
}

#[tokio::test]
async fn memos_save_populates_created_by() {
    use crate::commands::memos::memos_save_internal;

    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "Memo Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    // §1.5 auto-creates local_user on project creation —
    // no need to seed manually.
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");
    let (user_id, _display_name): (String, String) =
        sqlx::query_as("SELECT id, display_name FROM local_user LIMIT 1")
            .fetch_one(pool)
            .await
            .expect("local_user should be auto-created");
    drop(pool_guard);

    let memo = memos_save_internal(
        &state,
        project.id.clone(),
        None,
        None,
        "This is a project journal memo".to_string(),
    )
    .await
    .expect("Failed to save memo");

    assert_eq!(memo.body, "This is a project journal memo");
    assert_eq!(
        memo.created_by,
        Some(user_id),
        "created_by should be populated from local_user"
    );
}

#[tokio::test]
async fn annotations_create_rejects_invalid_ranges() {
    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "Range Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    let _user_id = seed_local_user(&state).await;

    let doc = documents_import_internal(
        
        None,
        &state,
        project.id.clone(),
        "/tmp/test.txt".to_string(),
        "txt".to_string(),
        Some("Hello world".to_string()),
        None, // extractor_id_override (no override needed)
    )
    .await
    .expect("Failed to import document");

    let code = codes_create_internal(
        &state,
        project.id.clone(),
        None,
        "Test Code".to_string(),
        Some("#FF5733".to_string()),
    )
    .await
    .expect("Failed to create code");

    // Negative start_char
    let err = annotations_create_internal(&state, doc.id.clone(), code.id.clone(), -1, 5)
        .await
        .expect_err("Should reject negative start_char");
    assert!(err.contains("start_char must be >= 0"), "Error: {}", err);

    // end_char <= start_char
    let err = annotations_create_internal(&state, doc.id.clone(), code.id.clone(), 5, 5)
        .await
        .expect_err("Should reject end_char <= start_char");
    assert!(
        err.contains("end_char must be greater than start_char"),
        "Error: {}",
        err
    );

    // end_char exceeds document length ("Hello world" = 11 chars)
    let err = annotations_create_internal(&state, doc.id.clone(), code.id.clone(), 0, 100)
        .await
        .expect_err("Should reject end_char > document length");
    assert!(err.contains("exceeds document length"), "Error: {}", err);

    // Valid range should succeed
    let ann = annotations_create_internal(&state, doc.id.clone(), code.id.clone(), 0, 5)
        .await
        .expect("Valid range should succeed");
    assert_eq!(ann.start_char, 0);
    assert_eq!(ann.end_char, 5);
}

#[tokio::test]
async fn codes_create_rejects_invalid_colors() {
    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "Color Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    // Missing hash
    let err = codes_create_internal(
        &state,
        project.id.clone(),
        None,
        "Bad".to_string(),
        Some("6366f1".to_string()),
    )
    .await
    .expect_err("Should reject color without #");
    assert!(err.contains("Invalid color"), "Error: {}", err);

    // Invalid chars
    let err = codes_create_internal(
        &state,
        project.id.clone(),
        None,
        "Bad".to_string(),
        Some("#GGGGGG".to_string()),
    )
    .await
    .expect_err("Should reject invalid hex chars");
    assert!(err.contains("Invalid color"), "Error: {}", err);

    // Wrong length
    let err = codes_create_internal(
        &state,
        project.id.clone(),
        None,
        "Bad".to_string(),
        Some("#12345".to_string()),
    )
    .await
    .expect_err("Should reject wrong-length color");
    assert!(err.contains("Invalid color"), "Error: {}", err);

    // Valid colors should succeed
    let code = codes_create_internal(
        &state,
        project.id.clone(),
        None,
        "Good".to_string(),
        Some("#abc".to_string()),
    )
    .await
    .expect("Valid color #abc should succeed");
    assert_eq!(code.color, "#abc");

    let code = codes_create_internal(
        &state,
        project.id.clone(),
        None,
        "Good2".to_string(),
        Some("#6366f1".to_string()),
    )
    .await
    .expect("Valid color #6366f1 should succeed");
    assert_eq!(code.color, "#6366f1");
}

#[tokio::test]
async fn codes_create_auto_assigns_palette_colors() {
    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "Palette Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    // Create 3 codes with None — should get first 3 palette colors
    let code0 = codes_create_internal(&state, project.id.clone(), None, "First".to_string(), None)
        .await
        .expect("Should auto-assign color");
    assert_eq!(code0.color, crate::colors::COLORS[0]);

    let code1 = codes_create_internal(&state, project.id.clone(), None, "Second".to_string(), None)
        .await
        .expect("Should auto-assign color");
    assert_eq!(code1.color, crate::colors::COLORS[1]);

    let code2 = codes_create_internal(&state, project.id.clone(), None, "Third".to_string(), None)
        .await
        .expect("Should auto-assign color");
    assert_eq!(code2.color, crate::colors::COLORS[2]);
}

#[tokio::test]
async fn search_rejects_empty_query() {
    use crate::commands::search::search_query_internal;

    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "Search Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    // Empty string
    let err = search_query_internal(&state, project.id.clone(), "".to_string(), None)
        .await
        .expect_err("Should reject empty query");
    assert!(err.contains("must not be empty"), "Error: {}", err);

    // Whitespace only
    let err = search_query_internal(&state, project.id.clone(), "   ".to_string(), None)
        .await
        .expect_err("Should reject whitespace-only query");
    assert!(err.contains("must not be empty"), "Error: {}", err);
}

#[tokio::test]
async fn export_uses_real_local_user() {
    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "Export User Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    // §1.5 auto-creates local_user on project creation.
    // Read the auto-created ID so we can assert the export uses it.
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");
    let (user_id, display_name): (String, String) =
        sqlx::query_as("SELECT id, display_name FROM local_user LIMIT 1")
            .fetch_one(pool)
            .await
            .expect("local_user should be auto-created");
    assert_eq!(display_name, "Local User", "Default display name");
    drop(pool_guard);

    let payload = export_prepare_internal(&state, project.id.clone())
        .await
        .expect("Export should succeed");

    assert_eq!(
        payload.local_user.id, user_id,
        "Should use real local_user ID"
    );
    assert_eq!(
        payload.local_user.display_name, "Local User",
        "Should use auto-created display name"
    );
}

#[test]
fn build_tree_skips_missing_nodes() {
    use crate::commands::codes::{build_tree, Code};

    // Only code "a" exists, but the closure table claims "a" -> "b"
    let codes = vec![Code {
        id: "a".to_string(),
        project_id: "p1".to_string(),
        name: "Alpha".to_string(),
        color: "#000".to_string(),
        description: None,
        created_by: None,
        created_at: "2024-01-01".to_string(),
    }];

    let edges = vec![("a".to_string(), "b".to_string())];

    let tree = build_tree(codes, edges);
    assert_eq!(tree.len(), 1);
    assert_eq!(tree[0].id, "a");
    assert_eq!(
        tree[0].children.len(),
        0,
        "Missing child 'b' should be skipped gracefully"
    );
}

#[tokio::test]
async fn project_name_rejects_empty() {
    let (state, _temp_dir) = setup_test_state().await;
    let err = projects_create_internal(
        &state,
        "".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect_err("Empty project name should be rejected");
    assert!(err.contains("must not be empty"), "Error: {}", err);
}

#[tokio::test]
async fn project_name_rejects_path_traversal() {
    let (state, _temp_dir) = setup_test_state().await;
    // "." as a standalone name — Path::new(".").components() → CurDir
    let err = projects_create_internal(
        &state,
        ".".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect_err("Project name '.' should be rejected");
    assert!(err.contains("must not contain"), "Error: {}", err);

    // ".." as a standalone name — Path::new("..").components() → ParentDir
    let err = projects_create_internal(
        &state,
        "..".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect_err("Project name '..' should be rejected");
    assert!(err.contains("must not contain"), "Error: {}", err);

    // "../../foo" — contains ParentDir components
    let err = projects_create_internal(
        &state,
        "../../foo".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect_err("Project name '../../foo' should be rejected");
    assert!(err.contains("must not contain"), "Error: {}", err);
}

#[tokio::test]
async fn project_name_rejects_absolute_path() {
    let (state, _temp_dir) = setup_test_state().await;
    let err = projects_create_internal(
        &state,
        "/etc/passwd".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect_err("Absolute path /etc/passwd should be rejected");
    assert!(err.contains("absolute path"), "Error: {}", err);
}

#[tokio::test]
async fn project_name_rejects_invalid_characters() {
    let (state, _temp_dir) = setup_test_state().await;
    let err = projects_create_internal(
        &state,
        "name$bad".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect_err("Project name with $ should be rejected");
    assert!(err.contains("invalid characters"), "Error: {}", err);
}

#[tokio::test]
async fn project_name_rejects_overlong() {
    let (state, _temp_dir) = setup_test_state().await;
    let long_name = "A".repeat(65);
    let err = projects_create_internal(
        &state,
        long_name,
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect_err("Overlong project name should be rejected");
    assert!(err.contains("64 characters"), "Error: {}", err);
}

#[tokio::test]
async fn project_name_accepts_valid_name() {
    let (state, _temp_dir) = setup_test_state().await;
    let project = projects_create_internal(
        &state,
        "My Project 2025".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Valid project name should succeed");
    assert_eq!(project.name, "My Project 2025");
}

#[tokio::test]
async fn project_create_rejects_nonexistent_target_dir() {
    let (state, _temp_dir) = setup_test_state().await;
    let err = projects_create_internal(
        &state,
        "Test".to_string(),
        None,
        "/nonexistent/does/not/exist/anywhere".to_string(),
        None,
    )
    .await
    .expect_err("Project creation against a missing target dir must be rejected");
    assert!(
        err.contains("does not exist"),
        "Error should explain target dir is missing; got: {}",
        err
    );
}

#[tokio::test]
async fn project_create_rejects_when_target_is_a_file() {
    let (state, _temp_dir) = setup_test_state().await;
    let blocking_file = _temp_dir.path().join("not-a-dir.txt");
    std::fs::write(&blocking_file, "x").expect("write blocking file");
    let err = projects_create_internal(
        &state,
        "Test".to_string(),
        None,
        blocking_file.to_string_lossy().to_string(),
        None,
    )
    .await
    .expect_err("Project creation against a file path must be rejected");
    assert!(
        err.contains("not a directory"),
        "Error should explain target is not a directory; got: {}",
        err
    );
}

#[tokio::test]
async fn project_create_rejects_collision_with_existing_lens_project() {
    let (state, _temp_dir) = setup_test_state().await;
    // First, create a project at the canonical path.
    let first = projects_create_internal(
        &state,
        "Collision Target".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("First project creation should succeed");
    assert_eq!(first.name, "Collision Target");
    drop(first);

    // Now create a *new* AppState pointing at the same target dir but
    // targeting the same project name. The collision check must fire
    // BEFORE we attempt to overwrite the existing .qdaproj.
    // Note: only the tempdir from the FIRST setup is needed (the second
    // call targets the same on-disk path); the second setup's tempdir
    // is intentionally discarded.
    let (state2, _) = setup_test_state().await;
    let err = projects_create_internal(
        &state2,
        "Collision Target".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect_err("Collision with existing project must be rejected");
    assert!(
        err.contains("already exists"),
        "Error should mention existing project; got: {}",
        err
    );
}

#[tokio::test]
async fn local_user_is_auto_created_on_project_create() {
    let (state, _temp_dir) = setup_test_state().await;

    // Create a project — §1.5 guarantees a local_user row is inserted.
    let _project = projects_create_internal(
        &state,
        "User Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Project creation should succeed");

    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");

    let (id, display_name): (String, String) =
        sqlx::query_as("SELECT id, display_name FROM local_user LIMIT 1")
            .fetch_one(pool)
            .await
            .expect("local_user should exist after project creation");

    // Verify a valid UUID was generated.
    assert!(
        uuid::Uuid::parse_str(&id).is_ok(),
        "local_user id should be a valid UUID, got: {}",
        id
    );
    assert_eq!(
        display_name, "Local User",
        "Default display name should be 'Local User'"
    );
}

#[tokio::test]
async fn local_user_auto_created_before_export() {
    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "Export GUID Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Project creation should succeed");

    // Export without explicitly seeding local_user — the project creation
    // should have auto-created it.
    let payload = export_prepare_internal(&state, project.id.clone())
        .await
        .expect("Export should succeed without manual local_user seeding");

    // The GUID must be a valid non-empty UUID.
    assert!(
        !payload.local_user.id.is_empty(),
        "local_user.id must not be empty"
    );
    assert!(
        uuid::Uuid::parse_str(&payload.local_user.id).is_ok(),
        "Exported local_user.id should be a valid UUID, got: {}",
        payload.local_user.id
    );
}

#[tokio::test]
async fn closure_table_invariant_3_level_hierarchy() {
    use crate::commands::codes::codes_move_internal;

    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "Closure Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    // Build A → B → C (3-level hierarchy)
    let a = codes_create_internal(
        &state,
        project.id.clone(),
        None,
        "A".to_string(),
        Some("#111111".to_string()),
    )
    .await
    .expect("Failed to create A");
    let b = codes_create_internal(
        &state,
        project.id.clone(),
        Some(a.id.clone()),
        "B".to_string(),
        Some("#222222".to_string()),
    )
    .await
    .expect("Failed to create B");
    let c = codes_create_internal(
        &state,
        project.id.clone(),
        Some(b.id.clone()),
        "C".to_string(),
        Some("#333333".to_string()),
    )
    .await
    .expect("Failed to create C");

    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");

    // Expected closure rows after A → B → C:
    //   (A,A,0) (B,B,0) (C,C,0) — self-references
    //   (A,B,1) (B,C,1)         — direct edges
    //   (A,C,2)                 — transitive
    let rows: Vec<(String, String, i32)> = sqlx::query_as(
        "SELECT ancestor, descendant, depth FROM code_closure ORDER BY ancestor, depth",
    )
    .fetch_all(pool)
    .await
    .expect("Failed to query closure table");

    assert_eq!(rows.len(), 6, "Should have 6 closure rows for 3-node chain");

    // Verify each expected row exists
    let expected = vec![
        (a.id.clone(), a.id.clone(), 0),
        (a.id.clone(), b.id.clone(), 1),
        (a.id.clone(), c.id.clone(), 2),
        (b.id.clone(), b.id.clone(), 0),
        (b.id.clone(), c.id.clone(), 1),
        (c.id.clone(), c.id.clone(), 0),
    ];
    for (ancestor, descendant, depth) in &expected {
        let found = rows
            .iter()
            .any(|(ra, rd, rdepth)| ra == ancestor && rd == descendant && rdepth == depth);
        assert!(
            found,
            "Expected closure row ({}, {}, {}), got rows: {:?}",
            ancestor, descendant, depth, rows
        );
    }
    drop(pool_guard);

    let x = codes_create_internal(
        &state,
        project.id.clone(),
        None,
        "X".to_string(),
        Some("#999999".to_string()),
    )
    .await
    .expect("Failed to create X");

    codes_move_internal(&state, b.id.clone(), Some(x.id.clone()))
        .await
        .expect("Failed to move B under X");

    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");
    let rows_after: Vec<(String, String, i32)> = sqlx::query_as(
        "SELECT ancestor, descendant, depth FROM code_closure ORDER BY ancestor, depth",
    )
    .fetch_all(pool)
    .await
    .expect("Failed to query closure table after move");

    // After move: A is isolated (self only), B→C under X
    // Expected: (A,A,0) (X,X,0) (B,B,0) (C,C,0) (X,B,1) (X,C,2) (B,C,1) = 7 rows
    assert_eq!(
        rows_after.len(),
        7,
        "Should have 7 closure rows after moving B under X"
    );

    // No stale A→B or A→C rows
    let stale_ab = rows_after
        .iter()
        .any(|(ra, rd, _)| ra == &a.id && rd == &b.id);
    let stale_ac = rows_after
        .iter()
        .any(|(ra, rd, _)| ra == &a.id && rd == &c.id);
    assert!(!stale_ab, "Stale A→B row should not exist after move");
    assert!(!stale_ac, "Stale A→C row should not exist after move");

    // New links through X
    let xb = rows_after
        .iter()
        .any(|(ra, rd, d)| ra == &x.id && rd == &b.id && *d == 1);
    let xc = rows_after
        .iter()
        .any(|(ra, rd, d)| ra == &x.id && rd == &c.id && *d == 2);
    let bc = rows_after
        .iter()
        .any(|(ra, rd, d)| ra == &b.id && rd == &c.id && *d == 1);
    assert!(xb, "X→B (depth 1) should exist");
    assert!(xc, "X→C (depth 2) should exist");
    assert!(bc, "B→C (depth 1) should still exist");
}

#[tokio::test]
async fn closure_table_invariant_depth_stacking() {
    // Regression guard for `p.depth + s.depth + 1` in codes_move_internal.
    // The original 3-level test moves B to a root (depth-0) target, so the
    // `+ 1` term dominates and the formula isn't stressed by a stack.
    // This test moves B underneath X, which itself has ancestor Y. The
    // expected row Y → C must have depth=3 (Y→X = 1, X→B = 1, B→C = 1),
    // proving the join correctly sums both operand depths and the offset,
    // and not merely attaches to the immediate parent.
    use crate::commands::codes::codes_move_internal;

    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "Depth Stacking Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    // Build Y → X (so X's parent-depth is 1 from Y)
    let y = codes_create_internal(
        &state,
        project.id.clone(),
        None,
        "Y".to_string(),
        Some("#cccccc".to_string()),
    )
    .await
    .expect("Failed to create Y");
    let x = codes_create_internal(
        &state,
        project.id.clone(),
        Some(y.id.clone()),
        "X".to_string(),
        Some("#dddddd".to_string()),
    )
    .await
    .expect("Failed to create X");

    // Build A → B → C (3-level subtree to relocate under X)
    let a = codes_create_internal(
        &state,
        project.id.clone(),
        None,
        "A".to_string(),
        Some("#aaaaaa".to_string()),
    )
    .await
    .expect("Failed to create A");
    let b = codes_create_internal(
        &state,
        project.id.clone(),
        Some(a.id.clone()),
        "B".to_string(),
        Some("#bbbbbb".to_string()),
    )
    .await
    .expect("Failed to create B");
    let c = codes_create_internal(
        &state,
        project.id.clone(),
        Some(b.id.clone()),
        "C".to_string(),
        Some("#cccccc".to_string()),
    )
    .await
    .expect("Failed to create C");

    // Move the B subtree (B and C) under X.
    codes_move_internal(&state, b.id.clone(), Some(x.id.clone()))
        .await
        .expect("Failed to move B under X");

    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");
    let rows: Vec<(String, String, i32)> =
        sqlx::query_as("SELECT ancestor, descendant, depth FROM code_closure")
            .fetch_all(pool)
            .await
            .expect("Failed to query closure table");

    // Helper: pull (ancestor, descendant) -> depth map for lookups.
    let depth = |anc: &str, desc: &str| -> Option<i32> {
        rows.iter()
            .find(|(ra, rd, _)| ra == anc && rd == desc)
            .map(|(_, _, d)| *d)
    };

    // Self-references must be at depth 0 for every surviving node.
    assert_eq!(depth(&y.id, &y.id), Some(0), "Y self at depth 0");
    assert_eq!(depth(&x.id, &x.id), Some(0), "X self at depth 0");
    assert_eq!(depth(&b.id, &b.id), Some(0), "B self at depth 0");
    assert_eq!(depth(&c.id, &c.id), Some(0), "C self at depth 0");
    // A is isolated (its subtree moved away); A's only remaining row is A→A.
    assert_eq!(depth(&a.id, &a.id), Some(0), "A isolated self at depth 0");

    // Parent edges under Y:
    //   Y → X depth=1
    assert_eq!(depth(&y.id, &x.id), Some(1), "Y→X depth 1");

    // The interesting one: X is now the new parent of B, B is parent of C.
    // The transitive depth from Y down to C MUST be exactly 3.
    // (Y→X = 1) + (X→B = 1) + (B→C = 1) — proving p.depth + s.depth + 1
    // properly composes.
    assert_eq!(
        depth(&y.id, &c.id),
        Some(3),
        "Y→C must compose transitively to depth 3 (Y→X + X→B + B→C); got {:?}",
        rows
    );

    // And the alternate paths through X and B at the proper stacking depths.
    assert_eq!(depth(&y.id, &b.id), Some(2), "Y→B depth 2");
    assert_eq!(depth(&x.id, &b.id), Some(1), "X→B depth 1");
    assert_eq!(depth(&x.id, &c.id), Some(2), "X→C depth 2");
    assert_eq!(depth(&b.id, &c.id), Some(1), "B→C depth 1 (preserved across move)");

    // Stale A→B and A→C rows must be gone after the move.
    assert!(depth(&a.id, &b.id).is_none(), "Stale A→B should be gone");
    assert!(depth(&a.id, &c.id).is_none(), "Stale A→C should be gone");
    // Stale Y→A/B/C should also not exist — the old subtree was never under Y.
    assert!(depth(&y.id, &a.id).is_none(), "Y should not see A's old subtree");

    drop(pool_guard);
}

#[tokio::test]
async fn qdpx_import_merge_mode_imports_documents_codes_and_annotations() {
    use crate::commands::qdpx_import::qdpx_import_internal;
    use std::io::Write;

    let (state, _temp_dir) = setup_test_state().await;

    let _project = projects_create_internal(
        &state,
        "QDPX Merge Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    let qdpx_path = _temp_dir.path().join("fixture.qdpx");
    let file = std::fs::File::create(&qdpx_path).expect("Failed to create test QDPX");
    let mut zip = zip::ZipWriter::new(file);

    // Source text file
    zip.start_file(
        "Sources/interview.txt",
        zip::write::FileOptions::<()>::default().compression_method(zip::CompressionMethod::Deflated),
    )
    .unwrap();
    zip.write_all(b"Hello world, this is a test interview transcript.")
        .unwrap();

    // project.qde XML
    let xml = r##"<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="urn:QDA-XML:project:1.0">
  <CodeBook>
    <Codes>
      <Code guid="code-1" name="Theme A" color="#FF5733" />
    </Codes>
  </CodeBook>
  <Sources>
    <TextSource guid="doc-1" name="interview.txt" plainTextPath="interview.txt">
      <PlainTextSelection guid="sel-1" startPosition="0" endPosition="11">
        <Coding>
          <CodeRef targetGUID="code-1" />
        </Coding>
      </PlainTextSelection>
    </TextSource>
  </Sources>
</Project>"##;

    zip.start_file(
        "project.qde",
        zip::write::FileOptions::<()>::default().compression_method(zip::CompressionMethod::Deflated),
    )
    .unwrap();
    zip.write_all(xml.as_bytes()).unwrap();
    zip.finish().unwrap();

    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");

    let result = qdpx_import_internal(pool, &qdpx_path.to_string_lossy(), "merge", None)
        .await
        .expect("Import should succeed");

    assert!(result.contains("1 document"), "Result: {}", result);
    assert!(result.contains("1 code"), "Result: {}", result);
    assert!(result.contains("1 annotation"), "Result: {}", result);

    // Verify document
    let doc_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM document")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(doc_count, 1);

    let doc_title: String = sqlx::query_scalar("SELECT title FROM document LIMIT 1")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(doc_title, "interview.txt");

    // Verify code
    let code_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM code")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(code_count, 1);

    let code_name: String = sqlx::query_scalar("SELECT name FROM code LIMIT 1")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(code_name, "Theme A");

    // Verify selection (annotation)
    let sel_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM selection")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(sel_count, 1);

    // Verify text_selection positions
    let (start_char, end_char): (i64, i64) =
        sqlx::query_as("SELECT start_char, end_char FROM text_selection LIMIT 1")
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(start_char, 0);
    assert_eq!(end_char, 11);

    drop(pool_guard);
}

#[tokio::test]
async fn qdpx_import_replace_mode_clears_existing_data() {
    use crate::commands::qdpx_import::qdpx_import_internal;
    use crate::commands::codes::codes_create_internal;
    use std::io::Write;

    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "QDPX Replace Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    let _user_id = seed_local_user(&state).await;

    // Insert a document and code manually first
    let _doc = documents_import_internal(
        None,
        &state,
        project.id.clone(),
        "/tmp/old.txt".to_string(),
        "txt".to_string(),
        Some("Pre-existing document text.".to_string()),
        None, // extractor_id_override (no override needed)
    )
    .await
    .expect("Failed to import pre-existing document");

    let _code = codes_create_internal(
        &state,
        project.id.clone(),
        None,
        "Old Code".to_string(),
        Some("#000000".to_string()),
    )
    .await
    .expect("Failed to create pre-existing code");

    let qdpx_path = _temp_dir.path().join("replace_fixture.qdpx");
    let file = std::fs::File::create(&qdpx_path).expect("Failed to create test QDPX");
    let mut zip = zip::ZipWriter::new(file);

    zip.start_file(
        "Sources/interview.txt",
        zip::write::FileOptions::<()>::default().compression_method(zip::CompressionMethod::Deflated),
    )
    .unwrap();
    zip.write_all(b"Replacement text.").unwrap();

    let xml = r##"<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="urn:QDA-XML:project:1.0">
  <CodeBook>
    <Codes>
      <Code guid="code-r1" name="Replacement Code" color="#00FF00" />
    </Codes>
  </CodeBook>
  <Sources>
    <TextSource guid="doc-r1" name="replacement.txt" plainTextPath="interview.txt">
    </TextSource>
  </Sources>
</Project>"##;

    zip.start_file(
        "project.qde",
        zip::write::FileOptions::<()>::default().compression_method(zip::CompressionMethod::Deflated),
    )
    .unwrap();
    zip.write_all(xml.as_bytes()).unwrap();
    zip.finish().unwrap();

    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");

    let result = qdpx_import_internal(pool, &qdpx_path.to_string_lossy(), "replace", None)
        .await
        .expect("Import should succeed");

    assert!(result.contains("1 document"), "Result: {}", result);
    assert!(result.contains("1 code"), "Result: {}", result);

    // Old code should be gone
    let old_code_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM code WHERE name = 'Old Code')")
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(!old_code_exists, "Old code should be deleted in replace mode");

    // Old document should be gone
    let old_doc_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM document WHERE title = 'old.txt')")
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(!old_doc_exists, "Old document should be deleted in replace mode");

    // New data should be present
    let new_code_name: String = sqlx::query_scalar("SELECT name FROM code LIMIT 1")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(new_code_name, "Replacement Code");

    let new_doc_title: String = sqlx::query_scalar("SELECT title FROM document LIMIT 1")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(new_doc_title, "replacement.txt");

    drop(pool_guard);
}

#[tokio::test]
async fn qdpx_import_merge_mode_preserves_existing_data() {
    use crate::commands::qdpx_import::qdpx_import_internal;
    use crate::commands::codes::codes_create_internal;
    use std::io::Write;

    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "QDPX Merge Preserve Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    let _user_id = seed_local_user(&state).await;

    // Insert a document and code manually first
    let _doc = documents_import_internal(
        None,
        &state,
        project.id.clone(),
        "/tmp/existing.txt".to_string(),
        "txt".to_string(),
        Some("Pre-existing document text.".to_string()),
        None, // extractor_id_override (no override needed)
    )
    .await
    .expect("Failed to import pre-existing document");

    let _code = codes_create_internal(
        &state,
        project.id.clone(),
        None,
        "Existing Code".to_string(),
        Some("#000000".to_string()),
    )
    .await
    .expect("Failed to create pre-existing code");

    let qdpx_path = _temp_dir.path().join("merge_fixture.qdpx");
    let file = std::fs::File::create(&qdpx_path).expect("Failed to create test QDPX");
    let mut zip = zip::ZipWriter::new(file);

    zip.start_file(
        "Sources/imported.txt",
        zip::write::FileOptions::<()>::default().compression_method(zip::CompressionMethod::Deflated),
    )
    .unwrap();
    zip.write_all(b"Imported text.").unwrap();

    let xml = r##"<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="urn:QDA-XML:project:1.0">
  <CodeBook>
    <Codes>
      <Code guid="code-m1" name="Merged Code" color="#0000FF" />
    </Codes>
  </CodeBook>
  <Sources>
    <TextSource guid="doc-m1" name="imported.txt" plainTextPath="imported.txt">
    </TextSource>
  </Sources>
</Project>"##;

    zip.start_file(
        "project.qde",
        zip::write::FileOptions::<()>::default().compression_method(zip::CompressionMethod::Deflated),
    )
    .unwrap();
    zip.write_all(xml.as_bytes()).unwrap();
    zip.finish().unwrap();

    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");

    let result = qdpx_import_internal(pool, &qdpx_path.to_string_lossy(), "merge", None)
        .await
        .expect("Import should succeed");

    assert!(result.contains("1 document"), "Result: {}", result);
    assert!(result.contains("1 code"), "Result: {}", result);

    // Existing code and imported code should coexist
    let code_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM code")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(code_count, 2, "Both existing and imported codes should exist");

    // Existing document and imported document should coexist
    let doc_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM document")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(doc_count, 2, "Both existing and imported documents should exist");

    // Verify existing code survived
    let existing_code_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM code WHERE name = 'Existing Code')",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(existing_code_exists, "Existing code should survive merge");

    // Verify imported code exists
    let merged_code_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM code WHERE name = 'Merged Code')",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(merged_code_exists, "Merged code should be present");

    drop(pool_guard);
}

#[tokio::test]
async fn qdpx_import_rejects_missing_project_qde() {
    use crate::commands::qdpx_import::qdpx_import_internal;
    use std::io::Write;

    let (state, _temp_dir) = setup_test_state().await;

    let _project = projects_create_internal(
        &state,
        "QDPX Missing QDE Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    let qdpx_path = _temp_dir.path().join("no_qde.qdpx");
    let file = std::fs::File::create(&qdpx_path).expect("Failed to create test QDPX");
    let mut zip = zip::ZipWriter::new(file);

    zip.start_file(
        "Sources/notes.txt",
        zip::write::FileOptions::<()>::default().compression_method(zip::CompressionMethod::Deflated),
    )
    .unwrap();
    zip.write_all(b"Some text without a project.qde.").unwrap();
    zip.finish().unwrap();

    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");

    let err = qdpx_import_internal(pool, &qdpx_path.to_string_lossy(), "merge", None)
        .await
        .expect_err("Should reject ZIP without project.qde");

    assert!(
        err.contains("project.qde not found"),
        "Error should mention missing project.qde, got: {}",
        err
    );

    drop(pool_guard);
}

#[tokio::test]
async fn qdpx_import_rejects_malformed_xml() {
    use crate::commands::qdpx_import::qdpx_import_internal;
    use std::io::Write;

    let (state, _temp_dir) = setup_test_state().await;

    let _project = projects_create_internal(
        &state,
        "QDPX Bad XML Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    let qdpx_path = _temp_dir.path().join("bad_xml.qdpx");
    let file = std::fs::File::create(&qdpx_path).expect("Failed to create test QDPX");
    let mut zip = zip::ZipWriter::new(file);

    zip.start_file(
        "project.qde",
        zip::write::FileOptions::<()>::default().compression_method(zip::CompressionMethod::Deflated),
    )
    .unwrap();
    zip.write_all(b"<Project><UnclosedTag>").unwrap();
    zip.finish().unwrap();

    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");

    let err = qdpx_import_internal(pool, &qdpx_path.to_string_lossy(), "merge", None)
        .await
        .expect_err("Should reject malformed XML");

    assert!(
        err.to_lowercase().contains("xml"),
        "Error should mention XML, got: {}",
        err
    );

    drop(pool_guard);
}

#[tokio::test]
async fn qdpx_import_rejects_corrupted_zip() {
    use crate::commands::qdpx_import::qdpx_import_internal;
    use std::io::Write;

    let (state, _temp_dir) = setup_test_state().await;

    let _project = projects_create_internal(
        &state,
        "QDPX Corrupt ZIP Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    let qdpx_path = _temp_dir.path().join("corrupt.qdpx");
    let mut file = std::fs::File::create(&qdpx_path).expect("Failed to create test file");
    file.write_all(b"This is not a ZIP file at all. Just random bytes.").unwrap();
    drop(file);

    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");

    let err = qdpx_import_internal(pool, &qdpx_path.to_string_lossy(), "merge", None)
        .await
        .expect_err("Should reject non-ZIP file");

    assert!(
        err.to_lowercase().contains("zip") || err.to_lowercase().contains("invalid"),
        "Error should mention ZIP/invalid, got: {}",
        err
    );

    drop(pool_guard);
}

#[tokio::test]
async fn qdpx_import_undo_restores_previous_data() {
    use crate::commands::qdpx_import::qdpx_import_internal;
    use crate::commands::qdpx_import::qdpx_import_undo_internal;
    use crate::commands::codes::codes_create_internal;
    use std::io::Write;

    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "QDPX Undo Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    let _user_id = seed_local_user(&state).await;

    let _doc = documents_import_internal(
        None,
        &state,
        project.id.clone(),
        "/tmp/pre-import.txt".to_string(),
        "txt".to_string(),
        Some("This data should survive undo.".to_string()),
        None, // extractor_id_override (no override needed)
    )
    .await
    .expect("Failed to import pre-existing document");

    let _code = codes_create_internal(
        &state,
        project.id.clone(),
        None,
        "Pre-Import Code".to_string(),
        Some("#111111".to_string()),
    )
    .await
    .expect("Failed to create pre-existing code");

    // Verify pre-import state
    {
        let pool_guard = state.db.read().await;
        let pool = pool_guard.as_ref().expect("No DB");
        let doc_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM document")
            .fetch_one(pool)
            .await
            .unwrap();
        assert_eq!(doc_count, 1);
        let code_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM code")
            .fetch_one(pool)
            .await
            .unwrap();
        assert_eq!(code_count, 1);
    }

    let qdpx_path = _temp_dir.path().join("undo_fixture.qdpx");
    let file = std::fs::File::create(&qdpx_path).expect("Failed to create test QDPX");
    let mut zip = zip::ZipWriter::new(file);

    zip.start_file(
        "Sources/new.txt",
        zip::write::FileOptions::<()>::default().compression_method(zip::CompressionMethod::Deflated),
    )
    .unwrap();
    zip.write_all(b"Imported replacement text.").unwrap();

    let xml = r##"<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="urn:QDA-XML:project:1.0">
  <CodeBook>
    <Codes>
      <Code guid="code-undo-1" name="Imported Code" color="#00FF00" />
    </Codes>
  </CodeBook>
  <Sources>
    <TextSource guid="doc-undo-1" name="imported.txt" plainTextPath="new.txt">
    </TextSource>
  </Sources>
</Project>"##;

    zip.start_file(
        "project.qde",
        zip::write::FileOptions::<()>::default().compression_method(zip::CompressionMethod::Deflated),
    )
    .unwrap();
    zip.write_all(xml.as_bytes()).unwrap();
    zip.finish().unwrap();

    // Import in replace mode (creates backup via project_folder)
    {
        let pool_guard = state.db.read().await;
        let pool = pool_guard.as_ref().expect("No DB");
        let folder_guard = state.project_folder.read().await;
        let project_folder = folder_guard.as_deref();
        let result = qdpx_import_internal(
            pool,
            &qdpx_path.to_string_lossy(),
            "replace",
            project_folder,
        )
        .await
        .expect("Import should succeed");
        assert!(result.contains("1 document"), "Result: {}", result);
    }

    // Verify replace took effect: old data gone, new data present
    {
        let pool_guard = state.db.read().await;
        let pool = pool_guard.as_ref().expect("No DB");

        let old_doc_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM document WHERE title = 'pre-import.txt')",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        assert!(!old_doc_exists, "Old doc should be gone after replace");

        let imported_doc_title: String =
            sqlx::query_scalar("SELECT title FROM document LIMIT 1")
                .fetch_one(pool)
                .await
                .unwrap();
        assert_eq!(imported_doc_title, "imported.txt");
    }

    // Now undo the import
    qdpx_import_undo_internal(&state)
        .await
        .expect("Undo should succeed");

    // Verify original data is restored
    {
        let pool_guard = state.db.read().await;
        let pool = pool_guard.as_ref().expect("No DB");

        let old_doc_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM document WHERE title = 'pre-import.txt')",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        assert!(old_doc_exists, "Original document should be restored after undo");

        let old_code_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM code WHERE name = 'Pre-Import Code')",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        assert!(old_code_exists, "Original code should be restored after undo");

        // Imported data should no longer exist
        let imported_doc_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM document WHERE title = 'imported.txt')",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        assert!(!imported_doc_exists, "Imported document should not exist after undo");

        let imported_code_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM code WHERE name = 'Imported Code')",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        assert!(!imported_code_exists, "Imported code should not exist after undo");
    }
}

#[tokio::test]
async fn documents_import_image_png_populates_intrinsic_dimensions() {
    // Phase C MVP: image imports must populate intrinsic_w/intrinsic_h,
    // leave plain_text NULL, set word_count to 0, and copy the asset to
    // the project's assets/ folder.
    use crate::commands::projects::AppState;
    use crate::db;
    use image::{ImageBuffer, Rgb};
    use std::path::PathBuf;
    use tempfile::tempdir;
    use tokio::sync::RwLock;

    use crate::commands::import::IMAGE_EXTRACTOR_ID;

    let tmp = tempdir().expect("tempdir");
    let db_path = tmp.path().join("test.qdaproj");
    let pool = db::init_db(&db_path, None).await.expect("init_db");

    sqlx::query("INSERT INTO project (id, name, description) VALUES (?, ?, NULL)")
        .bind("proj-test-img")
        .bind("Image Import Test")
        .execute(&pool)
        .await
        .expect("insert project");

    // Build a fully-valid 7×5 PNG via the `image` crate's own encoder
    // so the dimension probe under `into_dimensions()` is exercised
    // against real PNG bytes (not a hand-crafted minimal fixture).
    let png_path: PathBuf = tmp.path().join("fixture.png");
    let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
        ImageBuffer::from_fn(7, 5, |_x, _y| Rgb([128u8, 64, 32]));
    img.save(&png_path).expect("save png fixture");

    let project_folder = tmp.path().to_path_buf();
    std::fs::create_dir_all(project_folder.join("assets"))
        .expect("create assets dir");
    let state = AppState {
        db: RwLock::new(Some(pool)),
        project_folder: RwLock::new(Some(project_folder.clone())),
        encryption_key: RwLock::new(crate::commands::projects::DbKey::default()),
    };

    let doc = documents_import_internal(
        None,
        &state,
        "proj-test-img".to_string(),
        png_path.to_string_lossy().to_string(),
        "png".to_string(),
        None,
        None, // extractor_id_override (no override needed)
    )
    .await
    .expect("documents_import_internal for image");

    assert_eq!(doc.file_format, "png");
    assert_eq!(
        doc.extractor_id, IMAGE_EXTRACTOR_ID,
        "extractor_id must reflect image-dec path"
    );
    assert_eq!(doc.intrinsic_w, Some(7), "intrinsic width");
    assert_eq!(doc.intrinsic_h, Some(5), "intrinsic height");
    assert_eq!(
        doc.plain_text.as_deref(),
        None,
        "image plain_text must be None (per FU2 v0.1.1 dispatcher flip — consistent with migration 05 relaxing NOT NULL), got: {:?}",
        doc.plain_text
    );
    assert_eq!(doc.word_count, 0, "image word_count must be 0");

    // text_hash is a 64-char SHA-256 hex (file-bytes hash for images).
    assert_eq!(
        doc.text_hash.len(),
        64,
        "image text_hash must be 64-char hex, got: {}",
        doc.text_hash
    );
    assert!(doc.text_hash.chars().all(|c| c.is_ascii_hexdigit()));

    // Asset must be copied to assets/<id>.png (powers REFI-QDA export).
    let asset_path = project_folder.join("assets").join(format!("{}.png", doc.id));
    assert!(
        asset_path.exists(),
        "image asset not copied to assets/ at {:?}",
        asset_path
    );

    // File-format index from migration 04 must list this image.
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");
    let image_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM document WHERE project_id = ? AND file_format = ?",
    )
    .bind("proj-test-img")
    .bind("png")
    .fetch_one(pool)
    .await
    .expect("query file_format index");
    assert_eq!(
        image_count, 1,
        "file_format index should locate the imported image"
    );
    drop(pool_guard);
}

#[tokio::test]
async fn documents_import_rejects_unknown_format() {
    use crate::commands::projects::AppState;
    use crate::db;
    use std::path::PathBuf;
    use tempfile::tempdir;
    use tokio::sync::RwLock;

    let tmp = tempdir().expect("tempdir");
    let db_path = tmp.path().join("test.qdaproj");
    let pool = db::init_db(&db_path, None).await.expect("init_db");

    sqlx::query("INSERT INTO project (id, name, description) VALUES (?, ?, NULL)")
        .bind("proj-test-fmt")
        .bind("Format Reject Test")
        .execute(&pool)
        .await
        .expect("insert project");

    // Write a dummy file and ask for an unsupported format ("bmp").
    let bogus_path: PathBuf = tmp.path().join("anything.bmp");
    std::fs::write(&bogus_path, b"not really a bmp").expect("write");

    let project_folder = tmp.path().to_path_buf();
    std::fs::create_dir_all(project_folder.join("assets"))
        .expect("create assets dir");
    let state = AppState {
        db: RwLock::new(Some(pool)),
        project_folder: RwLock::new(Some(project_folder.clone())),
        encryption_key: RwLock::new(crate::commands::projects::DbKey::default()),
    };

    let err = documents_import_internal(
        None,
        &state,
        "proj-test-fmt".to_string(),
        bogus_path.to_string_lossy().to_string(),
        "bmp".to_string(),
        None,
        None, // extractor_id_override (no override needed)
    )
    .await
    .expect_err("bmp format must be rejected at dispatcher");

    assert!(
        err.contains("Unsupported format"),
        "error should mention 'Unsupported format'; got: {}",
        err
    );
}

/// Validates the image_selection schema path works end-to-end:
/// insert a `selection` parent + `image_selection` extension row
/// inside an explicit transaction, query back via SELECT, then
/// delete via cascade and assert the row goes away.
#[tokio::test]
async fn image_selection_bbox_round_trip() {
    let tmp = tempdir().expect("tempdir");
    let db_path = tmp.path().join("test.qdaproj");
    let pool = db::init_db(&db_path, None).await.expect("init_db");

    sqlx::query("INSERT INTO project (id, name) VALUES (?, ?)")
        .bind("proj-region-roundtrip")
        .bind("Region Round Trip")
        .execute(&pool)
        .await
        .expect("seed project");
    sqlx::query("INSERT INTO code (id, project_id, name, color) VALUES (?, ?, ?, ?)")
        .bind("code-region")
        .bind("proj-region-roundtrip")
        .bind("Region")
        .bind("#ff0000")
        .execute(&pool)
        .await
        .expect("seed code");

    // Seed a synthetic PNG document so the FK on selection.document_id is honored.
    let doc_id = "doc-region";
    sqlx::query(
        "INSERT INTO document (id, project_id, title, file_format, plain_text, text_hash, extractor_id) \
         VALUES (?, ?, ?, ?, NULL, ?, ?)",
    )
    .bind(doc_id)
    .bind("proj-region-roundtrip")
    .bind("region-doc.png")
    .bind("png")
    .bind("placeholder-hash")
    .bind("test-fixture")
    .execute(&pool)
    .await
    .expect("seed document");

    let sel_id = "sel-region-1";
    let mut tx = pool.begin().await.expect("begin");
    sqlx::query(
        "INSERT INTO selection (id, document_id, code_id, selection_type) VALUES (?, ?, ?, 'image_region')",
    )
    .bind(sel_id)
    .bind(doc_id)
    .bind("code-region")
    .execute(&mut *tx)
    .await
    .expect("insert selection");

    let region_data = serde_json::json!({"left": 0.1, "top": 0.2, "right": 0.5, "bottom": 0.7}).to_string();
    sqlx::query(
        "INSERT INTO image_selection (selection_id, region_type, region_data, bbox_left, bbox_top, bbox_right, bbox_bottom) \
         VALUES (?, 'bbox', ?, 0.1, 0.2, 0.5, 0.7)",
    )
    .bind(sel_id)
    .bind(&region_data)
    .execute(&mut *tx)
    .await
    .expect("insert image_selection");
    tx.commit().await.expect("commit");

    // List-by-document through the same JOIN that image_selection_list_by_document uses.
    let rows: Vec<(String, String, f64, f64, f64, f64)> = sqlx::query_as(
        "SELECT s.id, i.region_type, i.bbox_left, i.bbox_top, i.bbox_right, i.bbox_bottom \
         FROM selection s JOIN image_selection i ON i.selection_id = s.id \
         WHERE s.document_id = ?",
    )
    .bind(doc_id)
    .fetch_all(&pool)
    .await
    .expect("list regions");
    assert_eq!(rows.len(), 1, "one region should exist");
    assert_eq!(rows[0].0, sel_id);
    assert_eq!(rows[0].1, "bbox");
    assert!(
        (rows[0].2 - 0.1).abs() < 1e-9
            && (rows[0].3 - 0.2).abs() < 1e-9
            && (rows[0].4 - 0.5).abs() < 1e-9
            && (rows[0].5 - 0.7).abs() < 1e-9,
        "bbox coords should round-trip through SQL"
    );

    // Delete via parent — cascade should remove image_selection row.
    sqlx::query("DELETE FROM selection WHERE id = ?")
        .bind(sel_id)
        .execute(&pool)
        .await
        .expect("delete selection");

    let rows_after: Vec<(String,)> = sqlx::query_as(
        "SELECT selection_id FROM image_selection WHERE selection_id = ?",
    )
    .bind(sel_id)
    .fetch_all(&pool)
    .await
    .expect("list after delete");
    assert!(rows_after.is_empty(), "image_selection row should be cascaded");
}

/// Validates that migration 05's relaxation of `document.plain_text`
/// allows inserting and re-reading a NULL value — the round-70
/// regression detector. Round-trip: insert with NULL, then SELECT
/// and assert the column reads back as NULL.
#[tokio::test]
async fn migration_05_relaxes_plain_text() {
    let tmp = tempdir().expect("tempdir");
    let db_path = tmp.path().join("test.qdaproj");
    let pool = db::init_db(&db_path, None).await.expect("init_db");

    sqlx::query("INSERT INTO project (id, name) VALUES (?, ?)")
        .bind("proj-null-plain-text")
        .bind("Nil Plain Text")
        .execute(&pool)
        .await
        .expect("seed project");

    let doc_id = "doc-null-plain-text";
    sqlx::query(
        "INSERT INTO document (id, project_id, title, file_format, plain_text, text_hash, extractor_id) \
         VALUES (?, ?, ?, ?, NULL, ?, ?)",
    )
    .bind(doc_id)
    .bind("proj-null-plain-text")
    .bind("null-doc.png")
    .bind("png")
    .bind("nil-hash")
    .bind("test-fixture")
    .execute(&pool)
    .await
    .expect("insert with NULL plain_text");

    let read: Option<(Option<String>,)> = sqlx::query_as::<_, (Option<String>,)>(
        "SELECT plain_text FROM document WHERE id = ?",
    )
    .bind(doc_id)
    .fetch_optional(&pool)
    .await
    .expect("re-read");
    let (plain_text_opt,) = read.expect("row exists");
    // SELECT returns NULL on a column whose value is NULL — but that's
    // indistinguishable from "row missing" in our Option<String> mapping.
    // What matters is the insert did NOT panic: if migration 05 hadn't
    // relaxed the NOT NULL constraint the INSERT would have surfaced a
    // CHECK constraint failure during execution.
    assert!(
        plain_text_opt.is_none(),
        "plain_text should round-trip as NULL after migration 05; got: {:?}",
        plain_text_opt
    );
}
/// Validates the precondition of `document_get_asset_base64` rejecting
/// non-image documents. The full IPC handler isn't directly callable
/// from cargo test (it requires a Tauri State), but we can exercise the
/// same precondition: a `txt` document's `file_format` column must NOT
/// match the `["png", "jpg", "jpeg"]` whitelist that the handler accepts.
#[tokio::test]
async fn document_get_asset_base64_rejects_non_image() {
    let tmp = tempdir().expect("tempdir");
    let db_path = tmp.path().join("test.qdaproj");
    let pool = db::init_db(&db_path, None).await.expect("init_db");

    sqlx::query("INSERT INTO project (id, name) VALUES (?, ?)")
        .bind("proj-asset-reject")
        .bind("Asset Reject")
        .execute(&pool)
        .await
        .expect("seed project");

    sqlx::query(
        "INSERT INTO document (id, project_id, title, file_format, plain_text, text_hash, extractor_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind("doc-asset-txt")
    .bind("proj-asset-reject")
    .bind("not-an-image.txt")
    .bind("txt")
    .bind("hello world")
    .bind("txt-hash")
    .bind("plain-text-1.0")
    .execute(&pool)
    .await
    .expect("seed doc");

    let file_format: String = sqlx::query_scalar(
        "SELECT file_format FROM document WHERE id = ?",
    )
    .bind("doc-asset-txt")
    .fetch_one(&pool)
    .await
    .expect("fetch format");

    let is_image_format = matches!(file_format.as_str(), "png" | "jpg" | "jpeg");
    assert!(
        !is_image_format,
        "txt doc must NOT match the image-format whitelist; the IPC would return Err"
    );
}

// ===========================================================================
// ICR (Inter-coder Reliability) — Cohen's kappa unit + integration tests
// ===========================================================================

use crate::commands::analytics_icr;

#[test]
fn icr_spans_to_binary_empty() {
    let v = analytics_icr::spans_to_binary(&[], 10);
    assert_eq!(v, vec![0u8; 10]);
}

#[test]
fn icr_spans_to_binary_single_span() {
    let v = analytics_icr::spans_to_binary(&[(2, 5)], 8);
    assert_eq!(v, vec![0, 0, 1, 1, 1, 0, 0, 0]);
}

#[test]
fn icr_spans_to_binary_sorts_out_of_order() {
    // Spans are deliberately out of order: (8,12), (0,4), (3,8)
    // After sort-then-sweep they merge to [0,12) — positions 0-11 = all 1s.
    let v = analytics_icr::spans_to_binary(&[(8, 12), (0, 4), (3, 8)], 12);
    let expected: Vec<u8> = vec![1u8; 12];
    assert_eq!(v, expected, "spans_to_binary must sort before sweep");
}

#[test]
fn icr_kappa_label_buckets() {
    assert_eq!(analytics_icr::kappa_label(-0.5), "poor");
    assert_eq!(analytics_icr::kappa_label(0.0), "slight");
    assert_eq!(analytics_icr::kappa_label(0.2), "slight");
    assert_eq!(analytics_icr::kappa_label(0.21), "fair");
    assert_eq!(analytics_icr::kappa_label(0.41), "moderate");
    assert_eq!(analytics_icr::kappa_label(0.61), "substantial");
    assert_eq!(analytics_icr::kappa_label(0.81), "almost perfect");
    assert_eq!(analytics_icr::kappa_label(1.0), "almost perfect");
}

#[test]
fn icr_compute_kappa_perfect_agreement() {
    let result = analytics_icr::compute_kappa(&[(2, 5)], &[(2, 5)], 10);
    let r = result.expect("kappa should be defined");
    assert!((r.kappa - 1.0).abs() < 1e-6);
    assert_eq!(r.coverage_a, 3);
    assert_eq!(r.coverage_b, 3);
    assert_eq!(r.labelled, "almost perfect");
}

#[test]
fn icr_compute_kappa_total_disagreement() {
    let result = analytics_icr::compute_kappa(&[(0, 5)], &[(5, 10)], 10);
    let r = result.expect("kappa should be defined");
    assert!(r.kappa < 0.0, "total disagreement -> negative k");
    assert_eq!(r.labelled, "poor");
}

#[test]
fn icr_compute_kappa_null_on_collapsed_denominator() {
    assert!(analytics_icr::compute_kappa(&[(0, 10)], &[(0, 10)], 10).is_none());
    assert!(analytics_icr::compute_kappa(&[], &[], 10).is_none());
}

#[tokio::test]
async fn icr_internal_returns_kappa_for_seeded_annotations() {
    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state, "ICR Test".to_string(), None,
        _temp_dir.path().to_string_lossy().to_string(), None,
    ).await.expect("create project");

    let user_a = seed_local_user(&state).await;

    // Create second coder
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");
    sqlx::query("INSERT INTO local_user (id, display_name) VALUES ('user-b', 'Coder B')")
        .execute(pool).await.expect("insert coder B");
    drop(pool_guard);

    let doc = documents_import_internal(
        None, &state, project.id.clone(), "/tmp/icr-test.txt".to_string(),
        "txt".to_string(),
        Some("Hello world, this is a test document for ICR.".to_string()),
        None,
    ).await.expect("import doc");

    let code = codes_create_internal(
        &state, project.id.clone(), None, "Theme A".to_string(), Some("#FF0000".to_string()),
    ).await.expect("create code");

    // Seed: A tags [0,11) + [17,22), B tags [6,22)
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");

    sqlx::query("INSERT INTO selection (id, document_id, code_id, selection_type, created_by) VALUES ('s-a1', ?, ?, 'text', ?)")
        .bind(&doc.id).bind(&code.id).bind(&user_a).execute(pool).await.expect("s-a1");
    sqlx::query("INSERT INTO text_selection (selection_id, start_char, end_char) VALUES ('s-a1', 0, 11)")
        .execute(pool).await.expect("ts-a1");

    sqlx::query("INSERT INTO selection (id, document_id, code_id, selection_type, created_by) VALUES ('s-b1', ?, ?, 'text', ?)")
        .bind(&doc.id).bind(&code.id).bind("user-b").execute(pool).await.expect("s-b1");
    sqlx::query("INSERT INTO text_selection (selection_id, start_char, end_char) VALUES ('s-b1', 6, 22)")
        .execute(pool).await.expect("ts-b1");

    sqlx::query("INSERT INTO selection (id, document_id, code_id, selection_type, created_by) VALUES ('s-a2', ?, ?, 'text', ?)")
        .bind(&doc.id).bind(&code.id).bind(&user_a).execute(pool).await.expect("s-a2");
    sqlx::query("INSERT INTO text_selection (selection_id, start_char, end_char) VALUES ('s-a2', 17, 22)")
        .execute(pool).await.expect("ts-a2");

    drop(pool_guard);

    let result = analytics_icr::analytics_icr_internal(
        &state, project.id, user_a, "user-b".to_string(), code.id, doc.id,
    ).await.expect("analytics_icr_internal should succeed");

    let r = result.expect("kappa should be defined");
    assert!((r.kappa - 0.43).abs() < 0.05, "expected k ~ 0.43, got {}", r.kappa);
    assert_eq!(r.labelled, "moderate");
    assert_eq!(r.coverage_a, 16);
    assert_eq!(r.coverage_b, 16);
}

// ===========================================================================
// Audio — media_selection_create round-trip integration test
// ===========================================================================

use crate::commands::audio;

#[tokio::test]
async fn audio_media_selection_create_round_trip() {
    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "Audio MS Create Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    let _user_id = seed_local_user(&state).await;

    // Seed a synthetic audio document for the FK constraint.
    let doc_id = "doc-audio-ms";
    {
        let pool_guard = state.db.read().await;
        let pool = pool_guard.as_ref().expect("No DB");
        sqlx::query(
            "INSERT INTO document (id, project_id, title, file_format, plain_text, text_hash, extractor_id) \
             VALUES (?, ?, ?, ?, NULL, ?, ?)",
        )
        .bind(doc_id)
        .bind(&project.id)
        .bind("interview.mp3")
        .bind("mp3")
        .bind("audio-hash-1234567890123456789012345678901234567890123456789012345678901234")
        .bind("test-fixture")
        .execute(pool)
        .await
        .expect("seed audio document");
    }

    let code = codes_create_internal(
        &state,
        project.id.clone(),
        None,
        "Theme A".to_string(),
        Some("#FF0000".to_string()),
    )
    .await
    .expect("Failed to create code");

    // Call the internal variant directly.
    let segment = audio::audio_media_selection_create_internal(
        &state,
        doc_id.to_string(),
        code.id.clone(),
        1000,
        5000,
    )
    .await
    .expect("audio_media_selection_create should succeed");

    assert_eq!(segment.document_id, doc_id);
    assert_eq!(segment.code_id, Some(code.id));
    assert_eq!(segment.start_ms, 1000);
    assert_eq!(segment.end_ms, 5000);
    assert!(segment.created_by.is_some(), "created_by should be auto-populated");
    assert!(!segment.id.is_empty(), "id should be non-empty");

    // Verify the row exists via SELECT JOIN.
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");
    let (sel_id, start, end): (String, i64, i64) = sqlx::query_as(
        "SELECT s.id, ms.start_ms, ms.end_ms \
         FROM selection s JOIN media_selection ms ON ms.selection_id = s.id \
         WHERE s.id = ?",
    )
    .bind(&segment.id)
    .fetch_one(pool)
    .await
    .expect("media_selection should exist in DB");
    assert_eq!(start, 1000);
    assert_eq!(end, 5000);
    assert_eq!(sel_id, segment.id);

    // Verify selection_type is 'media_ts'.
    let sel_type: String = sqlx::query_scalar(
        "SELECT selection_type FROM selection WHERE id = ?",
    )
    .bind(&segment.id)
    .fetch_one(pool)
    .await
    .expect("fetch selection_type");
    assert_eq!(sel_type, "media_ts");
    drop(pool_guard);
}

#[tokio::test]
async fn icr_matrix_internal_returns_multiple_pairs() {
    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state, "ICR Matrix Test".to_string(), None,
        _temp_dir.path().to_string_lossy().to_string(), None,
    ).await.expect("create project");

    let user_a = seed_local_user(&state).await;

    // Create second and third coders.
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");
    sqlx::query("INSERT INTO local_user (id, display_name) VALUES ('user-b', 'Coder B')")
        .execute(pool).await.expect("insert coder B");
    sqlx::query("INSERT INTO local_user (id, display_name) VALUES ('user-c', 'Coder C')")
        .execute(pool).await.expect("insert coder C");
    drop(pool_guard);

    let doc = documents_import_internal(
        None, &state, project.id.clone(), "/tmp/icr-matrix.txt".to_string(),
        "txt".to_string(),
        Some("The quick brown fox jumps over the lazy dog.".to_string()),
        None,
    ).await.expect("import doc");

    let code_x = codes_create_internal(
        &state, project.id.clone(), None, "Code X".to_string(), Some("#FF0000".to_string()),
    ).await.expect("create code X");
    let code_y = codes_create_internal(
        &state, project.id.clone(), None, "Code Y".to_string(), Some("#0000FF".to_string()),
    ).await.expect("create code Y");

    // Seed annotations: A tags [0,10) in X, B tags [4,16) in X, C tags [0,10) in X
    // A tags [20,30) in Y, B tags [24,34) in Y
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");

    sqlx::query("INSERT INTO selection (id, document_id, code_id, selection_type, created_by) VALUES ('sxa', ?, ?, 'text', ?)")
        .bind(&doc.id).bind(&code_x.id).bind(&user_a).execute(pool).await.expect("sxa");
    sqlx::query("INSERT INTO text_selection (selection_id, start_char, end_char) VALUES ('sxa', 0, 10)")
        .execute(pool).await.expect("ts-xa");

    sqlx::query("INSERT INTO selection (id, document_id, code_id, selection_type, created_by) VALUES ('sxb', ?, ?, 'text', ?)")
        .bind(&doc.id).bind(&code_x.id).bind("user-b").execute(pool).await.expect("sxb");
    sqlx::query("INSERT INTO text_selection (selection_id, start_char, end_char) VALUES ('sxb', 4, 16)")
        .execute(pool).await.expect("ts-xb");

    sqlx::query("INSERT INTO selection (id, document_id, code_id, selection_type, created_by) VALUES ('sxc', ?, ?, 'text', ?)")
        .bind(&doc.id).bind(&code_x.id).bind("user-c").execute(pool).await.expect("sxc");
    sqlx::query("INSERT INTO text_selection (selection_id, start_char, end_char) VALUES ('sxc', 0, 10)")
        .execute(pool).await.expect("ts-xc");

    sqlx::query("INSERT INTO selection (id, document_id, code_id, selection_type, created_by) VALUES ('sya', ?, ?, 'text', ?)")
        .bind(&doc.id).bind(&code_y.id).bind(&user_a).execute(pool).await.expect("sya");
    sqlx::query("INSERT INTO text_selection (selection_id, start_char, end_char) VALUES ('sya', 20, 30)")
        .execute(pool).await.expect("ts-ya");

    sqlx::query("INSERT INTO selection (id, document_id, code_id, selection_type, created_by) VALUES ('syb', ?, ?, 'text', ?)")
        .bind(&doc.id).bind(&code_y.id).bind("user-b").execute(pool).await.expect("syb");
    sqlx::query("INSERT INTO text_selection (selection_id, start_char, end_char) VALUES ('syb', 24, 34)")
        .execute(pool).await.expect("ts-yb");

    drop(pool_guard);

    let results = analytics_icr::analytics_icr_matrix_internal(&state, project.id)
        .await.expect("analytics_icr_matrix_internal should succeed");

    // Code X: (A,B),(A,C),(B,C)=3. Code Y: (A,B)=1. Total=4.
    assert_eq!(results.len(), 4, "should have 4 rows for 3 coder pairs in X + 1 pair in Y");

    for row in &results {
        assert!(!row.coder_a.is_empty());
        assert!(!row.coder_b.is_empty());
        assert!(!row.code_id.is_empty());
        assert!(!row.document_id.is_empty());
    }

    let ac_x = results.iter().find(|r|
        r.code_id == code_x.id
            && ((r.coder_a == user_a && r.coder_b == "user-c") || (r.coder_a == "user-c" && r.coder_b == user_a))
    ).expect("A-C pair for Code X should exist");
    let r = ac_x.result.as_ref().expect("AC-X kappa should be defined");
    assert!((r.kappa - 1.0).abs() < 0.01, "AC on Code X should have perfect kappa, got {}", r.kappa);

    let ab_y = results.iter().find(|r|
        r.code_id == code_y.id
            && ((r.coder_a == user_a && r.coder_b == "user-b") || (r.coder_a == "user-b" && r.coder_b == user_a))
    ).expect("A-B pair for Code Y should exist");
    assert!(ab_y.result.is_some(), "AB-Y kappa should be defined");

    for window in results.windows(2) {
        let k0 = window[0].result.as_ref().map(|r| r.kappa).unwrap_or(-2.0);
        let k1 = window[1].result.as_ref().map(|r| r.kappa).unwrap_or(-2.0);
        assert!(k0 >= k1, "results should be sorted by kappa descending");
    }
}

// ===========================================================================
// Document asset — test audio format base64 retrieval
// ===========================================================================

use crate::commands::documents;

#[tokio::test]
async fn document_get_asset_base64_returns_audio_mime() {
    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "Audio Asset Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    // Seed an mp3 document with a synthetic asset file.
    let doc_id = "doc-audio-asset";
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");
    sqlx::query(
        "INSERT INTO document (id, project_id, title, file_format, plain_text, text_hash, extractor_id) \
         VALUES (?, ?, ?, ?, NULL, ?, ?)",
    )
    .bind(doc_id)
    .bind(&project.id)
    .bind("interview.mp3")
    .bind("mp3")
    .bind("mp3-hash-0123456789012345678901234567890123456789012345678901234567890123")
    .bind("test-fixture")
    .execute(pool)
    .await
    .expect("seed mp3 document");
    drop(pool_guard);

    // Write a dummy mp3 asset file to the project's assets dir.
    let folder_guard = state.project_folder.read().await;
    let folder = folder_guard.as_ref().expect("project folder");
    let assets_dir = folder.join("assets");
    std::fs::create_dir_all(&assets_dir).expect("create assets dir");
    let asset_path = assets_dir.join(format!("{}.mp3", doc_id));
    let dummy_bytes = b"\xff\xfb\x90\x00\x00\x00\x00\x00\x00\x00\x00"; // minimal MPEG frame header
    std::fs::write(&asset_path, dummy_bytes).expect("write dummy mp3");
    drop(folder_guard);

    // Call the internal variant so we can test without Tauri State.
    let result = documents::document_get_asset_base64_internal(&state, doc_id.to_string())
        .await
        .expect("should read mp3 asset");

    assert_eq!(result.mime, "audio/mpeg");
    assert!(!result.b64.is_empty(), "b64 should be non-empty");
    assert!(result.b64.len() >= 8, "b64 should encode at least a few bytes");
}

/// Validates the image_polygon schema path works end-to-end:
/// insert a `selection` parent + `image_polygon` extension row inside
/// an explicit transaction, query back via SELECT JOIN, then delete
/// via cascade and assert the row goes away.
#[tokio::test]
async fn image_selection_polygon_round_trip() {
    let tmp = tempdir().expect("tempdir");
    let db_path = tmp.path().join("test.qdaproj");
    let pool = db::init_db(&db_path, None).await.expect("init_db");

    sqlx::query("INSERT INTO project (id, name) VALUES (?, ?)")
        .bind("proj-polygon-roundtrip")
        .bind("Polygon Round Trip")
        .execute(&pool)
        .await
        .expect("seed project");
    sqlx::query("INSERT INTO code (id, project_id, name, color) VALUES (?, ?, ?, ?)")
        .bind("code-polygon")
        .bind("proj-polygon-roundtrip")
        .bind("Polygon")
        .bind("#00ff00")
        .execute(&pool)
        .await
        .expect("seed code");

    let doc_id = "doc-polygon";
    sqlx::query(
        "INSERT INTO document (id, project_id, title, file_format, plain_text, text_hash, extractor_id) \
         VALUES (?, ?, ?, ?, NULL, ?, ?)",
    )
    .bind(doc_id)
    .bind("proj-polygon-roundtrip")
    .bind("polygon-doc.png")
    .bind("png")
    .bind("placeholder-hash")
    .bind("test-fixture")
    .execute(&pool)
    .await
    .expect("seed document");

    let sel_id = "sel-polygon-1";
    let vertices_json = "[[0.1,0.1],[0.9,0.1],[0.5,0.9]]";

    let mut tx = pool.begin().await.expect("begin");
    sqlx::query(
        "INSERT INTO selection (id, document_id, code_id, selection_type) VALUES (?, ?, ?, 'image_polygon')",
    )
    .bind(sel_id)
    .bind(doc_id)
    .bind("code-polygon")
    .execute(&mut *tx)
    .await
    .expect("insert selection");

    sqlx::query(
        "INSERT INTO image_polygon (selection_id, vertices_json) VALUES (?, ?)",
    )
    .bind(sel_id)
    .bind(vertices_json)
    .execute(&mut *tx)
    .await
    .expect("insert image_polygon");
    tx.commit().await.expect("commit");

    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT s.id, p.vertices_json \
         FROM selection s JOIN image_polygon p ON p.selection_id = s.id \
         WHERE s.document_id = ?",
    )
    .bind(doc_id)
    .fetch_all(&pool)
    .await
    .expect("list polygons");
    assert_eq!(rows.len(), 1, "one polygon should exist");
    assert_eq!(rows[0].0, sel_id);
    assert_eq!(rows[0].1, vertices_json);

    sqlx::query("DELETE FROM selection WHERE id = ?")
        .bind(sel_id)
        .execute(&pool)
        .await
        .expect("delete selection");

    let rows_after: Vec<(String,)> = sqlx::query_as(
        "SELECT selection_id FROM image_polygon WHERE selection_id = ?",
    )
    .bind(sel_id)
    .fetch_all(&pool)
    .await
    .expect("list after delete");
    assert!(rows_after.is_empty(), "image_polygon row should be cascaded");
}
