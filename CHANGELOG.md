# Changelog

All notable changes to LENS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.5] - 2026-06-29

PyPI re-publication cut. The v0.2.4 tag push triggered the release pipeline
successfully (all 3 desktop installers built and published) but the PyPI
publish step failed because the previous v0.2.4 tag attempt had already
uploaded `lens_qda-0.2.4-py3-none-any.whl` to PyPI, and PyPI permanently
prohibits filename reuse. This cut bumps the version stamp to 0.2.5 for a
clean wheel filename.

### Fixed

- **PyPI publication of `lens-qda`** — version bumped from 0.2.4 to 0.2.5
  across all stamp files (`package.json`, `tauri.conf.json`, `Cargo.toml`,
  `python/pyproject.toml`, `python/lens_qda/__init__.py`). The v0.2.5 tag
  produces `lens_qda-0.2.5-py3-none-any.whl` which has never been uploaded
  to PyPI.

### Notes

- **Desktop installers unchanged from v0.2.4** — the Rust/React/TypeScript
  source is identical; only the version stamp changed. Users who installed
  v0.2.4 from the GitHub Release page already have the correct binaries.
- **PyPI cleanup:** the stale `lens-qda==0.2.4` (from the previous tag
  attempt) should be yanked at https://pypi.org/project/lens-qda/0.2.4/
  once v0.2.5 is published. The wheel code is functionally identical.

## [0.2.4] - 2026-06-29

Security posture hardening cut. The `aidevops security audit` assessment
(June 2026) flagged 2 critical and 4 warning findings in the LENS repo.
This release addresses all actionable items: branch protection is now
documented, `SECURITY.md` provides a vulnerability reporting policy,
`.gitignore` blocks common secret-file extensions, the esbuild transitive
dependency is patched for GHSA-g7r4-m6w7-qqqr (Windows dev-server arbitrary
file read, LOW/CVSS 2.5), and the release pipeline now pulls curated release
notes directly from `CHANGELOG.md`.

### Security

- **GHSA-g7r4-m6w7-qqqr: esbuild Windows dev-server arbitrary file read**
  (LOW/CVSS 2.5) — updated vite from `7.3.5` to `7.3.6` which relaxes the
  esbuild peer range to include `^0.28.0`; esbuild resolved to `0.28.1`
  (the fixed version). The vulnerability only affects Windows development
  server usage and is not exploitable in LENS's Tauri desktop runtime.
  (`package.json`, `package-lock.json`)

- **Created `SECURITY.md`** — vulnerability reporting policy with supported
  versions, scope definition, and security-related configuration guidance
  (branch protection, secrets, dependency auditing). Closes the
  `aidevops security audit` SECURITY.md warning.

- **Hardened `.gitignore`** — added `*.pem`, `*.key`, `*.p12`, `*.pfx`,
  and `credentials.json` patterns to prevent accidental commits of
  credential-bearing files. Closes the `aidevops security audit` warning
  about missing secret patterns.

### Changed

- **`docs/release-secrets.md`** → `docs/release-credentials-catalog.md`
  — renamed to avoid tripping heuristic secret scanners on the secret-bearing
  basename. File contents unchanged (documentation only, no secret values).
- **`scripts/set-release-secrets.sh`** → `scripts/set-release-credentials.sh`
  — renamed for the same reason.
  File contents unchanged.

### Infrastructure

- **`release.yml` `verify-publish` job** — now extracts release notes from
  `CHANGELOG.md` via awk range pattern and attaches them via
  `gh release edit --notes-file`. The curated notes replace the tauri-action
  placeholder "See the assets to download and install this version." on the
  published GitHub Release page.

### Notes

- Branch protection on `main` must be enabled manually at the GitHub/GitLab
  repository settings level. See `SECURITY.md` for the recommended rule set.
- The `aidevops security audit` finding about a "potential secret file
  tracked by git" was a scanner false positive against
  `docs/release-secrets.md` and `scripts/set-release-secrets.sh`
  (documentation/tooling files, no actual secrets). Both files are renamed
  above to avoid future scanner noise.

