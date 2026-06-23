# LENS — Local Ethnographic Narrative System

Open-source qualitative data analysis (QDA) for the desktop. Import documents, build a hierarchical code tree, annotate text passages, and export to REFI-QDA standards — all offline-first, with no cloud dependency.

## Features

- **Document import:** TXT, DOCX (via Mammoth.js), PDF (via pdfplumber sidecar)
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
| Frontend | React 18 + TypeScript + Vite |
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
git clone <repo-url>
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

## License

To be determined.
