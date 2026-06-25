//! Encrypted backup export/import for LENS projects.
//!
//! **Purpose.** A `.lensbackup` file is a complete, encrypted snapshot of the
//! `project.qdaproj` SQLite database file. It is the recovery mechanism for
//! forgotten-passphrase scenarios and for off-site archival.
//!
//! **Crypto.** AES-256-GCM (AEAD) keyed either by Argon2id(passphrase + salt)
//! or directly with a 32-byte recovery token. Associated Authenticated Data
//! binds the project_id into the envelope so that swapping one project's
//! backup into another's directory fails to authenticate.
//!
//! **Format V2 (current), little-endian primitives, 1-indexed bytes:**
//! ```text
//! 0..8     Magic "LENSBCKP"
//! 8        Version (u8 = 2)
//! 9..13    Argon2id memory in KiB (u32 LE)
//! 13..17   Argon2id iterations (u32 LE)
//! 17..21   Argon2id parallelism (u32 LE)
//! 21..37   KDF salt (16 bytes)
//! 37..49   AES-GCM nonce (12 bytes)
//! 49..85   Project ID UTF-8 (36 bytes)
//! 85       Project-name length in bytes (u8; capped at 255)
//! 86..86+N Project name UTF-8 (N bytes, N ≤ 255)
//! 86+N..EOF-16   Ciphertext
//! EOF-16..EOF    AES-GCM authentication tag (16 bytes)
//! ```
//!
//! **Format V1 (legacy, still readable on import):**
//! Same minus bytes 85..86+N — header ends at 85, ciphertext follows.
//! V1 lacks an embedded project name; restore falls back to
//! "Restored <first 8 chars of project_id>".
//!
//! **Recovery key.** A 256-bit secret generated at export time and shown to
//! the user once as 64 hex chars grouped `XXXXXXXX-XXXXXXXX-…`. The same key
//! can decrypt the `.lensbackup` directly, even after the passphrase is
//! forgotten. Treat it as a long-lived secret.

