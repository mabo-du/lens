//! Root-level integration test for the panic-freedom contract of `lens::DbKey`.
//!
//! **Why this file lives in `tests/` (not `src/`):**
//! The internal test suite at `src-tauri/src/commands/projects.rs::dbkey_tests`
//! can reach the `pub(crate)` inner field directly, so it can construct a
//! `DbKey(Some("short".to_string()))` to exercise the panic-prone short-
//! inner-string path. This integration test, by contrast, lives under
//! `tests/` and is restricted to the public surface of the `lens` library
//! crate. It verifies that **every public construction path** produces a
//! `DbKey` whose `Display` and `Debug` never panic AND never leak the full
//! 64-char inner hex (the security invariant).
//!
//! **Note on inner field visibility:**
//! `DbKey`'s inner field is `pub(crate) Option<String>` -- deliberately NOT
//! `pub` so external code cannot bypass the canonical constructors
//! (`from_passphrase`, `from_hex`, `Default`). This integration test
//! therefore uses only the public API, which means the panic-prone short-
//! inner-string path is unreachable from this test (those short values can
//! only enter the type via internal test fixtures today). The public-API
//! panic-freedom contract that this test DOES verify is:
//!
//!   1. `Default` -> `DbKey(None)` -> `<DbKey None>`
//!   2. `from_passphrase(None | Some(non-empty))` -> canonical 64-char hex
//!   3. `from_hex(None)` -> `DbKey(None)` -> `<DbKey None>`
//!   4. `from_hex(Some(64-char-lowercase-hex))` -> canonical 64-char hex
//!   5. `from_hex(Some(_))` with any other shape -> `Err` (NEVER Ok)
//!
//! Combination of (1)-(5) proves: any successful public construction
//! yields a DbKey that renders in well under 32 chars and never prints
//! its inner hex.

use lens::DbKey;

// ---------- Public-API panic-freedom tests ----------

/// `Default` yields `DbKey(None)` whose Display + Debug are both
/// `<DbKey None>` -- the only stable rendering for the None variant.
#[test]
fn public_default_renders_canonical_none() {
    let k = DbKey::default();
    assert_eq!(format!("{}", k), "<DbKey None>");
    assert_eq!(format!("{:?}", k), "<DbKey None>");
}

/// `from_passphrase(Some(non-empty))` yields a 64-char lowercase hex
/// whose truncated Display is well under 32 chars, includes the
/// ellipsis (U+2026) sentinel, and is bounded.
#[test]
fn public_from_passphrase_produces_truncated_display() {
    let k = DbKey::from_passphrase(Some("hello-world"))
        .expect("non-empty passphrase");
    let rendered = format!("{}", k);
    assert!(rendered.starts_with("<DbKey hex="),
            "Display must start with the canonical prefix, got: {rendered}");
    assert!(rendered.ends_with('>'),
            "Display must end with '>', got: {rendered}");
    assert!(rendered.contains('\u{2026}'),
            "Display must include the U+2026 ellipsis sentinel, got: {rendered}");
    assert!(rendered.len() < 32,
            "Display output must be < 32 chars (well under any plausible 8-char hex prefix), got len={}: {rendered}",
            rendered.len());
}

/// Debug must delegate to Display (no separate Debug representation
/// that could leak the inner hex). This is the security invariant
/// for `dbg!()` / `{:?}` / `tracing::debug!{?key}` callers.
#[test]
fn public_debug_delegates_to_display() {
    let k = DbKey::from_passphrase(Some("delegation-test"))
        .expect("non-empty passphrase");
    let debug_rendered = format!("{:?}", k);
    let display_rendered = format!("{}", k);
    assert_eq!(debug_rendered, display_rendered,
               "Debug must produce identical output to Display, got debug={debug_rendered} display={display_rendered}");
}

/// Security invariant: Debug output must NEVER contain the full
/// 64-char hex. A future contributor who re-adds `#[derive(Debug)]`
/// fails this test on the spot.
#[test]
fn public_debug_does_not_leak_full_hex() {
    let k = DbKey::from_passphrase(Some("leak-test-pass"))
        .expect("non-empty passphrase");
    let debug_rendered = format!("{:?}", k);
    let full_hex = k.as_deref().expect("Some");
    assert!(!debug_rendered.contains(full_hex),
            "Debug MUST NOT print the full 64-char hex, got: {debug_rendered}");
    assert!(debug_rendered.len() < 32,
            "Debug output length budget, got len={}: {debug_rendered}",
            debug_rendered.len());
}

