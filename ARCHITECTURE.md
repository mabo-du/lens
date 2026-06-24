# LENS Architecture

## Overview

LENS is a single-user, offline-first qualitative data analysis (QDA) desktop application built with Tauri 2 (Rust backend) and React 19 + TypeScript (frontend).

## Data Model

The database is a single SQLite file (`project.qdaproj`) stored in the project directory. Core tables:

| Table | Purpose |
|---|---|
| `project` | Project metadata |
| `local_user` | User identity (single row, auto-created) |
| `document` | Imported documents with canonical plain text snapshots |
| `code` | Hierarchical code tree nodes |
| `code_closure` | Closure table for ancestor/descendant queries |
| `selection` | Annotation base (class table inheritance) |
| `text_selection` | Character-range annotation data |
| `memo` | Per-code, per-annotation, and project journal memos |
| `document_fts` | FTS5 virtual table for document search |
| `memo_fts` | FTS5 virtual table for memo search |

### Closure Table

The code tree uses a closure table pattern: every node has a self-referencing row (`depth=0`), and parent-child relationships are stored as rows with `depth > 0`. This enables O(1) ancestor/descendant queries and efficient subtree moves via SQL set operations.

## IPC Contract

All IPC follows a `domain:operation` naming convention (e.g., `codes:create`, `annotations:list-by-code`). Commands are defined as `#[tauri::command]` functions in `src-tauri/src/commands/` and typed on the frontend in `src/ipc/`.

## Import Pipeline

1. Frontend opens file via native dialog (`tauri-plugin-dialog`)
2. For DOCX: xmldom + jszip extract text in the renderer, passes via `raw_text` IPC param
3. For PDF: pdfplumber sidecar binary extracts text on the Rust side
4. For TXT: read directly as UTF-8
5. All text runs through normalisation (NFC, ligature expansion, line ending normalisation)
6. SHA-256 hash computed for duplicate detection
7. Row inserted in `document` table; FTS5 triggers auto-index

## Annotation System

Text annotations are stored as `(document_id, code_id, start_char, end_char)` tuples. Character offsets are 0-indexed relative to the canonical `document.plain_text`. ProseMirror renders highlights as inline decorations via a custom plugin (`QdaAnnotationPlugin`).

## Export Layer

The export system is a strategy pattern: `export:prepare` assembles the full project state into a typed `ExportPayload`, then exporter plugins (QDPX, QDC, CSV, HTML) transform it into their respective formats. Exporters are pure functions — no direct database access.

## Migration Runner

Database migrations are numbered SQL files in `src-tauri/src/db/migrations/`, embedded via `include_str!()` and run sequentially. A `schema_version` table tracks which migrations have been applied.

## Project Structure

```
src/                    # React frontend
  components/           # UI components
    editor/             # ProseMirror wrapper + annotation plugin
    code-tree/          # react-arborist code tree
    document-list/      # Document navigator
    memos/              # Memo dialogs
    search/             # FTS5 search dialog
  ipc/                  # Typed IPC callers
  store/                # Zustand stores
  export/               # Export plugins

src-tauri/              # Rust backend
  src/
    commands/           # Tauri command handlers
    db/                 # Migration runner + SQL
    import/             # Text extraction + normalisation
```
