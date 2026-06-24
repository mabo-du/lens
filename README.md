# LENS

Open-source qualitative data analysis (QDA) for the desktop. Import documents, build a hierarchical code tree, annotate text passages, and export to REFI-QDA standards — all offline-first, with no cloud dependency.

## Features

- **Document import:** TXT, DOCX (custom importer via xmldom + jszip), PDF (via pdfplumber sidecar)
- **Coding workspace:** Three-panel layout — document list, ProseMirror editor with annotation highlights, hierarchical code tree
- **Closure-table code tree:** Nest codes arbitrarily deep with drag-and-drop reorganization
- **Full-text search:** FTS5 across documents and memos, with code-scoped filtering
- **Memo system:** Per-code, per-annotation, and project journal memos with autosave
- **REFI-QDA export:** `.qdpx` (full project), `.qdc` (codebook), CSV (annotations), HTML (printable report)
- **Offline-first:** SQLite database, no internet required

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 (Rust) |
| Frontend | React 19 + TypeScript + Vite |
| UI | Tailwind CSS + shadcn/ui |
| Editor | ProseMirror |
| Database | SQLite via sqlx (direct, no ORM) |
| State | Zustand |

## Development

### Prerequisites

- Rust 1.75+
- Node.js 20+
- Python 3.9+ (for pdfplumber sidecar)
- Tauri system dependencies ([see Tauri docs](https://v2.tauri.app/start/prerequisites/))

### Setup

```bash
git clone https://github.com/mabo-du/lens.git
cd lens
npm install
```

### Run (dev mode)

```bash
npm run dev        # Vite frontend dev server
npm run tauri dev  # Full Tauri desktop app
```

### Test

```bash
npm test           # Vitest (frontend)
cd src-tauri && cargo test  # Rust (backend)
```

### Build

```bash
npm run tauri build
```

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design, data model, and IPC contract.

## Release Process

LENS follows [Semantic Versioning](https://semver.org/). Releases ship via the
GitHub Actions `release.yml` matrix (`ubuntu-22.04` / `windows-latest` /
`macos-latest` x86_64 / `macos-latest` aarch64), which builds signed installers
and opens a **draft** GitHub Release.

### Cut a release candidate first (recommended for non-trivial changes)

```bash
# 1. Move CHANGELOG.md "Unreleased" → dated entry under the new version.
# 2. Bump versions in package.json + src-tauri/Cargo.toml + src-tauri/tauri.conf.json.
# 3. (Optional) Validate the pipeline end-to-end without publishing:
gh workflow run release-dry-run.yml
# 4. Commit + tag + push:
git commit -am "release: vX.Y.Z-rc.N"
git tag -a vX.Y.Z-rc.N -m "vX.Y.Z-rc.N"
git push origin main
git push origin vX.Y.Z-rc.N
# 5. Wait for the matrix to finish green at
#    https://github.com/mabo-du/lens/actions/workflows/release.yml
#    (and Resolve any platform-specific failures).
```

### Promote RC → GA after the matrix is green

```bash
# Replace prerelease flag + publish the draft. Either:
gh release edit vX.Y.Z-rc.N \
  --draft=false --prerelease=false \
  --notes-file CHANGELOG.md
# Or open the Actions tab → Releases → click the entry → "Edit" →
# uncheck "This is a pre-release" and click "Publish release".
```

### Apple notarization prerequisites

macOS jobs need `TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]` plus notarization
credentials stored in repo secrets: `APPLE_ID`, `APPLE_PASSWORD`,
`APPLE_TEAM_ID`, and a base64-encoded App Store Connect API key
(`ASC_API_KEY`). Bootstrap recipes (incl. the macOS `base64 -b 0` gotcha and
the `security find-identity` snippet) live in
`docs/onboarding-apple-developer.md` and `scripts/set-release-secrets.sh`.

### Pinned action SHAs

`.github/workflows/release.yml` and `release-dry-run.yml` pin every
third-party action to a specific commit SHA so workflow behaviour is
reproducible across Renovate-style dependency rollers. When a new tagged
release of an upstream action is needed, update the SHA inline (look up
the correct SHA via `git ls-remote https://github.com/<owner>/<repo>.git
refs/tags/<tag>` or `curl https://api.github.com/repos/<owner>/<repo>/git/
refs/tags/<tag>`) and update the trailing `# <version>` comment in the
same edit.

When bumping, refresh:
- `actions/checkout` (latest stable tag)
- `actions/setup-node` (latest stable tag)
- `actions/setup-python` (release-dry-run.yml only)
- `dtolnay/rust-toolchain` (refs/heads/stable)
- `tauri-apps/tauri-action` (rolling `v0` tag)
- `actions/upload-artifact` (release-dry-run.yml only)

## License

LENS is released under the [MIT License](LICENSE). You are free to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies of the
source or binaries, provided the copyright notice and permission notice are
preserved. The above is a summary; the [LICENSE](LICENSE) file is
authoritative. Third-party components carry their own licences — see
[Third-Party Notices](THIRD_PARTY_NOTICES.md) for the upstream attribution
list.
