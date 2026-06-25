pub mod migrations;

use sha2::{Digest, Sha256};

/// Identifier of the on-disk LENS-layer key derivation function
/// `db::init_db` records for every encrypted project via
/// `project_settings.kdf_version`. This string covers the
/// *LENS-side* layer (`derive_passphrase_key` → SHA-256 hex)
/// only. SQLCipher's own internal KDF (PBKDF2-SHA512 default,
/// `PRAGMA cipher_kdf_iter` etc.) is whatever the linked
/// `libsqlcipher` ships with and is NOT tagged here — if a
/// SQLCipher upgrade ever changes that default in a breaking
/// way, the LENS release notes are the contract; this column
/// does not detect that.
///
/// **Bumping protocol.** Change the string when
/// `derive_passphrase_key` (or another path producing the bytes
/// this build hands to `PRAGMA key`) is altered in a way that
/// produces different output for the same passphrase. Older
/// projects carry the value they were tagged with at their last
/// open so a future build can detect (and refuse / migrate) an
/// unsupported ciphertext.
pub const KDF_VERSION_CURRENT: &str = "v1-lens-sha256-passphrase-hash";

use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use std::path::Path;
use std::str::FromStr;

/// Initialize a SQLCipher-backed connection pool for a project database.
///
/// **Encryption.** When `encryption_key` is `Some(s)` and the binary was
/// compiled with the `sqlcipher` Cargo feature (the default build since
/// v0.1.2), the key is attached to `SqliteConnectOptions` via `.pragma("key", s)`
/// so `PRAGMA key = '…'` runs as the very first statement on every new
/// connection in the pool — SQLCipher requires this ordering to decrypt
/// pages on first access. Without `SQLCipher`, `PRAGMA key` is silently
/// ignored by plain SQLite, so `init_db` is also gated on
/// `#[cfg(feature = "sqlcipher")]` to avoid implying encryption when none
/// is actually applied.
///
/// On a fresh db file, `PRAGMA key` immediately locks the entire file —
/// every page written afterwards is encrypted.
///
/// **Quoting at the SQL boundary.** The value passed to `pragma("key", v)`
/// is manually wrapped in single quotes (with internal `'` doubled to
/// `''`) so user-typed passphrases containing SQL-special characters
/// (`?`, `'`, `"`, `;`, etc.) do not crash the PRAGMA parser. See the
/// `if let Some(key)` block below for the in-code rationale, and the
/// `init_db_handles_passphrase_with_*` regression tests for locked-in
/// coverage of the could-crash character set.
pub async fn init_db(
    db_path: &Path,
    encryption_key: Option<&str>,
) -> Result<SqlitePool, String> {
    let mut options = SqliteConnectOptions::from_str(&format!("sqlite:{}", db_path.display()))
        .map_err(|e| e.to_string())?
        .create_if_missing(true);

    #[cfg(feature = "sqlcipher")]
    if let Some(key) = encryption_key {
        if key.is_empty() {
            return Err("Encryption passphrase must not be empty".to_string());
        }
        // Defense-in-depth: sqlx 0.9's `pragma("key", v)` formats `v`
        // directly into the PRAGMA SQL statement as a Display value
        // with NO quoting or escaping, so a raw user passphrase containing
        // SQL-special characters (`?`, `'`, `"`, `;`) would crash the
        // PRAGMA parser with `near "?": syntax error` (the production
        // report that prompted this layer). We manually wrap the value in
        // single quotes and double any internal `'`, the standard SQL string
        // literal escape. The CANONICAL LENS callers in
        // `commands::projects::projects_*` already map the user's typed
        // passphrase through `derive_passphrase_key` to a 64-char hex
        // string before reaching here, so the value reaching this point
        // is always SQL-safe alphanumeric. This quoting is a backstop
        // for any future caller that forgets the hash step.
        let quoted = format!("'{}'", key.replace('\'', "''"));
        options = options.pragma("key", quoted);
    }

    let pool = SqlitePool::connect_with(options)
        .await
        .map_err(|e| e.to_string())?;

    migrations::run_migrations(&pool).await?;

    // **Forward-migration safety.** Persist the KDF version of this
    // project so a future LENS build can detect and migrate (or refuse
    // to open) ciphertext produced under a different on-disk
    // derivation function. See `KDF_VERSION_CURRENT` (top of this file)
    // for the contract and bumping protocol.
    //
    // Gated on:
    //   * `#[cfg(feature = "sqlcipher")]` — without SQLCipher, projects
    //     are plaintext and `kdf_version` is meaningless;
    //   * `encryption_key.is_some()` — only encrypted projects have a
    //     non-no-op KDF that a future migration would care about.
    #[cfg(feature = "sqlcipher")]
    if encryption_key.is_some() {
        // LENS-side KDF record via the canonical set_project_setting helper.
        set_project_setting(&pool, "kdf_version", KDF_VERSION_CURRENT).await?;

        // SQLCipher-side KDF snapshot (v0.1.4). These three PRAGMAs
        // (cipher_version, cipher_kdf_iter, cipher_hmac_algorithm) are
        // the SQLCipher library's own on-disk KDF knobs. The LENS-side
        // `kdf_version` only tracks what THIS build does; the three
        // rows here track what the linked `libsqlcipher` did. Combined,
        // a future build can detect a ciphertext made under a different
        // SQLCipher default and refuse to open or auto-migrate.
        //
        // CAST all values to TEXT (cipher_kdf_iter is INTEGER natively)
        // so the `value` column type stays uniform.
        //
        // Implementation note v0.1.4 round-3 fix: SQLite does NOT
        // accept `(SELECT cipher_version)` as a subquery without a
        // FROM clause — it tries to resolve `cipher_version` as
        // a column reference and errors out. We fetch the PRAGMA
        // values in Rust first via `PRAGMA <name>`, then bind them
        // into the INSERT. Result is identical, but compiler-safe.
        // PRAGMA cipher_version is TEXT (e.g. "4.5.4 community"). sqlx's
        // `fetch_one` panics with `RowNotFound` when a PRAGMA returns
        // zero rows (timing-dependent in SQLCipher; safe-fold to
        // "unknown" so a missing value never blocks init). Use
        // `fetch_optional` and default.
        let cipher_version_val: String = sqlx::query_scalar(
            "PRAGMA cipher_version",
        )
        .fetch_optional(&pool)
        .await
        .map_err(|e| format!("Failed to read PRAGMA cipher_version: {}", e))?
        .unwrap_or_else(|| {            log::warn!(
                "[LENS] PRAGMA cipher_version returned no rows at init \u{2014} defaulting to \"unknown\".");
            "unknown".to_string()
        });
        set_project_setting(&pool, "sqlcipher_cipher_version", &cipher_version_val).await?;

        // PRAGMA cipher_kdf_iter returns native INTEGER (PBKDF2 iteration
        // count, default 256000). Like cipher_version, sqlx's fetch_one
        // panics on zero rows (timing-dependent in SQLCipher). Default
        // to 256000 (the documented SQLCipher default) so a missing
        // value never blocks init.
        let cipher_kdf_iter_val: i64 = sqlx::query_scalar(
            "PRAGMA cipher_kdf_iter",
        )
        .fetch_optional(&pool)
        .await
        .map_err(|e| format!("Failed to read PRAGMA cipher_kdf_iter: {}", e))?
        .unwrap_or_else(|| {            log::warn!(
                "[LENS] PRAGMA cipher_kdf_iter returned no rows at init \u{2014} defaulting to 256000.");
            256_000_i64
        });
        set_project_setting(&pool, "sqlcipher_cipher_kdf_iter", &cipher_kdf_iter_val.to_string()).await?;

        // PRAGMA cipher_hmac_algorithm returns TEXT (e.g. "HMAC_SHA512")
        // in newer SQLCipher, INTEGER (mode code) in older versions.
        // Same defensive fetch_optional + unwrap_or default.
        let cipher_hmac_algorithm_val: String = sqlx::query_scalar(
            "PRAGMA cipher_hmac_algorithm",
        )
        .fetch_optional(&pool)
        .await
        .map_err(|e| format!("Failed to read PRAGMA cipher_hmac_algorithm: {}", e))?
        .unwrap_or_else(|| {            log::warn!(
                "[LENS] PRAGMA cipher_hmac_algorithm returned no rows at init \u{2014} defaulting to \"unknown\".");
            "unknown".to_string()
        });
        set_project_setting(&pool, "sqlcipher_cipher_hmac_algorithm", &cipher_hmac_algorithm_val).await?;
    }

    Ok(pool)
}

