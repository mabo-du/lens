# Deep Research Prompts — Qualitative Data Analysis Desktop App

## Project: Qualitative-Data-Analysis-App

## Source: Heritage\_Tech\_Tool\_Specs.md — Tool 12

---

**Note on prior research:** One deep research run has already been completed for this project, covering: (1) feature benchmarking of NVivo / ATLAS.ti / MAXQDA / Taguette / QualCoder / RQDA; (2) REFI-QDA standard and `.qdpx` / `.qdc` file formats; (3) researcher pain points; (4) text annotation architecture (character-offset vs XPath vs hash-anchoring, W3C Web Annotation Data Model, fuzzy anchoring via Levenshtein / Diff-Match-Patch); (5) auto-coding with local LLMs via Ollama / RAG architectures; (6) multilingual and Bidi text rendering challenges; and (7) collaborative coding theory (Cohen's kappa, Krippendorff's alpha). The nine prompts below address the gaps in that report required for confident implementation decisions.

---

## Prompt 1 — Rich Text Editor Selection for Overlapping Inline Code Annotations

**Project:** Qualitative-Data-Analysis-App **Source:** Heritage\_Tech\_Tool\_Specs.md — Tool 12

---

### CONTEXT

I am building a free, open-source desktop qualitative data analysis (QDA) application using Electron and React. The core interaction model of a QDA tool is: a researcher opens a text document, selects a passage with their mouse or keyboard, and assigns one or more codes (tags) to that selection. Multiple codes can be assigned to overlapping or even identical text spans simultaneously — e.g., a single sentence may carry five different codes from three different researchers.

The rendering challenge this creates is severe: the rich text editor must simultaneously display stacked, overlapping highlight decorations across potentially hundreds of annotations in a single document, without breaking the DOM, corrupting character offsets used for storage, or making the text visually unreadable. The editor must also handle large documents (20,000–50,000 words), perform well during live coding sessions, and eventually support Bidirectional (Bidi) text for Arabic, Hebrew, and Urdu sources.

The two candidate editors identified in prior research are ProseMirror and Slate.js, but both have known instabilities with Bidi text and overlapping decoration rendering. A third candidate, Meta's Lexical, has emerged more recently.

Please provide a comprehensive technical report covering the following:

1. **Overlapping annotation rendering architecture:** How does each of ProseMirror, Slate.js, and Lexical handle the rendering of overlapping, non-hierarchical inline decorations (i.e., two highlighted spans that partially overlap)? For each framework, describe the internal data model for decorations/marks, the specific API used to render overlapping highlights, and any documented limitations or known bugs related to this use case. Include GitHub issue references where relevant.  
     
2. **Character offset preservation:** QDA tools store annotations as character offsets (start\_char, end\_char) against a canonical plain-text snapshot. When the editor re-renders a document, it must faithfully reconstruct these offset ranges as visual highlights. How does each framework handle the relationship between its internal document model (which may use nodes, positions, or indices) and raw character offsets? Which framework makes it easiest to reliably round-trip character offsets through the rendering pipeline?  
     
3. **Performance with large, heavily annotated documents:** What is the rendering performance profile of each framework when applied to a single document with 300+ non-overlapping and overlapping decoration spans and 30,000+ words? Are there benchmark results, or documented performance degradation patterns, for heavily decorated documents? Which framework uses virtual rendering or lazy decoration evaluation?  
     
4. **Existing QDA-adjacent annotation systems:** Identify open-source projects that have already solved overlapping annotation rendering in a web-based or Electron context — specifically the Hypothesis annotation client, Recogito (Pelagios Network), INCEpTION, and any others on GitHub under the `caqdas` or `text-annotation` topics. For each, identify which editor framework they use and how they handle overlapping highlights. Provide repository URLs.  
     
5. **Bidi text stability comparison:** Prior research found that both ProseMirror and Slate.js have known bugs when processing mixed RTL/LTR (Bidi) text, including recursive AST bugs when markdown replacement rules interact with Arabic text. Which framework has the most robust Bidi implementation as of 2025–2026? Are there published bug fixes, forks, or wrapper libraries that patch known Bidi deficiencies in any of the three frameworks?  
     
6. **Lexical as a third candidate:** Meta's Lexical editor framework has grown significantly since its 2022 open-source release. What is Lexical's architecture for inline decorations? Does it support non-hierarchical overlapping marks natively? What are its known limitations for annotation-heavy use cases? Is there an active community producing QDA or annotation-relevant plugins?  
     
7. **Final recommendation:** Given the requirements above (overlapping multi-code highlights, character offset fidelity, large-document performance, eventual Bidi support, React/Electron environment), which editor framework should this project use? What customizations or wrappers will be needed beyond the out-of-the-box API?

Please provide specific GitHub repository links, npm package names and versions, published benchmarks, and issue tracker references wherever possible.

---

