# AGENTS — LENS (Qualitative Data Analysis desktop app)

## Stack

React 19 + Vite 7 + TS strict (`@/*` → `src/*`). UI: Tailwind v4, react-resizable-panels, Zustand, ProseMirror, cmdk. Backend: Tauri 2 + Rust (sqlx SQLite, reqwest); PDF via pdfplumber sidecar, DOCX native. IPC: `src/ipc/*` thin `invoke()` wrappers. Optional: Ollama auto-coding.

## Verification (run before any commit)

```
npx tsc --noEmit
(cd src-tauri && cargo test --features sqlcipher)   # 119 pass
npx vitest run                                       # 73 pass / 7 files
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run build
charter doctor
```

Pre-commit (`.githooks/pre-commit`) runs tsc + cargo test + charter doctor. CI: ubuntu, includes `cargo clippy -D warnings`. Launch: `npm run tauri dev`.

## Off-Limits

**Never edit these without explicit user approval:**
- `.github/workflows/ci.yml` — CI pipeline
- `.env*` — env files and templates; never commit real secrets
- `secrets/` — runtime credential tokens directory; never commit
- `src-tauri/tauri.conf.json` — signing/updater config
- `src-tauri/src/db/migrations/*.sql` — on-disk file format; add NEW migrations only
- `charter.yaml` — policy gate
- `package.json` deps — major bumps must re-run full test suite before merge
- `rust-toolchain.toml` — pins Rust channel/components for reproducible builds

**Rules:**
- Use `exporterRegistry` (`src/export/QdpxExporter.ts`) for REFI-QDA, don't roll your own
- Don't bump `@tauri-apps/api` major or `@xmldom/xmldom` without the QDPX vitest round-trip

## History reshaping rule

Before `git reset --soft`, `git rebase -i` that drops/merges commits, or any history-rewriting tool, run `git branch backup-pre-reshape HEAD~N`. Excludes: pure re-order, `commit --amend`, cherry-pick.

## GitNexus (MCP)

Use `gitnexus_query`/`gitnexus_impact`/`gitnexus_context` before editing;
`gitnexus_detect_changes()` before each commit. HIGH/CRITICAL blast radius → pause and warn.

<!-- gitnexus:start -->
<!-- gitnexus:end -->