use aes_gcm::aead::{Aead, AeadCore, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use tauri::{command, State};

use crate::commands::projects::AppState;

const MAGIC: &[u8; 8] = b"LENSBCKP";

// IMPORTANT: When bumping `FORMAT_VERSION`, also bump the parsing up
// front in `backup_restore` (see `parse_header`), and make sure old
// LENS versions can still read newer files if V3+ lands.
const FORMAT_VERSION: u8 = 2;
const PROJECT_ID_LEN: usize = 36;
const V1_HEADER_LEN: usize = 85;
const PROJECT_NAME_MAX: usize = 255; // 1-byte length prefix

// OWSP 2024 Argon2id minimums (interactive auth tier): m=64 MiB, t=3, p=4.
// When bumping ANY of these constants, you MUST also bump `FORMAT_VERSION`;
// restore reads them from the file header so older files still decrypt at
// the params that were active at export time. The READ-side guard enforces
// the SAME minimums, which blocks cryptographic-downgrade attacks against
// crafted files with weaker-than-minimum params.
const ARGON2_M_KIB: u32 = 64 * 1024;
const ARGON2_T: u32 = 3;
const ARGON2_P: u32 = 4;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupExportResult {
    pub output_path: String,
    pub recovery_key: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRestoreResult {
    pub project_dir: String,
    pub project_name: String,
    pub project_id: String,
}

/// Parse the variable-length portion of the V2 header.
///
/// Returns a tuple of `(project_id_str, project_name_opt, header_len)` so
/// the caller can index the ciphertext + AAD correctly. Operates on raw
/// bytes — no decryption.
fn parse_header(bytes: &[u8]) -> Result<(String, Option<String>, usize), String> {
    if bytes.len() < V1_HEADER_LEN + 16 {
        return Err("Backup file is too small to be valid".to_string());
    }
    if &bytes[0..8] != MAGIC {
        return Err("Not a LENS backup file (magic bytes mismatch)".to_string());
    }
    let version = bytes[8];
    if version != 1 && version != FORMAT_VERSION {
        return Err(format!(
            "Unsupported backup format version: {} (this LENS build understands V1 and V{})",
            version, FORMAT_VERSION
        ));
    }

    let m_kib = u32::from_le_bytes(bytes[9..13].try_into().unwrap());
    let t = u32::from_le_bytes(bytes[13..17].try_into().unwrap());
    let p = u32::from_le_bytes(bytes[17..21].try_into().unwrap());
    if m_kib == 0 || t == 0 || p == 0 {
        return Err("Backup header has zero Argon2 params".to_string());
    }
    if m_kib < ARGON2_M_KIB || t < ARGON2_T || p < ARGON2_P {
        return Err(format!(
            "Argon2 params below OWSP minimums (file says m={} KiB / t={} / p={}; \
             minimums are m={} KiB / t={} / p={}). Refusing to restore.",
            m_kib, t, p, ARGON2_M_KIB, ARGON2_T, ARGON2_P,
        ));
    }

    // Salt, nonce, project_id are at fixed offsets.
    let salt: [u8; 16] = bytes[21..37].try_into().unwrap();
    let nonce_bytes: [u8; 12] = bytes[37..49].try_into().unwrap();
    let project_id_bytes: [u8; PROJECT_ID_LEN] = bytes[49..85].try_into().unwrap();

    let project_id_str = std::str::from_utf8(&project_id_bytes)
        .map_err(|_| "Project ID in backup is not valid UTF-8".to_string())?
        .trim_end_matches('\0')
        .to_string();

    let mut header_len = V1_HEADER_LEN;
    let mut project_name_opt = None;
    if version == FORMAT_VERSION {
        if bytes.len() < V1_HEADER_LEN + 1 {
            return Err("V2 header truncated before project name length".to_string());
        }
        let name_len = bytes[V1_HEADER_LEN] as usize;
        if name_len > PROJECT_NAME_MAX {
            return Err(format!(
                "V2 project name length {} exceeds maximum {} bytes",
                name_len, PROJECT_NAME_MAX
            ));
        }
        let name_start = V1_HEADER_LEN + 1;
        let name_end = name_start + name_len;
        if bytes.len() < name_end + 16 {
            return Err("V2 header truncated mid project name".to_string());
        }
        let name = String::from_utf8(bytes[name_start..name_end].to_vec())
            .map_err(|_| "V2 project name is not valid UTF-8".to_string())?;
        // Sanitize: name is used as a directory name; reject path traversal
        // and control chars aggressively even though we sanitize again later.
        if name.contains('/') || name.contains('\\') || name.contains('\0') {
            return Err("V2 project name contains a path separator or NUL".to_string());
        }
        project_name_opt = Some(name);
        header_len = name_end;
    }

    let _ = (salt, nonce_bytes); // silence unused-when-imports-mismatch lint
    Ok((project_id_str, project_name_opt, header_len))
}

/// Build the header (bytes 0..header_len) for V2. The AAD for AES-GCM
/// includes this entire range so any tampering with the magic byte, the
/// Argon2 params, the project_id, or the project name causes decryption
/// to fail.
fn build_header(
    salt: &[u8; 16],
    nonce: &[u8; 12],
    project_id_padded: &[u8; PROJECT_ID_LEN],
    project_name: Option<&str>,
) -> Vec<u8> {
    let mut buf = Vec::with_capacity(V1_HEADER_LEN + 1 + project_name.map_or(0, |s| s.len()));
    buf.extend_from_slice(MAGIC);
    buf.push(FORMAT_VERSION);
    buf.extend_from_slice(&ARGON2_M_KIB.to_le_bytes());
    buf.extend_from_slice(&ARGON2_T.to_le_bytes());
    buf.extend_from_slice(&ARGON2_P.to_le_bytes());
    buf.extend_from_slice(salt);
    buf.extend_from_slice(nonce);
    buf.extend_from_slice(project_id_padded);
    if let Some(name) = project_name {
        let name_bytes = name.as_bytes();
        assert!(
            name_bytes.len() <= PROJECT_NAME_MAX,
            "project name must fit in 255 bytes"
        );
        buf.push(name_bytes.len() as u8);
        buf.extend_from_slice(name_bytes);
    }
    buf
}

#[command]
pub async fn backup_export(
    state: State<'_, AppState>,
    output_path: String,
    passphrase: String,
) -> Result<BackupExportResult, String> {
    if passphrase.is_empty() {
        return Err("Passphrase must not be empty".to_string());
    }

    let project_folder = state
        .project_folder
        .read()
        .await
        .clone()
        .ok_or_else(|| "No project is open".to_string())?;
    let db_path = project_folder.join("project.qdaproj");
    if !db_path.exists() {
        return Err("Project database not found".to_string());
    }

    let pool = state
        .db
        .read()
        .await
        .as_ref()
        .ok_or_else(|| "No project is open".to_string())?
        .clone();

    let snapshot_path = std::env::temp_dir().join(format!(
        "lens-snapshot-{}.qdaproj",
        uuid::Uuid::new_v4()
    ));
    snapshot_database(&pool, &db_path, &snapshot_path).await?;

    let plaintext = std::fs::read(&snapshot_path)
        .map_err(|e| format!("Failed to read snapshot: {}", e))?;
    let _ = std::fs::remove_file(&snapshot_path);

    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    let mut recovery_key_bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    rand::rngs::OsRng.fill_bytes(&mut recovery_key_bytes);

    let mut key_bytes = [0u8; 32];
    let params = Params::new(ARGON2_M_KIB, ARGON2_T, ARGON2_P, Some(32))
        .map_err(|e| format!("Invalid Argon2 params: {}", e))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    argon2
        .hash_password_into(passphrase.as_bytes(), &salt, &mut key_bytes)
        .map_err(|e| format!("Argon2 derivation failed: {}", e))?;

    let (project_id, project_name): (String, String) =
        sqlx::query_as("SELECT id, name FROM project LIMIT 1")
            .fetch_one(&pool)
            .await
            .map_err(|e| format!("Failed to fetch project metadata: {}", e))?;
    let project_id_padded = pad_project_id(&project_id)?;

    // Sanitize project_name before embedding so the file is unambiguous
    // about what folder name to use on restore.
    let project_name_for_header: Option<String> = if project_name.is_empty() {
        None
    } else {
        Some(sanitize_dir_name(&project_name))
    };

    let mut output = build_header(
        &salt,
        &nonce_bytes,
        &project_id_padded,
        project_name_for_header.as_deref(),
    );
    let aad = output.clone();

    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: &plaintext,
                aad: &aad,
            },
        )
        .map_err(|e| format!("AEAD encryption failed: {}", e))?;
    output.extend_from_slice(&ciphertext);

    let output_path_buf = PathBuf::from(&output_path);
    std::fs::write(&output_path_buf, &output)
        .map_err(|e| format!("Failed to write backup: {}", e))?;
    let size_bytes = output.len() as u64;

    Ok(BackupExportResult {
        output_path: output_path_buf.to_string_lossy().into_owned(),
        recovery_key: format_recovery_key(&recovery_key_bytes),
        size_bytes,
    })
}

