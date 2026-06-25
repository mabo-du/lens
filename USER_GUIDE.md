# LENS — User Guide

A complete guide to using LENS for qualitative data analysis on the desktop.

## Table of Contents

1. [Installation](#installation)
2. [Getting Started](#getting-started)
3. [Creating and Opening Projects](#creating-and-opening-projects)
4. [Importing Documents](#importing-documents)
5. [Building a Code Tree](#building-a-code-tree)
6. [Coding Text](#coding-text)
7. [Working with Memos](#working-with-memos)
8. [Searching Your Project](#searching-your-project)
9. [Image Annotation](#image-annotation)
10. [Exporting Your Work](#exporting-your-work)
11. [Collaboration](#collaboration)
12. [Settings](#settings)
13. [Keyboard Shortcuts](#keyboard-shortcuts)
14. [Troubleshooting](#troubleshooting)

---

## Installation

### Download

Download the latest release for your platform from the
[LENS releases page](https://github.com/mabo-du/lens/releases/latest):

| Platform | Installer |
|----------|-----------|
| Windows 10+ | `.msi` or `.exe` (NSIS) |
| macOS 11+ (Intel) | `.dmg` (x86_64) |
| macOS 11+ (Apple Silicon) | `.dmg` (aarch64) |
| Ubuntu 22.04+ | `.deb` or `.AppImage` |

### System Requirements

- **Windows:** Windows 10 or later with WebView2 runtime (included in Windows 11,
  auto-installed on Windows 10)
- **macOS:** macOS 11 (Big Sur) or later
- **Linux:** Ubuntu 22.04+ with `libwebkit2gtk-4.1` and `libgtk-3`

### Build from Source

See the [Development](#) section in [README.md](README.md).

---

## Getting Started

### The Three-Panel Workspace

When you open a project, LENS shows a three-panel layout:

```
┌──────────────┬────────────────────────┬───────────────┐
│  DOCUMENTS   │    DOCUMENT EDITOR     │   CODE TREE   │
│              │                        │               │
│  - Interview │  Lorem ipsum dolor     │  ■ Themes     │
│    #1.txt    │  sit amet, consect-    │    ■ Identity │
│  - Interview │  etur adipiscing...    │  ■ Emotions   │
│    #2.txt    │                        │    ■ Joy      │
│  - Field     │  ██████ highlighted    │    ■ Sadness  │
│    notes.pdf │  ██████ passage →      │               │
│              │                        │  CODE VIEW:   │
│              │  [Margin code tags]    │  Segments     │
│              │                        │  tagged with  │
│              │                        │  selected     │
│              │                        │  code         │
└──────────────┴────────────────────────┴───────────────┘
```

- **Left panel** — Document list. Click a document to open it.
- **Center panel** — Document editor. Read documents and select text for coding.
- **Right panel** — Code tree (or Code View when a code is selected).

### Top Navigation Bar

The dark bar at the top of the window provides access to:

| Button | Action |
|--------|--------|
| Project name | Click to rename |
| **Export** | Export to REFI-QDA, CSV, or HTML report |
| **Backup** | Create or restore encrypted `.lensbackup` archives |
| **Import REFI-QDA** | Import `.qdpx` files from other QDA tools |
| **Project Journal** | Free-text project-wide notes |
| **Close** | Close the current project |
| **Settings** ⚙ | Theme, display name, default code colour |

---

## Creating and Opening Projects

### New Project

1. On the welcome screen, click **New Project**.
2. Choose a parent directory for your project folder.
3. Enter a project name (letters, numbers, spaces, dots, underscores, hyphens).
4. Optionally set an encryption passphrase to protect your data at rest.

LENS creates a folder structure:

```
My Project/
├── project.qdaproj    ← SQLite database
├── assets/            ← imported source files
└── .encrypted          ← present only if encryption is enabled
```

### Open Existing Project

Click **Open Project** on the welcome screen and select the project folder
containing `project.qdaproj`.

If the project was encrypted, you'll be prompted for the passphrase.

### Sample Project

Click **Sample Project** to create a pre-populated project with example
interview transcripts, codes, and annotations. This is ideal for learning
the coding workflow without importing your own data.

### Recent Projects

The welcome screen lists recently opened projects. Click any entry to
reopen it, or click the **×** button to remove it from the list.

---

## Importing Documents

LENS supports plain text (`.txt`), Microsoft Word (`.docx`), and PDF
documents. Images (`.png`, `.jpg`, `.jpeg`) are also supported for
visual annotation.

### Import a Document

1. Click the **+ Import** button in the **Document List** panel (left sidebar).
2. Select one or more files from the native file picker.
3. LENS processes each file and normalises the text for consistent coding.
4. Imported documents appear in the document list, ordered by import time.

### Import Pipeline

| Format | Extractor | Notes |
|--------|-----------|-------|
| `.txt` | Native UTF-8 reader | Reads the file directly |
| `.docx` | Rust-native `zip` + XML parser | Extracts text from runs/paragraphs. Tracked changes, comments, and footnotes are not included in MVP |
| `.pdf` | `pdfplumber` sidecar | Layout-aware extraction. Scanned PDFs may need OCR |
| `.png`/`.jpg` | Image header reader | Dimension-only for annotation canvas |

### Duplicate Detection

Re-importing the same file content produces a warning: LENS detects
duplicates by comparing SHA-256 hashes of the normalised text.

### Document List Features

- **Click** a document to open it in the editor.
- Documents are reorderable via drag-and-drop.
- Imported source files are copied to the project's `assets/` folder
  for self-contained portability.

---

## Building a Code Tree

Codes are the analytical categories you apply to text. In LENS, codes
are organised in a hierarchical tree using a closure table — you can
nest codes arbitrarily deep.

### Create a Root Code

1. Click the **+ New Code** button above the code tree.
2. Enter a name (e.g., "Themes", "Emotions", "Identity").
3. Choose a colour from the 16-colour palette (or enter a hex code).
4. Optionally add a description.
5. Choose a parent code, or leave blank for a root-level code.

### Create Child Codes

1. Right-click an existing code in the tree.
2. Choose **New Child Code**.
3. Fill in the details and click Create.

The child code appears nested under its parent in the tree, indented
with the parent's colour strip.

### Organise Codes

- **Drag and drop** codes to rearrange the hierarchy. Drop a code
  _on_ another code to make it a child; drop _between_ codes to
  reorder siblings.
- **Double-click** a code name to rename it inline.
- **Right-click** a code for actions: Edit (colour/description),
  Delete, New Child Code, or Edit Memo.

### Code View

Click any code in the tree to switch the right panel to **Code View**,
which shows every text segment tagged with that code across all
documents, with surrounding context. Click any segment to jump to
that location in the document editor.

---

## Coding Text

Coding is the core activity in LENS: selecting a passage of text in a
document and assigning it to one or more codes.

### Three Ways to Code

#### 1. Code Tree Click (Primary)

1. Select text in the document editor by clicking and dragging.
2. The code tree shows a subtle pulsing indicator on each code.
3. Click any code in the tree to assign it to the selected text.
4. The text is highlighted with the code's colour.

#### 2. Fuzzy Code Picker (Fastest)

1. Select text in the document editor.
2. Press **Ctrl+K** (or **Cmd+K** on macOS).
3. Start typing a code name — the picker shows fuzzy matches.
4. Press **Enter** or click a code to assign it.
5. Press **Esc** to dismiss without assigning.

#### 3. Right-Click Context Menu

1. Select text in the document editor.
2. Right-click the selection.
3. Choose **Assign code…** to open the fuzzy picker.
4. Right-click an existing highlight to **Remove annotation** or **Edit memo**.

### How Highlights Work

- Each code's highlight uses the code's colour at 35% opacity for the
  fill and a 2px bottom border in the full colour.
- When multiple codes overlap on the same text, highlights stack visually.
  Each code renders as a separate coloured span, so you can see all
  assigned codes at a glance.
- Margin code labels appear to the right of the document showing which
  codes are applied to each region.

### Undo / Redo

- **Ctrl+Z** (Cmd+Z) — Undo the last annotation (create or delete).
- **Ctrl+Shift+Z** or **Ctrl+Y** — Redo.

---

## Working with Memos

Memos let you attach notes to codes, annotations, or the project itself.

### Code Memo

1. Right-click a code in the code tree.
2. Choose **Edit memo**.
3. Write your analytical notes in the text area.
4. The memo auto-saves as you type (1-second debounce).

### Annotation Memo

1. Right-click an existing highlight in the document editor.
2. Choose **Edit memo**.
3. Write notes about why you applied this code to this passage.

Annotation memos are displayed as tooltips when hovering over the
highlighted text.

### Project Journal

1. Click **Project Journal** in the top navigation bar.
2. Write free-text notes about the project — research questions,
   methodological notes, or coding decisions.
3. The journal auto-saves as you type.

### Image Region Memo

For image annotations, right-click a region or polygon and choose
**Edit Memo…** from the action menu. Regions with memos show a bullet
(•) appended to the code label.

---

## Searching Your Project

### Full-Text Search

Press **Ctrl+F** (or **Cmd+F** on macOS) to open the search panel.

- Type a query to search across all documents and memos.
- Results are grouped by source type (Documents, Memos) and ordered
  by document import order.
- Each result shows a snippet with the match highlighted.
- Click a document result to open that document at the match location.

### Search Within a Code

You can filter search results to only show text segments tagged with
a specific code. Select the code from the filter dropdown in the
search panel.

### FTS5 Search

LENS uses SQLite's FTS5 full-text search with the `unicode61` tokenizer.
This provides fast, accurate search across large projects. Note: CJK
(Chinese, Japanese, Korean) text is not tokenised at character boundaries
— search for character sequences directly.

---

## Image Annotation

When you open an image document (`.png`, `.jpg`, `.jpeg`), the document
editor shows an interactive canvas.

### Rectangle Mode (Default)

1. Select a code from the code tree.
2. Click and drag on the image to draw a bounding box.
3. The region is saved with proportional coordinates (0–1).

### Polygon Mode

1. Toggle the mode selector from **Rectangle** to **Polygon**.
2. Click on the image to place vertices.
3. Right-click or press **Enter** to commit (minimum 3 vertices).
4. Press **Esc** to cancel.

### Region Actions

- **Right-click** a region for the action menu: Edit Memo or Delete.
- Regions with memos show a bullet (•) after the code name.

---

## Exporting Your Work

Click **Export** in the top navigation bar and choose a format:

| Format | Extension | Description |
|--------|-----------|-------------|
| **REFI-QDA Project** | `.qdpx` | Full project exchange format. Validates against `Projects.xsd`. Importable by NVivo, ATLAS.ti, MAXQDA, and other REFI-QDA-compatible tools. |
| **REFI-QDA Codebook** | `.qdc` | Standalone code tree. Share your coding scheme independently of data. |
| **CSV** | `.csv` | One row per annotation with: document title, code name, code path, segment text, context, memo, coder. UTF-8 BOM for Excel compatibility. |
| **HTML Report** | `.html` | Self-contained single-file report with code-by-code sections, segment quotes, and coding statistics. Print-friendly CSS included. |

### Import REFI-QDA

Click **Import REFI-QDA** in the top navigation bar to import `.qdpx`
files from other QDA tools. On conflict with existing project data,
you'll be prompted to Merge or Replace.

---

## Collaboration

LENS uses a **baton-pass** collaboration model — only one person can
have a project open at a time. This prevents simultaneous edits that
would cause data conflicts.

### How It Works

- When you open a project, LENS writes a `project.lock` file to the
  project folder containing your display name and a timestamp.
- When you close the project (or quit the app), the lock file is removed.
- If the app crashes, the lock file remains. Locks older than 8 hours
  are automatically cleared on the next open.

### Lock Indicator

When a project is open, the top navigation bar shows a small lock icon
(🔒) with your display name — confirming you hold the collaboration baton.

### Opening a Locked Project

If you try to open a project that appears to be open elsewhere, LENS
shows a warning message with the lock holder's name. You can choose to
open anyway if you're certain the other instance has been closed.

---

## Settings

Click the Settings icon (⚙) in the top navigation bar to access:

| Setting | Description |
|---------|-------------|
| **Display Name** | Your name as shown in exports (coder attribution) and collaboration locks |
| **Theme** | Light, Dark, or follow System preference |
| **Default Code Colour** | Colour pre-selected in the New Code dialog |
| **Ollama Model** | AI model for future integration (configurable) |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+K** (Cmd+K) | Open fuzzy code picker |
| **Ctrl+F** (Cmd+F) | Open full-text search |
| **Ctrl+Z** (Cmd+Z) | Undo annotation |
| **Ctrl+Shift+Z** / **Ctrl+Y** | Redo annotation |
| **Esc** | Dismiss picker/dialog |

---

## Troubleshooting

### The app won't start on Linux

Ensure `libwebkit2gtk-4.1` and `libgtk-3` are installed:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev
```

### PDF text extraction is poor or empty

Scanned PDFs (image-only, no text layer) produce minimal text. LENS
detects this and offers to run OCR (optical character recognition)
via Tesseract.js. Accept the prompt to extract text from the scanned pages.

### DOCX tracked changes are missing

The MVP DOCX importer reads only the live-edit view in `word/document.xml`.
Tracked changes, comments, and footnotes are not extracted. Accept all
changes in Word before importing for the most complete text.

### A project won't open (encrypted)

If you see "Incorrect encryption passphrase," double-check the passphrase.
LENS uses SHA-256 key derivation, so passphrases are case-sensitive and
no recovery is possible without the correct passphrase.

### Multiple people can't work on the same project

This is by design (baton-pass model). Only one person can have a project
open at a time. If you need to work together, take turns — close the
project when finished so your colleague can open it.

### The search doesn't find CJK characters

FTS5's `unicode61` tokenizer has limited CJK support. For Chinese,
Japanese, or Korean text, search for character sequences directly
rather than individual characters.

---

## Getting Help

- **[README.md](README.md)** — Development setup and technical overview
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — System design and data model
- **[CHANGELOG.md](CHANGELOG.md)** — Version history
- **[docs/SMOKE_TEST.md](docs/SMOKE_TEST.md)** — Manual verification checklist
- **GitHub Issues** — [Report a bug or request a feature](https://github.com/mabo-du/lens/issues)
