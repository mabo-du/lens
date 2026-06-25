use std::fs;
use std::path::Path;

/// Parse "name[op]version" lines and return the version string for `name`.
/// Handles `==`, `>=`, `<=`, `~=`, `!=`. Order-independent.
///
/// Per-line fail-closed semantics: a line that doesn't match a
/// recognised operator (e.g. pip's `@ file://...` URL syntax, `-r
/// other-file.txt` includes, marker lines like `-e .`, or anything
/// else pip 23+ recognises but is outside the simple `name op ver`
/// triple) is **skipped** rather than aborting the parse. This way,
/// `parse_pinned_version` keeps scanning a multi-line requirements.txt
/// for the desired package even when earlier lines aren't the expected
/// shape. The build falls back to `"unknown"` only if the desired
/// package is itself absent or its pinning is malformed.
///
/// Multi-constraint and env-marker lines are **rejected entirely**
/// (not silently truncated):
///   - PEP 440 multi-constraint: `pdfplumber>=0.11,<0.12` — silently
///     keeping only the lower bound would lose the upper bound, so
///     we refuse and treat the line as malformed.
///   - PEP 508 environment marker: `pdfplumber==0.11; python_version <= "3.8"`
///     — the marker is conditional install logic, not a version. We
///     refuse rather than bake a malformed `PDFPLUMBER_VERSION=<env-marker>`
///     stamp into the build.
///
/// Version tokens are parsed up to the next whitespace or `#` (inline
/// trailing comment). The presence of `,` or `;` anywhere in the
/// resulting token triggers a reject per the rules above.
fn parse_pinned_version(reqs_txt: &str, name: &str) -> Option<String> {
    let recognised = ["==", ">=", "<=", "~=", "!="];

    for line in reqs_txt.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        // Find the EARLIEST occurrence of any supported operator. If
        // none match this line, it's URL syntax / -r include / etc.;
        // skip and keep scanning rather than failing the whole parse.
        let (op_pos, op_len) = match recognised
            .iter()
            .filter_map(|op| line.find(op).map(|p| (p, op.len())))
            .min_by_key(|(p, _)| *p)
        {
            Some(t) => t,
            None => continue,
        };

        let (pkg, rest) = line.split_at(op_pos);
        let ver_token = &rest[op_len..];
        // Stop on whitespace OR inline-comment marker. The presence
        // of `,` / `;` is checked BELOW — take_while only needs to
        // honour the natural end-of-token boundaries.
        let ver: String = ver_token
            .chars()
            .take_while(|c| !c.is_whitespace() && *c != '#')
            .collect();
        // Reject multi-constraint (comma) and env-marker (semicolon)
        // contamination. Empty version is also a malformed line.
        if ver.is_empty() || ver.contains(',') || ver.contains(';') {
            continue;
        }

        let pkg = pkg.trim();
        let ver = ver.trim();
        if pkg.eq_ignore_ascii_case(name) {
            return Some(ver.to_string());
        }
    }
    None
}

/// Bake the runtime pdfplumber version into PDFPLUMBER_VERSION as a
/// compile-time constant via `env!("PDFPLUMBER_VERSION")`.
///
/// Source of truth: `src-tauri/sidecars/pdfplumber/requirements.txt`.
/// Reading from a pinned file (not the host's `python3 -c 'import
/// pdfplumber'`) guarantees the stamped version matches the actual
/// sidecar binary even when the CI runner's host Python lacks the
/// pdfplumber package or has a different version installed globally.
///
/// Falls back to "unknown" if the file is absent or unparseable so
/// the build never fails purely on sidecar metadata.
fn main() {
    let pdfplumber_version = read_pdfplumber_version()
        .unwrap_or_else(|| "unknown".to_string());

    println!("cargo:rustc-env=PDFPLUMBER_VERSION={}", pdfplumber_version);

    // Re-run if the requirements file changes (so version bumps trigger
    // a recompile without manual `cargo clean`).
    println!(
        "cargo:rerun-if-changed=src-tauri/sidecars/pdfplumber/requirements.txt"
    );

    tauri_build::build()
}

fn read_pdfplumber_version() -> Option<String> {
    let path = Path::new("src-tauri/sidecars/pdfplumber/requirements.txt");
    let contents = fs::read_to_string(path).ok()?;
    parse_pinned_version(&contents, "pdfplumber")
}

#[cfg(test)]
mod tests {
    use super::parse_pinned_version;

    #[test]
    fn parses_double_equals_pin() {
        let r = "pdfplumber==0.11.4\npyinstaller==6.0.0\n";
        assert_eq!(parse_pinned_version(r, "pdfplumber"), Some("0.11.4".to_string()));
        assert_eq!(parse_pinned_version(r, "pyinstaller"), Some("6.0.0".to_string()));
        assert_eq!(parse_pinned_version(r, "missing"), None);
    }

    #[test]
    fn ignores_comments_and_blank_lines() {
        let r = "# comment\n\npdfplumber==0.11.4\n";
        assert_eq!(parse_pinned_version(r, "pdfplumber"), Some("0.11.4".to_string()));
    }

    #[test]
    fn handles_unsupported_operators_gracefully() {
        // >= should be parsed (>= is in the supported set).
        let r = "pdfplumber>=0.11.0\n";
        assert_eq!(parse_pinned_version(r, "pdfplumber"), Some("0.11.0".to_string()));
    }

    #[test]
    fn url_syntax_line_does_not_poison_subsequent_pinned_lines() {
        // Regression guard for the bug where a non-operator line
        // anywhere BEFORE the pinned line would abort the whole parse.
        // Real-world requirements.txt lines that have no recognised
        // operator include:
        //   - pip URL/local refs: pdfplumber @ file:///tmp/local.tar.gz
        //   - include directives: -r other-requirements.txt
        //   - editable installs:    -e .
        let r = "# top header
pdfplumber @ file:///tmp/local-pdfplumber.tar.gz
-e .
-r other-requirements.txt
pdfplumber==0.11.4
";
        assert_eq!(
            parse_pinned_version(r, "pdfplumber"),
            Some("0.11.4".to_string()),
            "Unpinned/url-syntax lines before the pinned package must not poison the parse"
        );
    }

    #[test]
    fn comma_separated_constraints_are_rejected() {
        // PEP 440 supports multiple comma-separated constraints ORed on
        // a single line, e.g. `pdfplumber>=0.11.0,<0.12.0`. Silently
        // picking a single token would drop the upper bound without
        // warning, which is worse than refusing and falling back to
        // "unknown".
        let r = "pdfplumber>=0.11.0,<0.12.0\n";
        assert_eq!(
            parse_pinned_version(r, "pdfplumber"),
            None,
            "Multi-constraint pins are intentionally rejected"
        );
    }

    #[test]
    fn env_marker_semicolon_is_rejected() {
        // PEP 508 environment markers appear as `; python_version <= "3.8"`
        // on the same requirement line. The marker is conditional install
        // logic, not a version. Treating the post-`;` content as part
        // of the version would bake a malformed stamp into the build.
        let r = "pdfplumber==0.11.4; python_version <= \"3.8\"\n";
        assert_eq!(
            parse_pinned_version(r, "pdfplumber"),
            None,
            "Env-marker lines are intentionally rejected"
        );
    }

    #[test]
    fn trailing_inline_comment_is_stripped() {
        let r = "pdfplumber==0.11.4  # stable release\n";
        assert_eq!(
            parse_pinned_version(r, "pdfplumber"),
            Some("0.11.4".to_string())
        );
    }
}