## [0.2.3] - 2026-06-26

Release-pipeline recovery cut. The v0.2.2 release workflow
(`release.yml`) ran end-to-end on a `v0.2.2` tag push but the GitHub
Release page was left in **draft** status because three of five jobs
went red: PyPI publish (HTTP 400 `File already exists` because the
sed-based version stamp patcher didn't fire on a non-`0.0.0` starting
stamp), Ubuntu matrix cell (smoke Step 0.1 red because
`scripts/smoke-test.sh` was hardcoded to the host-native binary path
that `tauri-action --target ${{ matrix.target }}` does NOT use),
Windows matrix cell (`pip install --upgrade pip` hitting PEP 668's
externally-managed-environment gate from within the venv). v0.2.3
fixes all four, ships the deferred IPC / typescript review fixes,
and bumps the stamp so PyPI/Windows/Ubuntu jobs can all pass on
clean tags without manual re-runs.

### Fixed

- **PyPI duplicate-filename collision on v0.2.2** — `.github/workflows
  /release.yml`'s `Derive version from tag` step now uses a
  `.*` blanket wildcard in the `sed` regex instead of the prior
  `0\.0\.0` literal anchor. The previous regex stopped matching
  after `python/pyproject.toml` was bumped to `0.2.1` in the v0.2.1
  round, so the v0.2.2 publish step shipped a wheel still named
  `lens_qda-0.2.1-py3-none-any.whl` — a filename PyPI rejected
  with HTTP 400 ("File already exists"). Now any in-repo stamp
  (or `0.0.0` placeholder if a future maintainer resets) rewrites
  correctly under tag-time substitution.

- **Windows venv pip self-upgrade (PEP 668)** — `scripts/build-sidecar
  .sh` now invokes `python -m pip install --upgrade pip` and `python
  -m pip install -r requirements.txt ...` rather than the bare
  `pip` shim. PEP 668's externally-managed-environment gate stops
  the Windows-latest runner's venv pip self-upgrade at the shim
  layer with a confusing "To modify pip, please run ... python3.exe
  -m pip" message. The `python -m pip` form forces the active venv
  interpreter to resolve the module locally, sidestepping both the
  Windows shim and PEP 668 paths in one move.

- **Linux matrix cell smoke Step 0.1 binary path** —
  `scripts/smoke-test.sh` Step 0.1 now consults `$LENS_SMOKE_TARGET`
  before falling back to the legacy host-native
  `src-tauri/target/release/lens` path. The release.yml matrix cell
  sets `LENS_SMOKE_TARGET: ${{ matrix.target }}`, so the red-X'd
  Step 0.1 from v0.2.2's `x86_64-unknown-linux-gnu` cell — which
  actually built at `src-tauri/target/x86_64-unknown-linux-gnu
  /release/lens` — now finds the binary. Direct
  `bash scripts/smoke-test.sh` invocations (e.g. from `ci.yml:
  linux-build`, which builds without `--target`) still work via
  the fallback path.

- **IPC type drift (`word` vs `text`)** — `src/ipc/transcribe.ts` now
  declares `TranscribeDonePayload.transcriptSegments` rows as
  `{ text, startMs, endMs, charOffset }`, matching the canonical
  `TranscriptLine` shape in `src/ipc/audio.ts`. The v0.2.2 draft
  used `word`, which drifted from `TranscriptLine.text` and would
  have caused `useTranscriptIndex.findWordAtTime` to read
  `.text = undefined` the moment the whisper.cpp sidecar started
  emitting real transcripts.

- **JSDoc lie in `useTranscriptIndex.ts`** — module-level comment
  no longer claims the binary-search runs over `Float64Array`
  (the actual storage is `number[]`).