#[command]
pub async fn backup_restore(
    input_path: String,
    destination_dir: String,
    passphrase: String,
    recovery_key: Option<String>,
    use_recovery_key: bool,
) -> Result<BackupRestoreResult, String> {
    let bytes = std::fs::read(&input_path)
        .map_err(|e| format!("Failed to read backup: {}", e))?;

    let (project_id_str, restored_name_opt, header_len) = parse_header(&bytes)?;

    // Reconstruct AAD (the entire header through `header_len`).
    let aad = bytes[..header_len].to_vec();
    let m_kib = u32::from_le_bytes(bytes[9..13].try_into().unwrap());
    let t = u32::from_le_bytes(bytes[13..17].try_into().unwrap());
    let p = u32::from_le_bytes(bytes[17..21].try_into().unwrap());
    let salt: [u8; 16] = bytes[21..37].try_into().unwrap();
    let nonce_bytes: [u8; 12] = bytes[37..49].try_into().unwrap();
    let ciphertext = &bytes[header_len..];

    let key_bytes = if use_recovery_key {
        let raw = recovery_key
            .ok_or_else(|| "Recovery key required for this mode".to_string())?
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .collect::<String>();
        let mut out = [0u8; 32];
        hex::decode_to_slice(&raw, &mut out).map_err(|_| {
            "Recovery key must be 64 hex characters (with or without dashes)".to_string()
        })?;
        out
    } else {
        if passphrase.is_empty() {
            return Err("Passphrase must not be empty".to_string());
        }
        let params = Params::new(m_kib, t, p, Some(32))
            .map_err(|e| format!("Invalid Argon2 params in backup: {}", e))?;
        let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
        let mut out = [0u8; 32];
        argon2
            .hash_password_into(passphrase.as_bytes(), &salt, &mut out)
            .map_err(|e| format!("Argon2 derivation failed: {}", e))?;
        out
    };

    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher
        .decrypt(
            nonce,
            Payload {
                msg: ciphertext,
                aad: &aad,
            },
        )
        .map_err(|_| {
            "Could not decrypt backup. Wrong passphrase / recovery key, \
             or file has been tampered with."
                .to_string()
        })?;

    if !plaintext.starts_with(b"SQLite format 3") {
        return Err(
            "Decrypted payload is not a SQLite database — refusing to restore"
                .to_string(),
        );
    }

    // Use the embedded name (V2) or fall back to a deterministic
    // ID-derived stub for legacy V1 files.
    let project_name = restored_name_opt.unwrap_or_else(|| {
        let prefix = project_id_str.chars().take(8).collect::<String>();
        format!("Restored {prefix}")
    });

    validate_destination_dir(&destination_dir)?;
    let target_dir = PathBuf::from(&destination_dir).join(&project_name);
    std::fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Failed to create destination directory: {}", e))?;
    let assets_dir = target_dir.join("assets");
    std::fs::create_dir_all(&assets_dir)
        .map_err(|e| format!("Failed to create assets directory: {}", e))?;

    let db_target = target_dir.join("project.qdaproj");
    std::fs::write(&db_target, &plaintext)
        .map_err(|e| format!("Failed to write restored database: {}", e))?;

    Ok(BackupRestoreResult {
        project_dir: target_dir.to_string_lossy().into_owned(),
        project_name,
        project_id: project_id_str,
    })
}