/// `from_hex` rejects every unsafe input shape. Any input that
/// bypasses validation is itself a security bug, so we assert rejection.
#[test]
fn public_from_hex_rejects_unsafe_inputs() {
    // Wrong length (off-by-one or worse).
    assert!(DbKey::from_hex(Some("a".repeat(63))).is_err(),
            "63 chars must be rejected");
    assert!(DbKey::from_hex(Some("a".repeat(65))).is_err(),
            "65 chars must be rejected");
    assert!(DbKey::from_hex(Some(String::new())).is_err(),
            "empty string must be rejected");
    assert!(DbKey::from_hex(Some("a".repeat(32))).is_err(),
            "32 chars (half-length hash) must be rejected");

    // Wrong case (uppercase).
    assert!(DbKey::from_hex(Some("A".repeat(64))).is_err(),
            "uppercase A-F must be rejected");
    assert!(DbKey::from_hex(Some("0".repeat(63) + "A")).is_err(),
            "even one uppercase char must be rejected");

    // Non-hex chars.
    assert!(DbKey::from_hex(Some("z".repeat(64))).is_err(),
            "'z' is not a hex char, must be rejected");
    assert!(DbKey::from_hex(Some("0123456789abcdef".repeat(4).replace("a", "g"))).is_err(),
            "'g' is not a hex char, must be rejected");
}

/// All public construction paths together: cover Default, from_passphrase
/// (None + Some), from_hex (None + Some valid). Every Ok DbKey must
/// render without panicking in Display OR Debug, AND must not leak the
/// full hex. The single test covers all branches so a regression in any
/// construction path shows up as one failure with full diagnostic.
#[test]
fn public_construction_paths_never_panic_through_display() {
    use std::fmt::Write;

    let valid_64_hex = "0".repeat(64);

    let keys: Vec<DbKey> = vec![
        DbKey::default(),
        DbKey::from_passphrase(None).expect("None valid"),
        DbKey::from_passphrase(Some("a")).expect("non-empty a"),
        DbKey::from_passphrase(Some("with spaces & special!? chars")).expect(""),
        DbKey::from_hex(None).expect("None valid"),
        DbKey::from_hex(Some(valid_64_hex.clone())).expect("valid hex"),
    ];

    let mut display_buf = String::new();
    let mut debug_buf = String::new();

    for k in &keys {
        display_buf.clear();
        debug_buf.clear();

        // Display::fmt must NEVER panic for any public-API DbKey value.
        write!(display_buf, "{}", k)
            .expect("Display::fmt must not panic for public-API DbKey");
        // Debug::fmt must NEVER panic for any public-API DbKey value.
        write!(debug_buf, "{:?}", k)
            .expect("Debug::fmt must not panic for public-API DbKey");

        // Length budget: no public-API Debug/Display can be long enough
        // to enclose the full 64-char hex inline.
        assert!(display_buf.len() < 64,
                "Display output length must be bounded, got len={}: {display_buf}",
                display_buf.len());
        assert!(debug_buf.len() < 64,
                "Debug output length must be bounded, got len={}: {debug_buf}",
                debug_buf.len());

        // Round-trip through Debug's known None shape to verify the
        // canonical rendering for the no-hex branch.
        if k.as_deref().is_none() {
            assert_eq!(display_buf, "<DbKey None>",
                       "DbKey(None) must render exactly <DbKey None>");
            assert_eq!(debug_buf, "<DbKey None>",
                       "Debug of DbKey(None) must mirror Display");
        } else {
            // Some(64-char): Display prefix, ellipsis sentinel, end '>'.
            assert!(display_buf.starts_with("<DbKey hex="),
                    "Some(64-char) Display prefix missing: {display_buf}");
            assert!(display_buf.contains('\u{2026}'),
                    "Some(64-char) Display must include U+2026: {display_buf}");
            assert!(display_buf.ends_with('>'),
                    "Some(64-char) Display must close with '>': {display_buf}");

            // Debug delegation for Some(64-char).
            assert_eq!(debug_buf, display_buf,
                       "Debug must equal Display for Some(64-char)");
        }
    }
}

/// `is_some` / `as_deref` accessors behave consistently across
/// construction paths.
#[test]
fn public_accessors_consistent_across_constructions() {
    let none = DbKey::default();
    assert!(!none.is_some());
    assert_eq!(none.as_deref(), None);

    let from_p_none = DbKey::from_passphrase(None).expect("from_passphrase(None)");
    assert!(!from_p_none.is_some());
    assert_eq!(from_p_none.as_deref(), None);

    let from_h_none = DbKey::from_hex(None).expect("from_hex(None)");
    assert!(!from_h_none.is_some());
    assert_eq!(from_h_none.as_deref(), None);

    let from_p_some = DbKey::from_passphrase(Some("k")).expect("from_passphrase(Some)");
    assert!(from_p_some.is_some());
    assert!(from_p_some.as_deref().is_some());
    assert_eq!(from_p_some.as_deref().unwrap().len(), 64);

    let from_h_some = DbKey::from_hex(Some("1".repeat(64))).expect("from_hex(Some)");
    assert!(from_h_some.is_some());
    assert_eq!(from_h_some.as_deref(), Some("1".repeat(64).as_str()));
}
