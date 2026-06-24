# Changelog

All notable changes to LENS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-rc.1] - 2026-06-24

First release candidate. Public-domain-format imports (txt / docx / pdf), structured
codebook with closure-table ancestry, prose-mirror-backed annotations, REFI-QDA export,
full-text search, project journals, annotated-image imports (Phase C MVP backend),
SQLite data layer with race-safe dedup, local-first Tauri 2 desktop shell.

### Added
- **Phase C MVP image coding (backend)** — Imports for PNG/JPG/JPEG via the Rust
  `image` crate's header-only dimension reader (no pixel allocation). Each image
  document records `intrinsic_w` / `intrinsic_h` (migration `04_image_format.sql`)
  ready for the upcoming region-annotation pipeline. The full Konva-based viewer
  with region drawing ships in v0.1.1.
- **Phase B correctness hardening** — Closure-table depth-stacking test
  (`closure_table_invariant_depth_stacking`) that proves `p.depth + s.depth + 1`
  composes transitively (Y → C must colon to depth 3 after a sub-tree move).
- **PDF extractor version bake** — `build.rs` now reads the pdfplumber pin from
  `src-tauri/sidecars/pdfplumber/requirements.txt` (fall-back to
  `pdfplumber-unknown` if the host Python is missing). The previous host-`python3`
  probe is gone, removing cross-environment ambiguity.
- **`documents_import_internal` UNIQUE-violation mapping** — Concurrent-import
  race window closed: the optimistic duplicate-check is preserved, but the
  UNIQUE(`project_id`, `text_hash`) constraint (migration 02) is now the final
  defense, mapped to a friendly duplicate message instead of a raw SQLite error.
- **Architecture documentation** — `ARCHITECTURE.md` rewritten as a comprehensive
  16-chapter sourcebook for future maintainers, with cross-references to all 19
  research papers under `docs/research-papers/`.
- **Apple signing onboarding runbook** — `docs/onboarding-apple-developer.md` +
  `scripts/set-release-secrets.sh`. Includes the BSD/macOS `base64 -b 0` fix,
  missing-file diagnostic output for `TAURI_KEY_FILE` overrides, and the
  `security find-identity` "between the double quotes" snippet.

### Changed
- **Project name validation** — `src/lib/validation.ts` rejects trailing path
  separators (`"foo/"` no longer collapses silently to `"foo"`) and produces a
  specific error message (`"Project name parts must not start with '.'"`).
- **Migration registry** — `src-tauri/src/db/migrations.rs` now lists migration
  04 alongside 01 / 02 / 03.
- **Document IPC type** — `src/ipc/documents.ts` extends `DocumentRecord` with
  optional `intrinsicW` / `intrinsicH` for image documents.

### Fixed
- **Concurrent-import race** — Optimistic duplicate-check + UNIQUE constraint +
  transaction wrap + `UniqueViolation` mapping combine to give race-safe dedup
  with a user-friendly error message.
- **Apple-signing `base64` crash** — macOS `base64` does not accept `-w 0`; the
  onboard runbook now uses `-b 0` (BSD-style) so the resulting secret actually
  fits in a GitHub Actions masked variable.

### Security
- Tauri 2 sandbox, strict CSP, asset-protocol scoped (no global FS access from
  renderer). Update endpoint pinned to `github.com/mabo-du/lens/releases/latest`
  with an explicit public key.

## [Unreleased]

### Planned for v0.1.1
- Konva-based image viewer with region-drawing canvas
- SQLite-level region annotations for image documents (Phase D)
- Memos-on-region binding (cross-document annotation memos)
- Konva vs custom-canvas performance benchmarking under WSL/Raspberry Pi 4
