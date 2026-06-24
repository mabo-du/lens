/**
 * Shared validation constants for the project-name input.
 *
 * These mirror the rules in `validate_project_name` in
 * `src-tauri/src/commands/projects.rs` so the in-dialog UX feedback
 * matches the server-side authoritative check. Any relaxation or
 * tightening on either side must be reflected here.
 *
 * Reference (Rust):
 *   - empty rejected
 *   - len <= MAX_PROJECT_NAME_LENGTH
 *   - reject if Path::new(name).is_absolute() (POSIX or Windows drive)
 *   - reject if any component is ParentDir ("..") or CurDir (".")
 *   - allow only alphanumeric, space, dot, underscore, hyphen
 */

export const MAX_PROJECT_NAME_LENGTH = 64;

/**
 * Single-character regex-style predicate for allowed chars. Note this is
 * ASCII-only by design (matches the Rust `is_ascii_alphanumeric`-based
 * allowlist). Unicode project names are not supported in v1; revisit
 * for v1.1+.
 */
export const PROJECT_NAME_ALLOWED_CHAR_PATTERN = /[A-Za-z0-9 ._-]/;

/**
 * Run the full allowlist + length + path-shape checks against a name.
 * Mirrors `validate_project_name` 1:1 for the rules covered by the
 * constants above. Returns null on success, or a short user-visible
 * reason on failure.
 *
 * NOTE: This is a UX-only duplication of the Rust check. The Rust-side
 * validation is authoritative; the frontend uses this for immediate
 * in-dialog feedback so the user doesn't have to round-trip a server
 * error.
 */
export function validateProjectNameClient(v: string): string {
  const trimmed = v.trim();
  if (!trimmed) return 'Project name must not be empty';
  if (trimmed.length > MAX_PROJECT_NAME_LENGTH) {
    return `Project name must be ${MAX_PROJECT_NAME_LENGTH} characters or fewer`;
  }

  // Mirror Rust's `Path::new(name).components()` rejection of any
  // `CurDir` ('.') or `ParentDir` ('..') segment, plus leading-dot
  // segments that Rust resolves as CurDir/ParentDir (e.g. ".foo",
  // "..foo", "foo/.", "foo/.."). Splitting on both POSIX and Windows
  // path separators here matches what Rust's components() collapses.
  const segments = trimmed.split(/[/\\]+/).filter((s) => s.length > 0);
  if (
    segments.some(
      (s) => s === '.' || s === '..' || s.startsWith('.'),
    )
  ) {
    return "Project name segments must not be '.' or '..' or start with '.'";
  }
  // Absolute paths: POSIX leading slash, or Windows drive letter prefix.
  if (
    trimmed.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(trimmed)
  ) {
    return 'Project name must not be an absolute path';
  }
  if (!trimmed.split('').every((c) => PROJECT_NAME_ALLOWED_CHAR_PATTERN.test(c))) {
    return 'Allowed: A-Z, a-z, 0-9, space, dot, underscore, hyphen';
  }
  return '';
}
