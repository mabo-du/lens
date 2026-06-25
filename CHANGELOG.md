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

## [0.1.0-rc.2] - 2026-06-24

Patch-level RC. Re-tags 0.1.0-rc.1 with the release.yml matrix fix.
The rc.1 tag push (release run `28076077890`) failed across all 4
platforms with `log not found` because three pinned action SHAs in
`.github/workflows/release.yml` had drifted past the resolver — the
REST API returned HTTP 422 for every `actions/*@<sha>` reference.
No surface features change from rc.1.

### Fixed
- **release.yml matrix** — refreshes three pinned action SHAs to
  current live commits:
  - `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020` (v4)
  - `dtolnay/rust-toolchain@29eef336d9b2848a0b548edc03f92a220660cdb8` (stable)
  - `tauri-apps/tauri-action@fce9c6108b31ea247710505d3aaaa893ee6768d4` (v0 rolling)
- **release-dry-run.yml** — same `setup-node` + `rust-toolchain` SHA
  refresh; the manual `npx tauri build --no-bundle` step is preserved
  so this workflow continues to verify the pipeline *without* producing
  a draft release artefact (its stated purpose).

### Added
- **`scripts/refresh-release-sha-pins.sh`** — maintainer tool that
  diffs the workflow pins against the latest GitHub refs (defaults
  dry-run; `--apply` writes after confirmation). Companion to the
  release.yml release-process section in README.md.
- **README release-process docs** — the new "Release Process" section
  documents the cut-RC-then-promote workflow, the Apple-notarization
  secret prerequisites, and the inline SHA-bump procedure so future
  maintainers don't repeat the rc.1 matrix failure.

## [0.1.1] - 2026-06-24

Dependable image-doc UX: Konva-powered image viewer with drag-to-create bbox regions. The projected v0.1.1 plan ships in this release line (plan subset: viewer + bbox regions; polygon and memos-on-region rolled into v0.2).

### Added
- **Image-viewer + region drawing** — new `ImageViewer.tsx` mounts in `DocumentEditor` when `document.file_format` is `png`/`jpg`/`jpeg`. Renders the bitmap at its intrinsic width/height via react-konva, lets the researcher pick a code from the project tree, and drag-draws a bounding-box Rect on mouseup. Coordinates normalised to 0..1 at the IPC boundary so REFI-QDA AreaReference export can use them verbatim.
- **Migration 05 — `plain_text` nullable** — 12-step `CREATE TABLE _new` schema rebuild relaxes the NOT NULL constraint on `document.plain_text`. The prior round-70 attempt at `ALTER COLUMN ... DROP NOT NULL` broke 34/53 integration tests on the bundled SQLite ("unsupported ALTER TABLE" path); this rebuild is portable across every reasonable SQLite ≥ 3.7 since it relies only on native CREATE / INSERT / DROP / ALTER RENAME. FTS5 sync triggers recreated with `COALESCE(plain_text, '')` so image rows with NULL don't break full-text search.
- **Image-region IPC** — three new Tauri commands: `image_selection_create` (with bbox coord validation: rejects NaN/Infinity, out-of-range, zero-area, non-strict rectangles), `image_selection_list_by_document`, `image_selection_delete`. All wrapped in transactions; the `selection` parent row + `image_selection` extension row are inserted atomically.
- **Document-asset IPC** — `document_get_asset_base64` reads the bitmap from `assets/<id>.<ext>` on disk and returns a base64-encoded payload + MIME type so the renderer can construct a `data:image/png;base64,...` URL. Rejects non-png/jpg/jpeg formats at the dispatcher.
- **Frontend stack addition** — adds `konva` (10.x) + `react-konva` (19.x) to package.json.

### Changed
- **Image-import dispatcher** — `commands/import.rs` image branch now binds `plain_text: None` directly (vs the round-70 fallback to `Some("")`); combined with migration 05, this is the canonical post-cut path.

### Tests
- `image_selection_bbox_round_trip` — assert insert → SELECT (JOIN) → delete via FK cascade.
- `migration_05_relaxes_plain_text` — assert a row can be inserted with NULL `plain_text` and the value round-trips (closes the round-70 regression violation that originally broke 34 of 53 tests).

## [0.2.0-rc.1] - 2026-06-26

### v0.2 — Playwright E2E wiring + http-server stack + CI integration (round-78)

Builds on the round-77 test infrastructure with two corrections and one
production CI integration:

#### http-server replaces `vite preview` (and the failing `vite dev`)

