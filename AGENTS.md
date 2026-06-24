# AGENTS — LENS (Qualitative Data Analysis desktop app)

## Stack

React 19 + Vite 7 + TS strict (`@/*` -> `src/*`). UI: Tailwind v4, `react-resizable-panels` v4, Zustand, ProseMirror, `cmdk`. Backend: Tauri 2 + Rust (sqlx SQLite); PDF text via pdfplumber sidecar, DOCX native (`src-tauri/src/import/docx.rs`). IPC: `src/ipc/*` thin `invoke()` wrappers; types mirror Rust `#[serde(rename_all = "camelCase")]`.

## Verification (run before any commit)

```
npx tsc --noEmit                              # TS strict
(cd src-tauri && cargo test)                  # Rust unit + integration (43 pass)
npx vitest run                                # vitest (11 pass)
npm run build                                 # tsc && vite build
charter doctor                                # Charter conformance gate
```

Pre-commit (`githooks/pre-commit`) runs the first two. CI matrix: ubuntu/windows/macos. **Launch:** `npm run tauri dev` — `npm run dev` is vite-only without Tauri bindings.

## Off-Limits (MVP)

- Edit `migrations/*.sql` directly — add a new migration. Schema is also the on-disk file format.
- Roll your own REFI-QDA export/import — use `exporterRegistry` in `src/export/QdpxExporter.ts`.
- Bump `@tauri-apps/api` major or `@xmldom/xmldom` without re-running the QDPX vitest round-trip.
- `projectsIpc.createSample` populates a demo on first run — treat it as a sandbox; clear via the project menu before research coding.

## GitNexus (MCP)

Read the markers at the end of this file. Use `gitnexus_query`/`gitnexus_impact`/`gitnexus_context` before editing; `gitnexus_detect_changes()` before each commit. HIGH/CRITICAL blast radius = pause and warn the user.

## Release secrets

See `docs/release-secrets.md` (Tauri signing + Apple notarisation catalogue + rotation runbook). Sidecar build was promoted to blocking in `release.yml`. Use `scripts/release-dry-run.sh` (or `release-dry-run.yml` via `workflow_dispatch`) before tagging a v0.1.0 release.

<!-- gitnexus:start -->
<!-- gitnexus:end -->
