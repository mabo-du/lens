use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::path::{Component, Path, PathBuf};
use tauri::{command, AppHandle, State};
use tokio::sync::RwLock;
use uuid::Uuid;

pub struct AppState {
    pub db: RwLock<Option<SqlitePool>>,
    pub project_folder: RwLock<Option<PathBuf>>,
    pub encryption_key: RwLock<Option<String>>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    #[sqlx(rename = "createdAt")]
    pub created_at: String,
    #[sqlx(rename = "updatedAt")]
    pub updated_at: String,
}

/// Auto-create a `local_user` row if the table is empty. This guarantees
/// the export path never encounters the "no local_user" fallback, which would
/// produce an empty GUID (`""`) — invalid per REFI-QDA `Projects.xsd`.
///
/// Uses an atomic `INSERT ... WHERE NOT EXISTS` to avoid a TOCTOU race
/// between two concurrent callers (e.g., rapid `projects_open` calls
/// on the same DB).
async fn ensure_local_user_exists(pool: &sqlx::SqlitePool) -> Result<(), String> {
    let user_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO local_user (id, display_name) \
         SELECT ?, ? \
         WHERE NOT EXISTS (SELECT 1 FROM local_user)",
    )
    .bind(&user_id)
    .bind("Local User")
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create local_user: {}", e))?;

    Ok(())
}

fn validate_project_name(name: &str) -> Result<(), String> {
    // Reject empty and overlong names
    if name.is_empty() {
        return Err("Project name must not be empty".to_string());
    }
    if name.len() > 64 {
        return Err("Project name must be 64 characters or fewer".to_string());
    }

    // Reject absolute paths (POSIX /foo and Windows C:\foo)
    if Path::new(name).is_absolute() {
        return Err("Project name must not be an absolute path".to_string());
    }

    // Reject path traversal segments
    for segment in Path::new(name).components() {
        match segment {
            Component::ParentDir | Component::CurDir => {
                return Err(format!(
                    "Project name must not contain '{}'",
                    segment.as_os_str().to_string_lossy()
                ));
            }
            _ => {}
        }
    }

    // Reject invalid characters (allow alphanumeric, space, dot, underscore, hyphen)
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == '.' || c == '_' || c == '-')
    {
        return Err(
            "Project name contains invalid characters. Allowed: A-Z, a-z, 0-9, space, dot, underscore, hyphen".to_string()
        );
    }

    Ok(())
}

pub async fn projects_create_internal(
    state: &AppState,
    name: String,
    description: Option<String>,
    target_dir: String,
    encryption_key: Option<String>,
) -> Result<Project, String> {
    validate_project_name(&name)?;

    let mut project_dir = PathBuf::from(&target_dir);
    project_dir.push(&name);

    // Create folder structure
    std::fs::create_dir_all(&project_dir)
        .map_err(|e| format!("Failed to create project directory: {}", e))?;
    let assets_dir = project_dir.join("assets");
    std::fs::create_dir_all(&assets_dir)
        .map_err(|e| format!("Failed to create assets directory: {}", e))?;

    // Write .encrypted flag file if encryption is enabled
    if encryption_key.is_some() {
        let flag_path = project_dir.join(".encrypted");
        std::fs::write(&flag_path, "1")
            .map_err(|e| format!("Failed to write encryption flag: {}", e))?;
    }

    let db_path = project_dir.join("project.qdaproj");

    // Initialize DB and run migrations
    let pool = crate::db::init_db(&db_path, encryption_key.as_deref()).await?;
    *state.encryption_key.write().await = encryption_key;

    let id = Uuid::new_v4().to_string();

    // Create project row
    sqlx::query("INSERT INTO project (id, name, description) VALUES (?, ?, ?)")
        .bind(&id)
        .bind(&name)
        .bind(&description)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to insert project: {}", e))?;

    // Guarantee a local_user row exists — the export path requires a
    // non-empty GUID per REFI-QDA Projects.xsd.
    ensure_local_user_exists(&pool).await?;

    let project = sqlx::query_as::<_, Project>(
        "SELECT id, name, description, created_at as createdAt, updated_at as updatedAt FROM project WHERE id = ?"
    )
    .bind(&id)
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("Failed to fetch created project: {}", e))?;

    // Update global state
    *state.db.write().await = Some(pool);
    *state.project_folder.write().await = Some(project_dir);

    Ok(project)
}