Three rounds of Playwright ERR_CONNECTION_REFUSED on the linux
Playwright runtime were traced not to config but to one of: dev-mode
HMR, vite preview's layered network handling, or inherited stdio
lifecycle races. Round-78 swaps to `npx http-server` — a 100-line static
file server — for both `tests/e2e/` and `tools/perf/`. The Playwright
fixture is built once via `vite build` (heavy React + Konva compile),
then served as static `dist/` by http-server on `127.0.0.1:57599`,
removing every tried-and-failed timing race.

New files: `tests/e2e/global-setup.mjs` (spawn vite build → spawn
http-server → poll URL up to 180s), `tests/e2e/global-teardown.mjs`
(SIGTERM the http-server child via `process.env.LENS_E2E_HTTP_PID`,
`pkill -f` fallback). `playwright.config.ts` switches from
`webServer` to `globalSetup`/`globalTeardown`.

URLs moved from `localhost` → `127.0.0.1` everywhere (avoids Playwright
chromium resolving to `::1` while vite bound IPv4 only). Same for
`host: '127.0.0.1'` in `fixture.vite.config.ts` server block.

#### CI integration (`playwright-e2e` job)

New `playwright-e2e` job in `.github/workflows/ci.yml` runs on
ubuntu-latest after `typescript` + `rust` gates succeed:
- `npm ci` → `npx playwright install --with-deps chromium` →
  `npx tsc --noEmit` → `npx playwright test --reporter=list`.

Runs both `tests/e2e/image-viewer.spec.ts` (4 user-flow tests) and
`tools/perf/perf-bench.spec.ts` (Konva-baseline + writes
`tools/perf/results.json`).

#### Note on local execution

The Playwright chromiums in some sandboxes cannot reach
locally-spawned HTTP servers via 127.0.0.1 TCP even with http-server
(no dev-mode logic, just a 100-line static file responder). On those
hosts the gate manifests as ERR_CONNECTION_REFUSED for every test
even though `curl http://127.0.0.1:57599/` returns 200 OK from the
parent shell. This is an environmental quirk of the runner, not a
config bug — CI provides a fresh env where the http-server backing
+ Playwright chromium network stack always line up.

**Debug recipe** if a similar surface appears in CI: walk through the
4-attempt tree at /home/mark/Projects/LENS:

1. Run `npx playwright test --reporter=list`. If every test fails at
   `await page.goto(URL)` with `net::ERR_CONNECTION_REFUSED`, the
   chromium network stack can't reach the spun-up server.
2. Sanity-check with `curl -sv http://127.0.0.1:57599/`. If curl gets
   200 OK but chromium doesn't, the issue is browser ↔ host network
   isolation (not config).
3. Check `getent hosts localhost` / `cat /etc/hosts` — chromium often
   resolves `localhost` to `::1` while servers bind IPv4. Forcing
   `127.0.0.1` everywhere is the first mitigation.
