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

    // Delete the parent
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

// ---------------------------------------------------------------------------
// Phase 2.1 — Closure-table invariant test
// ---------------------------------------------------------------------------

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

    // Create new root X, move B under it
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

// ---------------------------------------------------------------------------
// Phase 4.8 — REFI-QDA .qdpx import integration tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn qdpx_import_merge_mode_imports_documents_codes_and_annotations() {
    use crate::commands::qdpx_import::qdpx_import_internal;
    use std::io::Write;

    let (state, _temp_dir) = setup_test_state().await;

    let project = projects_create_internal(
        &state,
        "QDPX Merge Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    // Build a minimal .qdpx ZIP fixture
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

    // Import
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

    // Build the same .qdpx fixture
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

    // Import in replace mode
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

    // Build the .qdpx fixture
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

    // Import in merge mode
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

    let project = projects_create_internal(
        &state,
        "QDPX Missing QDE Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    // Build a ZIP without project.qde
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

    let project = projects_create_internal(
        &state,
        "QDPX Bad XML Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    // Build a ZIP with malformed XML
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

    let project = projects_create_internal(
        &state,
        "QDPX Corrupt ZIP Test".to_string(),
        None,
        _temp_dir.path().to_string_lossy().to_string(),
        None,
    )
    .await
    .expect("Failed to create project");

    // Write a file that is NOT a valid ZIP
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

    // Create a document and code manually first
    let _doc = documents_import_internal(
        None,
        &state,
        project.id.clone(),
        "/tmp/pre-import.txt".to_string(),
        "txt".to_string(),
        Some("This data should survive undo.".to_string()),
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

    // Build a .qdpx fixture for replace import
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
