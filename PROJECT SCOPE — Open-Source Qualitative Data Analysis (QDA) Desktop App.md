# PROJECT 1 LENS (Local Ethnographic Narrative System) — Open-Source Qualitative Data Analysis (QDA) Desktop App

## Overview

A free, cross-platform desktop application for qualitative data analysis — the kind of work ethnographers, anthropologists, and social researchers do when they need to systematically code interview transcripts, field notes, documents, images, and audio/video recordings. This directly replaces NVivo ($1,499/yr), ATLAS.ti ($839/yr), and MAXQDA ($519/yr), all of which are out of reach for unfunded researchers and Global South practitioners. The existing open-source alternative, Taguette, is extremely limited — text-only, no multimedia, no advanced querying, no team features.

## Target users

- Ethnographers and cultural anthropologists coding interview transcripts
- Qualitative social scientists using grounded theory methodology
- Graduate students and independent researchers priced out of proprietary tools
- Research teams in low-income countries with no institutional licenses
- Mixed-methods researchers needing to link qualitative codes to quantitative data

## MVP scope (v1)

- Import plain text files (.txt, .docx, .pdf) into a project
- Create a hierarchical code tree (parent codes, child codes, memos attached to codes)
- Highlight and tag text segments with one or more codes
- View all segments associated with a given code ("code view")
- Basic search across all documents and coded segments
- Export coded segments to CSV and a human-readable HTML report
- Local-only, single-user, file-based project storage (no server required)
- Cross-platform: Windows, macOS, Linux via Electron

## Feature roadmap (v2+)

- Image coding (draw regions on images, attach codes)
- Audio/video support with transcript synchronisation
- Co-occurrence matrix: which codes appear together most often
- Code frequency charts and visual analytics dashboard
- Team collaboration via shared project file or optional sync server
- Auto-coding suggestions using local LLM (Ollama integration)
- REFI-QDA project interchange standard support (for interoperability with NVivo/ATLAS.ti exports)
- Network/relationship diagrams between codes
- Memo linking and annotation threading
- Multilingual interface (Spanish, French, Arabic, Portuguese as first targets)

## Tech stack recommendation

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Electron + React | Cross-platform, large ecosystem, good for rich text editing |
| UI library | shadcn/ui + Tailwind | Clean, accessible, low-friction |
| Database | SQLite via better-sqlite3 | Local-first, no server, fast, reliable |
| Rich text | Slate.js or ProseMirror | Handles inline code annotations on text |
| PDF rendering | pdf.js | Built into Firefox, mature, handles most PDFs |
| State management | Zustand | Lightweight, works well with Electron IPC |
| Packaging | electron-builder | Cross-platform installers |

## Architecture notes

- **Project = a folder on disk** containing an SQLite `.qdaproj` file plus an `/assets/` subfolder for imported media. This makes projects portable, easy to back up, and git-friendly.
- **Code tree** stored as adjacency list in SQLite with `parent_id` self-reference. Unlimited nesting depth.
- **Annotations** stored as character offset ranges (start_char, end_char) against a document's plain-text content. Re-render highlights on document open by replaying annotation ranges.
- Separate the **import pipeline** (PDF→text, DOCX→text, audio→transcript) from the coding engine. Import is a pre-processing step that creates a canonical plain-text snapshot stored in the DB.
- Use **IPC channels** cleanly — main process owns SQLite, renderer sends queries via typed channels. Never expose raw DB access to renderer.
- Design the **export layer** as a plugin architecture from day one so new export formats (REFI-QDA, NVivo XML) can be added without touching core logic.

## Core data model

```
Project
  id, name, created_at, description

Document
  id, project_id, title, file_path, plain_text, imported_at, word_count

Code
  id, project_id, parent_id, name, color, description, created_at

Annotation
  id, document_id, code_id, start_char, end_char, memo, created_by, created_at

Memo
  id, project_id, linked_code_id (nullable), linked_annotation_id (nullable), body, created_at
```

## Existing resources to leverage

- **Taguette** (open source) — study its data model and import what works: https://github.com/remram44/taguette
- **REFI-QDA standard** — the interchange format spec, implement this for interoperability: https://www.qdasoftware.org
- **QualCoder** — another open-source QDA tool in Python/Qt worth reviewing for feature ideas: https://github.com/ccbogel/QualCoder
- **pdf.js** — Mozilla's PDF renderer for in-app PDF reading
- **Slate.js** — rich text editor with annotation support

## Technical risks

- **PDF annotation offset stability** — PDF text extraction can be inconsistent; offsets may drift between re-imports. Mitigate by storing the extracted plain-text snapshot permanently and annotating against that, never the live PDF.
- **Large file performance** — a project with 200 transcripts and 5,000 annotations needs to remain snappy. Index heavily in SQLite and use virtual/lazy rendering in the document list.
- **Rich text with overlapping annotations** — multiple codes on the same text span must render correctly (stacked highlights, not broken markup). ProseMirror's decoration system handles this well.

---

## Deep Research Prompt — Project 1

> I am building a free, open-source desktop qualitative data analysis (QDA) application to replace expensive proprietary tools like NVivo, ATLAS.ti, and MAXQDA, which are inaccessible to researchers in the Global South and unfunded academics. Before I begin development, I need a comprehensive technical and user research report covering the following:
>
> 1. **Feature benchmarking**: Produce a detailed feature comparison table covering NVivo, ATLAS.ti, MAXQDA, and the open-source tools Taguette, QualCoder, and RQDA. For each, cover: supported data types (text, audio, video, image), coding features, team collaboration, query/analysis tools, export formats, OS support, and pricing.
>
> 2. **REFI-QDA interchange standard**: What is the Rotterdam Exchange Format Initiative for QDA (REFI-QDA)? What file formats does it specify? Which tools currently support it? What is the technical specification for implementing it, and where is the schema documented?
>
> 3. **Researcher pain points**: Search academic forums, Reddit (r/qualitativeresearch, r/anthropology, r/GradSchool), and published articles for specific frustrations researchers have with current QDA tools. What features do they most want? What are the most common complaints about NVivo specifically?
>
> 4. **Text annotation architecture**: What are the best technical approaches for storing inline text annotations (highlights, tags) in a document that preserve stability when source text is re-imported? Compare character-offset approaches, XPath-based approaches, and hash-anchoring approaches. Which open-source libraries implement these well?
>
> 5. **Auto-coding with local LLMs**: Are there any existing open-source projects or published research that integrate local LLMs (e.g. via Ollama) with qualitative data coding? What prompting strategies have been proposed for automated code suggestion?
>
> 6. **Multilingual support needs**: Which languages are most underrepresented in current QDA tooling? What are the specific technical challenges for right-to-left script support, non-Latin character handling, and mixed-language transcript coding?
>
> Please provide specific GitHub repositories, academic paper citations, forum thread URLs, and technical specification links wherever possibl