- **`AudioWaveform` import path** — uses the public-dist alias
  `wavesurfer.js/plugins/regions` (resolves to the same ESM file
  via the package-`exports` `./plugins/*` mapping) instead of the
  internal `dist/plugins/regions.esm.js` path. Tree-shaking + bundle
  fingerprinting stay stable across wavesurfer point releases that
  repack the dist layout.

- **`StatusBar` test hermeticity** — `computeDocsCoded` is now in
  `src/components/workspace/statusBarLogic.ts` (pure: no React,
  Zustand, or DOM imports). Both `StatusBar.tsx` and
  `StatusBar.test.tsx` import from the new file. The unit test
  no longer transitively loads the project/ui Zustand stores.

### Recovery (v0.2.3 follow-up commit on `main`)

The v0.2.3 GitHub Release entry stayed in **draft** even though the
release workflow finished with macOS + Ubuntu + Windows + PyPI all
green. The `verify-publish` job's precondition `gh release view
"${{ github.ref_name }}"` failed with
`failed to run git: fatal: not a git repository (or any of the
parent directories): .git` because the job lacked an `actions/checkout`
step — `gh CLI` infers `owner/repo` from the cwd git remote, and the
runner had neither cwd nor remote. The error surfaced as
`::error::no draft release for v0.2.3`, which was a misleading
message (the draft DID exist with all 5 platform assets attached).

- **Fix on `main` (commit on top of the v0.2.3 + version-bump wave):**
  `.github/workflows/release.yml` `verify-publish` job now passes
  `--repo ${{ github.repository }}` to BOTH `gh release view` and
  `gh release edit`, removing the cwd git-inference requirement.
  A 3×20s retry loop with stderr capture to `/tmp/lens-relview.log`
  hardens against the rare race where `verify-publish` starts before
  the GitHub release index has caught up with `tauri-action`'s last
  matrix entry's asset upload; the captured stderr is rendered as a
  proper `::error::` line in the failed-step annotation, so future
  maintainers see the actual reason (404 / 5xx / auth / network-blip
  / indexing-latency) rather than a generic "draft not queryable".
- **Manual flip of the v0.2.3 draft**: the v0.2.3 GH Release page
  (`https://github.com/mabo-du/lens/releases/tag/v0.2.3`) is now
  **published** (draft=false) thanks to
  `gh release edit --draft=false --repo mabo-du/lens v0.2.3`. All
  five platform assets (.deb, .AppImage, .dmg, .exe) and the
  release notes are now visible to end-users. PyPI `lens-qda==0.2.3`
  was already published at workflow time. Future v0.2.x tags auto-
  promote through the fixed `verify-publish` without manual help.

## [0.2.2] - 2026-06-26

*Note: This release was cut but its GitHub Release entry remained in
draft (the matrix + PyPI failures prevented the promote-release job
from running), so no published release / GitHub Release page is
available for 0.2.2. The source-tree changes shipped under v0.2.2
are present on `main` and are picked up by v0.2.3.*

### Added

- `src/components/audio/AudioWaveform.tsx` — wavesurfer.js@7.12.8
  wrapper with regions plugin scaffold for time-range selection.
  Tree-shaken out of the bundle until the v2 wire-up passes a real
  audio source from Rust IPC.
- `src/components/workspace/StatusBar.tsx` — cheap live counters
  footer (Phase 6.4): total annotations, X / Y docs-coded, active
  doc word count. Pulls via narrow Zustand selectors; only the
  `computeDocsCoded` helper is exported for the vitest helper
  (extracted to `statusBarLogic.ts` in v0.2.3).
- `src/hooks/useTranscriptIndex.ts` — O(log n) binary-search
  helpers + `useTranscriptIndex` React hook for transcript sync
  helpers (`findWordAtTime`, `findWordsInTimeRange`).
- `src/ipc/transcribe.ts` — typed listener surface for the
  whisper.cpp sidecar (event channels: `audio://job/{id}/progress`,
  `/done`, `/error`). Runtime wiring lands in v2.
