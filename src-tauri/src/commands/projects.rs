use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, State, command};
use tokio::sync::RwLock;
use uuid::Uuid;
use std::path::{Component, Path, PathBuf};

pub struct AppState {
    pub db: RwLock<Option<SqlitePool>>,
    pub project_folder: RwLock<Option<PathBuf>>,
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
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == '.' || c == '_' || c == '-') {
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
) -> Result<Project, String> {
    validate_project_name(&name)?;

    let mut project_dir = PathBuf::from(&target_dir);
    project_dir.push(&name);

    // Create folder structure
    std::fs::create_dir_all(&project_dir).map_err(|e| format!("Failed to create project directory: {}", e))?;
    let assets_dir = project_dir.join("assets");
    std::fs::create_dir_all(&assets_dir).map_err(|e| format!("Failed to create assets directory: {}", e))?;

    let db_path = project_dir.join("project.qdaproj");

    // Initialize DB and run migrations
    let pool = crate::db::init_db(&db_path).await?;

    let id = Uuid::new_v4().to_string();

    // Create project row
    sqlx::query(
        "INSERT INTO project (id, name, description) VALUES (?, ?, ?)"
    )
    .bind(&id)
    .bind(&name)
    .bind(&description)
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to insert project: {}", e))?;

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
) -> Result<Project, String> {
    projects_create_internal(&state, name, description, target_dir).await
}

#[command]
pub async fn projects_open(
    app: AppHandle,
    state: State<'_, AppState>,
    project_dir: String,
) -> Result<Project, String> {
    let db_path = PathBuf::from(&project_dir).join("project.qdaproj");
    if !db_path.exists() {
        return Err("Project database not found".to_string());
    }
    
    let pool = crate::db::init_db(&db_path).await?;
    
    // We assume there's only one project row in the database per .qdaproj file
    let project = sqlx::query_as::<_, Project>(
        "SELECT id, name, description, created_at as createdAt, updated_at as updatedAt FROM project LIMIT 1"
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("Failed to read project metadata: {}", e))?;
    
    *state.db.write().await = Some(pool);
    let folder = db_path.parent().unwrap().to_path_buf();
    *state.project_folder.write().await = Some(folder);
    
    Ok(project)
}

#[command]
pub async fn projects_close(state: State<'_, AppState>) -> Result<(), String> {
    *state.db.write().await = None;
    *state.project_folder.write().await = None;
    Ok(())
}
