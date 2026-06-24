//! DOCX text extraction.
//!
//! A `.docx` file is a ZIP archive whose root contains `word/document.xml`.
//! This module extracts plain text from that XML using only the `zip` and
//! `roxmltree` crates already in `Cargo.toml` — no Node-sidecar required for
//! the MVP hot path. The IPC `raw_text` parameter on `documents_import` is
//! retained as a renderer-side escape hatch for any future alternative
//! extractor; no Mammoth.js fallback is currently shipped (Mammoth was
//! removed in the P4.3 dependency sweep and `package.json` carries no such
//! dependency).
//!
//! Skipped XML nodes:
//! - `<w:proofErr w:type="spellStart|spellEnd|gramStart|gramEnd">` —
//!   spell-check runs are not actual content.
//! - `<w:r>` runs whose properties mark them as `<w:vanish/>` (hidden text).
//!
//! Whitespace handling mirrors `normalise::normalise_text`, but the bulk
//! normalisation is delegated to the import dispatcher so this function only
//! produces the canonical paragraph-broken string.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use roxmltree::{Document, NodeType};

/// Extract plain text from a `.docx` file.
///
/// Returns the **raw** extracted text (paragraphs separated by `\n`). The
/// caller (`documents_import_internal`) is responsible for running the
/// pipeline-wide `normalise_text` so extraction and normalisation are not
/// performed twice.
///
/// Accepted path type is `&Path`; callers holding a `PathBuf` should wrap as
/// `Path::new(&path_buf)`.
pub fn extract_text_from_docx(file_path: &Path) -> Result<String, String> {
    let bytes = read_file_bytes(file_path)?;
    extract_text_from_docx_bytes(&bytes)
}

fn extract_text_from_docx_bytes(bytes: &[u8]) -> Result<String, String> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("DOCX zip open failed: {e}"))?;

    let mut xml_bytes = Vec::new();
    {
        let mut entry = archive
            .by_name("word/document.xml")
            .map_err(|e| format!("DOCX missing word/document.xml: {e}"))?;
        entry
            .read_to_end(&mut xml_bytes)
            .map_err(|e| format!("DOCX entry read failed: {e}"))?;
    }

    let doc = Document::parse(std::str::from_utf8(&xml_bytes).map_err(|e| {
        format!("DOCX word/document.xml is not valid UTF-8: {e}")
    })?)
    .map_err(|e| format!("DOCX XML parse failed: {e}"))?;

    // `<w:document>` always wraps a single `<w:body>`. Walk one level into
    // the body so `<w:p>` paragraphs are direct children of the iteration
    // target. If the document is malformed and lacks `<w:body>`, fall back
    // to descending from the root.
    let body = doc
        .root_element()
        .children()
        .find(|c| c.tag_name().name() == "body")
        .ok_or_else(|| {
            "DOCX malformed: missing <w:body> element".to_string()
        })?;

    let mut out = String::new();
    let mut first_paragraph = true;
    for child in body.children() {
        if child.tag_name().name() != "p" {
            continue;
        }
        if !first_paragraph {
            out.push('\n');
        }
        first_paragraph = false;
        append_paragraph_text(&child, &mut out);
    }
    Ok(out)
    // NOTE: Top-level `<w:tbl>` blocks are skipped — only direct-child
    // `<w:p>` paragraphs of `<w:body>` are extracted. Tables in research
    // transcripts are uncommon; surface them as a known limitation in the
    // followup tracker alongside the document2.xml revision-history note.
}

/// Append the visible text of a `<w:p>` element to `out`. Run text is
/// concatenated without intervening whitespace; line breaks (`<w:br/>`) and
/// tabs (`<w:tab/>`) inside a run become literal `\n` / `\t`. We iterate
/// descendants only for `<w:r>` runs and delegate `<w:t>` / `<w:br/>` /
/// `<w:tab>` children to `append_run_text` so the same `<w:br/>` is not
/// processed twice (once by the run and once by a top-level descent).
fn append_paragraph_text(paragraph: &roxmltree::Node, out: &mut String) {
    for descendant in paragraph.descendants() {
        if descendant.node_type() != NodeType::Element {
            continue;
        }
        if descendant.tag_name().name() != "r" {
            continue;
        }
        // Skip runs flagged as having proof errors so we don't emit
        // spell-check artefacts.
        if has_proof_err(&descendant) {
            continue;
        }
        if has_vanish(&descendant) {
            continue;
        }
        append_run_text(&descendant, out);
    }
}

fn append_run_text(run: &roxmltree::Node, out: &mut String) {
    for child in run.children() {
        if child.node_type() != NodeType::Element {
            continue;
        }
        match child.tag_name().name() {
            "t" => {
                if let Some(text) = child.text() {
                    let preserve_space = child
                        .attribute(("http://www.w3.org/XML/1998/namespace", "space"))
                        .map(|v| v == "preserve")
                        .unwrap_or(false);
                    if preserve_space {
                        out.push_str(text);
                    } else {
                        out.push_str(&collapse_whitespace(text));
                    }
                }
            }
            "br" => out.push('\n'),
            "tab" => out.push('\t'),
            _ => {}
        }
    }
}

/// Whitespace inside a single `<w:t>` run usually collapses, but DOCX
/// frequently emits runs with leading/trailing spaces that should still
/// survive. We collapse internal multi-spaces but preserve a single
/// leading/trailing space if adjacent to another non-space run.
fn collapse_whitespace(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut prev_space = false;
    for ch in text.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                out.push(ch);
                prev_space = true;
            }
        } else {
            out.push(ch);
            prev_space = false;
        }
    }
    out
}