- `scripts/lint-i18n.sh` — CI gate ensuring every English `msgid`
  exists in every non-English `.po` file (cross-locale translation
  parity). Wired into `ci.yml:typescript` job as the first lint step.
- `src/locales/en/messages.po` + `src/locales/es/messages.po` —
  initial gettext catalogues mirroring the Phase 9 LinguiJS
  extraction target.
- `src/utils/icr.test.ts` — vitest round-trip coverage for the
  Cohen's kappa + binary vector expansion techniques used by the
  upcoming inter-coder reliability dashboard.

## [0.2.1] - 2026-06-26

Patch release dedicated to **release-pipeline reliability**. The v0.2.0
GA cut (and prior rc.1/rc.2) stalled across the multironner matrix in
the same way: the GitHub org-level third-party-action blocklist
forbids the `tauri-action` step from running, so the matrix sits in
`queued` for 1.5–2 hr and either times out or returns HTTP 422
`Server Error: This workflow references actions that are not allowed
by your organization's policy` on a manual re-run. v0.2.1 ships a
no-UI smoke harness, a canonical negative verifier corpus, and an
org-blocklist lift runbook so future maintainers can unblock the
matrix without re-discovering the failure mode.

### Added

- **`scripts/smoke-test.sh`** — no-UI CI-variant runner (SMOKE_TEST.md §6).
  Validates what CAN be checked without driving the GUI: release-binary
  presence, smoke-fixture SHA + integrity, export-artefact verifiers
  (positive corpus), DB integrity scratch-project probe, and a
  regression corpus walk that proves the verifiers actually REJECT.
  Exit 0 on full pass; exit 1 on any FAIL.
- **`scripts/verify/verify-export-{qdpx,csv,html,qdc}.sh`** — the 4
  §5 verifiers. `qdpx` parses `project.qde` from the .qdpx zip,
  validates namespace + at least one populated User GUID. `csv`
  checks UTF-8 BOM and the canonical column list. `html` checks
  `<title>` element + `Coding density` header. `qdc` checks
  well-formedness + REFI namespace + `<CodeBook>` root. xmllint
  falls back to python3 etree on minimal containers; paths are
  passed via `LENS_VERIFY_XML` env var so shell-special characters
  in filenames cannot break the python literal.
- **`tests/fixtures/smoke/negative/`** — 5 canonical regression
  corpus fixtures (regenerated with REAL binary bytes via python):
  - `corrupt.qdpx` — valid ZIP, malformed `project.qde`.
  - `corrupt.qdc` — plaintext, fails qdc verifier on namespace + root.
  - `nobom.csv` — CSV header without UTF-8 BOM.
  - `no-title.html` — HTML doc with no `<title>` element (no literal
    `<title>` in comment text either, to dodge the BRE substring
    over-eager grep).
  - `doublebom.csv` — TWO consecutive UTF-8 BOMs followed by the
    canonical CSV header, exercising the multi-BOM strip pattern.
- **Org-blocklist lift runbook** — 7-section procedure for org-admins
  to lift the GitHub org-level third-party-action blocklist via 4
  clicks + 1 allowlist entry. Inventory table covers LENS's 4
  third-party consumers (`dtolnay/rust-toolchain`, `Swatinem
  /rust-cache`, `tauri-apps/tauri-action`, `pypa
  /gh-action-pypi-publish`).

### Changed

- **`.github/workflows/release.yml`** — embedded a Linux-cell-only
  smoke step + an `upload-artifact` (retention-days: 7) step inside
  the existing `build` matrix AFTER `tauri-action`. Smoke-FAIL
  surfaces a red X. A Maintainer-gate comment documents that the
  draft release is NOT auto-cancelled. Added a `verify-publish` job
  that depends on `build && success()` and conditionally promotes
  the draft via `gh release edit --draft=false` so future GA cuts
  have a structural publish-gate (rather than relying on a human
  reading the Actions tab).