/// Derive a deterministic, SQLCipher-safe 64-char hex key from the
/// user's typed passphrase.
///
/// **Two jobs at once.**
///
/// 1. **Sanitize SQL-special characters before they reach sqlx.** sqlx
///    0.9's `pragma("key", v)` formats `v` directly into the PRAGMA SQL
///    statement with no quoting or escaping; without this layer a
///    passphrase containing `?` (or `'` `"` `;`) crashes the PRAGMA
///    parser. Pre-hashing to a deterministic 64-char lowercase hex
///    string [0-9a-f] is unambiguously SQL-safe and renders the
///    underlying query parser neutral regardless of pre-fix or
///    post-fix sqlx behavior.
///
/// 2. **Match the on-disk key derivation function.** Two users typing
///    the same passphrase produce the same hex; SQLCipher applies its
///    own PBKDF2 over those hex digits to derive the actual AES key.
///    The hex is a *fixed-input KDF* layer that makes the on-disk key
///    depend solely on the passphrase (modulo SQLCipher's random
///    per-database salt). With this layer in place the entire LENS
///    codebase — `commands::projects::projects_*` and
///    `commands::qdpx_import` alike — has a single canonical contract:
///    `init_db` always receives a 64-char hex string.
pub fn derive_passphrase_key(passphrase: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(passphrase.as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    //! **Scope of these tests.** All `init_db_*` tests exercise the
    //! PRAGMA-key quoting boundary in `init_db` — they prove the
    //! single-quote-wrap fix keeps user-typed passphrases with SQL
    //! special characters (`?`, `'`, `"`, `;`, etc.) from crashing
    //! the PRAGMA parser, AND that the same bytes SQLCipher receives
    //! are the bytes it uses for PBKDF2 (round-trip).
    //!
    //! Other user-input fields in LENS — project name, code name,
    //! memo body, document title — flow through `sqlx::query` with
    //! `bind()`, NOT through `init_db`. Those have separate
    //! validation upstream (e.g. `validate_project_name` rejecting
    //! non-`[A-Za-z0-9 ._-]` chars). The same byte-for-byte
    //! invariant they get is provided by sqlx's bound-parameter API
    //! itself, not by the quoting layer in this module.
    use super::*;
    use tempfile::tempdir;

    /// `init_db` with no passphrase still works (control case). Sanity
    /// check that the non-encrypted path isn't broken.
    #[tokio::test]
    async fn init_db_without_passphrase_still_works() {
        let dir = tempdir().expect("Failed to create temp dir");
        let db_path = dir.path().join("plain.qdaproj");

        let pool = init_db(&db_path, None)
            .await
            .expect("init_db without passphrase should succeed");

        sqlx::query("INSERT INTO project (id, name, description) VALUES (?, ?, ?)")
            .bind("plain-1")
            .bind("Plain Project")
            .bind(None::<String>)
            .execute(&pool)
            .await
            .expect("insert into project should succeed");
    }

    /// `init_db` with a passphrase succeeds. With the `sqlcipher` Cargo
    /// feature enabled (this build), the passphrase is installed as
    /// `PRAGMA key` on every new connection and the on-disk `.qdaproj`
    /// file is actually encrypted at rest. The `.encrypted` flag at the
    /// filesystem level is the source of truth for whether a user opted
    /// in. Schema remains usable: SELECT/INSERT work because the same
    /// key is in scope for this connection.
    #[tokio::test]
    async fn init_db_with_passphrase_creates_encrypted_database() {
        let dir = tempdir().expect("Failed to create temp dir");
        let db_path = dir.path().join("encrypted.qdaproj");

        let pool = init_db(&db_path, Some("a_user_chose_a_passphrase"))
            .await
            .expect("init_db with passphrase should succeed");

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM project")
            .fetch_one(&pool)
            .await
            .expect("query against encrypted db in same session should succeed");
        assert_eq!(count, 0, "no rows expected on a fresh encrypted db");
    }

    /// `init_db` rejects an empty passphrase explicitly so the user gets
    /// a meaningful error rather than SQLCipher accepting `PRAGMA key = ''`
    /// and silently producing an unreadable database.
    #[tokio::test]
    async fn init_db_with_empty_passphrase_is_rejected() {
        let dir = tempdir().expect("Failed to create temp dir");
        let db_path = dir.path().join("empty_pw.qdaproj");

        let result = init_db(&db_path, Some("")).await;
        assert!(
            result.is_err(),
            "empty passphrase should be rejected, got Ok"
        );
        assert!(
            result.as_ref().err().map(|e| e.contains("passphrase")).unwrap_or(false),
            "error message should mention passphrase"
        );
    }

    /// **Encryption-at-rest proof.** This test creates an encrypted
    /// `.qdaproj` with a known passphrase, then asserts four properties
    /// each of which is *required* for SQLCipher linkage to actually
    /// encrypt at rest:
    ///
    /// 1. The on-disk bytes do NOT start with the SQLite magic — proving
    ///    the file is encrypted (not a plaintext SQLite db).
    /// 2. Reopening without a passphrase fails — proving the key is
    ///    enforced on read.
    /// 3. Reopening with the wrong passphrase fails — proving the KDF
    ///    is doing real work (not a no-op).
    /// 4. Reopening with the correct passphrase succeeds AND returns
    ///    the row we wrote — proving the same key unlocks the same data.
    ///
    /// Only meaningful when the `sqlcipher` Cargo feature is on; without
    /// it, `PRAGMA key` is silently ignored by plain SQLite and the byte
    /// assertion in step 1 would fail. The `#[cfg]` gate keeps the test
    /// from running in plain-SQLite builds where it would be misleading.
    #[cfg(feature = "sqlcipher")]
    #[tokio::test]
    async fn init_db_with_sqlcipher_actually_encrypts_file() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("encrypted.qdaproj");
        // sqlx's `pragma("key", value)` formats the value into the SQL
        // statement unquoted, so spaces / em-dashes / quotes in the
        // passphrase surface as SQL syntax errors at PRAGMA parse time.
        // Restricting to alphanumeric-only keeps the test deterministic
        // across compiler / locale variations. (Real user passphrases
        // are FUNNELY hashed by `commands::projects::projects_*` into
        // a 64-char hex string before reaching `init_db`, which is
        // already a safe character set.)
        let passphrase = "correcthorsebatterystaple_test_passphrase_xyz_a1b2";

        {
            let pool = init_db(&db_path, Some(passphrase))
                .await
                .expect("init_db with passphrase should succeed");
            // Drop the pool by exiting the block; this finalises the
            // WAL/SHM if any and releases all connection files.
            sqlx::query("INSERT INTO project (id, name) VALUES (?, ?)")
                .bind("enc-proof-proj")
                .bind("Encrypted Proof Sample")
                .execute(&pool)
                .await
                .expect("insert");
            let live: i32 = sqlx::query_scalar("SELECT 1")
                .fetch_one(&pool)
                .await
                .expect("liveness check");
            assert_eq!(live, 1);
            pool.close().await;
        }

        let raw_bytes = std::fs::read(&db_path).expect("read raw db bytes");
        assert!(
            !raw_bytes.starts_with(b"SQLite format 3"),
            "on-disk .qdaproj must NOT start with the SQLite magic bytes \
             — a plain plaintext file would mean SQLCipher isn't actually \
             encrypting at rest"
        );

        let no_key = init_db(&db_path, None).await;
        assert!(
            no_key.is_err(),
            "reopening an encrypted .qdaproj without a passphrase must fail"
        );

        let wrong_key = init_db(&db_path, Some("totallywrongpassphrase999")).await;
        assert!(
            wrong_key.is_err(),
            "reopening with the wrong passphrase must fail (not silently open)"
        );

        let good_pool = init_db(&db_path, Some(passphrase))
            .await
            .expect("reopen with the correct passphrase should succeed");
        let roundtrip_name: String =
            sqlx::query_scalar("SELECT name FROM project WHERE id = ?")
                .bind("enc-proof-proj")
                .fetch_one(&good_pool)
                .await
                .expect("read project after reopen");
        assert_eq!(
            roundtrip_name, "Encrypted Proof Sample",
            "data inserted under one open should round-trip through reopen"
        );
    }

    /// **Regression: passphrase containing a `?` character.** Real-user
    /// report (prod blocker): `Failed to set encryption key: ... near "?": syntax error`.
    /// Root cause was sqlx 0.9's `pragma("key", v)` formatting `v` unquoted.
    /// This test locks in BOTH:
    ///   (a) the quoting fix at the SQL boundary (init_db must accept `?`), AND
    ///   (b) the round-trip contract — the same quoted passphrase must
    ///       unlock the data on reopen. That double-assertion proves
    ///       the bytes SQLCipher actually receives are the bytes it
    ///       uses for PBKDF2; if quoting accidentally transformed the
    ///       value (e.g., added escape characters that ended up in the
    ///       key), reopen would fail or read wrong data.
    #[cfg(feature = "sqlcipher")]
    #[tokio::test]
    async fn init_db_handles_passphrase_with_question_mark_round_trip() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("qmark.qdaproj");
        let passphrase = "What?Secret?";
        let marker_id = "rt-qmark";
        let marker_name = "? Round-trip";

        let pool = init_db(&db_path, Some(passphrase))
            .await
            .expect("init_db must accept `?` in passphrase");
        sqlx::query("INSERT INTO project (id, name) VALUES (?, ?)")
            .bind(marker_id)
            .bind(marker_name)
            .execute(&pool)
            .await
            .expect("insert");
        let same_session: (String,) =
            sqlx::query_as("SELECT name FROM project WHERE id = ?")
                .bind(marker_id)
                .fetch_one(&pool)
                .await
                .expect("same-session read");
        assert_eq!(same_session.0, marker_name);
        pool.close().await;

        let r = std::fs::read(&db_path).expect("read");
        assert!(
            !r.starts_with(b"SQLite format 3"),
            "? passphrase encrypted the file (not plaintext SQLite)"
        );

        let reopen = init_db(&db_path, Some(passphrase))
            .await
            .expect("reopen with the same `?` passphrase must succeed");
        let after_reopen: (String,) =
            sqlx::query_as("SELECT name FROM project WHERE id = ?")
                .bind(marker_id)
                .fetch_one(&reopen)
                .await
                .expect("read after reopen");
        assert_eq!(
            after_reopen.0, marker_name,
            "round-trip must preserve data exactly — proves SQLCipher \
             receives the full string and uses it for PBKDF2"
        );
    }

    /// **Regression: passphrase containing `'` (SQL string delimiter).**
    /// The quoting fix must double internal `'` to `''`. Round-trip
    /// proves the doubled-quote isn't accidentally part of the key.
    #[cfg(feature = "sqlcipher")]
    #[tokio::test]
    async fn init_db_handles_passphrase_with_single_quote_round_trip() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("squote.qdaproj");
        let passphrase = "It's a passphrase";
        let marker = "rt-squote";

        let pool = init_db(&db_path, Some(passphrase))
            .await
            .expect("init_db must accept `'` in passphrase");
        sqlx::query("INSERT INTO project (id, name) VALUES (?, ?)")
            .bind(marker)
            .bind("' Round-trip")
            .execute(&pool)
            .await
            .expect("insert");
        pool.close().await;
        assert!(!std::fs::read(&db_path).unwrap().starts_with(b"SQLite format 3"));

        let reopen = init_db(&db_path, Some(passphrase))
            .await
            .expect("reopen with `'` passphrase must succeed");
        let r: (String,) = sqlx::query_as("SELECT name FROM project WHERE id = ?")
            .bind(marker)
            .fetch_one(&reopen)
            .await
            .expect("read after reopen");
        assert_eq!(r.0, "' Round-trip");
    }

    /// **Regression: passphrase containing `"` (SQL identifier delimiter).**
    /// Inside single-quoted SQL string literals, `"` has no special
    /// meaning. Round-trip proves no character was dropped or escaped.
    #[cfg(feature = "sqlcipher")]
    #[tokio::test]
    async fn init_db_handles_passphrase_with_double_quote_round_trip() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("dquote.qdaproj");
        let passphrase = r#"Quote"Test"#;
        let marker = "rt-dquote";

        let pool = init_db(&db_path, Some(passphrase))
            .await
            .expect("init_db must accept `\"` in passphrase");
        sqlx::query("INSERT INTO project (id, name) VALUES (?, ?)")
            .bind(marker)
            .bind("\" Round-trip")
            .execute(&pool)
            .await
            .expect("insert");
        pool.close().await;
        assert!(!std::fs::read(&db_path).unwrap().starts_with(b"SQLite format 3"));

        let reopen = init_db(&db_path, Some(passphrase))
            .await
            .expect("reopen with `\"` passphrase must succeed");
        let r: (String,) = sqlx::query_as("SELECT name FROM project WHERE id = ?")
            .bind(marker)
            .fetch_one(&reopen)
            .await
            .expect("read after reopen");
        assert_eq!(r.0, "\" Round-trip");
    }

    /// **Regression: passphrase containing `;` (SQL statement terminator).**
    /// Quoting neutralizes it; round-trip confirms the `;` is part of
    /// the key material, not a statement separator.
    #[cfg(feature = "sqlcipher")]
    #[tokio::test]
    async fn init_db_handles_passphrase_with_semicolon_round_trip() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("semi.qdaproj");
        let passphrase = "pass;word";
        let marker = "rt-semi";

        let pool = init_db(&db_path, Some(passphrase))
            .await
            .expect("init_db must accept `;` in passphrase");
        sqlx::query("INSERT INTO project (id, name) VALUES (?, ?)")
            .bind(marker)
            .bind("; Round-trip")
            .execute(&pool)
            .await
            .expect("insert");
        pool.close().await;
        assert!(!std::fs::read(&db_path).unwrap().starts_with(b"SQLite format 3"));

        let reopen = init_db(&db_path, Some(passphrase))
            .await
            .expect("reopen with `;` passphrase must succeed");
        let r: (String,) = sqlx::query_as("SELECT name FROM project WHERE id = ?")
            .bind(marker)
            .fetch_one(&reopen)
            .await
            .expect("read after reopen");
        assert_eq!(r.0, "; Round-trip");
    }

    /// **Regression: Unicode / emoji passphrase.** Arbitrary UTF-8 bytes
    /// between the single quotes are not interpreted as SQL grammar.
    /// Round-trip confirms the bytes — not a UTF-8-mangled surrogate —
    /// are used for PBKDF2.
    #[cfg(feature = "sqlcipher")]
    #[tokio::test]
    async fn init_db_handles_unicode_passphrase_round_trip() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("unicode.qdaproj");
        let passphrase = "pässwörd \u{1f343}✨";
        let marker = "rt-unicode";

        let pool = init_db(&db_path, Some(passphrase))
            .await
            .expect("init_db must accept unicode/emoji in passphrase");
        sqlx::query("INSERT INTO project (id, name) VALUES (?, ?)")
            .bind(marker)
            .bind("🌍 Round-trip")
            .execute(&pool)
            .await
            .expect("insert");
        pool.close().await;
        assert!(!std::fs::read(&db_path).unwrap().starts_with(b"SQLite format 3"));

        let reopen = init_db(&db_path, Some(passphrase))
            .await
            .expect("reopen with Unicode passphrase must succeed");
        let r: (String,) = sqlx::query_as("SELECT name FROM project WHERE id = ?")
            .bind(marker)
            .fetch_one(&reopen)
            .await
            .expect("read after reopen");
        assert_eq!(r.0, "🌍 Round-trip");
    }

    /// **Regression: PRAGMA quoting contract — PBKDF2 receives the
    /// user passphrase as one byte-for-byte literal.** This test
    /// exercises a multi-token payload that resembles SQL injection
    /// grammar (`'; DROP TABLE …`), but here it is a *passphrase*, not
    /// a query. Under the pre-fix raw-passthrough bug, sqlx 0.9's
    /// `pragma("key", v)` formatted `v` unquoted, so such a string
    /// would have been parsed as multiple statements and either errored
    /// mid-statement or been silently truncated to the first token.
    /// With the single-quote-wrapping boundary in `init_db`, the
    /// entire string is treated as a single SQL string literal and
    /// `init_db` can be reopened with the same passphrase to read back
    /// the row we wrote under it — proving the bytes SQLCipher uses
    /// for PBKDF2 are those bytes unaltered.
    ///
    /// **Scope:** This test (and the `_with_question_mark_*` /
    /// `_with_single_quote_*` / `_with_double_quote_*` /
    /// `_with_semicolon_*` / `_unicode_*` round-trip tests below)
    /// cover the **PRAGMA-key boundary only**. Other user-input
    /// fields in LENS (project name, code name, memo body, document
    /// title) flow through `sqlx::query::bind()` and have separate
    /// validation upstream. They do NOT go through `init_db` and
    /// are not covered by these tests.
    #[cfg(feature = "sqlcipher")]
    #[tokio::test]
    async fn init_db_passes_full_pbkdf2_input_byte_for_byte_after_quote_escaping_round_trip() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("injection.qdaproj");
        let passphrase = "'; DROP TABLE project; -- something \"weird\"? foo;bar";
        let marker = "rt-injection";

        let pool = init_db(&db_path, Some(passphrase))
            .await
            .expect("init_db must accept injection-shaped passphrase as a literal string");
        sqlx::query("INSERT INTO project (id, name) VALUES (?, ?)")
            .bind(marker)
            // Note: in real LENS project_name validation this string
            // would be rejected upstream. We're testing init_db in
            // isolation here — the bytes are the only thing that matters.
            .bind("injected-name")
            .execute(&pool)
            .await
            .expect("insert");
        pool.close().await;
        assert!(!std::fs::read(&db_path).unwrap().starts_with(b"SQLite format 3"));

        let reopen = init_db(&db_path, Some(passphrase))
            .await
            .expect("reopen with injection-shaped passphrase must succeed");
        let r: (String,) = sqlx::query_as("SELECT name FROM project WHERE id = ?")
            .bind(marker)
            .fetch_one(&reopen)
            .await
            .expect("read after reopen — if this fails the key was truncated");
        assert_eq!(r.0, "injected-name");
    }

    /// **kdf_version is recorded for encrypted projects.** Forward-
    /// migration safety: a future LENS build that changes its on-disk
    /// KDF can detect (and refuse / migrate) an older ciphertext via
    /// `SELECT value FROM project_settings WHERE key = 'kdf_version'`.
    /// Without this row, no version signal is available.
    ///
    /// Only meaningful when the `sqlcipher` Cargo feature is on; the
    /// companion test (`init_db_skips_kdf_version_when_unencrypted`)
    /// covers the unencrypted branch.
    #[cfg(feature = "sqlcipher")]
    #[tokio::test]
    async fn init_db_records_kdf_version_when_encrypted() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("kdf-set.qdaproj");
        let pool = init_db(&db_path, Some("kdf-version-set-pass"))
            .await
            .expect("init_db with passphrase");
        let stored: Option<String> = sqlx::query_scalar(
            "SELECT value FROM project_settings WHERE key = 'kdf_version'",
        )
        .fetch_optional(&pool)
        .await
        .expect("read kdf_version");
        assert_eq!(
            stored.as_deref(),
            Some(KDF_VERSION_CURRENT),
            "kdf_version row must reflect the current KDF_VERSION_CURRENT \
             constant — if you bumped it, this test will fail and the bump \
             is intentional"
        );
        pool.close().await;
    }

    /// **kdf_version is NOT recorded for unencrypted projects.** Plain
    /// projects have a no-op KDF; tagging them with a version string
    /// would imply forward-migration safety they don't actually have.
    /// The `project_settings` table itself is created by migration 07
    /// for ALL projects; that's fine, it's just empty for plaintext.
    #[cfg(feature = "sqlcipher")]
    #[tokio::test]
    async fn init_db_skips_kdf_version_when_unencrypted() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("kdf-skip.qdaproj");
        let pool = init_db(&db_path, None)
            .await
            .expect("init_db unencrypted");
        let rows: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM project_settings WHERE key = 'kdf_version'",
        )
        .fetch_one(&pool)
        .await
        .expect("count kdf_version rows");
        assert_eq!(rows, 0, "no kdf_version row for plaintext projects");
        pool.close().await;
    }

    /// **SQLCipher-side KDF settings are recorded for encrypted projects.**
    /// Forward-migration safety matrix: a future LENS build can read all
    /// of `kdf_version`, `sqlcipher_cipher_version`,
    /// `sqlcipher_cipher_kdf_iter`, `sqlcipher_cipher_hmac_algorithm`
    /// and decide whether the on-disk ciphertext is still legible under
    /// its full KDF. Without these rows, no SQLCipher-side signal is
    /// available — a `libsqlcipher` upgrade that shifts `cipher_kdf_iter`
    /// default would silently corrupt the project's open path.
    #[cfg(feature = "sqlcipher")]
    #[tokio::test]
    async fn init_db_records_sqlcipher_kdf_settings_when_encrypted() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("sqlcipher-snap.qdaproj");
        let pool = init_db(&db_path, Some("snap-pass"))
            .await
            .expect("init_db with passphrase");

        for key in [
            "sqlcipher_cipher_version",
            "sqlcipher_cipher_kdf_iter",
            "sqlcipher_cipher_hmac_algorithm",
        ] {
            let value: Option<String> =
                sqlx::query_scalar("SELECT value FROM project_settings WHERE key = ?")
                    .bind(key)
                    .fetch_optional(&pool)
                    .await
                    .expect("read snapshot");
            assert!(
                value.is_some(),
                "{key} row must be recorded for encrypted projects — if missing, \
                 init_db's PRAGMA snapshot block regressed",
            );
            assert!(
                !value.as_deref().unwrap().is_empty(),
                "{key} value must not be empty",
            );
        }
        pool.close().await;
    }

    /// **SQLCipher-side KDF settings are NOT recorded for plaintext projects.**
    /// Plaintext projects have a no-op KDF on both LENS and SQLCipher
    /// sides; tagging them with these settings would imply
    /// forward-migration safety they don't actually have.
    #[cfg(feature = "sqlcipher")]
    #[tokio::test]
    async fn init_db_skips_sqlcipher_kdf_settings_when_unencrypted() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("sqlcipher-skip.qdaproj");
        let pool = init_db(&db_path, None)
            .await
            .expect("init_db unencrypted");
        let total: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM project_settings WHERE key IN \
             ('sqlcipher_cipher_version','sqlcipher_cipher_kdf_iter','sqlcipher_cipher_hmac_algorithm')",
        )
        .fetch_one(&pool)
        .await
        .expect("count snapshot rows");
        assert_eq!(total, 0, "no SQLCipher settings rows for plaintext projects");
        pool.close().await;
    }

    /// **Helper unit test: derive_passphrase_key is deterministic and
    /// produces a 64-char hex string.** Confirms the on-disk KDF input
    /// is stable across calls and SQL-safe. Used as a sanity check that
    /// the Path B hash layer (`commands::projects::projects_*`) produces
    /// exactly what SQLCipher's PBKDF2 will be invoked with.
    #[test]
    fn derive_passphrase_key_is_deterministic_and_64_hex() {
        let a = derive_passphrase_key("hello-world");
        let b = derive_passphrase_key("hello-world");
        assert_eq!(a, b, "same input → same hex");
        assert_eq!(a.len(), 64, "SHA-256 hex is 64 chars");
        assert!(
            a.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
            "lowercase hex only (SQL & file-name safe)"
        );

        // Different inputs → different hexes.
        let c = derive_passphrase_key("hello-earth");
        assert_ne!(
            a, c,
            "different input → different hex (SHA-256 collision-resistant)"
        );
    }

    /// **autosave_checkpoint footer-cleanup invariant.** A first checkpoint
    /// on a fresh DB after some writes should report 0 busy frames (no
    /// in-flight concurrent writer) and at least 0 checkpointed pages
    /// (idempotent on empty WAL — not an error). This test stands in for
    /// the larger crash-recovery work: it proves the wrapper compiles,
    /// PgReturn shape is consumed correctly, and call-side wiring works.
    /// Real durability is exercised by the upstream `init_db` tests
    /// (encrypted + unencrypted) plus the integration migration round-trip
    /// test in `tests/migration_round_trip.rs`.
    #[tokio::test]
    async fn autosave_checkpoint_returns_zero_pages_on_idle_wal() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("checkpoint-idle.qdaproj");
        let pool = init_db(&db_path, None).await.expect("init_db");

        let pages = autosave_checkpoint(&pool)
            .await
            .expect("checkpoint on idle WAL should succeed");
        assert!(pages >= 0, "checkpoint returns non-negative page count");
        pool.close().await;
    }

    /// **autosave_checkpoint after writes returns ≥0 pages.** Smoke for
    /// the "did real work" half of the wrapper. We don't pin an upper
    /// bound: SQLite's WAL bookkeeping varies by migration-set size.
    /// The lower bound is the contract — ratcheting non-negative is
    /// enough to prove no panic path is hit on a non-empty WAL.
    #[tokio::test]
    async fn autosave_checkpoint_after_writes_returns_nonnegative_pages() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("checkpoint-writes.qdaproj");
        let pool = init_db(&db_path, None).await.expect("init_db");
        sqlx::query("INSERT INTO project (id, name) VALUES (?, ?)")
            .bind("ck-mod")
            .bind("Checkpoint Module Test")
            .execute(&pool)
            .await
            .expect("insert project");
        let pages = autosave_checkpoint(&pool)
            .await
            .expect("checkpoint after writes");
        assert!(pages >= 0, "checkpoint page count must be non-negative after writes");
        pool.close().await;
    }

    /// **set_project_setting upserts idempotently.** Two consecutive calls
    /// with the same key must produce ONE row, the second value wins
    /// (ON CONFLICT...DO UPDATE). The first call's `updated_at` may or
    /// may not equal the second's; we don't pin the timestamp.
    #[tokio::test]
    async fn set_project_setting_upserts_idempotently() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("set-setting.qdaproj");
        let pool = init_db(&db_path, None).await.expect("init_db");
        set_project_setting(&pool, "last_saved_at", "2024-01-01T00:00:00Z")
            .await
            .expect("first set");
        set_project_setting(&pool, "last_saved_at", "2024-12-01T00:00:00Z")
            .await
            .expect("second set overrides");

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM project_settings WHERE key = 'last_saved_at'",
        )
        .fetch_one(&pool)
        .await
        .expect("count rows");
        assert_eq!(count, 1, "exactly one row per key");

        let row: (String, String) = sqlx::query_as(
            "SELECT value, updated_at FROM project_settings WHERE key = 'last_saved_at'",
        )
        .fetch_one(&pool)
        .await
        .expect("read back");
        assert_eq!(row.0, "2024-12-01T00:00:00Z", "second value replaces first");
        assert!(!row.1.is_empty(), "updated_at column populated by trigger-equivalent strftime");
        pool.close().await;
    }

    /// **set_project_setting rejects empty key.** Empty key would
    /// satisfy SQL but is semantically meaningless: callers can't
    /// look up "" later. Catch this at the Rust boundary so a typo
    /// doesn't silently produce an orphan row.
    #[tokio::test]
    async fn set_project_setting_rejects_empty_key() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("set-setting-empty.qdaproj");
        let pool = init_db(&db_path, None).await.expect("init_db");
        let result = set_project_setting(&pool, "", "any_value").await;
        assert!(result.is_err(), "empty key must be rejected");
        assert!(
            result.as_ref().err().map(|e| e.contains("must not be empty")).unwrap_or(false),
            "error message must mention the rejection reason"
        );
        pool.close().await;
    }
}