## Prompt 2 — Electron Desktop Architecture, IPC Security, and Cross-Platform Packaging

**Project:** Qualitative-Data-Analysis-App **Source:** Heritage\_Tech\_Tool\_Specs.md — Tool 12

---

### CONTEXT

I am building a free, open-source desktop qualitative data analysis (QDA) application to replace proprietary tools like NVivo and ATLAS.ti. The planned tech stack is Electron \+ React, with a local SQLite database as the data store. Prior research confirmed that the fatal weakness of legacy open-source QDA tools (particularly RQDA) was tight coupling between the GUI framework and the OS, leading to catastrophic obsolescence. The Electron approach must be architected to avoid similar coupling.

The application is local-first and single-user for the MVP, with no server requirement. The SQLite database should only be accessible from the main process, never directly from the renderer. This requires a well-designed IPC (Inter-Process Communication) channel architecture.

Please provide a comprehensive technical report covering the following:

1. **Electron vs Tauri for this use case:** Provide a rigorous technical comparison of Electron and Tauri for a document-heavy, SQLite-backed, offline-first desktop QDA application. Consider: bundle size and memory overhead, Rust vs JavaScript for the backend process, native module compatibility (especially for better-sqlite3, pdf.js, and potential multimedia processing), cross-platform build complexity, community size and long-term maintenance risk, and the implications of Tauri's WebView approach (using the OS-native WebView rather than a bundled Chromium) for consistent rendering of the rich text editor and annotation highlights. Which framework represents the lower architectural risk for a solo open-source maintainer in 2025–2026?  
     
2. **IPC channel design for SQLite isolation:** In the recommended framework, describe best-practice patterns for isolating the SQLite database in the main process and exposing typed query channels to the renderer. Specifically: how should query channels be designed (one channel per table, one channel per query type, or a generic query bus)? What TypeScript typing patterns are recommended for IPC message payloads? How should errors from the database layer be surfaced to the UI? Provide concrete code patterns or reference implementations.  
     
3. **Context isolation and preload script security:** What is the current best-practice security model for Electron applications that handle sensitive research data (interview transcripts, ethnographic field notes)? Cover: `contextIsolation`, the preload script pattern, `nodeIntegration` settings, and Content Security Policy (CSP) headers for local HTML content. What are the known security vulnerabilities in Electron apps that handle local file system access, and how should they be mitigated?  
     
4. **SQLite integration — better-sqlite3 vs alternatives:** What is the current recommended approach for SQLite access in an Electron main process? Compare `better-sqlite3` (synchronous), `sqlite3` (asynchronous callback), and `@Electric-SQL/pglite` or similar newer entrants. Cover: compatibility with the Electron native module rebuild process (`electron-rebuild`), ARM64 / Apple Silicon support, Windows compatibility, and any known packaging issues with `electron-builder`.  
     
5. **electron-builder packaging for three platforms:** Provide a practical guide to configuring `electron-builder` (or the recommended alternative) to produce signed, distributable installers for Windows (NSIS or MSI), macOS (DMG with code signing considerations for Gatekeeper), and Linux (AppImage and .deb). What are the minimum configuration requirements? What are the known failure modes during macOS notarization for apps with native SQLite modules? How should auto-update be handled for a free open-source tool with no commercial CDN budget (i.e., using GitHub Releases)?  
     
6. **App architecture template references:** Are there well-maintained open-source Electron \+ React \+ SQLite application templates or starter kits that embody current best practices for IPC isolation, TypeScript typing, and cross-platform packaging? Provide GitHub repository URLs, star counts, and last-commit dates as indicators of maintenance status.

Please provide specific GitHub repository links, npm package names, electron-builder configuration examples, and references to official Electron security documentation.

---

## Prompt 3 — Document Import Pipeline and Annotation Offset Stability

**Project:** Qualitative-Data-Analysis-App **Source:** Heritage\_Tech\_Tool\_Specs.md — Tool 12

---

### CONTEXT

I am building a free, open-source desktop qualitative data analysis (QDA) application. The application's core workflow requires importing source documents (plain text `.txt`, Word documents `.docx`, and PDFs `.pdf`) and producing a canonical plain-text snapshot that is permanently stored in SQLite. All annotations (code highlights) are stored as character-offset ranges (start\_char, end\_char) against this snapshot — never against the live file. This is by design: it eliminates the risk of annotation drift when the original file changes.

Prior research flagged PDF annotation offset stability as the highest-risk technical problem in this architecture: PDF text extraction is notoriously inconsistent, and if two different extraction runs of the same PDF produce different plain-text outputs (due to hyphenation handling, ligature expansion, whitespace normalisation, or column ordering), existing annotations will silently point to wrong text spans.

The MVP must handle at minimum: `.txt` (trivial), `.docx` (complex), and `.pdf` (high-risk). The v2+ roadmap adds audio/video transcription.