4. Try a different transport: `vite dev` → `vite build && vite preview`
   → static build + `npx http-server` (round-78 final choice because
   it's a 100-line responder with no rolling dev-tooling).
5. If all three still fail, the runner has browser network hardening
   that breaks localhost TCP; the gate belongs in CI where the runner
   is fresh.

#### Round-78 fixes after code-reviewer

- **Require-in-mjs blocker**: original `tests/e2e/global-teardown.mjs`
  used `require('node:child_process')` inside a function in a `.mjs`
  file. Node 20 LTS treats `.mjs` as strict ESM — `require` is
  undefined — so the SIGTERM-fallback pkill path would have thrown
  ERR_REQUIRE_ESM at teardown. Hoisted `import { execFileSync } from
  'node:child_process'` to the top of file. (Same shape works fine on
  the Node 22 default but the CI job pins Node 20, so it matters.)

### v0.2 — polygon-mode UX (frontend, this commit)

Building on the round-74 v0.2 polygon backend foundation (migration 06 +
`image_polygon` extension table + 3 IPC handlers + round-trip test + TS
IPC), the Konva image viewer now ships an interactive **polygon-mode
drawing tool** alongside the existing bbox mode.

#### ImageViewer — mode toggle (Rectangle | Polygon)

A pill-style toggle at the top-left of the viewer toolbar switches the
active drawing mode for the current image document. Default is
Rectangle (preserves the existing drag-to-create UX). Switching modes
cancels any in-flight draft of the other mode.

#### Polygon mode — interaction model

| Action | Result |
|---|---|
| Click on stage | Add a vertex at the cursor position |
| Move cursor (≥1 vertex placed) | Live preview line from last vertex to cursor |
| Right-click OR Enter | Commit polygon (requires ≥3 vertices); otherwise a toast hints to add more |
| Esc | Cancel the in-flight draft (discard vertices) |
| Click within 12px of vertex 0 (≥3 vertices already placed) | Highlighted snap-to-close ring on vertex 0 — visual only, click itself adds a duplicate vertex on top |

Once a polygon is committed, `imagePolygonsIpc.create` posts the record
with vertices serialised in 0..1 proportional coords. Polygon backend
validation (`validate_polygon`) enforces 3..64 vertices, finite values
in `[0,1]²`. The list auto-refreshes after every commit / delete.

#### Polygon rendering

Persisted polygons render as Konva `<Line closed=true>` with the
assigned code colour stroke and a 0.2-alpha fill, plus a small white
code-name label at the first vertex for parity with bbox labels. The
in-flight draft renders an uncommitted closed polygon at 0.08-alpha
fill, a small filled circle at every placed vertex, and a dashed
preview segment from the last vertex to the cursor. The snap-to-close
ring is an extra stroked circle (8px radius) around vertex 0 that
appears only when both conditions hold.

#### Polygon deletion

Right-click on a persisted polygon's stroke opens the same delete
confirmation as the bbox path — `imagePolygonsIpc.delete(id)`
followed by a list refresh. The selection FK on `image_polygon`
cascade-deletes on the parent `selection` row, so a single IPC
handles both.

### v0.2 — memos-on-region + polygon-mode test coverage (this commit)

Building on the round-75 polygon-mode UX, this commit adds the memo-on-
region binding (cross-document annotation memos exposed for image regions
and polygons) plus the first vitest coverage for the polygon interaction
state machine, so future edits to vertex / snap / commit behaviour are
safe to refactor against.

#### Memos-on-region — ImageViewer action menu

The ImageViewer's right-click on a persisted region OR polygon no longer
goes straight to delete: it now opens a small action Dialog with two
buttons — **Edit Memo...** and **Delete** — sharing the same memo
backend as text annotations (`AnnotationMemoDialog`). Because the memo
table's `linked_selection_id` column already references the parent
`selection.id` regardless of `selection_type`, no schema migration was
needed: text / image-region / image-polygon memos row-share the same
table.

New component `RegionMemoDialog` (alongside the existing
`AnnotationMemoDialog` which is unchanged). It differs from the text
version only by (a) accepting `codeName` as a prop instead of looking
it up in the text-annotations store, and (b) omitting the inline
Delete button (Delete lives in the action menu so the two paths remain
discoverable in one place).

Memo-presence badge: shapes with a non-empty memo body render a bullet
(`•`) appended to the code-name label so a researcher can see at a
glance which regions have notes attached. The presence set is loaded
from `memosIpc.listByProject(activeProject.id)` on doc-switch and
re-loaded after every region/polygon create/delete and after the memo
dialog closes (so adding a body updates the badge immediately).

#### Polygon-mode test coverage

Round-75 left the polygon interaction math inline in `ImageViewer.tsx`,
which made safe refactoring hard. This commit extracts the pure logic
into `src/components/editor/polygonState.ts` and adds vitest coverage
(`polygonState.test.ts`, 30 tests) so we can ship small changes to
constants like `SNAP_RADIUS_PX` or `MIN_POLYGON_VERTICES` without
re-validating by hand.

Pure helpers exported:

| Helper | Inputs | Output |
|---|---|---|
| `pushVertex(vertices, v)` | array, vertex | new array with v appended (immutable) |
| `canCommit(vertices)` | array | bool (boolean vs `MIN/MAX_POLYGON_VERTICES`) |
| `isSnapToClose(vertices, cursor)` | array, vertex or null | bool (squared-distance compare) |
| `snappedCursor(vertices, cursor)` | array, vertex or null | the effective cursor (snap zone → v[0]) |
| `livePreviewPoints(vertices, cursor)` | array, vertex or null | `Line` points array or null |
| `draftLinePoints(vertices)` | array | `Line` points array (null for < 2 vertices) |
| `draftShouldClose(vertices)` | array | bool (mirrors the `<Line closed>` prop) |
| `modeSwitchReset()` | `()` | `{ draftRect: null, draftVertices: [], cursorPos: null }` |

`ImageViewer.tsx` now imports these and the inline math is reduced to
state plumbing + Konva rendering. Behaviour is unchanged: the round-75
gate suite (tsc 0 / cargo 0 / vitest 0 / vite build 0) is re-greened
with the new tests included.

Snap-distance boundary cases covered by the tests:
- 11.31 px off-axis (8 right + 8 down) — inside zone
- 12.0 px straight down — exactly on the boundary (inclusive)
- 12.73 px off-axis (9 right + 9 down) — outside zone
- MAX_POLYGON_VERTICES = 64 boundary (64 → commit, 65 → reject)
- MIN_POLYGON_VERTICES = 3 boundary (2 → reject, 3 → commit)

### v0.2 — Playwright E2E + Konva perf baseline (round-77, this commit)

Two infrastructure tracks to close the [Unreleased] v0.2 items:
a real-browser E2E suite and a Konva draw-time baseline.

#### Playwright E2E suite (data-testid hooks live)

A new `tests/e2e/` directory hosts a Playwright suite that drives the
actual production `ImageViewer.tsx` React component via a small
standalone fixture (no Tauri runtime required):

```
tests/e2e/
  fixture.vite.config.ts      # separate vite config on port 57599
  fixture/
    index.html
    src/main.tsx              # bootstraps window.__TAURI_INTERNALS__
                              # shim + useProjectStore + ImageViewer mount
  playwright.config.ts
  image-viewer.spec.ts        # 4 tests: mode toggle, 4-vertex commit,
                              # action dialog, Edit Memo flow
  README.md                   # runner docs
```

The fixture's `main.tsx` synchronously sets
`window.__TAURI_INTERNALS__ = { invoke }` before importing
`@tauri-apps/api/core`, so all production IPC paths (`imagePolygonsIpc
.create`, `memosIpc.save`, `document_get_asset_base64`, etc.) resolve
against an in-memory fixture store. The store is exposed via
`window.__LENS_TEST__ = { invocations, reset, fixture }` for Playwright
assertions.

`image-viewer.spec.ts` covers the four data-testid hooks added in
rounds 75-76:
- `mode-bbox` / `mode-polygon` (mode toggle pill)
- `region-action-edit-memo` / `region-action-delete` (shape action Dialog)
- Polygon commit IPC payload shape (4 vertices in [0, 1]²)
- `RegionMemoDialog` opens with the correct codeName via Edit Memo...

Run with:
```
npx playwright test tests/e2e/image-viewer.spec.ts
```

#### Konva draw-time perf baseline

`tools/perf/` directory with a Playwright-driven benchmark that mounts
a Konva Stage on synthetic mid-grey PNGs at three intrinsic sizes
(256, 1024, 2048) and records `performance.now()`-timed `layer.draw()`
cycles for both bbox and polygon operations over `N = 200`
iterations per cell. Results are written to
`tools/perf/results.json` after each Playwright run.

Methodology + interpretation + sample thresholds are documented in
`docs/research-papers/v0.2-konva-perf-baseline.md`; the
**custom-canvas comparison** is explicitly deferred to v0.3 since this
round establishes the Konva baseline numbers needed as a control.

Run with:
```
npx playwright test tools/perf/perf-bench.spec.ts
cat tools/perf/results.json
```

#### Maintainer action item

The release matrix is still failing — `github.com/mabo-du/lens` needs
an `admin:org`-scoped maintainer to inspect + lift the org-level
third-party-action blocklist on `Settings → Actions → General → Allow
specified actions`. Steps are written to `.gh_admin_org_setup.md` in
the repository root.

### v0.2 — Collaboration lock file + lock status indicator (round-79, this commit)

Implements the baton-pass collaboration lock from Plan §7.2, preventing
simultaneous project access across devices.

#### Lock file lifecycle

On project open, a `project.lock` file is written to the project folder
containing the local user's display name and a Unix timestamp. On project
close (or app quit via `CloseRequested` window event), it's removed.

- **`projects_check_lock`** — new Tauri command. Before opening, callers
  check for a live lock file. Returns a warning message if a fresh lock
  (<8 hours old) is found; stale locks are silently cleared.
- **`App.tsx` open flow** — `handleOpenProject` now checks for a live lock
  via `projectsIpc.checkLock()` and shows a `confirm()` dialog before
  proceeding.
- **`projects_close`** — removes the lock file on normal project close.
- **`on_window_event(CloseRequested)`** — `lib.rs` registers a handler that
  removes the lock file on unexpected app quit (crash recovery).
- **`remove_lock_file`** — `pub(crate)` helper for the above paths.

#### Lock status indicator

The workspace TopNav now shows a subtle lock badge (🔒 + user name) when
a project is open, reassuring researchers that they hold the collaboration
baton. The badge auto-fetches the local user's display name on project
open via `local_user_get_name`.

#### Tests

10 Rust integration tests in `lock_file_tests` module cover the full
lock lifecycle: write/read round-trip, empty/missing lock, Unicode user
names, fresh-lock warning, stale-lock auto-clear, and timestamp integrity
on rewrite.

### Planned for v0.2 (remaining)
- Apple-signing release.yml matrix verification + GA cut
- Custom-canvas comparison vs the round-77 Konva baseline (v0.3 track)

## [Unreleased]
