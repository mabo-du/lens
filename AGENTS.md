<!-- gitnexus:start -->
# GitNexus — LENS

Index: 55 symbols, 52 relationships. Run `npx gitnexus analyze` if stale.

## Rules

- Run `gitnexus_impact` before editing any symbol. Warn user on HIGH/CRITICAL risk.
- Run `gitnexus_detect_changes()` before committing.
- Use `gitnexus_query` for conceptual searches, `gitnexus_context` for symbol details.
- Never rename symbols with find-and-replace; use `gitnexus_rename`.

## Off-Limits

- Do NOT modify `.gitnexus/`, schema migration files, or `.ctx/` configuration.
- Do NOT install global packages or modify system configuration.
- Do NOT push, force-push, or rewrite published branches.

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
