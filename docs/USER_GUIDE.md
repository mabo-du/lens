# LENS — User Guide

A tutorial that walks every LENS surface from first launch to a published `.qdpx` export.

> If you've never used a QDA tool before, start with **[§ 2 Concepts](#concepts)**, then **[§ 3 Quickstart](#quickstart)**. If you're switching from NVivo or ATLAS.ti, jump to **[§ 7 Image coding](#image-coding)** — bbox + polygon annotation is what most differences LENS from.

## Table of contents

- [1. Documentation map](#documentation-map)
- [2. Concepts](#concepts)
- [3. Quickstart](#quickstart)
- [4. Workspace tour](#workspace-tour)
- [5. Project lifecycle](#project-lifecycle)
- [6. Document imports](#document-imports)
- [7. Image coding](#image-coding)
- [8. Prose annotation](#prose-annotation)
- [9. Codebook management](#codebook-management)
- [10. Memos](#memos)
- [11. Search](#search)
- [12. Export (REFI-QDA and others)](#export-refi-qda-and-others)
- [13. Backup + restore](#backup--restore)
- [14. Settings](#settings)
- [15. Collaboration lock](#collaboration-lock)
- [16. Python CLI (`lens-qda`)](#python-cli-lens-qda)
- [17. Keyboard shortcuts](#keyboard-shortcuts)
- [18. Troubleshooting](#troubleshooting) _(anchor uses heading slug `troubleshooting` — the prev `#18-troubleshooting` form breaks external links)_

---

## 1. Documentation map

- [`README.md`](../README.md) — installation, dev workflow, release process, license.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — the 16-chapter sourcebook for the data model, IPC contract, and closure-table math. Read this if you want to *modify* LENS.
- [`docs/research-papers/`](../docs/research-papers/) — 19 design notes underpinning the implementation; referenced from `ARCHITECTURE.md` chapters.

This guide is the user-facing companion to the README. The architecture doc lives next door for whenever you need to know *why* a surface behaves a certain way.

## 2. Concepts

| Term | Meaning |
|---|---|
| **Project** | A top-level analysis unit. Holds one codebook, one document list, and all annotations and memos. Stored as a single SQLite file inside a folder of your choice. |
| **Document** | A single artefact — TXT, DOCX, PDF, or image (PNG/JPG/JPEG). Documents live in a project; their `plain_text` is the substrate for text coding. |
| **Code** | A labelling unit. Codes form a tree of arbitrary depth (closure-table-backed in SQLite). Each code has a name, a colour, a description, and zero-or-more annotations across documents and images. |
| **Annotation** | The application of a code to a span — either a `[start, end)` char-offset range in a text document, or a `bbox`/`polygon` normalised region in an image. |
| **Memo** | Free-form prose attached at any level: per-code, per-annotation, or per-project (the *project journal*). |
| **Workspace** | The 3-pane desktop view: **DocumentList** (left), **DocumentEditor** (centre), **CodeTree/CodeSegments** (right). See [§ 4](#workspace-tour). |
| **REFI-QDA** | The standard interchange format LENS exports to / imports from. Sister projects: NVivo, ATLAS.ti, QDA Miner. |

All project state lives in `<project-folder>/lens.sqlite` (and a few sibling files for asset blobs, the lock file, and back-ups). You can `ls`, copy, archive, and version-control a project folder like any other — no proprietary formats, no cloud sync.

## 3. Quickstart

Goal: from a fresh install, **get to a coded annotation in under five minutes**.

1. **Create a project.** From the empty workspace (the dialog that opens on first launch), click **Create Project**. Name it `Pilot Study`. Pick a location (`~/Documents/LENS/` is a reasonable default). You land in the **empty workspace**.
2. **Import a document.** With the new project open, click **Import** in the **DocumentList** (left panel). Pick a `.txt` / `.docx` / `.pdf` / `.png` / `.jpg`. The file imports; thumbnails render in the left rail.
3. **Open the document.** Click the imported document in the rail. The footer shows total char count; the centre pane starts blank if it's an image (you'll see the canvas) or with the full text body if it's a doc.
4. **Build a codebook.** Right pane → **Code Tree**. Click the **+** icon → name your first code (`Theme`), pick a colour. Repeat to add `Sub-theme` and grandchild codes if you want a hierarchy.
5. **Annotate.** In the centre editor:
   - **Text doc:** select a span of text → press **Ctrl+K** (Cmd+K on macOS) → type/recent-select a code → Enter. The span gets a colour-stripped margin marker.
   - **Image doc:** pick a code from the toolbar, then drag a rectangle (bbox mode) or click vertices in polygon mode. Right-click the region → **Edit Memo…** if you want notes attached.
6. **Export.** Click **Export** in the top-right nav. Choose **REFI-QDA Project (.qdpx)** if you intend to share with NVivo/ATLAS.ti users; choose **CSV (annotations)** if you want a flat table for stats; choose **HTML report** if you need a printable narrative.
7. **Back it up.** Click **Backup** in the top-right nav → pick a destination `.lensbackup` file → check the encryption-then-export succeeds. Tarball the project folder too if you want a non-encrypted snapshot.

## 4. Workspace tour

A LENS workspace opens with three resizable panels:

- **Left (DocumentList):** vertical list of imported documents with thumbnails. Top of the rail: an **Import** button. The rail's width is persisted in the `uiStore` (see `src/store/uiStore.ts`); drag the divider to resize.
- **Centre (DocumentEditor):** the active artefact. Plain-text documents render through ProseMirror (read-only) with annotation margin markers. Image documents render through Konva with the bbox/polygon overlay (see [§ 7](#image-coding)).
- **Right (CodeTree XOR CodeSegments):** the right pane toggles between the **hierarchical codebook** and the **flat list of all coded segments** for the active code. Click a code in the tree's right pane chip → the pane switches to segments; click back-arrow → tree.

A fourth rail — **TopNav** — sits above the three panels and exposes project-scoped actions: **Export**, **Backup**, **Import REFI-QDA**, **Project Journal**, **Close project**, **Settings**, **Help**.

A subtle **lock badge** (🔒 + your display name) appears in the **TopNav**'s left side whenever a project is open, indicating you hold the collaboration lock for that project. See [§ 15](#collaboration-lock).

### Image coder

The image coder mounts when you click an `.png` / `.jpg` document in the rail.

> **Fixtures vs. real data:** the interaction model is identical regardless of how many codes or how big the image. In a real session you'll have a multi-code codebook drawn from your actual project's code tree and your imported image.

(Note: the histogram collapsed on the canvas is intentional — the Konva Stage renders 256×256 by default; the actual image will be at its native intrinsic dims.)

## 5. Project lifecycle

A project lives in a folder you choose on disk. Inside that folder:

```
my-project/
├── lens.sqlite                       # main store (codes, documents, annotations, memos)
├── project.lock                      # collaboration lock (when open)
├── assets/<doc-id>.png               # imported document payloads
└── analysis-notes.txt                # an optional colocated file
```

**Create:** LENS picks a folder name for you (`<name>_<yyyy-mm-dd>`), creates the directory, runs the six migrations on a fresh SQLite, and seeds the closure table with the root code (which you can't delete).

**Open:** LENS checks `project.lock`. If fresh (<8 h), a `confirm()` dialog tells you who else currently holds it; you can proceed if you trust them. LENS then writes a fresh lock with your display name and timestamp.

**Close / quit:** the lock file is removed. `on_window_event(CloseRequested)` (in `src-tauri/src/lib.rs`) handles the same cleanup on crash-recovery.

**Rename:** click the project name in the top-left rail — the field turns into an inline input; rename + Enter commits.

## 6. Document imports

| Format | Importer | Notes |
|---|---|---|
| **TXT** | built-in (UTF-8 reader) | line breaks normalised to `\n` |
| **DOCX** | `xmldom` + `jszip` (in-renderer) | unzips `word/document.xml`, walks paragraphs, ignores styles/track-changes |
| **PDF** | `pdfplumber` Python sidecar (bundled via PyInstaller) | spawns the sidecar subprocess, pipes `{"pdf": "..."}` on stdin, reads `{"text": ...}` on stdout |
| **PNG / JPG / JPEG** | Rust `image` crate (header-only) | reads width/height without allocating pixel buffers; full bitmap fetched on demand via `document_get_asset_base64` |

Concurrent imports are race-safe: an optimistic duplicate-check + `UNIQUE(project_id, text_hash)` constraint (migration 02) + transaction wrap combine to give a friendly duplicate message instead of an error. New imports do not overwrite existing documents with the same content.

## 7. Image coding

Image coding is where LENS differs most from text-only QDA. The centre pane renders through **Konva 10** + **react-konva 19**. The toolbar (top of the canvas) exposes:

- **Rectangle / Polygon mode pill** (data-testid `mode-bbox` / `mode-polygon`)
- **Code picker** — a row of buttons for each code in the active codebook, colour-coded
- **Active document title** (right-aligned)
- **(zoom control in v0.2.1)** — currently 1:1 pixel mapping; zoom is on the v0.2.1 roadmap

### Rectangle mode (bbox)

Default mode. Pick a code from the toolbar, then drag on the canvas.

When the mouse releases (with drag distance > `MIN_DRAG_PX = 4px`), the bbox commits via `image_selection_create` IPC:

The chassis serialises the coords in **0..1 normalised form** at the IPC boundary so a `.qdpx` AreaReference round-trips with the same dimensions regardless of the underlying image's intrinsic pixel width.

Drags below `MIN_DRAG_PX = 4px` are intentionally suppressed so a click-create-vs-drag-create distinction holds.

### Polygon mode

Click the **Polygon** pill. The interaction model flips:

| Action | Result |
|---|---|
| Click on stage | Add a vertex at that cursor position |
| Move cursor (≥1 vertex placed) | Live dashed preview line from last vertex to cursor |
| Right-click on empty canvas *or* press **Enter** | Commit polygon (≥3 vertices required; otherwise an error toast says "Polygons need at least 3 vertices") |
| **Esc** | Cancel the in-flight draft |

Mode toggle flips the visual state.

After picking a code and clicking three or four vertices on the canvas:

Press Enter (or right-click on empty canvas):

Validation rules (enforced **and** server-side):

- Vertices in `[0, 1]²`, finite, no NaN.
- between `MIN_POLYGON_VERTICES = 3` and `MAX_POLYGON_VERTICES = 64`.

Snap-to-close ring: when the cursor is within `SNAP_RADIUS_PX = 12` of vertex 0 (and ≥3 vertices are placed), an 8-px stroked ring renders around vertex 0 as a visual cue. The click itself adds a duplicate vertex on top — closing higher than 64 vertices errs out.

### Right-click action menu on a region/polygon

Right-click a committed region/polygon stroke opens the action menu:

- **Edit Memo…** opens a `RegionMemoDialog` that shares the same memo schema as text annotations (the `memos.linked_selection_id` column references the parent selection regardless of `selection_type`). Saving attaches a free-form body to the region; the region's code-name label gains a `•` bullet (memo-presence badge) once the body is non-empty.
- **Delete** removes the selection + cascades the polygon / image_selection extension row.

## 8. Prose annotation

For text documents, the centre editor is a ProseMirror instance loaded with a minimal schema (`doc` / `paragraph` / `text`, no marks). Annotation `annotation_type` and `codeId` are stored on the selection's mark decorations via the custom `qdaAnnotationPlugin` (`src/components/editor/QdaAnnotationPlugin.ts`).

**Workflow:**
1. Mouse-drag-select text → the right panel highlights the active selection's code colour (if any) and shows the offset range.
2. **Ctrl+K** opens the **FuzzyCodePicker** popover → type to fuzzy-search the codebook → Enter to assign.
3. The selection now has a colour-stripped margin marker on the right edge; the right pane nav icon tags the selection in the **CodeSegments** view.

**Edit / delete:** Right-click the highlight → **Edit Memo…** opens the `AnnotationMemoDialog` (annotation-scoped memo). Right-click → **Delete** removes the selection.

**Undo / Redo:** **Ctrl+Z** undoes the most recent annotation create-or-delete; **Ctrl+Shift+Z** or **Ctrl+Y** redoes. Annotated edits are tracked in a per-stack entry that pins the result-row ID after re-do so the operation stays idempotent.

## 9. Codebook management

**The right pane** is the **CodeTree** (`src/components/code-tree/CodeTree.tsx`). Use `react-arborist` for tree-walking; closure-table math keeps depth-stacking inviolate.

**Add a code:** click the **+** next to "Root" (or any parent code) → CodeDialog opens → name + colour picker + description (optional). Save creates a row in `codes` and a self-referencing closure edge in `closure`.

**Sub-code:** select an existing code → click **+ sub-code**. The new child appears underneath and the closure table inserts:

```
ancestor.id → descendant.id edges for ALL existing ancestors of parent
parent.id → child.id edge at depth 1
NEW descendant.id → NEW descendant.id edge at depth 0 (self)
```

**Rename / recolour:** Right-click the row → **Rename** / **Recolour**. Right-click → **Delete** removes the code *and cascades deletion of all descendant closures and annotations tied to that code*. (Confirmation dialog every time.)

**Drag-and-drop:** drag a code onto another code in the tree → rearborist re-parents. The closure table is rewritten atomically: the dragged-code's descendants retain their original depth and all ancestor edges are remap-inserted with `descendant.depth = ancestor.depth + existing_subtree_depth`.

## 10. Memos

Three types:

- **Code memos:** written in the code's memo pane (right-click the code row → **Edit memo…**). Carry the code's interpretive living-document.
- **Annotation memos:** written in the `AnnotationMemoDialog` (right-click a text annotation or a region/polygon). Free-form context for that single segment.
- **Project journal:** TopNav → **Project Journal** → entries are scoped to the project but not attached to a code/annotation. Loosely-structured notes that survive across documents.

All three use the same dialog (`AnnotationMemoDialog` and `ProjectJournalDialog` share the memo-table backend via `memosIpc`). Autosave is implicit on blur or dialog close when the body changed; `POST /memos/save` is idempotent on `(project_id, linked_code_id, linked_selection_id)`.

## 11. Search

TopNav → click the **search icon** (or **Ctrl+F**). The `SearchDialog` query hits SQLite's FTS5 virtual table (`fts_idx`) over `documents.plain_text` and `memos.body`. Results come back with surrounding snippet + line reference + document title.

Filters:
- **Scope:** "All documents" / "Active document only". (Active-document filter restricts results to the centre pane's current document.)
- **Code pin:** "Any code" / "Annotated with code <id>". The latter runs a JOIN through `annotations` to restrict to spans the code was applied to.

Click a result → centre pane opens the underlying document at the right scroll-offset; the right pane tagsthe annotation under the active selection's code colour.

## 12. Export (REFI-QDA and others)

TopNav → **Export** popover exposes the exporter registry:

- **REFI-QDA Project (.qdpx)** — full zip-bundled project archive. Codes + documents + annotations + memos; the renderer walks the closure-table via depth-stacking to lay out `.qdc`-conformant hierarchies. Round-trips with NVivo 12+, ATLAS.ti 8+, QDA Miner 6+.
- **REFI-QDA Codebook (.qdc)** — codebook-only; documents and annotations are stripped. Use for sending just the code schema upstream.
- **CSV (annotations)** — flat table with columns: `document_path`, `start`, `end`, `code_name`, `code_color`, `memo`. Sortable in Excel.
- **HTML report** — printable narrative; reads the same closure table but renders a per-code chapter with the coded segments and any attached memos. Print → PDF for a paper artifact for your IRB.

Plugin registry in `src/export/index.ts` exposes an `ExportedPayload` API so alternative exporters (REFI-QDA compressed, DEDUCE, MAXQDA XML, etc.) plug in without touching core.

## 13. Backup + restore

TopNav → **Backup** → pick a destination. LENS reads the project's SQLite, tar+gzip's the project folder, then encrypts the archive with **AES-256-GCM** keyed off an argon2 KDF derived from a passphrase the user supplies at backup-time. The output is a single `.lensbackup` file.

**Restore:** TopNav → **Backup** → **Restore**: choose a `.lensbackup` → supply passphrase → LENS creates a fresh folder at the chosen location, writes the SQLite + assets, then opens the project.

Backup archives do not contain the lock file — restoring on a different machine does not inherit the previous user's lock state.

## 14. Settings

TopNav → **Settings icon** (right edge) opens the **SettingsDialog**:

- **Display name** — used by the collaboration lock badge (`projectsIpc.localUserGetName()`). Persists to local SQLite at the project level.
- **Theme** — light / dark / system-follow. Default is system-follow.
- **Code default colour** — colour assigned to newly created codes; cycle through a curated palette for visual diversity.

## 15. Collaboration lock

Local-first means multi-device is awkward. The collaboration lock is an opt-in warning:

- On **open:** LENS writes `<project>/project.lock` with the user's display name + ISO timestamp. The lock survives only as long as the project is open OR until 8 hours elapse (whichever fires first).
- On **close** (or window **CloseRequested** event): the lock file is removed.
- Stale (> 8 h): on next open, silently cleared (assumed crash).
- Fresh (< 8 h, but you weren't the holder): a `confirm()` dialog names the holder, asks if you want to proceed; default Cancel.

Defaults favour safety: it is *always* safe to assume the previous holder's session ended; LENS still tries to surface the conflict so you don't accidentally scribble over their work.

## 16. Python CLI (`lens-qda`)

The `lens-qda` Python companion is published to PyPI and shares the PDF text-extraction contract with the Tauri Rust layer:

```bash
pip install lens-qda
```

CLI surface:

```
lens-qda extract <pdf> [--json] [--x-tolerance N] [--y-tolerance N] [-o OUTPUT]
lens-qda version    [-o OUTPUT]
```

The `--json` flag emits the exact `{"success": bool, "text"|"error": str}` envelope Tauri parses — so a CLI user and the desktop importer share one extraction contract. `pdfplumber` is pinned to `0.11.4` to match `src-tauri/sidecars/pdfplumber/requirements.txt`.

Installation:

```bash
# PEP 668 — use pipx or a venv on some distros
pipx install lens-qda
# ─ or ─
python -m venv .venv && source .venv/bin/activate && pip install lens-qda
```

Run:

```bash
lens-qda version
lens-qda extract corpus.pdf
lens-qda extract corpus.pdf --json | jq .
```

If you want to use the same script from a non-PDF corpus, `lens-qda extract` accepts a `pdfplumber` style options block (`--x-tolerance 2`, `--y-tolerance 3`) for noisy scans.

## 17. Keyboard shortcuts

| Shortcut | Action |
|---|---|
| **Ctrl+K** / **Cmd+K** | Open the FuzzyCodePicker to assign a code to the active selection |
| **Ctrl+Z** / **Cmd+Z** | Undo the most recent annotation create-or-delete |
| **Ctrl+Shift+Z**, **Ctrl+Y** | Redo |
| **Ctrl+F** / **Cmd+F** | Open the search dialog |
| **Esc** (polygon mode) | Cancel the in-flight polygon draft |
| **Enter** (polygon mode) | Commit the in-flight polygon (≥3 vertices required) |
| **Right-click** (canvas / image / annotation) | Open the action Dialog (region menu / annotation memo / code-tree menu) |

## Troubleshooting

> _Note: numbered 18 in the table of contents above; heading slugified to `troubleshooting` so external links (e.g. `README.md` → `docs/USER_GUIDE.md#troubleshooting`) keep resolving._

### Smoke harness for the LENS release pipeline

Every `release.yml` matrix run (Linux/Windows/macOS) executes
`bash scripts/smoke-test.sh` from the Ubuntu-22.04 cell. The runner
verifies the freshly-built `lens` binary, walks 5 intentionally-
broken/edge fixtures through the `scripts/verify/verify-export-*.sh`
corpus, and exits 0 if the verifiers actually REJECT bad inputs (no
regressed-to-no-op acceptable). Smoke-FAIL surfaces as a red X on
the matrix cell; the `verify-publish` job downstream implicitly
gates the GH Release draft promotion. To run locally:

```bash
bash scripts/smoke-test.sh
```

### Image viewer canvas blank?

If the canvas renders empty on a `.png` / `.jpg` document, the asset request IPC (`document_get_asset_base64`) may have failed. Check:
- The Rust layer's `env_logger` writes to **`stderr`** (initialised once via `env_logger::try_init().ok()` — idempotent under test re-runs). On Linux/macOS run the desktop app from a terminal to capture the log; on Windows use `tauri info` summaries or the tauri-driver capture.
- The asset file in `<project>/assets/<doc-id>.<ext>` — if missing, re-import the document (the directory may have been deleted externally).

### Polygon commit says "Polygons need at least 3 vertices"

You pressed Enter (or right-clicked) with fewer than 3 vertices. Click at least 3 distinct points on the canvas; **Esc** cancels an in-flight draft if you want to start over.

### Code-drag-and-drop undoes itself

If drag-and-drop re-parenting fails silently, the closure-table invariant test tripped. The likely cause is a stale row in `closure` that pre-existed before round-29's depth-stacking fix; run `cargo test closure_table_invariant_depth_stacking` from `src-tauri/` to verify the schema. If the test fails, dump `closure` rows and the surrounding codes; the LENS schema's invariant should hold by construction.

### Playwright tests: `ERR_CONNECTION_REFUSED` on Linux

The Playwright chromium in some sandboxes cannot reach a locally-spawned server. Walk the resolution tree:

1. Sanity check the server: `curl -sv http://127.0.0.1:57599/`. If curl gets 200 OK, the issue is browser ↔ host isolation.
2. Check `cat /etc/hosts`: chromium often resolves `localhost` to `::1` while servers bind IPv4.
3. Build + serve via static `npx http-server` (the round-78 final choice) rather than `vite preview`.
4. If all three still fail, the runner has browser network hardening that breaks localhost TCP — the gate belongs in CI where the runner is fresh.

### `npm run tauri build` succeeded but no `.AppImage` in `dist/`

The Linux AppImage is generated by `linuxdeploy-plugin-appimage`, which fuses libfuse + lzma at bundle time. Without the host libraries, the `.deb` builds but the AppImage silently doesn't appear. The fix is the round-9 apt-get pre-install on CI:

```bash
sudo apt-get install -y libfuse2 liblzma-dev
```

If you're building locally, replicate these yourself.

### macOS Gatekeeper blocks the unsigned build

Until `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` / `ASC_API_KEY` are provisioned (see [README § Release Process — Apple code signing](../README.md#apple-code-signing--notarisation-prerequisites)), macOS builds are unsigned. First launch triggers **Gatekeeper** "can't be opened because the developer cannot be verified". One-time workaround from a terminal:

```bash
# strips the quarantine xattr so Gatekeeper stops blocking the launch
xattr -cr /Applications/LENS.app
```

The signed-and-notarised `.dmg` ships once the Apple-secrets onboarding run (`docs/onboarding-apple-developer.md`) is complete and `npx tauri build` runs inside a release-tag matrix.

### Gate failures

A complete green gate looks like this:

```
bash -n scripts/build-sidecar.sh                  # syntax check
npm test                                          # vitest
npx tsc --noEmit                                  # tsc
cd src-tauri && cargo test                        # cargo
npx playwright test                               # e2e
cd python && pytest                               # pytest
```

If any single command fails, the others can still pass. Bump one at a time, fix the smallest problem first.

---

For installation, dev workflow, and the release process, see [`README.md`](../README.md). For the deep dive into the data model and IPC contract, see [`ARCHITECTURE.md`](../ARCHITECTURE.md).