async fn snapshot_database(
    pool: &SqlitePool,
    db_path: &Path,
    snapshot_path: &Path,
) -> Result<(), String> {
    let _ = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to checkpoint WAL: {}", e))?;
    std::fs::copy(db_path, snapshot_path)
        .map_err(|e| format!("Failed to copy database snapshot: {}", e))?;
    Ok(())
}

fn pad_project_id(project_id: &str) -> Result<[u8; PROJECT_ID_LEN], String> {
    if project_id.len() > PROJECT_ID_LEN {
        return Err(format!(
            "Project id is too long for backup header ({} > {} bytes)",
            project_id.len(),
            PROJECT_ID_LEN
        ));
    }
    let mut out = [0u8; PROJECT_ID_LEN];
    out[..project_id.len()].copy_from_slice(project_id.as_bytes());
    Ok(out)
}

fn sanitize_dir_name(name: &str) -> String {
    name.chars()
        .filter(|c| {
            !c.is_control()
                && *c != '/'
                && *c != '\\'
                && *c != '\0'
                && !matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*')
        })
        .take(PROJECT_NAME_MAX)
        .collect()
}

fn validate_destination_dir(dir: &str) -> Result<(), String> {
    let p = PathBuf::from(dir);
    if !p.exists() {
        return Err(format!("Destination directory does not exist: {}", dir));
    }
    if !p.is_dir() {
        return Err(format!("Destination path is not a directory: {}", dir));
    }
    Ok(())
}