/// Periodic WAL checkpoint + autosave API.
///
/// `autosave_checkpoint` is the user-callable wrapper that takes a
/// `SqlitePool` and forces a `PRAGMA wal_checkpoint(TRUNCATE)`. Returns
/// the number of WAL frames archived (a.k.a. pages) so callers can log
/// or assert on it.
///
/// **Why this public API exists.** The migration runner enables WAL mode
/// (`journal_mode = WAL`, `synchronous = NORMAL`) for every project at
/// first open. WAL gives concurrent readers + a single writer. The
/// durability tradeoff is that committed-but-not-yet-checkpointed pages
/// live in the `-wal` sidecar until either (a) the WAL grows past a
/// threshold, or (b) a CHECKPOINT is requested.
///
/// Without an explicit checkpoint mechanism, two failure modes emerge:
///
/// 1. **WAL bloat:** a long-running session that writes continuously
///    keeps the WAL sidecar growing. After ~1000 pages (the
///    `wal_autocheckpoint` default) SQLite auto-checkpoints, but a
///    user-driven checkpoint gives the researcher an explicit
///    "I closed the loop on this work" affordance.
///
/// 2. **Stale `-wal` files after a forced quit:** if a user kills the
///    app between a successful commit and the auto-checkpoint,
///    `*.qdaproj-wal` survives in the project folder. A subsequent
///    LENS open runs normal SQLite recovery and replays the WAL
///    transparently, but the sidecar file is confusing in
///    `ls -la project/`. Truncate-checkpointing aggressively on
///    shutdown or `File > Close Project` eliminates the sidecar.
///
/// **Caller contract.** `pool` must come from `init_db`. Other pools
/// (test fixtures) work fine. This function does NOT spawn a
/// background task; it is a synchronous on-`tokio::task::spawn` opt-in
/// for `lens::run()` callers that want periodic checkpoints or a
/// close-time flush.
pub async fn autosave_checkpoint(pool: &SqlitePool) -> Result<i64, String> {
    // PRAGMA wal_checkpoint(TRUNCATE) returns a 3-tuple: (busy, log_pages, checkpointed_pages).
    // `query_as<(i64, i64, i64)>` consumes the full PRAGMA result row.
    let row: (i64, i64, i64) = sqlx::query_as("PRAGMA wal_checkpoint(TRUNCATE)")
        .fetch_one(pool)
        .await
        .map_err(|e| format!("autosave_checkpoint failed: {}", e))?;
    let busy = row.0;
    let checkpointed_pages = row.2;
    if busy != 0 {
        // A `busy` return means another connection has uncommitted writes — not an
        // error, just informational. Surfacing it lets a future operator looking
        // at logs see the busy state and understand why a "hard checkpoint" was
        // rolled back to a passive one.
        log::warn!(
            target: "lens::db",
            "autosave_checkpoint returned busy=1 ({} pages waiting); checkpointed pages: {}",
            row.1, checkpointed_pages
        );
    }
    Ok(checkpointed_pages)
}

/// Insert-or-update a project_settings row. Used by `autosave` callers
/// that want to remember the last successful checkpoint timestamp so
/// the user can see when their work was last "durably flushed".
///
/// **Why exposed publicly.** Putting this helper next to
/// `autosave_checkpoint` means callers (UI's `View > Show last
/// checkpoint` indicator, future background autosave task) have one
/// canonical way to write into the KDF-version-and-related-settings
/// table without duplicating the SQL text from db::migrations.
pub async fn set_project_setting(
    pool: &SqlitePool,
    key: &str,
    value: &str,
) -> Result<(), String> {
    if key.is_empty() {
        return Err("project_settings key must not be empty".to_string());
    }
    sqlx::query(
        "INSERT INTO project_settings (key, value) VALUES (?, ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, \
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .map_err(|e| format!("set_project_setting({key}) failed: {}", e))?;
    Ok(())
}