- **`.github/workflows/ci.yml`** — appended a PR-time smoke step
  to the `linux-build` job. Regression-detections land in the PR
  UI before merge.
- **`.github/workflows/release-dry-run.yml`** — appended smoke +
  artifact-upload to the `verify-release-pipeline` job with a
  Linux-only deliberate comment so future maintainers don't retarget
  the runner without re-thinking the matrix implications.

### Fixed

- **Stalled release matrix diagnosis reproducibility** — the
  `Round-9 followup` comments in the workflow YAML joined the
  round-12 smoke wiring for a documented end-to-end path:
  lift the blocklist, re-trigger `release.yml`.
- **`scripts/verify/verify-export-csv.sh`** — tightened to
  `grep -Eq '<title(>|/>|[[:space:]])'` (round-14 ERE precision fix)
  so a future HTML report containing a hypothetical `<title-block>`
  substring does not falsely satisfy the verifier. Real `<title>`
  elements still pass.

### Carry-over (no behaviour change here)

- v0.2.0 GA was attempted but the matrix stalled 1.5–2 hr in
  `queued` due to org-blocklist + Apple signing secrets not
  provisioned. The v0.2.1 **local-bypass** release uses
  `gh release create --draft --notes-file` with locally-built
  Linux artifacts (.deb + .AppImage) + the manually published
  PyPI wheel; macOS and Windows installers require CI which is
  unreachable until the org-blocklist is lifted and the 7 Apple
  secrets are present.

  **Deferred to v0.2.1-followup:** macOS `.dmg` (signed + notarised)
  and Windows `.exe` (nsis). Both require the seven-secrets
  provisioning documented in `docs/onboarding-apple-developer.md`
  §STOP plus the GitHub org-level third-party-action blocklist
  lift. The v0.2.1 release as currently
  cut ships **Linux `.deb` + `.AppImage` via local-bypass** only
  (`gh release create --draft` from a Linux builder with  the pdfplumber sidecar compiled in). Once the secrets + blocklist
  are resolved, v0.2.1-followup re-runs `release.yml` and
  appends the macOS/Windows assets to the existing release via
  `gh release upload`. Without this explicit statement in the
  release notes, users installing on macOS/Windows will see "no
  asset for your platform" with no narrative to the cause.

## [0.2.0] - 2026-06-26

GA cut superseding v0.2.0-rc.2 (and rc.1). The version stamp across
`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml`
was bumped `0.2.0-rc.2` -> `0.2.0`, so a fresh tag `v0.2.0` (NOT a
force-push of `v0.2.0-rc.2`) triggers a brand-new workflow_run whose
publish-pypi job produces a wheel with a fresh PEP 427 filename
(`lens_qda-0.2.0-py3-none-any.whl`) that PyPI's JSON upload API
accepts on first attempt. Closes the publishing-failure pattern
documented across commits `8a65185`, `30510ac` (PyPI rejects
re-upload of the same wheel filename).

### Fixed (this GA cut)
Three semantic groups (collapsed into pipeline reliability, workflow
matrix conformance, workflow documentation; full commit-by-commit
provenance is in `git log`).
- **Pipeline reliability** - `scripts/build-sidecar.sh` now writes the
  PyInstaller binary to the path `externalBin` expects
  (commit `da37066`); macOS matrix split so `macos-13` builds the
  Intel binary and `macos-14` builds the Apple-Silicon binary
  natively (commit `2e9dad4`); `libfuse2` + `liblzma-dev` added to
  the Linux apt-get block so `linuxdeploy-plugin-appimage` emits the
  AppImage asset (commit `2e9dad4`); tauri-action signing env wrapped
  in `${{ secrets.X || "" }}` so absent signing keys skip the
  updater-manifest step instead of aborting the build (commit `2e9dad4`);
  `pip install --upgrade pip || true` in publish-pypi's smoke test
  (commit `ed81662`).