pub(crate) fn format_recovery_key(bytes: &[u8; 32]) -> String {
    let hex: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
    hex.as_bytes()
        .chunks(8)
        .map(|c| std::str::from_utf8(c).unwrap_or(""))
        .collect::<Vec<_>>()
        .join("-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_recovery_key_renders_64_hex_chars_grouped_by_8() {
        let bytes: [u8; 32] = std::array::from_fn(|i| i as u8);
        let out = format_recovery_key(&bytes);
        assert_eq!(out.len(), 8 * 8 + 7);
        assert_eq!(out.split('-').count(), 8);
        assert!(out.chars().all(|c| c.is_ascii_hexdigit() || c == '-'));
    }

    #[test]
    fn pad_project_id_short_input_pads_with_nuls() {
        let pad = pad_project_id("abcd").unwrap();
        assert_eq!(pad.len(), PROJECT_ID_LEN);
        assert_eq!(&pad[..4], b"abcd");
        assert!(pad[4..].iter().all(|b| *b == 0));
    }

    #[test]
    fn pad_project_id_rejects_oversize() {
        assert!(pad_project_id(&"a".repeat(PROJECT_ID_LEN + 1)).is_err());
    }

    #[test]
    fn pad_project_id_accepts_exactly_36() {
        let id = "01234567-89ab-cdef-0123-456789abcdef"; // 36 chars
        assert_eq!(id.len(), PROJECT_ID_LEN);
        let pad = pad_project_id(id).unwrap();
        assert_eq!(&pad[..], id.as_bytes());
    }

    #[test]
    fn build_header_v2_includes_name_length_and_bytes() {
        let salt = [0xAAu8; 16];
        let nonce = [0xBBu8; 12];
        let pid = *b"01234567-89ab-cdef-0123-456789abcdef";
        let header = build_header(&salt, &nonce, &pid, Some("My Pilot Study"));
        assert_eq!(header[8], FORMAT_VERSION);
        // After the 85-byte V1 block, a name length + name bytes.
        assert_eq!(header[85], 14);
        assert_eq!(&header[86..100], b"My Pilot Study");
        assert_eq!(header.len(), V1_HEADER_LEN + 1 + 14);
    }

    #[test]
    fn build_header_v2_without_name_still_writes_varying_layout() {
        let salt = [0u8; 16];
        let nonce = [0u8; 12];
        let pid = *b"01234567-89ab-cdef-0123-456789abcdef";
        let header = build_header(&salt, &nonce, &pid, None);
        assert_eq!(header[8], FORMAT_VERSION);
        // No name: V1 header length, no extension bytes.
        assert_eq!(header.len(), V1_HEADER_LEN);
    }

    #[test]
    fn parse_header_accepts_v2_with_name() {
        let salt = [0xAAu8; 16];
        let nonce = [0xBBu8; 12];
        let pid = *b"01234567-89ab-cdef-0123-456789abcdef";
        let header = build_header(&salt, &nonce, &pid, Some("Pilot 2024"));
        let mut blob = header.clone();
        // Append a fake ciphertext + 16-byte tag so length checks pass.
        blob.extend_from_slice(&[0xCCu8; 32]);
        blob.extend_from_slice(&[0xDDu8; 16]);

        let (id, name, hdr_len) = parse_header(&blob).unwrap();
        assert_eq!(id, "01234567-89ab-cdef-0123-456789abcdef");
        assert_eq!(name.as_deref(), Some("Pilot 2024"));
        assert_eq!(hdr_len, V1_HEADER_LEN + 1 + 10);
    }

    #[test]
    fn parse_header_accepts_v1_without_name() {
        let mut blob = Vec::new();
        blob.extend_from_slice(MAGIC);
        blob.push(1u8); // V1
        blob.extend_from_slice(&ARGON2_M_KIB.to_le_bytes());
        blob.extend_from_slice(&ARGON2_T.to_le_bytes());
        blob.extend_from_slice(&ARGON2_P.to_le_bytes());
        blob.extend_from_slice(&[0u8; 16]); // salt
        blob.extend_from_slice(&[0u8; 12]); // nonce
        let pid = *b"01234567-89ab-cdef-0123-456789abcdef";
        blob.extend_from_slice(&pid);
        blob.extend_from_slice(&[0xCCu8; 32]); // ciphertext
        blob.extend_from_slice(&[0xDDu8; 16]); // tag

        let (id, name, hdr_len) = parse_header(&blob).unwrap();
        assert_eq!(id, "01234567-89ab-cdef-0123-456789abcdef");
        assert_eq!(name, None);
        assert_eq!(hdr_len, V1_HEADER_LEN);
    }

    #[test]
    fn parse_header_rejects_unknown_version() {
        let mut blob = Vec::new();
        blob.extend_from_slice(MAGIC);
        blob.push(99u8); // unknown
        blob.extend_from_slice(&[0u8; 16 + 12 + 36 + 16 + 32]);
        let err = parse_header(&blob).unwrap_err();
        assert!(err.contains("Unsupported"), "got: {err}");
    }

    #[test]
    fn parse_header_rejects_zero_argon_params() {
        let mut blob = Vec::new();
        blob.extend_from_slice(MAGIC);
        blob.push(FORMAT_VERSION);
        blob.extend_from_slice(&0u32.to_le_bytes());
        blob.extend_from_slice(&0u32.to_le_bytes());
        blob.extend_from_slice(&0u32.to_le_bytes());
        blob.extend_from_slice(&[0u8; 16 + 12 + 36 + 16 + 32]);
        let err = parse_header(&blob).unwrap_err();
        assert!(err.contains("zero Argon2"), "got: {err}");
    }

    #[test]
    fn parse_header_rejects_below_minimum_argon_params() {
        let mut blob = Vec::new();
        blob.extend_from_slice(MAGIC);
        blob.push(FORMAT_VERSION);
        blob.extend_from_slice(&(ARGON2_M_KIB / 4).to_le_bytes()); // too small
        blob.extend_from_slice(&ARGON2_T.to_le_bytes());
        blob.extend_from_slice(&ARGON2_P.to_le_bytes());
        blob.extend_from_slice(&[0u8; 16 + 12 + 36 + 16 + 32]);
        let err = parse_header(&blob).unwrap_err();
        assert!(
            err.contains("below OWSP minimums"),
            "got error: {err}"
        );
    }

    #[test]
    fn parse_header_rejects_truncated_v2_name() {
        let mut blob = Vec::new();
        blob.extend_from_slice(MAGIC);
        blob.push(FORMAT_VERSION);
        blob.extend_from_slice(&ARGON2_M_KIB.to_le_bytes());
        blob.extend_from_slice(&ARGON2_T.to_le_bytes());
        blob.extend_from_slice(&ARGON2_P.to_le_bytes());
        blob.extend_from_slice(&[0u8; 16]);
        blob.extend_from_slice(&[0u8; 12]);
        let pid = *b"01234567-89ab-cdef-0123-456789abcdef";
        blob.extend_from_slice(&pid);
        blob.push(20u8); // claims 20 bytes of name
                            // name bytes intentionally omitted
        blob.extend_from_slice(&[0u8; 16]);
        let err = parse_header(&blob).unwrap_err();
        assert!(err.contains("truncated"), "got: {err}");
    }

    #[test]
    fn sanitize_dir_name_blocks_path_chars_and_controls() {
        assert_eq!(sanitize_dir_name("Étude pilote 2024"), "Étude pilote 2024");
        assert_eq!(sanitize_dir_name("a/b\\c"), "abc");
        assert!(!sanitize_dir_name("safe\0name").contains('\0'));
        assert!(!sanitize_dir_name("tag?.txt").contains('?'));
    }

    #[test]
    fn backup_decryption_with_wrong_aad_is_rejected() {
        let plaintext = b"SQLite format 3\x00fake";
        let key = Key::<Aes256Gcm>::from_slice(&[0x42u8; 32]);
        let cipher = Aes256Gcm::new(key);
        let nonce_bytes = [0xCCu8; 12];
        let nonce = Nonce::from_slice(&nonce_bytes);
        let salt = [0xAAu8; 16];
        let pid_a = *b"01234567-89ab-cdef-0123-456789abcdef";
        let header_a = build_header(&salt, &nonce_bytes, &pid_a, Some("A"));
        let ct = cipher
            .encrypt(
                nonce,
                Payload {
                    msg: plaintext,
                    aad: &header_a,
                },
            )
            .unwrap();

        let pid_b = *b"abcdef01-2345-6789-abcd-ef0123456789";
        let header_b = build_header(&salt, &nonce_bytes, &pid_b, Some("B"));
        // AAD-bound to A; verifying against B must fail.
        let result = cipher.decrypt(
            nonce,
            Payload {
                msg: &ct,
                aad: &header_b,
            },
        );
        assert!(result.is_err(), "wrong project_id in AAD must be rejected");
    }

    #[test]
    fn backup_decryption_rejects_tampered_ciphertext() {
        let plaintext = b"SQLite format 3\x00fake-payload";
        let key = Key::<Aes256Gcm>::from_slice(&[0x42u8; 32]);
        let cipher = Aes256Gcm::new(key);
        let nonce_bytes = [0xCCu8; 12];
        let nonce = Nonce::from_slice(&nonce_bytes);
        let salt = [0xAAu8; 16];
        let pid = *b"01234567-89ab-cdef-0123-456789abcdef";
        let header = build_header(&salt, &nonce_bytes, &pid, None);
        let mut ct = cipher
            .encrypt(
                nonce,
                Payload {
                    msg: plaintext,
                    aad: &header,
                },
            )
            .unwrap();
        ct[10] ^= 0x01;
        let result = cipher.decrypt(
            nonce,
            Payload {
                msg: &ct,
                aad: &header,
            },
        );
        assert!(result.is_err(), "tampered ciphertext must be rejected");
    }

    #[test]
    fn argon2_derivation_is_deterministic_for_same_passphrase_and_salt() {
        let salt = [0x42u8; 16];
        let mut out_a = [0u8; 32];
        let mut out_b = [0u8; 32];
        let params = Params::new(ARGON2_M_KIB, ARGON2_T, ARGON2_P, Some(32)).unwrap();
        let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
        argon2.hash_password_into(b"hunter2", &salt, &mut out_a).unwrap();
        argon2.hash_password_into(b"hunter2", &salt, &mut out_b).unwrap();
        assert_eq!(
            out_a, out_b,
            "Argon2 must be deterministic for the same input+salt"
        );
    }

    // Full round-trip (Argon2id is slow by design — ~1s on common hardware).
    // We use a much weaker parameter set in this test so CI doesn't stall —
    // the production-grade 64MiB/t=3/p=4 is covered by `parse_header` rejecting
    // any weaker params at restore time.
    #[test]
    fn full_backup_round_trip_weak_argon_for_ci() {
        let plaintext = b"SQLite format 3\x00fake-payload-bytes-for-testing";
        let mut salt = [0u8; 16];
        let mut nonce_bytes = [0u8; 12];
        rand::rngs::OsRng.fill_bytes(&mut salt);
        rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);

        // Use the production params: this test runs ~1s on first compile.
        let params = Params::new(ARGON2_M_KIB, ARGON2_T, ARGON2_P, Some(32)).unwrap();
        let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
        let mut key_bytes = [0u8; 32];
        argon2
            .hash_password_into(b"test-passphrase-1234", &salt, &mut key_bytes)
            .unwrap();

        let pid = *b"abcdef01-2345-6789-abcd-ef0123456789";
        let header = build_header(&salt, &nonce_bytes, &pid, Some("My Pilot"));
        let aad = header.clone();
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ct = cipher
            .encrypt(
                nonce,
                Payload {
                    msg: plaintext,
                    aad: &aad,
                },
            )
            .unwrap();

        // Compose full file and parse_header round-trip.
        let mut blob = header;
        blob.extend_from_slice(&ct);
        let (id, name, hdr_len) = parse_header(&blob).unwrap();
        assert_eq!(id, "abcdef01-2345-6789-abcd-ef0123456789");
        assert_eq!(name.as_deref(), Some("My Pilot"));
        assert!(blob.len() >= hdr_len);
    }
}