fn has_proof_err(run: &roxmltree::Node) -> bool {
    run.children().any(|c| {
        c.node_type() == NodeType::Element && c.tag_name().name() == "proofErr"
    })
}

fn has_vanish(run: &roxmltree::Node) -> bool {
    for child in run.descendants() {
        if child.node_type() != NodeType::Element {
            continue;
        }
        if child.tag_name().name() == "vanish" {
            return true;
        }
    }
    false
}

fn read_file_bytes(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|e| {
        format!("DOCX open failed ({}): {e}", path.display())
    })?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)
        .map_err(|e| format!("DOCX read failed: {e}"))?;
    Ok(buf)
}

// NOTE: known MVP limitations of this extractor (documented for future
// readers; some drop *text entirely*, others lose *semantic distinction*):
//
// - Revision history: `word/document.xml` is read by hard-coded name. DOCX
//   files with revision history enabled store live edits in `document.xml`
//   and earlier revisions in `document2.xml`, `document3.xml`, … Only the
//   live edit view is read.
//
// - Top-level tables: only direct-child `<w:p>` paragraphs of `<w:body>`
//   are walked. `<w:p>` nested inside `<w:tbl>/<w:tr>/<w:tc>` is inlined
//   into the body output stream, losing the table row/column structure.
//
// - Tracked changes: `<w:ins>` and `<w:del>` (which live INSIDE paragraphs
//   in `document.xml`) are descended into and their inner `<w:r><w:t>` is
//   appended. Accept/reject semantics are NOT applied — `del` text reads
//   as if accepted, `ins` reads as if regular text. Author/date metadata
//   from `<w:ins>` / `<w:del>` does NOT survive.
//
// - Footnotes: `word/document.xml` is the only file opened. `<w:footnote>`
//   bodies live in `word/footnotes.xml` which is NEVER read. Footnote text
//   is **silently dropped from the output** even though it would be reached
//   by the descendant walker. Endnotes: same pattern via `endnotes.xml`.
//
// - Comments: body anchors `<w:commentRangeStart>` / `<w:commentRangeEnd>`
//   / `<w:commentReference>` (in `document.xml`) are visible —
//   `<w:commentRangeStart>` carries text attributes that may produce
//   empty runs and so are silently inlined. The comment bodies live in
//   `word/comments.xml` which is **never read**, so authored comment text
//   is silently dropped.
//
// Top-level tables and tracked changes are *partial-loss* semantics (the
// text is reached but structure is lost). Footnotes / endnotes / comment
// bodies are *total-loss* semantics (the text is never read). A single
// document can hit several of these at once. The output extract's
// character offset space approximates the live view but is NOT guaranteed
// to match NVivo or ATLAS.ti interpretations of the same source.

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_docx(body_xml: &str) -> Vec<u8> {
        let manifest = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
                        <Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
                        <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
                        <Default Extension=\"xml\" ContentType=\"application/xml\"/>\
                        <Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>\
                        </Types>";
        let rels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
                    <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
                    <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>\
                    </Relationships>";
        let document = format!("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
                                <w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">\
                                <w:body>{body_xml}</w:body>\
                                </w:document>");

        use std::io::Write;
        let mut buf = Vec::new();
        let cursor = std::io::Cursor::new(&mut buf);
        let mut zip = zip::ZipWriter::new(cursor);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, content) in [
            ("[Content_Types].xml", manifest),
            ("_rels/.rels", rels),
            ("word/document.xml", &document),
        ] {
            zip.start_file(name, opts).unwrap();
            zip.write_all(content.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
        buf
    }

    #[test]
    fn extracts_two_paragraphs_with_line_breaks() {
        let body = "<w:p><w:r><w:t>Hello</w:t></w:r></w:p>\
                    <w:p><w:r><w:t>World</w:t></w:r></w:p>";
        let bytes = fixture_docx(body);
        let text = extract_text_from_docx_bytes(&bytes).unwrap();
        assert_eq!(text, "Hello\nWorld");
    }

    #[test]
    fn skips_proof_error_runs() {
        let body = "<w:p><w:r><w:t>Sevral</w:t></w:r>\
                    <w:r><w:proofErr w:type=\"spellStart\"/><w:t>text</w:t></w:r>\
                    <w:r><w:proofErr w:type=\"spellEnd\"/></w:r></w:p>";
        let bytes = fixture_docx(body);
        let text = extract_text_from_docx_bytes(&bytes).unwrap();
        assert_eq!(text, "Sevral");
    }

    #[test]
    fn honours_preserve_space_attribute() {
        let body = "<w:p><w:r><w:t xml:space=\"preserve\">hello </w:t></w:r>\
                    <w:r><w:t>world</w:t></w:r></w:p>";
        let bytes = fixture_docx(body);
        let text = extract_text_from_docx_bytes(&bytes).unwrap();
        assert_eq!(text, "hello world");
    }

    #[test]
    fn line_break_in_paragraph_becomes_newline() {
        let body = "<w:p><w:r><w:t>first</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>second</w:t></w:r></w:p>";
        let bytes = fixture_docx(body);
        let text = extract_text_from_docx_bytes(&bytes).unwrap();
        assert_eq!(text, "first\nsecond");
    }
}