Please provide a comprehensive technical report covering the following:

1. **PDF text extraction quality and consistency benchmark:** Compare the following PDF text extraction approaches for output consistency, text fidelity, and Unicode handling: (a) `pdf.js` (Mozilla, JavaScript/WASM — the planned MVP choice); (b) `pdfplumber` (Python, via child process or PyPI); (c) Apache Tika (Java, via HTTP API or tika-js wrapper); (d) `pdfminer.six` (Python); (e) `pdf-parse` (Node.js npm package). For each: what is its approach to text ordering in multi-column PDFs? How does it handle ligatures (ﬁ, ﬀ, etc.)? How consistent is its output when the same PDF is extracted twice? Are there known failure modes (scanned PDFs, password-protected files, right-to-left text)? Provide any published benchmarks or comparison studies.  
     
2. **The canonical snapshot strategy — best practices:** Once a PDF has been extracted to plain text and stored in SQLite, how should the application handle future scenarios where the user wants to "re-import" an updated version of the same document? Describe strategies used by existing tools (QualCoder, Taguette, Hypothesis) for managing annotation stability across document versions. What metadata should be stored alongside the plain-text snapshot to detect re-import conflicts (file hash, extraction timestamp, extraction library version)?  
     
3. **DOCX import — Mammoth.js vs alternatives:** For `.docx` import, compare `Mammoth.js` (converts DOCX to HTML/plain text, JavaScript) against `docx` (npm), `docx2txt`, and any other Node.js-native alternatives. Which produces the most stable, predictable plain-text output? How does each handle: embedded images (which the MVP should strip but note), tracked changes, comments, footnotes, and non-Latin character sets (Arabic, Chinese, Devanagari)?  
     
4. **Text normalisation pipeline:** After extraction, the raw text must be normalised before storage to maximise annotation stability. What normalisation steps are standard practice? Cover: Unicode normalisation form (NFC vs NFD vs NFKC), whitespace normalisation (collapsing runs, stripping soft hyphens), ligature expansion, line-ending standardisation, and BOM handling. What Node.js libraries implement these normalisations reliably?  
     
5. **Scanned PDF and OCR fallback:** A significant fraction of archival and historical documents imported into QDA tools are scanned PDFs with no embedded text layer. What is the recommended open-source OCR pipeline for an Electron desktop app? Cover: Tesseract.js (WASM, runs in renderer/worker), tesseract (Node.js binding), and any newer alternatives. What languages does Tesseract support well vs poorly? How does OCR output quality affect annotation offset stability compared to native text extraction?  
     
6. **Audio and video transcription pipeline (V2+ preview):** The v2+ roadmap includes audio/video support with transcript synchronisation. What is the recommended architecture for local, offline transcription in an Electron app? Cover: `whisper.cpp` (C++ WASM build), `faster-whisper` (Python, via child process), and OpenAI Whisper.js. How are word-level timestamps stored and linked to annotations? How do existing tools (QualCoder, ATLAS.ti) represent media timestamps in their annotation models?

Please provide specific npm package names, GitHub repositories, benchmarks, and links to any published studies comparing PDF extraction quality.

---

## Prompt 4 — SQLite Data Model and Query Architecture for Large QDA Corpora

**Project:** Qualitative-Data-Analysis-App **Source:** Heritage\_Tech\_Tool\_Specs.md — Tool 12

---

### CONTEXT

I am building a free, open-source desktop qualitative data analysis (QDA) application. The data store is a local SQLite database (file extension `.qdaproj`) stored in a portable project folder alongside imported media assets. The MVP scope includes: multi-document projects (up to 200+ transcripts), hierarchical code trees (unlimited nesting depth), inline text annotations stored as character offsets, memos linked to codes or annotations, and full-text search across all documents and coded segments.

The prior research identified two core performance risks: (1) code trees with deep nesting and (2) projects with 200 transcripts and 5,000+ annotations that must remain snappy. These risks must be addressed in the schema design before implementation begins.

The initial data model proposed in the project scope is:

Project (id, name, created\_at, description)

Document (id, project\_id, title, file\_path, plain\_text, imported\_at, word\_count)

Code (id, project\_id, parent\_id, name, color, description, created\_at)

Annotation (id, document\_id, code\_id, start\_char, end\_char, memo, created\_by, created\_at)

Memo (id, project\_id, linked\_code\_id NULLABLE, linked\_annotation\_id NULLABLE, body, created\_at)

This prompt asks for expert review and extension of this schema, plus a complete indexing and query strategy.

Please provide a comprehensive technical report covering the following:

