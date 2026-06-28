# LENS

<!-- aidevops:badges:start -->
<!-- managed by aidevops badges; edit the template, not this block -->
<!-- Build & Quality Status -->
[![GitHub Actions](https://github.com/mabo-du/lens/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mabo-du/lens/actions/workflows/ci.yml)

<!-- License & Legal -->
[![License](https://img.shields.io/badge/license-see%20file-yellow.svg)](https://github.com/mabo-du/lens/blob/main/LICENSE)

<!-- Repository Metrics -->
[![Lines of code](https://raw.githubusercontent.com/mabo-du/lens/main/.github/badges/loc-total.svg)](https://github.com/mabo-du/lens)
[![Languages by lines of code](https://raw.githubusercontent.com/mabo-du/lens/main/.github/badges/loc-languages.svg)](https://github.com/mabo-du/lens)

<!-- Project Links -->
[![GitHub repository](https://img.shields.io/badge/github-repository-181717.svg?logo=github)](https://github.com/mabo-du/lens)
<!-- aidevops:badges:end -->

> **Latest release: v0.2.5 (2026-06-29)** — PyPI re-publication cut.
> Addresses all findings from the `aidevops security audit`: patches esbuild
> transitive dependency (GHSA-g7r4-m6w7-qqqr), creates `SECURITY.md` with a
> vulnerability reporting policy, hardens `.gitignore` for secret-file extensions,
> renames secret-scanner-noise files, and wires curated CHANGELOG release notes
> into the publish workflow. See [CHANGELOG.md](CHANGELOG.md#024---2026-06-29).

**Open-source qualitative data analysis for the desktop.**

LENS is a local-first, REFI-QDA-compatible research tool. Import documents (TXT, DOCX, PDF, PNG, JPG), build a hierarchical codebook with arbitrary nesting, annotate text passages and image regions, attach memos at every level, search with FTS5, and export to standards-compliant `.qdpx` / `.qdc` / CSV / HTML — all without ever leaving the desktop or sending data to a cloud.

## Table of contents

- [Why LENS](#why-lens)
- [Features at a glance](#features-at-a-glance)
- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick start (5 minutes)](#quick-start-5-minutes)
- [Project layout](#project-layout)
- [Architecture overview](#architecture-overview)
- [Available scripts](#available-scripts)
- [Testing](#testing)
- [Release process](#release-process)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

## Why LENS

Most desktop QDA tools are either commercial (expensive, often closed), cloud-only (data leaves the machine), or partial (no image annotation, no REFI-QDA compliance, no offline story). LENS is built around three principles:

1. **Local-first.** Every byte of project state lives in a single SQLite file under your control. No accounts, no telemetry, no network calls during editing.
2. **REFI-QDA-compliant.** Codebook, annotation, and memo schemas track the REFI-QDA 1.5 specification; `.qdpx` export round-trips with NVivo, QDA Miner, and ATLAS.ti.
3. **Image + text coding.** A single workspace handles prose coding (ProseMirror editor with mark decorations) and image coding (Konva-backed bbox + polygon drawing) with one codebook and one set of memos.

The code is open-source under the MIT license, the install is a single `.deb` / `.AppImage` / `.dmg` / `.exe`, and the full Swiss-army-knife sits in a single directory the user owns.

## Features at a glance

| Feature | What it does |
|---|---|
| **Document imports** | TXT, DOCX (via `xmldom` + `jszip`), PDF (via the `pdfplumber` Python sidecar baked into `tauri.conf.json`'s `externalBin`), PNG, JPG. Header-only image-dimension reader means PNG/JPG import does not allocate pixel buffers. |
| **Walkable codebook** | Closure-table-backed code tree, arbitrarily deep, with drag-and-drop reorganization, per-code colour, per-code memo, and rename-in-place. The dual-table layout (`codes` + `closure`) keeps depth-stacking provable. |
| **Prose annotation** | ProseMirror read-only editor with inline annotation marks (start/end offsets annotated, colour-stripped margin marker on the right edge). Right-click for memo; backspace the selection to delete; undo via `Ctrl+Z`. |
| **Image coding** | Konva Stage renders the bitmap at intrinsic dims. Two drawing modes: **Rectangle** (drag-to-create bbox) and **Polygon** (click-vertex-by-vertex, commit via right-click or Enter; Escape cancels the draft). All coords normalised 0..1 at the IPC boundary for round-trip-safe `.qdpx` AreaReferences. |
| **Region memos** | Right-click any committed region/polygon → action menu → **Edit Memo…** opens the same dialog as text annotations. Memos share the schema across selection types via `linked_selection_id` on the memo table. |
| **Full-text search** | FTS5 across documents and memos. Scope the result set to a single code via the right pane switch. |
| **Project journal** | A free-form scrapbook at project scope. Loosely-structured notes that aren't attached to any specific code or annotation. |
| **Export** | `.qdpx` (zip-bundled REFI-QDA 1.5 project archive), `.qdc` (codebook-only), CSV (annotations), HTML (printable report). Plugin registry (`src/export/index.ts`) so alternative exporters plug in without touching core. |
| **Backup / restore** | Encrypted `.lensbackup` archives (AES-256-GCM with argon2-derived key) for project-level portable backups. |
| **Collaboration lock** | On-open written `project.lock` file with the local user's display name and timestamp. Prevents simultaneous multi-device edit warning. Removed on close + on crash-recovery via `on_window_event(CloseRequested)`. |
| **Python CLI companion** | `lens-qda` on PyPI via OIDC trusted-publishing. See [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) for `pip install lens-qda && lens-qda extract some.pdf --json`. |
| **REFI-QDA import** | Open a `.qdpx` produced by NVivo / ATLAS.ti; codes, documents, and annotations import in their original hierarchy. |

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 (Rust `src-tauri/`) |
| Frontend | React 19 + TypeScript + Vite 7 |
| UI library | Tailwind CSS 4 + shadcn/ui (`src/components/ui/`) |
| Editor | ProseMirror (`src/components/editor/`) — read-only schema + custom `qdaAnnotationPlugin` mark decorations |
| Image canvas | Konva 10 + react-konva 19 (`src/components/editor/ImageViewer.tsx`) |
| Database | SQLite via `sqlx` 0.9 (no ORM) + 6 migrations under `src-tauri/src/db/migrations/` |
| State (renderer) | Zustand (`src/store/projectStore.ts`, `src/store/uiStore.ts`) |
| PDF sidecar | Python 3.11 + `pdfplumber==0.11.4` bundled via PyInstaller + `src-tauri/sidecars/pdfplumber/` |
| Python CLI | `lens-qda` (`python/`) — published to PyPI via OIDC trusted-publishing |
| Tests | Vitest (frontend), Rust integration tests under `src-tauri/src/`, Playwright E2E (`tests/e2e/`) |
| Tauri-system CI | Pinned action SHAs (`actions/checkout@v4.2.0`, `tauri-apps/tauri-action@v0`, etc.); matrix is `ubuntu-22.04`, `windows-latest`, `macos-13`, `macos-14` |

## Prerequisites

- **Rust 1.75+** (`rustc --version`)
- **Node.js 20+** (`node --version`) and npm
- **Python 3.11+** with pip (only for building / running the PDF sidecar locally — the desktop install on macOS/Windows/Linux already bundles the sidecar via PyInstaller)
- **Tauri 2 system dependencies**:
  - **Linux:** `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libssl-dev`, `libsoup-3.0-dev`, `libjavascriptcoregtk-4.1-dev`, `libfuse2`, `liblzma-dev`
    ```bash
    sudo apt-get update && sudo apt-get install -y \
      libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
      librsvg2-dev libssl-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev \
      libfuse2 liblzma-dev
    ```
  - **macOS:** `brew install node python@3.11` + Xcode Command Line Tools (`xcode-select --install`)
  - **Windows:** WebView2 (preinstalled on Windows 10 1903+) + MSVC (`Microsoft Visual C++ Build Tools`)

## Quick start (5 minutes)

```bash
git clone https://github.com/mabo-du/lens.git
cd lens
npm install
npm run tauri dev
```

`npm run tauri dev` performs two jobs simultaneously: it boots Vite's dev server on `http://localhost:57598` for the renderer, then shells out to `cargo run` inside `src-tauri/` which embeds the WebView, attaches IPC, and opens a native window. The first build takes ~5 minutes (Rust compilation); subsequent rebuilds are incremental (< 30 seconds).

On first launch you'll be greeted with the **project picker** (no projects exist yet). Click **Create Project**, name it, choose a save location, and you're in.

For a fully-illustrated walkthrough of what's next, see [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

## Project layout

```
.
├── src/                          React 19 + TypeScript renderer
│   ├── components/                UI surfaces (see src/components/ for the full list)
│   ├── store/                    Zustand stores (projectStore.ts, uiStore.ts)
│   ├── ipc/                      Typed wrappers around Tauri `invoke()` calls
│   ├── export/                   REFI-QDA / CSV / HTML exporters
│   └── utils/                    offset-utils.ts (ProseMirror <-> char offset math)
├── src-tauri/                    Rust backend (Tauri 2 host)
│   ├── src/db/                   SQLite pool + migrations
│   ├── src/commands/             Tauri IPC handlers (one file per surface)
│   ├── src/import/               File-import dispatchers (txt / docx / pdf)
│   ├── sidecars/pdfplumber/      Python 3.11 + pdfplumber sidecar (PyInstaller bundle)
│   └── Cargo.toml
├── python/                       `lens-qda` CLI companion (published to PyPI)
│   ├── pyproject.toml            PEP 621 metadata
│   ├── lens_qda/                 `extract` + `version` console-script entry
│   └── tests/                    Pytest suite (in-memory fixtures)
├── tests/e2e/                    Playwright E2E suite + fixture (Konva image coding)
├── scripts/                      Maintainer tooling (release SHA refresh, sidecar build)
├── docs/                         User-facing docs + research papers
│   ├── USER_GUIDE.md             ★ Feature-by-feature user tutorial
│   ├── ARCHITECTURE.md           16-chapter system sourcebook
│   ├── onboarding-apple-developer.md   Apple signing/notarisation runbook
│   └── research-papers/          19 design notes underpinning the implementation
├── .github/workflows/            CI: ci.yml (lint + test + Playwright E2E) + release.yml + release-dry-run.yml
└── scripts/refresh-release-sha-pins.sh   Bumps pinned action SHAs
```

## Architecture overview

LENS is a **strict renderer/host split**:

- The **renderer** is a single React tree rooted at `App.tsx → Workspace.tsx`. It never speaks SQLite directly; every backend touch goes through an `ipc/*.ts` wrapper which calls `invoke()` from `@tauri-apps/api/core`. The Tauri bridge serialises the args, the Tauri compiled-host executes the matching `#[tauri::command]`, and the result is JSON-serialised back. See [ARCHITECTURE.md](ARCHITECTURE.md) for the IPC schema, the 6-table SQLite schema, and the closure-table math underpinning the code tree.

- The **host** (`src-tauri/`) is the Tauri 2 Rust binary. It spawns one sidecar (`pdfplumber`) for PDF text extraction, holds the SQLite connection pool via `sqlx`, and exposes every mutation as an IPC command. There is no ORM; SQL lives in discrete `mod.rs` files (`codes.rs`, `documents.rs`, `annotations.rs`, `memos.rs`, `search.rs`, `export.rs`, `import.rs`).

- **The PDF sidecar** is a Python 3.11 script bundled with PyInstaller (`scripts/build-sidecar.sh`). Tauri's `bundle.externalBin` references the produced binary; on startup, the Rust layer spawns it on demand, pipes `{"pdf": "...", "args": {...}}` JSON envelopes on stdin, and reads `{"success": bool, "text"|"error": str}` envelopes on stdout. The payload shape is shared verbatim with the `lens-qda` CLI so the Python contract is one source of truth.

- The **codebook** uses a **closure table** (`codes` + `closure` join) so depth-stacking is composable. The two-step composition invariant — `parent_depth + subtree_depth = composed_depth` — is asserted by the `closure_table_invariant_depth_stacking` Rust test (transitive move of a sub-tree must survive re-parent + depth remap with no orphan rows).

- **Annotations** are stored as half-open character offsets into the document's `plain_text`. ProseMirror `coordsAtPos` ↔ `charOffsetToPmPos` math lives in `src/utils/offset-utils.ts`. Image-region annotations carry 0..1 normalised bbox coords so REFI-QDA AreaReference `<azimuth range>` exports round-trip.

- **Lock file** is a one-line file at `project.lock` written on-open and removed on-close (and on `CloseRequested`). Stale (> 8 h) locks are silently cleared; fresh locks trigger a `confirm()` dialog before the open flow proceeds.

For the deep dive, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Available scripts

| Command | What it does |
|---|---|
| `npm install` | Install JS deps |
| `npm run dev` | Vite dev server only (renderer, no Tauri) — port 57598 |
| `npm run tauri dev` | Full Tauri 2 dev (renderer + Rust host + WebView) |
| `npm run tauri build` | Produce signed distributables (.deb / .AppImage / .dmg / .exe) under `src-tauri/target/<triple>/release/bundle/`. **First build is ~5 min.** |
| `npm run build` | Renderer-only build (no Rust) → `dist/` |
| `npm test` | Vitest run for the React tree (≈ 30 polygonState tests + a handful of editor mocks) |
| `npx tsc --noEmit` | TypeScript type-check, no emit |
| `cd src-tauri && cargo test` | Rust unit + integration tests (`codes`, `closure_table`, `annotations`, `migration_05_relaxes_plain_text`, `lock_file_tests`, `image_selection_bbox_round_trip`, etc.) |
| `npx playwright test` | Full E2E suite (https-server fixture on port 57599, see `tests/e2e/playwright.config.ts`) |
| `bash scripts/build-sidecar.sh <target-triple>` | Rebuild the PyInstaller `pdfplumber` binary for the given triple |

## Testing

LENS runs four parallel test surfaces:

1. **Vitest (frontend)** — `npm test`. Covers `polygonState.ts` (snap distance, min/max vertices, mode-switch reset), `offset-utils.ts` (PM ↔ char-offset round-trip), and a few component mocks. ~30 tests, runs in ~5 s.
2. **`cargo test` (Rust)** — `cd src-tauri && cargo test`. Closure table invariants, migration correctness (`migration_05_relaxes_plain_text`, `test_migration_history`), bbox validation (`image_selection_bbox_round_trip`), lock-file lifecycle (`lock_file_tests` — 10 tests), and a `documents_import_internal` race test (optimistic + UNIQUE-constraint dedup).
3. **Playwright E2E** — `npx playwright install chromium && npx playwright test`. Drives the production components via the Playwright fixture shim (`tests/e2e/fixture/src/main.tsx`). **27 tests across 5 spec files**:
   - `image-viewer.spec.ts` — 12 tests cover bbox mode (drag, sub-MIN_DRAG_PX suppression, right-click menu, Edit Memo) + polygon mode (mode toggle, 4-vertex commit, right-click polygon, Edit Memo, Escape cancel, <3-vertex error toast, empty-canvas right-click commit, Delete).
   - `code-tree.spec.ts` — 3 tests.
   - `document-editor.spec.ts` — 3 tests.
   - `import.spec.ts` — 5 tests (txt / docx / pdf happy paths + duplicate-import race + format-reject).
   - `search.spec.ts` — 4 tests (FTS5 hits, code-scoped filter, no-match empty state).
4. **Pytest (CLI)** — `cd python && pytest`. Tests the `lens-qda extract` envelope contract and the `version` reporting.

A green local gate looks like:
```
npm test                                  # vitest, 0 fail
cd src-tauri && cargo test                # all 60+ tests pass
npx tsc --noEmit                          # 0 errors
npx playwright test                       # 27/27 pass (across 5 spec files)
cd python && pytest                       # all CLI tests pass
```

## Release process

The release pipeline is the GitHub Actions matrix in `.github/workflows/release.yml`. It runs on every `v*` annotated tag push; the workspace builds in parallel across four runners.

### Cut a release

```bash
# 1. Edit CHANGELOG.md: move [Unreleased] into a dated [<version>] entry.
# 2. Bump versions in three files (keep them in lockstep):
#      package.json              "version": "<version>"
#      src-tauri/tauri.conf.json "version": "<version>"
#      src-tauri/Cargo.toml      version = "<version>"
#    (python/pyproject.toml and python/lens_qda/__init__.py stay at "0.0.0";
#     publish-pypi's sed-rewrite substitutes the version stamp at run-time.)

# 3. Commit:
git -c user.name='LENS maintainer' -c user.email='maintainer@example.com' \
    commit -am "release: v<version>"

# 4. Annotated tag + push:
git tag -a v<version> -m "v<version>"
git push origin main
git push origin v<version>

# 5. Watch the matrix:
#    https://github.com/mabo-du/lens/actions/workflows/release.yml
```

Each matrix entry produces its host-native bundle (`appimage,deb` on Linux / `nsis` on Windows / `app,dmg` on macOS) and uploads it to a **draft** GitHub Release on the same tag. tauri-action does not auto-publish — visit the GitHub Releases page, click the entry, review the assets, and click **Publish release**.

The Python wheel is published in parallel by `publish-pypi` (OIDC trusted-publishing — no PyPI API token required).

### Apple code signing / notarisation prerequisites

For signed macOS bundles (`.dmg` of the notarised `.app`) the repo needs these secrets:

| Secret | Set via |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | `tauri signer generate --password` + `scripts/set-release-credentials.sh` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Same flow |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, `ASC_API_KEY` (base64) | Apple Developer Portal |

Bootstrap procedure + the BSD-macOS `base64 -b 0` gotcha: `docs/onboarding-apple-developer.md`. **Until the secrets are configured, the release.yml builds unsigned `.dmg`s** — fine for RC distribution, mandatory by GA so users can launch without Gatekeeper friction.

### Pinned action SHAs

Every third-party action in the workflow files is SHA-pinned to ensure reproducible builds across Renovate-style dependency rollers. To bump (e.g., `tauri-apps/tauri-action` rolling tag moved):

```bash
bash scripts/refresh-release-sha-pins.sh            # dry-run diff
bash scripts/refresh-release-sha-pins.sh --apply    # write after confirmation
```

### Re-cut (force-push) caveats

A `force-push` of an existing tag reuses the same wheel filename on PyPI — `pypa/gh-action-pypi-publish` rejects duplicates with HTTP 400 `File already exists`. To re-cut the same tag, bump the version stamp and create a *fresh* tag (the matrix docs in `release.yml` spell this out).

## Troubleshooting

### Release matrix stalled in `queued` for 1.5–2 hr

This is almost always the **GitHub org-level third-party-action blocklist**
on `https://github.com/organizations/mabo-du/settings/actions`. The
`release.yml` `verify-publish` job added in v0.2.1 closes the structural
publish loop once smoke passes.

### `npx tauri dev` fails with "could not find crate `tauri-build`"

Submodule mismatch after a `git pull` — try `cargo clean && npm install && npm run tauri dev`.

### Playwright tests time out with `ERR_CONNECTION_REFUSED`

Chromium cannot reach the spun-up `http-server` on 127.0.0.1. Walk the resolution tree in [docs/USER_GUIDE.md § troubleshooting](docs/USER_GUIDE.md#troubleshooting); the canonical fix is to use IPv4-only hosts (`127.0.0.1`, not `localhost`) and to build + serve via static `http-server` rather than `vite preview`.

### PDF import gives "sidecar not found"

The PyInstaller binary at `src-tauri/sidecars/pdfplumber/pdfplumber-<target-triple>` is missing — re-run `bash scripts/build-sidecar.sh <triple>` then `npm run tauri build`.

### `wasm-unsafe-eval` CSP violation

The Tesseract.js OCR worker (used by `DocumentList.tsx` if you've enabled image-OCR for text-image hybrids) ships with WASM that's explicitly unsafe-eval. The CSP block in `src-tauri/tauri.conf.json` already includes `script-src 'self' 'wasm-unsafe-eval'` — if you're seeing the violation, you've added a custom CSP. Restore the original.

### SQLite migration stuck

`src-tauri/src/db/migrations.rs` lists `01_initial_schema.sql` through `06_image_polygon.sql` (six migrations). If a partial migration left the DB in a transient state, see `migration_history` debug command — but DO NOT hand-edit the SQLite file while LENS is running.

### Python companion install fails with `externally-managed-environment`

`pip install lens-qda` on PEP 668 Python (>3.11 on some distros) — use `pipx install lens-qda` or a venv.

## Security

See [`SECURITY.md`](SECURITY.md) for vulnerability reporting, supported
versions, and security-related configuration guidance (branch protection,
secrets, dependency auditing).

## Contributing

Issues and patches welcome — `github.com/mabo-du/lens`. See [`SECURITY.md`](SECURITY.md) for vulnerability reporting. The commit template is `<scope>(<area>): <subject>`; the prose mirror (commit message body) explains why. PRs go through `npm test && cd src-tauri && cargo test && npx playwright test` and one maintainer review.

When you change a UI surface, re-run the Playwright E2E tests to verify:
```bash
npx playwright test
```

## License

LENS is released under the [MIT License](LICENSE). The above is a summary; the `LICENSE` file is authoritative. Third-party components carry their own licences — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the upstream attribution list.

---

For the in-depth feature tutorial — codebook management, prose annotation, image coding, memos, search, export, backup, and the collaboration lock — see **[`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)**.
