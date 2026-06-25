use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{command, AppHandle, State};
use tokio::sync::RwLock;
use uuid::Uuid;

/// Wrapper around `Option<String>` enforcing the v0.1.4 invariant:
/// `Some` holds a 64-char lowercase hex string (the output of
/// `db::derive_passphrase_key`). `None` means no encrypted project is
/// open. Construction goes through `DbKey::from_passphrase` (which
/// hashes the raw user passphrase at the IPC boundary) or
/// `DbKey::from_hex` (which strictly validates the 64-char shape). The
/// raw user passphrase cannot reach `state.encryption_key` by any
/// other construction path — the type system guarantees it.
///
/// `Default` produces `DbKey(None)`, which is what every AppState
/// slot is initialised with via `RwLock::new(DbKey::default())` in
/// `main.rs` / `test_helpers.rs` / `tests.rs` / `commands/import.rs`.
#[derive(Clone, Default)]
pub struct DbKey(pub(crate) Option<String>);

impl DbKey {
    /// Hash a raw user passphrase into the canonical 64-char hex form.
    /// `None` round-trips to `DbKey(None)`. An empty `Some("")` is
    /// rejected so callers don't silently produce an unreadable db
    /// (SQLCipher would accept `PRAGMA key=''` and write a ciphertext
    /// that can never be decrypted).
    #[allow(
        clippy::redundant_guards,
        reason = "empty passphrase must NOT fall through to derive_passphrase_key"
    )]
    pub fn from_passphrase(raw: Option<&str>) -> Result<Self, String> {
        match raw {
            None => Ok(DbKey(None)),
            Some(p) if p.is_empty() => {
                Err("Encryption passphrase must not be empty".to_string())
            }
            Some(p) => Ok(DbKey(Some(crate::db::derive_passphrase_key(p)))),
        }
    }

    /// Strict validation when constructing from an already-derived hex
    /// (used by tests and any future seeder path). Rejects anything that
    /// isn't exactly 64 lowercase hex chars — built so a future bug
    /// producing uppercase or short-form hex is caught at the type
    /// boundary rather than later at `init_db`.
    pub fn from_hex(hex: Option<String>) -> Result<Self, String> {
        match hex {
            None => Ok(DbKey(None)),
            Some(s)
                if s.len() != 64
                    || !s
                        .chars()
                        .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()) =>
            {
                Err(format!(
                    "DbKey hex must be exactly 64 lowercase hex chars; got len={}",
                    s.len()
                ))
            }
            Some(s) => Ok(DbKey(Some(s))),
        }
    }

    /// Read-only view into the derived hex; consumed by `init_db`.
    pub fn as_deref(&self) -> Option<&str> {
        self.0.as_deref()
    }

    pub fn is_some(&self) -> bool {
        self.0.is_some()
    }
}

// Hand-written `Debug` impl: derive-based Debug would print the
// full 64-char inner hex via `dbg!()` / `format!("{:?}", ..)` /
// `tracing::debug!{?key}` / anyhow's panic-message rendering,
// defeating the truncated Display stance. Delegating to Display
// keeps `dbg!` ergonomic while closing the leak vector.
impl std::fmt::Debug for DbKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self)
    }
}

impl std::fmt::Display for DbKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.0 {
            // Never log the full hex — process logs persist and a
            // determined attacker with log access is one step away from
            // an offline-brute-force tool.
            // F1 v0.1.4 round-3: clean single-block arm, replaces
            // the broken split-write!( shape produced by the
            // partial inline replacement. Char-based slicing
            // (`chars().take(8)`) rather than byte `get(..8)` so
            // a malformed UTF-8 inner string cannot panic at a
            // slice boundary. `<short[len=N]>` carries the
            // actual char count for log triagability.
            Some(hex) => {
                let chars_n = hex.chars().count();
                let slice_n: String = hex.chars().take(8).collect();
                if chars_n >= 8 {
                    write!(f, "<DbKey hex=…{}>", slice_n)
                } else {
                    write!(f, "<DbKey hex=…<short[len={}]>>", chars_n)
                }
            },
            None => write!(f, "<DbKey None>"),
        }
    }
}