1. **Code tree storage — adjacency list vs alternatives:** The proposed schema uses an adjacency list (a `parent_id` self-reference on the `Code` table) for the hierarchical code tree. Compare this against the two principal alternatives: nested sets (Celko model) and closure tables. For a QDA code tree with potentially 500+ nodes at arbitrary depth, where the most common operations are: (a) render the full tree on app load, (b) move a subtree to a new parent, (c) retrieve all codes in a given subtree for query filtering — which approach offers the best balance of query simplicity and performance in SQLite specifically? Provide concrete SQL examples for each approach performing these three operations.  
     
2. **Annotation query patterns and indexing strategy:** The single most common query in a QDA application is the "code view" — retrieve all text segments tagged with a given code across all documents. For a project with 5,000 annotations across 200 documents, write the optimal SQL query for this operation and specify every index required. Additionally specify indexes for: (a) full-text search across `Document.plain_text`; (b) retrieving all annotations within a character range in a single document (for rendering on document open); (c) code co-occurrence queries (which pairs of codes most frequently appear on overlapping or adjacent text spans).  
     
3. **SQLite FTS5 for full-text search:** The MVP requires "basic search across all documents and coded segments." Should this be implemented with SQLite's built-in FTS5 virtual table, or with a separate JavaScript-based search library (e.g., FlexSearch, MiniSearch, Lunr.js)? Compare these approaches for: indexing speed during document import, query performance, support for partial-word matching and phrase search, Unicode/non-Latin language handling, and memory overhead in an Electron process. Provide the FTS5 schema definition and query pattern if FTS5 is recommended.  
     
4. **WAL mode, transactions, and data safety:** What SQLite PRAGMA settings are recommended for a desktop application where data integrity is paramount (researchers cannot afford to lose coded data)? Cover: WAL vs journal mode, synchronous settings, checkpoint frequency, and how to implement crash-safe atomic writes for annotation operations. What is the correct transaction strategy for bulk imports (importing a 50,000-word document and indexing it for FTS5)?  
     
5. **Schema migrations:** As the application evolves from v1 to v2+, the schema will need migration. What is the recommended approach for SQLite schema migration in an Electron app? Compare: embedding SQL migration scripts with version tracking, using a Node.js migration library (Knex, Drizzle ORM, Kysely, or similar), and handling migrations at app startup vs on-demand. Which approach is most appropriate for an open-source tool where users may skip multiple versions between updates?  
     
6. **Proposed schema extensions for v2+:** Given the v2+ roadmap (image region coding, audio/video timestamp coding, co-occurrence analytics, REFI-QDA compliance), what schema extensions should be designed now, even if not implemented, to avoid breaking migrations later? Provide a proposed extended schema covering: image region annotations (bounding box or polygon coordinates), media timestamp annotations (start\_ms, end\_ms), and the additional metadata fields required by the REFI-QDA `.qdpx` format (GUID assignment for all entities, case grouping).

Please provide concrete SQL DDL statements, index definitions, query examples with EXPLAIN QUERY PLAN output where helpful, and references to SQLite documentation for the recommended PRAGMA settings.

---

## Prompt 5 — Image and Multimedia Annotation Architecture (V2+)

**Project:** Qualitative-Data-Analysis-App **Source:** Heritage\_Tech\_Tool\_Specs.md — Tool 12

---

### CONTEXT

I am building a free, open-source desktop qualitative data analysis (QDA) application. The MVP covers text-only coding, but the v2+ roadmap includes two multimedia annotation features that require early architectural planning because they affect the data model and import pipeline:

- **Image coding:** Researchers draw freehand or geometric regions on images (photographs, archival documents, maps) and assign codes to those regions.  
- **Audio/video coding with transcript synchronisation:** Researchers watch or listen to a recording, select a time range, and assign a code to that clip. If a transcript is available, the coded audio segment should be visually linked to the corresponding text span.

This prompt is purely a research and architecture scoping exercise — no implementation is expected now, but the schema and import pipeline must be designed with these features in mind from day one to avoid costly migration.

Please provide a comprehensive technical report covering the following:

1. **How existing QDA tools implement image coding:** Provide a detailed technical description of how NVivo, ATLAS.ti, MAXQDA, and QualCoder implement image region coding. What UI paradigm do they use (bounding box only, freehand polygon, both)? How do they store region annotations (pixel coordinates, percentage coordinates, SVG path data)? How do they handle images that are resized or re-imported? What coordinate system is used (absolute pixel vs proportional)? Provide screenshots or documentation links where available.  
     
2. **Canvas-based region drawing libraries:** Compare the following JavaScript libraries for implementing interactive image region annotation in an Electron/React environment: (a) Fabric.js; (b) Konva.js; (c) react-image-annotate; (d) Label Studio's annotation frontend (open-source); (e) any others identified in the `image-annotation` GitHub topic. For each, cover: supported region types (rectangle, polygon, freehand), React integration quality, bundle size, active maintenance status (last commit, open issues), and whether it supports overlapping regions with different visual styles (as QDA codes would require different colours per code). Provide GitHub repository URLs.  
     
