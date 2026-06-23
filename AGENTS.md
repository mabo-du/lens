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

- `charter.yaml` configures pre-commit (`npx tsc --noEmit`) and pre-push (`npx tsc --noEmit && cargo test`).
- CI: `.github/workflows/charter.yaml` runs Charter on PRs and pushes to main.

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