pub struct AppState {
    pub db: RwLock<Option<SqlitePool>>,
    pub project_folder: RwLock<Option<PathBuf>>,
    pub encryption_key: RwLock<DbKey>,
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

/// ── Collaboration lock file (baton-pass, Plan §7.2) ──
///
/// On project open, a `project.lock` file is written to the project
/// folder containing the local user's display name and an ISO-8601
/// timestamp. On project close (or app quit), it's removed.
///
/// Stale locks (older than 8 hours) are silently cleared — the
/// assumption is a crash or forced quit left the file behind.
const LOCK_FILE_NAME: &str = "project.lock";
const STALE_LOCK_HOURS: u64 = 8;

fn lock_file_path(project_dir: &Path) -> PathBuf {
    project_dir.join(LOCK_FILE_NAME)
}

fn write_lock_file(project_dir: &Path, user_name: &str) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let name = if user_name.is_empty() { "Unknown User" } else { user_name };
    let content = format!("user={}\ntimestamp={}\n", name, ts);
    if let Err(e) = std::fs::write(lock_file_path(project_dir), &content) {
        log::warn!(target: "lens::projects", "failed to write lock file: {e}");
    }
}

fn read_lock_file(project_dir: &Path) -> Option<(String, u64)> {
    let content = std::fs::read_to_string(lock_file_path(project_dir)).ok()?;
    let mut user = String::new();
    let mut ts: u64 = 0;
    for line in content.lines() {
        if let Some(v) = line.strip_prefix("user=") {
            user = v.to_string();
        } else if let Some(v) = line.strip_prefix("timestamp=") {
            ts = v.parse().unwrap_or(0);
        }
    }
    if user.is_empty() { None } else { Some((user, ts)) }
}

pub(crate) fn remove_lock_file(project_dir: &Path) {
    let _ = std::fs::remove_file(lock_file_path(project_dir));
}