3. **Region annotation data model:** Propose a storage format for image region annotations in SQLite. Compare storing regions as: (a) bounding box (x, y, width, height in percentage coordinates); (b) polygon as a JSON array of \[x,y\] points; (c) SVG path string; (d) W3C Web Annotation Data Model `FragmentSelector` with `xywh` or SVG selectors. Which format is most robust to image resizing, most compatible with the REFI-QDA `.qdpx` standard (which does support image sources), and easiest to re-render accurately?  
     
4. **Audio/video annotation architecture:** For the audio/video feature, how should media files be stored and referenced in the project? (The project folder model stores assets in an `/assets/` subdirectory.) How should timestamp annotations (start\_ms, end\_ms) be linked to both codes and, when available, transcript text spans? Review how QualCoder implements audio/video annotation and timestamp-to-transcript linking. Identify the best JavaScript waveform visualisation library (WaveSurfer.js, Peaks.js, or others) for displaying coded audio regions. Provide links to relevant QualCoder source code sections.  
     
5. **Transcript synchronisation:** When a transcript is available for an audio/video recording (either imported as a `.txt`/`.docx` or generated by Whisper), how should the application maintain synchronisation between a time-coded audio annotation and its corresponding text span? What data structure links a media timestamp range to a character-offset range in the transcript? Are there open-source implementations of this synchronisation model to reference (e.g., OHMS XML, WebVTT-based approaches)?  
     
6. **REFI-QDA multimedia compliance:** The REFI-QDA `.qdpx` standard supports image and audio/video sources. What specific XML elements and attributes does the standard define for: image sources with region selections, audio/video sources with timestamp selections? Provide the relevant schema definitions from the `Projects.xsd` and any worked `.qdpx` examples that include multimedia annotations.

Please provide GitHub repository links, npm package names, schema references from the REFI-QDA XSD, and documentation links for all tools discussed.

---

## Prompt 6 — Export Plugin Architecture and REFI-QDA Serialisation Implementation

**Project:** Qualitative-Data-Analysis-App **Source:** Heritage\_Tech\_Tool\_Specs.md — Tool 12

---

### CONTEXT

I am building a free, open-source desktop qualitative data analysis (QDA) application. Prior research confirmed that REFI-QDA compliance (both `.qdpx` project export/import and `.qdc` codebook export/import) is non-negotiable for researcher adoption, as it provides interoperability with NVivo, ATLAS.ti, and MAXQDA.

The project scope specifies that the export layer must be designed as a plugin architecture from day one, so that new export formats (REFI-QDA, NVivo XML, CSV, HTML report) can be added without modifying core application logic.

Please provide a comprehensive technical report covering the following:

1. **Plugin architecture patterns in Electron/React applications:** What are the established patterns for implementing a plugin-based export system in an Electron \+ React \+ TypeScript application? Specifically, describe: (a) a simple strategy pattern (each exporter is a class implementing a common interface, registered at startup); (b) a dynamic module loading pattern (exporters are loaded at runtime from a `plugins/` directory); (c) a monorepo-based approach (each exporter as a separate npm workspace package). Which approach is most appropriate for a solo-maintained open-source tool that needs to be extensible but not over-engineered? Provide TypeScript interface definitions for the exporter plugin contract.  
     
2. **REFI-QDA `.qdpx` serialisation — complete technical implementation guide:** The `.qdpx` format is a ZIP archive containing `project.qde` (an XML document conforming to `Projects.xsd`) plus bundled source files. Provide a step-by-step implementation guide for serialising the application's SQLite data model into a valid `.qdpx` file. Cover: (a) GUID assignment strategy (should GUIDs be pre-assigned and stored in SQLite, or generated at export time and stored in a mapping table?); (b) the required XML namespace and `xmlns` declarations; (c) the XML element hierarchy for Sources, Codes, Selections, and Annotations; (d) how to bundle source files into the ZIP archive with correct relative path references; (e) XML validation against the official XSD before finalising the archive; (f) known quirks in how NVivo, ATLAS.ti, and MAXQDA interpret the standard differently (edge cases to be aware of during import testing). Reference the `openqda/refi-tools` GitHub repository and the official `Projects.xsd` schema throughout.  
     
3. **REFI-QDA `.qdpx` deserialisation — import implementation guide:** Provide an equally detailed guide for importing a `.qdpx` file produced by a third-party tool. Cover: (a) unzipping and validating the archive structure; (b) parsing the XML and mapping REFI-QDA entities to the local SQLite schema; (c) handling data loss gracefully — elements in the imported XML that have no equivalent in the local schema (e.g., MAXQDA-specific paraphrases, ATLAS.ti network views) should be silently ignored, not cause import failures; (d) handling missing or corrupt media files referenced in the archive; (e) conflict resolution when importing into an existing non-empty project (merge vs replace strategies).  
     
