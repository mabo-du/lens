use crate::commands::annotations::annotations_create_internal;
use crate::commands::codes::codes_create_internal;
use crate::commands::export::export_prepare_internal;
use crate::commands::import::documents_import_internal;
use crate::commands::projects::projects_create_internal;
use crate::test_helpers::{seed_local_user, setup_test_state};

#[tokio::test]
async fn happy_path_create_project_import_document_code_and_annotation() {
    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "Test Project".to_string(),
        Some("A test project".to_string()),
        _temp_dir.path().to_string_lossy().to_string(),
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

    let ann = annotations_create_internal(
        &state,
        doc.id.clone(),
        code.id.clone(),
        0,
        5,
    )
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
         WHERE s.id = ?"
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
    )
    .await
    .expect("Failed to create project");

    let _user_id = seed_local_user(&state).await;

    // Create a code so the export queries the code table
    let _code = codes_create_internal(
        &state,
        project.id.clone(),
        None,
        "Export Code".to_string(),
        Some("#00FF00".to_string()),
    )
    .await
    .expect("Failed to create code");

    // Create a project journal memo so the memo query is exercised
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");
    sqlx::query(
        "INSERT INTO memo (id, project_id, body) VALUES (?, ?, ?)"
    )
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

    let payload = result
        .expect("export_prepare should succeed after P0.3/P0.4 fixes");

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

// ---------------------------------------------------------------------------
// Regression tests for P1 bugs (currently document broken behaviour)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn codes_delete_cascades_to_children() {
    use crate::commands::codes::codes_delete_internal;

    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "Cascade Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
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

    // Delete the parent
    codes_delete_internal(&state, parent.id.clone())
        .await
        .expect("Failed to delete parent");

    // The child should ALSO be deleted (P1.1 fix required)
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");

    let child_exists: Option<i32> = sqlx::query_scalar(
        "SELECT 1 FROM code WHERE id = ?"
    )
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
    let closure_stale: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM code_closure WHERE descendant = ?"
    )
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

    let ann = annotations_create_internal(
        &state,
        doc.id.clone(),
        code.id.clone(),
        0,
        5,
    )
    .await
    .expect("Failed to create annotation");

    // Verify annotation exists before deletion
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");
    let ann_exists: Option<i32> = sqlx::query_scalar(
        "SELECT 1 FROM selection WHERE id = ?"
    )
    .bind(&ann.id)
    .fetch_optional(pool)
    .await
    .expect("Query failed");
    assert!(ann_exists.is_some(), "Annotation should exist before document deletion");
    drop(pool_guard);

    // Delete the document
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
    assert!(ann_exists.is_none(), "Annotation should be cascade-deleted with document");

    // Verify text_selection is also gone
    let ts_exists: Option<i32> = sqlx::query_scalar("SELECT 1 FROM text_selection WHERE selection_id = ?")
        .bind(&ann.id)
        .fetch_optional(pool)
        .await
        .expect("Query failed");
    assert!(ts_exists.is_none(), "text_selection should be cascade-deleted");
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
    assert_eq!(memo.created_by, Some(user_id), "created_by should be populated from local_user");
}

#[tokio::test]
async fn annotations_create_rejects_invalid_ranges() {
    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "Range Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
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
    assert!(err.contains("end_char must be greater than start_char"), "Error: {}", err);

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
    )
    .await
    .expect("Failed to create project");

    // Missing hash
    let err = codes_create_internal(&state, project.id.clone(), None, "Bad".to_string(), Some("6366f1".to_string()))
        .await
        .expect_err("Should reject color without #");
    assert!(err.contains("Invalid color"), "Error: {}", err);

    // Invalid chars
    let err = codes_create_internal(&state, project.id.clone(), None, "Bad".to_string(), Some("#GGGGGG".to_string()))
        .await
        .expect_err("Should reject invalid hex chars");
    assert!(err.contains("Invalid color"), "Error: {}", err);

    // Wrong length
    let err = codes_create_internal(&state, project.id.clone(), None, "Bad".to_string(), Some("#12345".to_string()))
        .await
        .expect_err("Should reject wrong-length color");
    assert!(err.contains("Invalid color"), "Error: {}", err);

    // Valid colors should succeed
    let code = codes_create_internal(&state, project.id.clone(), None, "Good".to_string(), Some("#abc".to_string()))
        .await
        .expect("Valid color #abc should succeed");
    assert_eq!(code.color, "#abc");

    let code = codes_create_internal(&state, project.id.clone(), None, "Good2".to_string(), Some("#6366f1".to_string()))
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

    assert_eq!(payload.local_user.id, user_id, "Should use real local_user ID");
    assert_eq!(payload.local_user.display_name, "Local User", "Should use auto-created display name");
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
    assert_eq!(tree[0].children.len(), 0, "Missing child 'b' should be skipped gracefully");
}

// ---------------------------------------------------------------------------
// Phase 1.2 — Path traversal / project-name validation tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn project_name_rejects_empty() {
    let (state, _temp_dir) = setup_test_state().await;
    let err = projects_create_internal(
        &state,
        "".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
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
    )
    .await
    .expect("Valid project name should succeed");
    assert_eq!(project.name, "My Project 2025");
}

// ---------------------------------------------------------------------------
// Phase 1.5 — Empty GUID / local_user auto-creation tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn local_user_is_auto_created_on_project_create() {
    let (state, _temp_dir) = setup_test_state().await;

    // Create a project — §1.5 guarantees a local_user row is inserted.
    let _project = projects_create_internal(
        &state,
        "User Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
    )
    .await
    .expect("Project creation should succeed");

    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().expect("No DB");

    let (id, display_name): (String, String) = sqlx::query_as(
        "SELECT id, display_name FROM local_user LIMIT 1"
    )
    .fetch_one(pool)
    .await
    .expect("local_user should exist after project creation");

    // Verify a valid UUID was generated.
    assert!(
        uuid::Uuid::parse_str(&id).is_ok(),
        "local_user id should be a valid UUID, got: {}",
        id
    );
    assert_eq!(display_name, "Local User", "Default display name should be 'Local User'");
}

#[tokio::test]
async fn local_user_auto_created_before_export() {
    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "Export GUID Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
    )
    .await
    .expect("Project creation should succeed");

    // Export without explicitly seeding local_user — the project creation
    // should have auto-created it.
    let payload = export_prepare_internal(&state, project.id.clone())
        .await
        .expect("Export should succeed without manual local_user seeding");

    // The GUID must be a valid non-empty UUID.
    assert!(!payload.local_user.id.is_empty(), "local_user.id must not be empty");
    assert!(
        uuid::Uuid::parse_str(&payload.local_user.id).is_ok(),
        "Exported local_user.id should be a valid UUID, got: {}",
        payload.local_user.id
    );
}
