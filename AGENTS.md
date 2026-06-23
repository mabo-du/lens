<!-- gitnexus:start -->
# LENS — Qualitative Data Analysis (QDA) Desktop App

**Stack:** Tauri 2 (Rust + React 19/TypeScript 5), SQLite via sqlx, TailwindCSS 4, Zustand 5, ProseMirror.

## Verification

```bash
npx tsc --noEmit && (cd src-tauri && cargo test && cargo build)
```

## Off-Limits

- Do NOT modify `.gitnexus/`, `.ctx/`, `.beads/`, `.charter/`, or `.claude/`.
- Do NOT modify `src-tauri/src/db/migrations/` or `schemas/` without approval.
- Do NOT modify `.github/workflows/`, CI/CD, or deploy scripts.
- Do NOT install global packages or modify system configuration.
- Do NOT push, force-push, or rewrite published branches.
- Do NOT touch `.env*` files; use `.env.example` for reference.

## Rules

- Run `gitnexus_impact` before editing symbols. Warn on HIGH/CRITICAL risk.
- Run `gitnexus_detect_changes()` before committing.
- Use `gitnexus_query` for concepts, `gitnexus_context` for symbols.
- Never rename with find-and-replace; use `gitnexus_rename`.

## Project Structure

| Directory | Purpose |
|-----------|--------|
| `src/` | React frontend |
| `src-tauri/` | Rust backend |
| `src-tauri/src/db/migrations/` | SQLite migrations (off-limits) |
| `schemas/` | REFI-QDA XML schemas (off-limits) |

## Hooks

```bash
git config core.hooksPath .githooks && chmod +x .githooks/pre-commit
```

- `.githooks/pre-commit` runs `npx tsc --noEmit` + `cargo test`.
- CI: `.github/workflows/ci.yml` (TS build + Rust matrix ubuntu/windows/macos).
- `.github/workflows/charter.yaml` runs Charter on PRs + pushes to main.
- See `.claude/skills/gitnexus/` for impact analysis, refactoring, and debugging.
<!-- gitnexus:end -->