4. **REFI-QDA `.qdc` codebook format:** The `.qdc` codebook format is simpler than `.qdpx` — it is a standalone XML document containing only the code hierarchy, without source documents or annotations. Provide the complete XML structure for a valid `.qdc` file, the relevant schema elements from `Codebooks.xsd`, and a guide to implementing bidirectional `.qdc` import/export in the application.  
     
5. **CSV and HTML report export:** Beyond REFI-QDA, the MVP requires export of coded segments to CSV and a human-readable HTML report. Describe the optimal structure for the CSV export: what columns should it contain (document title, code name, code path in hierarchy, start\_char, end\_char, quoted text, memo, created\_at)? For the HTML report, what is the recommended approach — a static template rendered with a library like Handlebars or EJS, or a React component rendered to static HTML via `ReactDOMServer.renderToStaticMarkup()`? What should the report include (summary statistics, per-code segment listings, per-document coding summaries)?  
     
6. **Validation and compliance testing:** The REFI consortium provides guidance that compliant tools must validate their `.qdpx` output against the official XSD before export. What is the recommended XML Schema validation library for Node.js (libxmljs2, @xmldom/xmldom \+ xsd-schema-validator, or others)? Are there any published test fixtures or official REFI-QDA test projects that can be used to validate import fidelity?

Please provide the TypeScript interface definitions, XML schema excerpts, GitHub repository links (especially `openqda/refi-tools`, `qdasoftware.org` resources), and npm package names throughout.

---

## Prompt 7 — Collaborative Coding Architecture and Inter-Coder Reliability Implementation

**Project:** Qualitative-Data-Analysis-App **Source:** Heritage\_Tech\_Tool\_Specs.md — Tool 12

---

### CONTEXT

I am building a free, open-source desktop qualitative data analysis (QDA) application. The MVP is single-user and local-only. The v2+ roadmap includes team collaboration, framed as "shared project file or optional sync server." Prior research covered the concepts of Cohen's kappa and Krippendorff's alpha as inter-coder reliability (ICR) metrics, but did not cover their technical implementation for the specific data structure of QDA annotation data (character-offset ranges on text), nor the concrete architecture for file-based collaborative coding without a mandatory server.

This prompt focuses on two distinct but related problems: (a) **Technical implementation of ICR metrics** for text annotation data. (b) **Collaborative coding workflow and sync architecture** appropriate for a zero-cost, zero-infrastructure open-source tool.

Please provide a comprehensive technical report covering the following:

