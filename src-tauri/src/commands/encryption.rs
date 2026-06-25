//! Encryption feature gates and helpers.
//!
//! Encrypted-at-rest project database encryption requires the SQLCipher
//! engine, which is gated behind the `sqlcipher` Cargo feature (see
//! `src-tauri/Cargo.toml`). Without that feature and an installed
//! `libsqlcipher-dev` at build time, plain SQLite silently ignores
//! `PRAGMA key = …` and the on-disk db is unencrypted.
//!
//! This module exposes a runtime read-only IPC, `encryption_available`,
//! that mirrors the compile-time `cfg!(feature = "sqlcipher")` so the
//! frontend can hide or warn about project-level encryption options
//! when only a build with the plain SQLite engine is installed.
//!
//! The recovery-key helpers (`recovery_key_generate`) generate
//! strong 256-bit random secrets, formatted as 64 hex characters grouped
//! in 8-char chunks for paper-writeable recovery. The same string is
//! accepted as input by `commands::backup::backup_restore` to decrypt
//! `.lensbackup` files without needing the original passphrase.

use rand::RngCore;
use tauri::command;

/// Returns `true` iff this binary was built with `--features sqlcipher`,
/// i.e. SQLCipher is linked and `PRAGMA key` will actually encrypt the
/// on-disk project database. Reads at compile time via `cfg!`.
#[command]
pub async fn encryption_available() -> Result<bool, String> {
    Ok(cfg!(feature = "sqlcipher"))
}

/// Generate a 256-bit CSPRNG-strong recovery key, formatted as 64 hex
/// characters grouped 8 per dash (`XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX`).
/// Shown to the user exactly once after a backup is created. Caller
/// must display this in a confirmation dialog and require explicit
/// acknowledgement before the dialog can be dismissed — the random key
/// is never persisted by LENS.
#[command]
pub fn recovery_key_generate() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    Ok(format_recovery_key(&bytes))
}

/// Format 32 random bytes as the user-facing 64 hex chars grouped 8 per
/// dash. Used by both `recovery_key_generate` and `backup_export`.
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
    fn recovery_key_has_correct_format() {
        let bytes: [u8; 32] = std::array::from_fn(|i| i as u8);
        let s = format_recovery_key(&bytes);
        assert_eq!(s.len(), 64 + 7);
        assert_eq!(s.split('-').count(), 8);
        assert!(s.chars().all(|c| c.is_ascii_hexdigit() || c == '-'));
    }

    #[test]
    fn recovery_key_is_high_entropy() {
        // Two consecutive calls should produce different output (overwhelmingly
        // likely with a CSPRNG; this catches regressions if someone replaces
        // OsRng with a fixed seed).
        let a = recovery_key_generate().unwrap();
        let b = recovery_key_generate().unwrap();
        assert_ne!(a, b);
        assert_eq!(a.len(), 64 + 7);
        assert_eq!(b.len(), 64 + 7);
    }
}
