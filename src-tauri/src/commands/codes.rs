use super::projects::AppState;
use crate::colors;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tauri::{command, State};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Code {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub color: String,
    pub description: Option<String>,
    pub created_by: Option<String>,
    #[sqlx(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeTreeNode {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub color: String,
    pub description: Option<String>,
    pub created_at: String,
    pub children: Vec<CodeTreeNode>,
    pub depth: i32,
}

pub async fn codes_create_internal(
    state: &AppState,
    project_id: String,
    parent_id: Option<String>,
    name: String,
    color: Option<String>,
) -> Result<Code, String> {
    // Input validation
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Code name must not be empty".to_string());
    }
    if name.len() > 128 {
        return Err("Code name must be 128 characters or fewer".to_string());
    }

    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    let color = match color {
        Some(c) => {
            if !colors::is_valid_hex_color(&c) {
                return Err(format!("Invalid color: '{}' (must be #RGB or #RRGGBB)", c));
            }
            c
        }
        None => {
            // Auto-assign the next palette colour based on existing code count
            let count: i32 = sqlx::query_scalar("SELECT COUNT(*) FROM code WHERE project_id = ?")
                .bind(&project_id)
                .fetch_one(pool)
                .await
                .map_err(|e| e.to_string())?;
            colors::COLORS[count as usize % colors::COLORS.len()].to_string()
        }
    };

    let id = Uuid::new_v4().to_string();

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query("INSERT INTO code (id, project_id, name, color) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(&project_id)
        .bind(&name)
        .bind(&color)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to insert code: {}", e))?;

    sqlx::query("INSERT INTO code_closure (ancestor, descendant, depth) VALUES (?, ?, 0)")
        .bind(&id)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to insert self-referencing closure: {}", e))?;

    if let Some(parent) = parent_id {
        sqlx::query(
            "INSERT INTO code_closure (ancestor, descendant, depth)
             SELECT ancestor, ?, depth + 1
             FROM code_closure
             WHERE descendant = ?",
        )
        .bind(&id)
        .bind(&parent)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to insert parent closure rows: {}", e))?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;

    let code = sqlx::query_as::<_, Code>(
        "SELECT id, project_id, name, color, description, created_by, created_at as createdAt FROM code WHERE id = ?"
    )
    .bind(&id)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to fetch created code: {}", e))?;

    Ok(code)
}

#[command]
pub async fn codes_create(
    state: State<'_, AppState>,
    project_id: String,
    parent_id: Option<String>,
    name: String,
    color: Option<String>,
) -> Result<Code, String> {
    codes_create_internal(&state, project_id, parent_id, name, color).await
}

#[command]
pub async fn codes_get_tree(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<CodeTreeNode>, String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    // 1. Fetch all codes for the project
    let codes: Vec<Code> = sqlx::query_as(
        "SELECT id, project_id, name, color, description, created_by, created_at as createdAt FROM code WHERE project_id = ?"
    )
    .bind(&project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // 2. Fetch all parent->child edges (depth=1 rows only)
    let edges: Vec<(String, String)> = sqlx::query_as(
        "SELECT ancestor, descendant FROM code_closure WHERE depth = 1 AND ancestor IN (SELECT id FROM code WHERE project_id = ?)"
    )
    .bind(&project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // 3. Build tree in memory
    Ok(build_tree(codes, edges))
}

pub fn build_tree(codes: Vec<Code>, edges: Vec<(String, String)>) -> Vec<CodeTreeNode> {
    let code_map: HashMap<String, Code> = codes.into_iter().map(|c| (c.id.clone(), c)).collect();
    let mut children_map: HashMap<String, Vec<String>> = HashMap::new();
    let mut all_descendants: HashSet<String> = HashSet::new();

    for (ancestor, descendant) in edges {
        children_map
            .entry(ancestor)
            .or_default()
            .push(descendant.clone());
        all_descendants.insert(descendant);
    }

    let roots: Vec<String> = code_map
        .keys()
        .filter(|id| !all_descendants.contains(*id))
        .cloned()
        .collect();

    fn build_node(
        id: &str,
        depth: i32,
        code_map: &HashMap<String, Code>,
        children_map: &HashMap<String, Vec<String>>,
    ) -> Option<CodeTreeNode> {
        let c = code_map.get(id)?;
        let mut children = Vec::new();
        if let Some(child_ids) = children_map.get(id) {
            for cid in child_ids {
                if let Some(child) = build_node(cid, depth + 1, code_map, children_map) {
                    children.push(child);
                }
            }
        }
        // sort children alphabetically
        children.sort_by(|a, b| a.name.cmp(&b.name));
        Some(CodeTreeNode {
            id: c.id.clone(),
            project_id: c.project_id.clone(),
            name: c.name.clone(),
            color: c.color.clone(),
            description: c.description.clone(),
            created_at: c.created_at.clone(),
            children,
            depth,
        })
    }

    let mut tree = Vec::new();
    for root_id in roots {
        if let Some(node) = build_node(&root_id, 0, &code_map, &children_map) {
            tree.push(node);
        }
    }
    tree.sort_by(|a, b| a.name.cmp(&b.name));

    tree
}

pub async fn codes_move_internal(
    state: &AppState,
    id: String,
    new_parent_id: Option<String>,
) -> Result<(), String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    // Cycle detection: reject if new_parent is the node itself or one of its descendants
    if let Some(ref parent_id) = new_parent_id {
        if parent_id == &id {
            return Err("Cannot move a code into itself".to_string());
        }

        // Verify the parent actually exists
        let parent_exists: Option<i32> = sqlx::query_scalar("SELECT 1 FROM code WHERE id = ?")
            .bind(parent_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
        if parent_exists.is_none() {
            return Err(format!("Parent code {} does not exist", parent_id));
        }

        let is_descendant: Option<i32> =
            sqlx::query_scalar("SELECT 1 FROM code_closure WHERE ancestor = ? AND descendant = ?")
                .bind(&id)
                .bind(parent_id)
                .fetch_optional(pool)
                .await
                .map_err(|e| e.to_string())?;

        if is_descendant.is_some() {
            return Err(
                "Cannot move a code into its own descendant (would create a cycle)".to_string(),
            );
        }
    }

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Step 1: Delete all closure rows where the ancestor is OUTSIDE the subtree
    // but the descendant IS in the subtree (stale parent links)
    sqlx::query(
        "DELETE FROM code_closure
         WHERE descendant IN (SELECT descendant FROM code_closure WHERE ancestor = ?)
           AND ancestor NOT IN (SELECT descendant FROM code_closure WHERE ancestor = ?)",
    )
    .bind(&id)
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to delete stale closure rows: {}", e))?;

    // Step 2: Re-insert links if new_parent_id is Some
    if let Some(parent_id) = new_parent_id {
        sqlx::query(
            "INSERT INTO code_closure (ancestor, descendant, depth)
             SELECT p.ancestor, s.descendant, p.depth + s.depth + 1
             FROM code_closure p
             CROSS JOIN code_closure s
             WHERE p.descendant = ? AND s.ancestor = ?",
        )
        .bind(&parent_id)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to insert new closure rows: {}", e))?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn codes_move(
    state: State<'_, AppState>,
    id: String,
    new_parent_id: Option<String>,
) -> Result<(), String> {
    codes_move_internal(&state, id, new_parent_id).await
}

#[command]
pub async fn codes_update(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    color: Option<String>,
    description: Option<String>,
) -> Result<Code, String> {
    // Input validation
    let name = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
    if let Some(ref n) = name {
        if n.len() > 128 {
            return Err("Code name must be 128 characters or fewer".to_string());
        }
    }
    if let Some(ref d) = description {
        if d.len() > 2000 {
            return Err("Code description must be 2000 characters or fewer".to_string());
        }
    }

    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    if let Some(n) = &name {
        sqlx::query("UPDATE code SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?")
            .bind(n)
            .bind(&id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(c) = &color {
        if !colors::is_valid_hex_color(c) {
            return Err(format!("Invalid color: '{}' (must be #RGB or #RRGGBB)", c));
        }
        sqlx::query("UPDATE code SET color = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?")
            .bind(c)
            .bind(&id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(d) = &description {
        sqlx::query("UPDATE code SET description = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?")
            .bind(d)
            .bind(&id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;

    let code = sqlx::query_as::<_, Code>(
        "SELECT id, project_id, name, color, description, created_by, created_at as createdAt FROM code WHERE id = ?"
    )
    .bind(&id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(code)
}

pub async fn codes_delete_internal(state: &AppState, id: String) -> Result<(), String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Find all descendants (including the node itself) via the closure table
    let descendants: Vec<String> =
        sqlx::query_scalar("SELECT descendant FROM code_closure WHERE ancestor = ?")
            .bind(&id)
            .fetch_all(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

    if descendants.is_empty() {
        return Err(format!("Code {} not found", id));
    }

    let mut query_builder = sqlx::QueryBuilder::new("DELETE FROM code WHERE id IN (");
    let mut separated = query_builder.separated(", ");
    for d in &descendants {
        separated.push_bind(d);
    }
    separated.push_unseparated(");");
    query_builder
        .build()
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to delete codes: {}", e))?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(())
}

#[command]
pub async fn codes_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    codes_delete_internal(&state, id).await
}

pub async fn codes_get_subtree_internal(
    state: &AppState,
    id: String,
) -> Result<Vec<CodeTreeNode>, String> {
    let pool_guard = state.db.read().await;
    let pool = pool_guard.as_ref().ok_or("No project open")?;

    // Find all codes in the subtree (descendants of id, plus id itself)
    let code_ids: Vec<String> =
        sqlx::query_scalar("SELECT descendant FROM code_closure WHERE ancestor = ?")
            .bind(&id)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

    if code_ids.is_empty() {
        return Err(format!("Code {} not found", id));
    }

    // Fetch the codes themselves using QueryBuilder for dynamic IN clause
    let mut query_builder = sqlx::QueryBuilder::new(
        "SELECT id, project_id, name, color, description, created_by, created_at as createdAt
         FROM code WHERE id IN (",
    );
    let mut separated = query_builder.separated(", ");
    for cid in &code_ids {
        separated.push_bind(cid);
    }
    separated.push_unseparated(")");
    let codes: Vec<Code> = query_builder
        .build_query_as()
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    // Fetch edges ONLY within the subtree (depth=1, both ancestor and descendant in subtree)
    let edges: Vec<(String, String)> = sqlx::query_as(
        "SELECT ancestor, descendant FROM code_closure
         WHERE depth = 1
           AND ancestor IN (SELECT descendant FROM code_closure WHERE ancestor = ?)
           AND descendant IN (SELECT descendant FROM code_closure WHERE ancestor = ?)",
    )
    .bind(&id)
    .bind(&id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(build_tree(codes, edges))
}

#[command]
pub async fn codes_get_subtree(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<CodeTreeNode>, String> {
    codes_get_subtree_internal(&state, id).await
}