#[command]
pub async fn projects_create(
    _app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
    target_dir: String,
    encryption_key: Option<String>,
) -> Result<Project, String> {
    projects_create_internal(&state, name, description, target_dir, encryption_key).await
}

#[command]
pub async fn projects_open(
    _app: AppHandle,
    state: State<'_, AppState>,
    project_dir: String,
    encryption_key: Option<String>,
) -> Result<Project, String> {
    let project_path = PathBuf::from(&project_dir);
    let db_path = project_path.join("project.qdaproj");
    if !db_path.exists() {
        return Err("Project database not found".to_string());
    }

    let pool = crate::db::init_db(&db_path, encryption_key.as_deref()).await?;
    *state.encryption_key.write().await = encryption_key;

    // Auto-create local_user if missing (handles projects created before
    // the §1.5 fix landed).
    ensure_local_user_exists(&pool).await?;

    // We assume there's only one project row in the database per .qdaproj file
    let project = sqlx::query_as::<_, Project>(
        "SELECT id, name, description, created_at as createdAt, updated_at as updatedAt FROM project LIMIT 1"
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("Failed to read project metadata: {}", e))?;

    *state.db.write().await = Some(pool);
    let folder = db_path
        .parent()
        .ok_or("Invalid project path (cannot determine parent directory)")?
        .to_path_buf();
    *state.project_folder.write().await = Some(folder);

    Ok(project)
}

/// Check if a project directory has encryption enabled (.encrypted flag file).
#[command]
pub async fn projects_is_encrypted(project_dir: String) -> Result<bool, String> {
    let flag_path = PathBuf::from(&project_dir).join(".encrypted");
    Ok(flag_path.exists())
}

#[command]
pub async fn projects_rename(
    _app: AppHandle,
    state: State<'_, AppState>,
    name: String,
) -> Result<Project, String> {
    validate_project_name(&name)?;

    let pool = state.db.read().await;
    let pool = pool.as_ref().ok_or("No project open")?;

    // Get current project
    let project = sqlx::query_as::<_, Project>(
        "SELECT id, name, description, created_at as createdAt, updated_at as updatedAt FROM project LIMIT 1"
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to read project: {}", e))?;

    // Update name
    sqlx::query("UPDATE project SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?")
        .bind(&name)
        .bind(&project.id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to rename project: {}", e))?;

    // Return updated project
    let updated = sqlx::query_as::<_, Project>(
        "SELECT id, name, description, created_at as createdAt, updated_at as updatedAt FROM project WHERE id = ?"
    )
    .bind(&project.id)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to read project: {}", e))?;

    Ok(updated)
}

#[command]
pub async fn local_user_get_name(state: State<'_, AppState>) -> Result<String, String> {
    let pool = state.db.read().await;
    let pool = pool.as_ref().ok_or("No project open")?;
    let (name,): (String,) =
        sqlx::query_as("SELECT display_name FROM local_user LIMIT 1")
            .fetch_one(pool)
            .await
            .map_err(|e| format!("Failed to read local_user: {}", e))?;
    Ok(name)
}

#[command]
pub async fn local_user_update_name(
    _app: AppHandle,
    state: State<'_, AppState>,
    name: String,
) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Display name must not be empty".to_string());
    }
    if trimmed.len() > 64 {
        return Err("Display name must be 64 characters or fewer".to_string());
    }
    let pool = state.db.read().await;
    let pool = pool.as_ref().ok_or("No project open")?;
    sqlx::query("UPDATE local_user SET display_name = ?")
        .bind(trimmed)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to update display name: {}", e))?;
    Ok(())
}

#[command]
pub async fn projects_close(state: State<'_, AppState>) -> Result<(), String> {
    *state.db.write().await = None;
    *state.project_folder.write().await = None;
    *state.encryption_key.write().await = None;
    Ok(())
}