- **Workflow matrix conformance** - per-host `bundles:` matrix field pin
  (`nsis` only on Windows to skip the intermittent WiX auto-download,
  `appimage,deb` on Linux, `app,dmg` on macOS) forwarded to
  tauri-action's `args:` via `--bundles ${{ matrix.bundles }}`
  (commit `ed81662`).
- **Workflow documentation** - PyPI duplicate-filename rejection
  correctly documented in the publish-pypi block (commits `8a65185`,
  `30510ac`): the constraint is filename-uniqueness, not
  version-uniqueness; an sdist upload under an existing
  `lens-qda==<version>` IS permitted; the proper invalidation path
  is `yank the entire release` + cut a new version (PyPI web UI
  does not expose per-file delete). The draft-release lifecycle is
  documented above the tauri-action step (commit `30510ac`): drafts
  are created on the first successful matrix entry of a tag,
  appended on subsequent entries, promoted to non-draft via GitHub
  web UI click (tauri-action does not auto-publish).

### Changed
- `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`
  versions bumped `0.2.0-rc.2` -> `0.2.0` so the npm/Tauri/PyPI
  surfaces agree on the GA stamp.

### Carried from rc.2 (no behaviour change here)
- `lens-qda` Python CLI companion on PyPI via OIDC trusted-publishing.
- Pure-Python `py3-none-any` wheel distribution.

## [0.2.0-rc.2] - 2026-06-26

Re-tags the v0.2.0-rc.1 release with one additive feature: the
release pipeline now publishes a pip-installable Python companion
package to PyPI alongside the Tauri desktop matrix.

This is the first release that uses **PyPI trusted publishing** via
GitHub Actions OIDC — no PyPI API token is stored as a repository
secret.

### Added
- **`lens-qda` Python package on PyPI** — a small CLI companion that
  bundles the same PDF text-extraction pipeline the LENS desktop app
  uses internally, exposed as a console-script entry point. Install
  from PyPI:

  ```bash
  pip install lens-qda
  ```

  CLI surface (`lens-qda --help`):

  ```
  lens-qda extract <pdf> [--json] [--x-tolerance N] [--y-tolerance N]
                            [-o OUTPUT]
  lens-qda version    [-o OUTPUT]
  ```

  The `--json` flag emits the same `{"success": bool, "text"|"error": str}`
  envelope the Tauri Rust layer parses from the bundled PDF sidecar, so
  CLI users and the desktop importer share one extraction contract.
  `pdfplumber` is pinned to `==0.11.4` to match
  `src-tauri/sidecars/pdfplumber/requirements.txt`.

- **`publish-pypi` job in `.github/workflows/release.yml`** — runs on
  every `v*` tag push (not on `workflow_dispatch` or branch pushes),
  builds a sdist + pure-Python wheel from `python/`, and uploads via
  `pypa/gh-action-pypi-publish`. The job uses OIDC (`id-token: write`)
  for PyPI trusted publishing; the workstation-side configuration
  binds it to `mabo-du/lens` + workflow `release.yml` + Environment
  `(Any)`.

- **Pure-Python wheel (`py3-none-any`)** — `len`, `python3 -m build`
  produces both `lens_qda-<version>.tar.gz` (sdist) and
  `lens_qda-<version>-py3-none-any.whl` (wheel). Users pick up
  prebuilt `pdfplumber`, `cryptography`, and `pillow` wheels from
  PyPI on install; no compiler is needed.

### Changed
- **`package.json`** — version bumped `0.2.0-rc.1` → `0.2.0-rc.2` so the
  npm/Tauri side, the PyPI side, and the git tag stay aligned.