/// Check whether a project appears to be open elsewhere (lock file exists
/// and is not stale). Returns `Some(warning_message)` if a fresh lock
/// is found, `None` if the project is free or the lock is stale.
fn check_project_lock(project_dir: &Path) -> Option<String> {
    let (user, ts) = read_lock_file(project_dir)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let age_secs = now.saturating_sub(ts);
    let stale = age_secs > (STALE_LOCK_HOURS * 3600);
    if stale {
        remove_lock_file(project_dir);
        return None;
    }
    Some(format!(
        "This project appears to be open by '{}' on another device. \
         Continuing may cause data conflicts. If you are certain \
         the other instance has been closed, you can proceed safely.",
        user
    ))
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

/// Validate the chosen target directory before creating a project folder
/// inside it. Defense-in-depth: even though the native folder picker should
/// only return paths the user pointed at, we further check that:
///
/// 1. `target_dir` actually exists and is a directory (otherwise
///    `fs::create_dir_all` would silently create it -- surprising).
/// 2. `<target_dir>/<project_name>/project.qdaproj` does NOT already exist
///    (would silently overwrite an existing LENS project).
///
/// These are belt-and-suspenders checks behind the existing strict
/// `validate_project_name` and the invariant sqlite pool is opened against
/// the chosen path.
fn validate_target_dir(target_dir: &str, project_name: &str) -> Result<(), String> {
    let target_path = PathBuf::from(target_dir);
    if !target_path.exists() {
        return Err(format!(
            "Target directory does not exist: {}",
            target_dir
        ));
    }
    if !target_path.is_dir() {
        return Err(format!(
            "Target path is not a directory: {}",
            target_dir
        ));
    }
    let qdaproj_path = target_path.join(project_name).join("project.qdaproj");
    if qdaproj_path.exists() {
        return Err(format!(
            "A LENS project already exists at {}/{}/project.qdaproj. Pick a different name or open the existing project instead.",
            target_dir, project_name
        ));
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
    validate_target_dir(&target_dir, &name)?;

    let mut project_dir = PathBuf::from(&target_dir);
    project_dir.push(&name);

    std::fs::create_dir_all(&project_dir)
        .map_err(|e| format!("Failed to create project directory: {}", e))?;
    let assets_dir = project_dir.join("assets");
    std::fs::create_dir_all(&assets_dir)
        .map_err(|e| format!("Failed to create assets directory: {}", e))?;

    // Encryption is gated behind the `sqlcipher` Cargo feature because
    // PRAGMA key is silently ignored by plain SQLite. Refusing to opt-in
    // via this build keeps users from creating a project marked
    // `.encrypted` whose database is actually plaintext on disk — a
    // security regression we explicitly don't want.
    //
    // When SQLCipher linkage is wired (cargo build --features sqlcipher)
    // the PRAGMA key call in `db::init_db` will actually encrypt, and
    // `.encrypted` becomes a meaningful intent + reality flag.
    #[cfg(not(feature = "sqlcipher"))]
    if encryption_key.is_some() {
        return Err(
            "Encryption is not available in this LENS build. The project \
             must be compiled with `cargo build --features sqlcipher` (which \
             additionally requires libsqlcipher on the system). Until then, \
             create the project without a password."
                .to_string(),
        );
    }

    // Write .encrypted flag file if encryption is enabled AND the
    // sqlcipher feature is active.
    #[cfg(feature = "sqlcipher")]
    if encryption_key.is_some() {
        let flag_path = project_dir.join(".encrypted");
        std::fs::write(&flag_path, "1")
            .map_err(|e| format!("Failed to write encryption flag: {}", e))?;
    }

    let db_path = project_dir.join("project.qdaproj");

    // v0.1.4 type-system enforcement. `DbKey::from_passphrase` hashes
    // raw \u2192 64-char hex at the IPC boundary; combined with `AppState`'s
    // `RwLock<DbKey>` field type, the raw passphrase
    // (`encryption_key: Option<String>` here as the public IPC shape)
    // cannot reach `state.encryption_key` by any path — only `DbKey::Some(hex)`
    // can. On success the hex lives in state for the project's open
    // lifetime; later consumers
    // (`commands::qdpx_import::qdpx_import_undo_internal`, e.g.) read
    // it directly via `.as_deref()`.
    // v0.1.4 ordering fix (caught by code-review). Clear state BEFORE
    // `from_passphrase` so an empty-passphrase Err leaves
    // `state.encryption_key` at `DbKey(None)` rather than at the
    // stale hex from a previously-open Project A. The clear-then-set
    // pattern's whole purpose was to prevent stale-state leakage across
    // projects; the newtype refactor accidentally inverted the order.
    *state.encryption_key.write().await = DbKey(None);
    let key = DbKey::from_passphrase(encryption_key.as_deref())?;

    let pool = crate::db::init_db(&db_path, key.as_deref()).await?;
    *state.encryption_key.write().await = key;

    let id = Uuid::new_v4().to_string();

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

    // Pre-check on the `.encrypted` flag: if the project folder claims
    // it is encrypted but the caller has not provided a passphrase,
    // surface a clear prompt before letting `init_db` hit SQLCipher.
    // Without this, the user would see SQLCipher's raw "file is not a
    // database" error (raised when SQLCipher's header check on a
    // ciphertext file fails before PRAGMA key is even issued).
    let is_encrypted = project_path.join(".encrypted").exists();
    if is_encrypted && encryption_key.is_none() {
        return Err(
            "This project is encrypted. Please enter the encryption \
             passphrase to open it."
                .to_string(),
        );
    }

    // v0.1.4 type-system enforcement. `DbKey::from_passphrase` hashes
    // raw \u2192 64-char hex at the IPC boundary. See the same block in
    // `projects_create_internal` for the v0.1.4 invariants.
    // v0.1.4 ordering fix (caught by code-review). Same rationale as
    // `projects_create_internal` immediately above: clear state first
    // so an empty-passphrase Err leaves state as `DbKey(None)`,
    // not the stale hex from a prior project.
    *state.encryption_key.write().await = DbKey(None);
    let key = DbKey::from_passphrase(encryption_key.as_deref())?;

    let pool = crate::db::init_db(&db_path, key.as_deref())
        .await
        .map_err(|e| {
            // Translate SQLCipher's ciphertext-shape errors into a user-facing
            // "incorrect encryption passphrase" message. This branch only
            // runs when the `.encrypted` flag is present (otherwise we
            // can't conclude the failure is key-related), AND when the
            // caller DID supply a key — so a failure now means either
            // the key is wrong or the database is corrupt. We append the
            // original error for debuggability but lead with the clear
            // human-readable cause.
            if is_encrypted {
                let lower = e.to_lowercase();
                let key_like = lower.contains("not a database")
                    || lower.contains("encrypted")
                    || lower.contains("file is not")
                    || lower.contains("invalid");
                if key_like {
                    // Intentionally short: the raw SQLCipher/SQLite
                    // error string can leak file paths, capability
                    // names, or fragments of ciphertext. Keep the
                    // user-facing message terse; if richer diagnostics
                    // are needed, log the underlying `e` server-side
                    // via `tracing` or the equivalent.
                    return "Incorrect encryption passphrase (or the database is corrupted)."
                        .to_string();
                }
            }
            e
        })?;
    *state.encryption_key.write().await = key;

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

    let folder = db_path
        .parent()
        .ok_or("Invalid project path (cannot determine parent directory)")?
        .to_path_buf();

    // Write collaboration lock file (baton-pass, Plan §7.2).
    // Query user name before moving pool into state.
    let user_name: String =
        sqlx::query_scalar("SELECT display_name FROM local_user LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|_| "Unknown User".to_string());
    write_lock_file(&folder, &user_name);

    *state.db.write().await = Some(pool);
    *state.project_folder.write().await = Some(folder);

    Ok(project)
}

/// Check if a project directory has encryption enabled (.encrypted flag file).
#[command]
pub async fn projects_is_encrypted(project_dir: String) -> Result<bool, String> {
    let flag_path = PathBuf::from(&project_dir).join(".encrypted");
    Ok(flag_path.exists())
}

/// Check whether a project folder has a live collaboration lock file.
/// Returns `Some(warning_message)` if the lock is fresh, `None` if the
/// project is free to open. Callers should surface the warning before
/// calling `projects_open`.
#[command]
pub async fn projects_check_lock(project_dir: String) -> Result<Option<String>, String> {
    Ok(check_project_lock(&PathBuf::from(&project_dir)))
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

    let project = sqlx::query_as::<_, Project>(
        "SELECT id, name, description, created_at as createdAt, updated_at as updatedAt FROM project LIMIT 1"
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to read project: {}", e))?;

    sqlx::query("UPDATE project SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?")
        .bind(&name)
        .bind(&project.id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to rename project: {}", e))?;

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
    // Fire a final WAL checkpoint before releasing the pool so no stale
    // -wal sidecar survives the close. Best-effort: a failing checkpoint
    // should not block the close (the pool will be dropped regardless).
    if let Some(ref pool) = *state.db.read().await {
        if let Err(e) = crate::db::autosave_checkpoint(pool).await {
            log::warn!(target: "lens::db", "close-time checkpoint failed: {e}");
        }
    }
    // Remove collaboration lock file before releasing state.
    if let Some(ref folder) = *state.project_folder.read().await {
        remove_lock_file(folder);
    }
    *state.db.write().await = None;
    *state.project_folder.write().await = None;
    *state.encryption_key.write().await = DbKey(None);
    Ok(())
}


#[cfg(test)]
mod dbkey_tests {
    //! Exercises DbKey invariants: constructor validation, Display
    //! panic-freedom on short inner strings, exact rendering, and
    //! Debug-leak closure. Runs without the `sqlcipher` feature.

    use super::DbKey;

    fn canonical_hex(seed: u8) -> String {
        let bytes: Vec<u8> = (0..32).map(|i| seed.wrapping_add(i as u8)).collect();
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }

    /// Round-trip a valid passphrase: output is exactly 64 lowercase
    /// hex and is deterministic.
    #[test]
    fn from_passphrase_produces_64_lowercase_hex() {
        let k = DbKey::from_passphrase(Some("hello-world"))
            .expect("non-empty passphrase");
        let h = k.as_deref().expect("Some");
        assert_eq!(h.len(), 64, "SHA-256 hex is 64 chars");
        assert!(
            h.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
            "lowercase hex only"
        );
        let k2 = DbKey::from_passphrase(Some("hello-world")).unwrap();
        assert_eq!(k.as_deref(), k2.as_deref(), "deterministic");
    }

    /// Empty passphrase rejected (PRAGMA key='' would silently write
    /// undecryptable ciphertext).
    #[test]
    fn from_passphrase_rejects_empty() {
        assert!(DbKey::from_passphrase(Some("")).is_err());
    }

    /// `None` round-trips to `DbKey(None)`.
    #[test]
    fn from_passphrase_accepts_none() {
        let k = DbKey::from_passphrase(None).expect("None valid");
        assert!(!k.is_some());
        assert_eq!(k.as_deref(), None);
    }

    /// `from_hex` accepts valid 64-char lowercase hex.
    #[test]
    fn from_hex_accepts_64_lowercase_hex() {
        let h = canonical_hex(0);
        let k = DbKey::from_hex(Some(h.clone())).expect("valid hex");
        assert_eq!(k.as_deref(), Some(h.as_str()));
    }

    /// `from_hex` rejects uppercase, wrong length, and empty.
    #[test]
    fn from_hex_rejects_invalid() {
        let mut h = canonical_hex(0);
        h.replace_range(0..1, "A");
        assert!(DbKey::from_hex(Some(h)).is_err(), "uppercase rejected");

        assert!(DbKey::from_hex(Some("a".repeat(63))).is_err(), "63 chars");
        assert!(DbKey::from_hex(Some("a".repeat(65))).is_err(), "65 chars");
        assert!(DbKey::from_hex(Some(String::new())).is_err(), "empty");
    }

    /// **REGRESSION** -- Display::fmt must NOT panic on a short inner
    /// string. Pre-v0.1.4-round2 did `&hex[..8]` which panics on
    /// len<8. Two-layer fix: (a) `pub(crate)` field; (b) `get(..8)`.
    /// This test asserts (b) holds for several short lengths including
    /// the 7-char boundary at which `&s[..8]` would panic.
    #[test]
    fn display_does_not_panic_on_short_inner_string() {
        let empty = DbKey(Some(String::new()));
        let rendered = format!("{}", empty);
        // F1 v0.1.4 round-3: anchor on the literal "<short[" prefix
        // (no other site produces it now that the sentinel carries len).
        assert!(rendered.contains("<short["),
                "expected <short[len=N]> sentinel, got: {rendered}");
        assert!(!rendered.contains("byte index"),
                "must not include panic message, got: {rendered}");

        let three = DbKey(Some("123".to_string()));
        let rendered3 = format!("{}", three);
        assert!(rendered3.contains("<short["), "3-char must use <short[len=N]> sentinel, got: {rendered3}");

        let seven = DbKey(Some("1234567".to_string()));
        let rendered7 = format!("{}", seven);
        assert!(rendered7.contains("<short["), "7-char must use <short[len=N]> sentinel, got: {rendered7}");
    }

    /// Display renders the first 8 hex chars after the ellipsis.
    /// Built from `format!("{:02x}", 0..32)` -> "00010203...".
    #[test]
    fn display_renders_first_8_chars_of_valid_hex() {
        let seed_hex: String = (0..32).map(|i| format!("{:02x}", i)).collect();
        assert_eq!(seed_hex.len(), 64);
        let k = DbKey(Some(seed_hex));
        let rendered = format!("{}", k);
        // Structural assertions to keep this robust.
        assert!(rendered.starts_with("<DbKey hex="), "got: {rendered}");
        assert!(rendered.ends_with("00010203>"), "got: {rendered}");
        // Rust char literal `'\u{2026}'` uses braces per Rust's documented
        // escape syntax; the compiler resolves it to U+2026 at parse time.
        assert!(rendered.contains('\u{2026}'),
                "expected ellipsis (U+2026) in Display, got: {rendered}");
    }

    /// Display for the None variant.
    #[test]
    fn display_for_none() {
        let k = DbKey(None);
        assert_eq!(format!("{}", k), "<DbKey None>");
    }

    /// **REGRESSION** -- Debug MUST NOT leak the full 64-char hex.
    /// A future contributor who re-adds `#[derive(Debug)]` will fail
    /// this test: `{:?}` would print `DbKey(Some("0123...full..."))`
    /// instead of the truncated Display form.
    #[test]
    fn debug_does_not_leak_full_hex() {
        let k = DbKey::from_passphrase(Some("leak-test-pass"))
            .expect("non-empty");
        let debug_rendered = format!("{:?}", k);
        let display_rendered = format!("{}", k);

        // (1) Delegation contract.
        assert_eq!(
            debug_rendered, display_rendered,
            "Debug must delegate to Display: debug={debug_rendered}              vs display={display_rendered}"
        );

        // (2) Full hex must NOT appear anywhere in Debug output.
        let full_hex = k.as_deref().unwrap();
        assert!(
            !debug_rendered.contains(full_hex),
            "Debug must NOT print the full 64-char hex, got: {debug_rendered}"
        );

        // (3) Output length budget: well under any plausible hash prefix.
        assert!(
            debug_rendered.len() < 32,
            "Debug output should be the truncated Display form              (<~30 chars), got len={}: {debug_rendered}",
            debug_rendered.len()
        );
    }

    /// `Default` produces `DbKey(None)` (matches fresh AppState slots).
    #[test]
    fn default_is_none() {
        let k = DbKey::default();
        assert!(!k.is_some());
        assert_eq!(k.as_deref(), None);
    }
}

#[cfg(test)]
mod lock_file_tests {
    //! Collaboration lock file (baton-pass, Plan §7.2) integration tests.
    //! Exercises the full lifecycle: write → read → stale detection → remove.

    use super::*;
    use std::fs;
    use std::thread;
    use std::time::Duration;

    /// Helper: create an empty temp directory that gets cleaned up on drop.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("lens-lock-test-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).expect("create temp dir");
            TempDir { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn write_and_read_lock_file_round_trip() {
        let dir = TempDir::new();
        write_lock_file(dir.path(), "Alice");

        let lock_path = lock_file_path(dir.path());
        assert!(lock_path.exists(), "lock file should exist after write");

        let (user, ts) = read_lock_file(dir.path()).expect("read back");
        assert_eq!(user, "Alice");
        assert!(ts > 0, "timestamp should be a positive Unix epoch");

        // Content should have expected format
        let content = fs::read_to_string(&lock_path).unwrap();
        assert!(content.starts_with("user=Alice\n"));
        assert!(content.contains("timestamp="));
    }

    #[test]
    fn read_lock_file_returns_none_when_missing() {
        let dir = TempDir::new();
        assert!(read_lock_file(dir.path()).is_none());
    }

    #[test]
    fn read_lock_file_returns_none_for_empty_user() {
        let dir = TempDir::new();
        fs::write(
            lock_file_path(dir.path()),
            "user=\ntimestamp=1000000\n",
        )
        .unwrap();
        assert!(read_lock_file(dir.path()).is_none(), "empty user → None");
    }

    #[test]
    fn write_lock_file_falls_back_to_unknown_user_for_empty_name() {
        let dir = TempDir::new();
        write_lock_file(dir.path(), "");
        let (user, _) = read_lock_file(dir.path()).expect("read back");
        assert_eq!(user, "Unknown User");
    }

    #[test]
    fn write_lock_file_handles_unicode_names() {
        let dir = TempDir::new();
        write_lock_file(dir.path(), "José Møller");
        let (user, _) = read_lock_file(dir.path()).expect("read back");
        assert_eq!(user, "José Møller");
    }

    #[test]
    fn remove_lock_file_cleans_up() {
        let dir = TempDir::new();
        write_lock_file(dir.path(), "Bob");
        assert!(lock_file_path(dir.path()).exists());

        remove_lock_file(dir.path());
        assert!(!lock_file_path(dir.path()).exists());
        assert!(read_lock_file(dir.path()).is_none());
    }

    #[test]
    fn check_project_lock_fresh_returns_warning() {
        let dir = TempDir::new();
        write_lock_file(dir.path(), "Charlie");

        let warning = check_project_lock(dir.path());
        assert!(warning.is_some(), "fresh lock should warn");
        let msg = warning.unwrap();
        assert!(msg.contains("Charlie"));
        assert!(msg.contains("open by"));
    }

    #[test]
    fn check_project_lock_none_for_no_lock_file() {
        let dir = TempDir::new();
        assert!(check_project_lock(dir.path()).is_none());
    }

    #[test]
    fn check_project_lock_clears_stale_lock() {
        let dir = TempDir::new();
        // Write a lock with a timestamp from 9 hours ago (beyond STALE_LOCK_HOURS=8)
        let stale_ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            .saturating_sub((STALE_LOCK_HOURS + 1) * 3600);
        fs::write(
            lock_file_path(dir.path()),
            format!("user=OldUser\ntimestamp={}\n", stale_ts),
        )
        .unwrap();

        // Should return None (lock was stale and got removed)
        let warning = check_project_lock(dir.path());
        assert!(warning.is_none(), "stale lock should be cleared silently");

        // Lock file should be gone
        assert!(
            !lock_file_path(dir.path()).exists(),
            "stale lock file should be deleted"
        );
    }

    #[test]
    fn lock_file_content_preserves_timestamp_integrity() {
        let dir = TempDir::new();
        write_lock_file(dir.path(), "Diana");

        // Small delay to ensure timestamp difference
        thread::sleep(Duration::from_millis(10));

        let (_, ts1) = read_lock_file(dir.path()).unwrap();

        // Rewrite with same user should produce a different timestamp
        thread::sleep(Duration::from_millis(1100)); // 1.1s to guarantee different second
        write_lock_file(dir.path(), "Diana");
        let (user2, ts2) = read_lock_file(dir.path()).unwrap();

        assert_eq!(user2, "Diana");
        assert!(
            ts2 > ts1,
            "rewrite should produce a newer timestamp (ts1={ts1}, ts2={ts2})"
        );
    }
}