1. **Inter-coder reliability for text spans — the implementation problem:** Cohen's kappa and Krippendorff's alpha were developed for categorical coding (coders classify items into discrete categories). Applying them to QDA text annotation requires adapting the formulas for unitisation — dividing continuous text into units before computing agreement. Describe the following approaches to unitisation: (a) line-by-line or sentence-by-sentence agreement (binary: does coder A and coder B both code sentence N with code X?); (b) character-level agreement (does coder A and coder B both assign code X to character position n?); (c) segment-overlap agreement (what is the Jaccard similarity or intersection-over-union between two coders' annotation spans for the same code?). Which approach is used by existing QDA tools? What are the trade-offs?  
     
2. **Cohen's kappa and Krippendorff's alpha — concrete calculation for coded segments:** Provide pseudocode or mathematical formulas for calculating both metrics from a pair of `Annotation` tables (each containing document\_id, code\_id, start\_char, end\_char). Which of the unitisation approaches from question 1 is most appropriate for each metric? Identify any JavaScript or Python libraries that implement these calculations and can be run in an Electron main process — search npm and PyPI. Are there any open-source QDA tools that have implemented ICR calculation on text spans, and if so, what algorithm do they use?  
     
3. **Coding comparison query:** NVivo and ATLAS.ti offer a "coding comparison query" that visualises where two coders agree and disagree on the same document. Describe the algorithm for this query: given two sets of annotations on the same document (from coder A and coder B), produce a structured output showing: (a) regions where only A coded, (b) regions where only B coded, (c) regions where both coded with the same code, (d) regions where both coded with different codes. This requires interval set algebra on character ranges. What is the optimal algorithm for computing this efficiently in SQLite or in JavaScript for large documents?  
     
4. **File-based collaboration without a server — architecture options:** For teams who want to collaborate without a server, what are the concrete options? Cover: (a) **Manual merge-on-export** — researcher A exports their project, researcher B imports it and SQLite triggers or application logic merges the annotation tables; (b) **Git as a sync layer** — the `.qdaproj` file and `/assets/` folder are version-controlled; describe what SQLite git diff/merge strategies exist (sqlite-utils, Litestream, or Beekeeper's approach); (c) **cr-sqlite (Conflict-free Replicated SQLite)** — describe what cr-sqlite is, how it implements CRDTs for SQLite tables, and whether it is stable enough for production use as of 2025–2026; provide the GitHub repository and status. Which approach is most realistic for solo researchers sharing projects via cloud storage (Dropbox, OneDrive) rather than Git?  
     
5. **Optional sync server architecture (V2+):** If an optional server is added in v2+, what is the minimum viable sync architecture that does not require a commercial cloud service? Cover: (a) a self-hostable sync server using SQLite \+ WebSockets (e.g., Electric-SQL, PocketBase, or a custom Fastify/WebSocket server); (b) Automerge or Yjs as a CRDT layer above SQLite for real-time multi-user coding. Which approach has the best documentation and community support for Electron desktop app integration as of 2025–2026?  
     
6. **Coder identity and audit trail:** In a collaborative coding project, annotations must be attributed to specific coders. The current schema has a `created_by` field on the `Annotation` table. How should coder identity be managed in a local-first tool with no authentication server? Describe the "local identity" pattern (a GUID stored in app preferences representing this user on this machine) and how it integrates with the REFI-QDA schema's `User` element in the `.qdpx` format.

Please provide npm package names, GitHub repository links, mathematical notation for the ICR formulas, and references to published ICR methodology papers for qualitative coding.

---

## Prompt 8 — Code Visualisation and the Analytical Dashboard

**Project:** Qualitative-Data-Analysis-App **Source:** Heritage\_Tech\_Tool\_Specs.md — Tool 12

---

### CONTEXT

I am building a free, open-source desktop qualitative data analysis (QDA) application. The v2+ roadmap includes a suite of analytical visualisations that help researchers move beyond line-by-line reading of coded segments into pattern detection across their entire corpus. Prior research did not address the implementation of these visualisations.

The planned visualisation features are:

- **Co-occurrence matrix:** Which codes appear together on the same or overlapping text spans most often?  
- **Code frequency charts:** How many times has each code been applied, across which documents?  
- **Network / relationship diagrams:** Force-directed graphs showing codes as nodes and co-occurrence frequency as edge weight.

This prompt asks for a technical implementation plan for the analytics layer.

Please provide a comprehensive technical report covering the following:

1. **Co-occurrence computation algorithm:** Define precisely what "code co-occurrence" means in the context of character-offset text annotations: (a) two annotations on the exact same span; (b) two annotations whose spans overlap by any amount; (c) two annotations that appear within the same paragraph or within N characters of each other. Which definition is used by NVivo's matrix coding query, ATLAS.ti's co-occurrence explorer, and MAXQDA's mixed-methods tools? Provide the SQL query for computing a pairwise co-occurrence count matrix across all documents given the `Annotation` table schema (document\_id, code\_id, start\_char, end\_char). Assess performance for 5,000 annotations and 100 codes.  
     
2. **Co-occurrence matrix visualisation:** What is the best approach for rendering a heat-map style co-occurrence matrix in a React/Electron environment? Compare: (a) Recharts (a React-native charting library); (b) D3.js (canvas or SVG); (c) Plotly.js; (d) Observable Plot. For a 100×100 code matrix, which library handles zooming, sorting, and hover tooltips most cleanly? Are there existing open-source code co-occurrence matrix components in the QDA or bioinformatics space that could be adapted?  
     
3. **Code frequency charts:** What chart types are most useful for code frequency analysis in qualitative research? Cover: (a) a simple bar chart of code application counts; (b) a stacked bar chart showing code frequency per document; (c) a timeline view showing when codes were applied (by document import date or by position within the document corpus). Which React charting library best supports these charts with accessible colour palettes appropriate for colour-blind researchers?  
     
4. **Network / relationship diagrams for code co-occurrence:** For a force-directed graph where nodes are codes (sized by frequency) and edges are weighted by co-occurrence count, compare: (a) `react-force-graph` (WebGL-based, GPU-accelerated, open-source); (b) Cytoscape.js (SVG/Canvas, widely used in bioinformatics); (c) Sigma.js (Canvas, designed for large graphs); (d) D3.js force simulation with SVG. For a graph with up to 500 code nodes and potentially 5,000 edges, which library provides the best performance and interactivity (drag nodes, zoom, click to highlight connected codes)? Provide GitHub repositories and bundle size information.  
     
5. **What analytical views do qualitative researchers actually use?** Based on published usability studies, academic papers, or researcher forum discussions (ResearchGate, Reddit, CAQDAS blog), which visualisations in NVivo, ATLAS.ti, and MAXQDA are used most frequently and considered most valuable? Which are rarely used despite prominent placement in the UI? This will inform prioritisation of which visualisations to implement first in v2+. Provide citations.  
     
6. **Dashboard architecture in React/Electron:** Should the analytics dashboard be implemented as: (a) inline panels within the main application window; (b) a separate Electron `BrowserWindow` rendered on demand; (c) a detachable panel system (e.g., using Golden Layout or React Mosaic)? What are the implications of each approach for window management, data freshness (ensuring charts reflect the latest coded data), and memory usage when rendering large D3 visualisations alongside the main code editor?

Please provide GitHub repository URLs, npm package names, bundle size estimates, and links to published QDA usability research.

---

## Prompt 9 — UX Design Patterns for Qualitative Coding Workflows

**Project:** Qualitative-Data-Analysis-App **Source:** Heritage\_Tech\_Tool\_Specs.md — Tool 12

---

### CONTEXT

I am building a free, open-source desktop qualitative data analysis (QDA) application targeting ethnographers, anthropologists, and qualitative social scientists. Prior research covered technical architecture in depth but did not address the UX design patterns that make professional QDA tools efficient and usable for researchers who spend hours per day coding interview transcripts.

The MVP interaction model requires: (1) a researcher opens a document; (2) they select a text span; (3) they assign one or more codes from the code tree; (4) they repeat this for hundreds of passages over many sessions. The efficiency of this core loop determines whether the tool is adopted or abandoned.

Please provide a comprehensive technical report covering the following:

1. **The canonical QDA coding UI paradigm:** Describe the standard split-view paradigm used by professional QDA tools: the document panel (left/centre), the code tree panel (right), and the marginal bracket or inline highlight system for showing applied codes. How do NVivo, ATLAS.ti, and MAXQDA each implement this layout? What are the specific UX mechanisms for assigning a code to a selection in each tool (drag-and-drop from tree, right-click context menu, double-click on code name, keyboard shortcut)? Which mechanism is fastest for experienced coders? Provide screenshots or documentation links.  
     
2. **Keyboard efficiency and shortcut systems:** Qualitative coding sessions involve thousands of repetitive selections and code assignments. What keyboard shortcut patterns do existing QDA tools use? Are there "quick code" mechanisms (e.g., press a number key to apply the most recently used code, or a shortcut that opens a fuzzy-search code picker without reaching for the mouse)? What does the research literature on expert QDA tool use say about the importance of keyboard accessibility and shortcut discoverability? Identify any usability studies of NVivo or ATLAS.ti that measured coding speed by interaction mode.  
     
3. **The code tree UX — interaction patterns for large trees:** The code tree can grow to 500+ nodes during a large qualitative project. What are the standard UX patterns for navigating, searching, and managing a large hierarchical tree in a desktop application? Cover: (a) incremental search / fuzzy filter within the tree; (b) drag-and-drop reorganisation of codes and subtrees; (c) multi-select for bulk operations (merging codes, applying multiple codes to a selection); (d) inline editing of code names and colours; (e) expanding/collapsing subtrees with memory of expansion state. Which React tree component libraries (react-arborist, rc-tree, @blueprintjs/core Tree, or others) support all of these interactions and are actively maintained? Provide GitHub repository URLs.  
     
4. **Document list and navigation UX:** In a project with 200 documents, how should the document list be structured? What metadata should be visible at a glance (word count, annotation count per document, last-coded date, coding completeness indicator)? What sorting and filtering options are standard in professional QDA tools? How should the application handle very long documents — does it scroll the full text or paginate?  
     
5. **The memo and annotation note UX:** Memos in QDA tools serve multiple purposes: free-form notes attached to a code (theoretical memos), notes attached to a specific coded passage (annotation memos), and project-level reflective journals. What is the UX model for memo creation and retrieval in NVivo, ATLAS.ti, and MAXQDA? When a researcher is actively coding and wants to attach a memo to a passage, what is the minimum-friction interaction? Should memos support rich text formatting (bold, italic, headings) or plain text only for the MVP?  
     
6. **Accessibility and low-vision support:** Qualitative researchers may have visual impairments. What accessibility requirements should the coding UI meet? Cover: (a) sufficient colour contrast for code highlight colours (WCAG AA minimum); (b) screen reader compatibility for the code tree (ARIA roles for tree widgets); (c) adjustable text size in the document panel; (d) the challenge of colour-coding codes for colour-blind researchers (what alternative visual distinguishers — patterns, borders, icons — are used in accessible data tools?). What accessibility guidelines are specific to annotation-heavy document UIs?  
     
7. **Onboarding UX for researchers new to QDA software:** Many target users will be graduate students or Global South researchers encountering systematic QDA software for the first time. What onboarding patterns are most effective for complex analytical tools? Cover: (a) interactive tutorial or sample project bundled with the app; (b) contextual help tooltips triggered on first use of each feature; (c) an empty-state design for a new project that guides the user toward their first action. Are there any open-source examples of excellent onboarding in research software tools?

Please provide documentation links, GitHub repository URLs for React component libraries, academic citations for QDA usability research, and WCAG references for accessibility guidance.

---

*End of prompt set — 9 prompts total.* *Prompts 1–4 and 6 are MVP-critical. Prompts 5, 7, 8, and 9 address V2+ roadmap and non-critical V1 concerns.*  
