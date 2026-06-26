# Weekly Lint Report — 2026-06-24

Snapshot from `aislop scan` and `charter doctor` on the `main` branch.

## Tooling scores

| Tool       | Score | Threshold | Status |
|------------|-------|-----------|--------|
| aislop     | 104 findings (82 AI-slop errors, 20 style/policy, 2 indicators) | — | informational |
| charter    | 59 / 100 | 80 | below threshold |

## aislop — top categories

| Rule                                       | Count | Note                                                                                                  |
|--------------------------------------------|-------|-------------------------------------------------------------------------------------------------------|
| `ai-slop/hallucinated-import` (false +)    | 81    | Path aliases `@/ipc`, `@/store`, `@/components` resolve from `tsconfig.json`/`vite.config.ts`. False-positive for Vite/TS projects. |
| `code-quality/duplicate-block`             | 3     | `src/App.tsx:142`/`125`, `SearchDialog.tsx:191`/`168`, `uiStore.ts:130`/`110`. Refactor candidates.    |
| `complexity/function-too-long`             | 3     | `App.tsx:21` (263), `CodeDialog.tsx:27` (186), `DocumentEditor.tsx:26` (194).                          |
| `complexity/file-too-large`                | 2     | `scripts/build_smoke_fixtures.py` (622), `src-tauri/src/tests.rs` (1685).                             |
| `jsx-a11y/prefer-tag-over-role`            | 5     | Includes the deeply nested `role="button"` in `CodeTree.tsx` (react-arborist drag handle demands a `<div>`, justified). |
| `jsx-a11y/no-static-element-interactions`  | 1     | Static `<div>` with event handler in `DocumentEditor.tsx:175`.                                        |
| `react-hooks/exhaustive-deps`              | 2     | `DocumentEditor.tsx:50`, `:59`.                                                                       |
| `jsx-a11y/label-has-associated-control`    | 1     | `src/components/ui/label.tsx:7` is the shadcn Label primitive — false positive for users not setting `htmlFor`. |

+ Confirmed improvements: `aislop fix` removed 51 dead-code/comment issues on first run; nested-meta comments are now down.

## charter — remaining findings

| Severity | ID            | Location      | Remediation hint                                                                 |
|----------|---------------|---------------|----------------------------------------------------------------------------------|
| BLOCKER  | AE-CTX-001    | `AGENTS.md`   | File is over the 600-token budget (currently ~617). Trim further to drop below.  |
| MEDIUM   | AE-CTX-002    | `AGENTS.md`   | Charter parser doesn't recognise the new `## Hooks` section + commands.           |
| MEDIUM   | AE-ENV-001    | repository    | Add a `.husky/` directory OR keep `.githooks/` and configure `git config core.hooksPath` on first clone. |
| LOW      | AE-CI-002     | `.github/`    | Release workflow unpinned for `tauri-action@v0` (now pinned); add a security scan step. |

## Chores for next sprint

1. **Refactor `App.tsx` function** — extract a `useProjectWorkflow` hook (or similar) covering qdpx import/export, recent projects, and conflict dialog state, to drop below the 160-line function cap.
2. **Refactor `CodeDialog.tsx` function** — the form-mode branch is now long enough to merit a `<CodeFormFields>` subcomponent.
3. **Refactor `DocumentEditor.tsx` function** — extract a `useEditorState` hook and an `useTextSelectionBridge` for the ProseMirror integration side-effects.
4. **Dedupe `App.tsx` lines 125 & 142** — same loading-spinner / empty-state markup repeated.
5. **Dedupe `SearchDialog.tsx` lines 168 & 191** — identical `<HighlightedSnippet>` row markup in the Documents and Memos sections; lift to a `<SearchResultRow>` subcomponent.
6. **Dedupe `uiStore.ts` lines 110 & 130** — adjacent `setX + persist` blocks; extract a `persistSet` helper.
7. ~~Add explicit ESLint disable for the deeply-nested role=button pattern in `CodeTree.tsx`~~ — **completed this sprint**: `// eslint-disable-next-line jsx-a11y/prefer-tag-over-role` was added immediately above the offending `<div role="button">` in `CodeTree.tsx`, accompanied by an explanatory comment about the react-arborist / nested-button trade-off.

## Verification this week

| Check                                             | Result            |
|---------------------------------------------------|-------------------|
| `npx tsc --noEmit`                                | clean (0 errors)  |
| `cd src-tauri && cargo test`                      | 38 / 38 pass      |
| `npm run build`                                   | success, no warnings |
| `aislop fix` (one-shot remediation)               | 51 issues resolved |
| `.githooks/pre-commit` (now uses `cargo test`, not `--locked`) | executable, runs tsc + cargo test |
