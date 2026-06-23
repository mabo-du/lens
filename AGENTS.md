<!-- gitnexus:start -->
# LENS — Qualitative Data Analysis (QDA) Desktop App

**Stack:** Tauri 2 (Rust + React 19/TypeScript 5), SQLite via sqlx, TailwindCSS 4, Zustand 5, ProseMirror.

## Verification

```bash
npx tsc --noEmit && (cd src-tauri && cargo test && cargo build)
```

Index: 55 symbols, 52 relationships. Run `npx gitnexus analyze` if stale.

## Off-Limits

- Do NOT modify `.gitnexus/`, `.ctx/`, `.beads/`, `.charter/`, or `.claude/` configuration.
- Do NOT modify `src-tauri/src/db/migrations/` or `schemas/` without explicit approval.
- Do NOT modify `.github/workflows/`, CI/CD config, or deploy scripts.
- Do NOT install global packages or modify system configuration.
- Do NOT push, force-push, or rewrite published branches.
- Do NOT touch `.env*` files; use `.env.example` for reference.

## Rules

- Run `gitnexus_impact` before editing any symbol. Warn user on HIGH/CRITICAL risk.
- Run `gitnexus_detect_changes()` before committing.
- Use `gitnexus_query` for conceptual searches, `gitnexus_context` for symbol details.
- Never rename symbols with find-and-replace; use `gitnexus_rename`.

## Project Structure

| Directory | Purpose |
|-----------|--------|
| `src/` | React frontend (components, hooks, IPC bindings, stores) |
| `src-tauri/` | Rust backend (commands, DB migrations, import/export) |
| `src-tauri/src/db/migrations/` | SQLite schema migrations (off-limits) |
| `schemas/` | REFI-QDA XML schemas (off-limits) |

## Hooks

After cloning, wire in the git hooks with:

```bash
git config core.hooksPath .githooks
```

Then `.githooks/pre-commit` will run `npx tsc --noEmit` and `cargo test --locked` automatically before each commit.

chmod +x .githooks/pre-commit is required after `git config core.hooksPath` so the hook is executable.
- `charter.yaml` documents the hook scripts run on pre-commit (`npx tsc --noEmit`, `cargo test --locked`) and pre-push.
- CI: `.github/workflows/ci.yml` (TypeScript build + Rust matrix on ubuntu/windows/macos) and `.github/workflows/charter.yaml` (Charter quality gate).

## Resources

| Resource | Use |
|----------|-----|
| `gitnexus://repo/LENS/context` | Overview, index freshness |
| `gitnexus://repo/LENS/clusters` | Functional areas |
| `gitnexus://repo/LENS/processes` | Execution flows |
| `gitnexus://repo/LENS/process/{name}` | Step-by-step trace |

## CLI Skills

See `.claude/skills/gitnexus/` for exploring, impact analysis, debugging, and refactoring.
<!-- gitnexus:end -->