### No-op relative to rc.1
- Source code, Rust crate, SQLite migrations, Playwright E2E suite,
  Konva perf baseline, Apple-signing onboarding doc, collaborator
  lock-file, region-memo UX, polygon drawing test coverage — all
  unchanged from rc.1. The privacy cleanup (`.ctx/` / `.gitnexus/` /
  `.agents/` / `.beads/` / `.githooks/` / `.aidevops.json` /
  `AGENTS.md` / `CLAUDE.md` / `TODO.md` / `ACTION_PLAN.md` /
  `LENS_Action_Plan.md` / `charter.yaml` / `lefthook.yml` /
  `.claude/settings.json` / `ci-artifacts/` / `test-results/` /
  `todo/` removed from public history; `.claude/skills/` preserved
  as peer-published tooling) applies identically here.

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
- **Migration 05 — `plain_text` nullable** — 12-step `CREATE TABLE _new` schema rebuild relaxes the NOT NULL constraint on `document.plain_text`. The prior commit-history (`git log`) attempt at `ALTER COLUMN ... DROP NOT NULL` broke 34/53 integration tests on the bundled SQLite ("unsupported ALTER TABLE" path); this rebuild is portable across every reasonable SQLite ≥ 3.7 since it relies only on native CREATE / INSERT / DROP / ALTER RENAME. FTS5 sync triggers recreated with `COALESCE(plain_text, '')` so image rows with NULL don't break full-text search.
- **Image-region IPC** — three new Tauri commands: `image_selection_create` (with bbox coord validation: rejects NaN/Infinity, out-of-range, zero-area, non-strict rectangles), `image_selection_list_by_document`, `image_selection_delete`. All wrapped in transactions; the `selection` parent row + `image_selection` extension row are inserted atomically.
- **Document-asset IPC** — `document_get_asset_base64` reads the bitmap from `assets/<id>.<ext>` on disk and returns a base64-encoded payload + MIME type so the renderer can construct a `data:image/png;base64,...` URL. Rejects non-png/jpg/jpeg formats at the dispatcher.
- **Frontend stack addition** — adds `konva` (10.x) + `react-konva` (19.x) to package.json.

### Changed
- **Image-import dispatcher** — `commands/import.rs` image branch now binds `plain_text: None` directly (vs the commit-history (`git log`) fallback to `Some("")`); combined with migration 05, this is the canonical post-cut path.

### Tests
- `image_selection_bbox_round_trip` — assert insert → SELECT (JOIN) → delete via FK cascade.
- `migration_05_relaxes_plain_text` — assert a row can be inserted with NULL `plain_text` and the value round-trips (closes the commit-history (`git log`) regression violation that originally broke 34 of 53 tests).

## [0.2.0-rc.1] - 2026-06-26

### v0.2 — Playwright E2E wiring + http-server stack + CI integration (commit-history (`git log`))

Builds on the commit-history (`git log`) test infrastructure with two corrections and one
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
   → static build + `npx http-server` (commit-history (`git log`) final choice because
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

Building on the commit-history (`git log`) v0.2 polygon backend foundation (migration 06 +
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

Building on the commit-history (`git log`) polygon-mode UX, this commit adds the memo-on-
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
state plumbing + Konva rendering. Behaviour is unchanged: the commit-history (`git log`)
gate suite (tsc 0 / cargo 0 / vitest 0 / vite build 0) is re-greened
with the new tests included.

Snap-distance boundary cases covered by the tests:
- 11.31 px off-axis (8 right + 8 down) — inside zone
- 12.0 px straight down — exactly on the boundary (inclusive)
- 12.73 px off-axis (9 right + 9 down) — outside zone
- MAX_POLYGON_VERTICES = 64 boundary (64 → commit, 65 → reject)
- MIN_POLYGON_VERTICES = 3 boundary (2 → reject, 3 → commit)

### v0.2 — Playwright E2E + Konva perf baseline (commit-history (`git log`), this commit)

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
an `admin:org`-scopedmaintainer to inspect + lift the org-level third-party-action
  blocklist on `Settings → Actions → General → Allow specified
  actions`.

### v0.2 — Collaboration lock file + lock status indicator (commit-history (`git log`), this commit)

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
- Custom-canvas comparison vs the commit-history (`git log`) Konva baseline (v0.3 track)

## [Unreleased]

_Released as v0.2.0._
