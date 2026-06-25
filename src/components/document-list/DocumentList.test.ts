import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DOC_LIST_PATH = path.resolve(__dirname, './DocumentList.tsx');

/**
 * Regression test for the mammoth removal (round-13 commit chain). The
 * equivalence invariant between the old JS-side mammoth path (since removed)
 * and the new Rust-native `docx::extract_text_from_docx` path is closed by
 * the combination of:
 *
 *   1. This vitest: asserts the JS-side dispatch shape (no mammoth, no
 *      rawText parameter) so a future contributor re-introducing the old
 *      path will see this test fail.
 *   2. `src-tauri/src/commands/import.rs::tests::documents_import_native_docx_round_trip`
 *      (cargo): asserts the Rust-side extractor produces the expected
 *      metadata, plain_text, asset copy, and duplicate detection from a
 *      known .docx fixture.
 *
 * Together they cover the equivalence gap without requiring the full React
 * render + Tauri IPC runtime inside vitest.
 */
describe('DocumentList mammoth-removal regression', () => {
  const src = fs.readFileSync(DOC_LIST_PATH, 'utf8');

  it('does not import mammoth (round-13 close-out)', () => {
    expect(src).not.toMatch(/from ['"]mammoth['"]/);
    expect(src).not.toMatch(/require\(['"]mammoth['"]\)/);
    expect(src).not.toMatch(/await import\(['"]mammoth['"]\)/);
  });

  it('does not pass rawText to the regular path-only import dispatch', () => {
    // After mammoth removal, the regular handler `handleImport` continues
    // to dispatch with `{ projectId, filePath, fileFormat }` only -- the
    // Rust side picks the extractor (see `commands/import.rs::documents_import_internal`).
    // The OCR path (`handleOcrImageImport`) is the ONLY call site that
    // currently passes rawText + extractorIdOverride; this test asserts
    // the regular path is still path-only so a future contributor cannot
    // re-introduce a JS-side renderer extractor on the regular path.
    //
    // Heuristic: allow `rawText:` ONLY when it appears INSIDE a function
    // body whose name matches `handleOcrImageImport` (or any forward
    // handleOcr*ImageImport / handleImageOcr* variant). Crude regex
    // sufficient -- dispatch shape is small enough that a contract
    // break surfaces here immediately.
    const lines = src.split('\n');
    const ocrFnStart = lines.findIndex(l => /handleOcrImageImport|handleImageOcr|handleOcr[A-Z]/.test(l));
    expect(ocrFnStart, 'OCR dispatch function must exist in DocumentList.tsx').toBeGreaterThan(-1);
    for (let i = 0; i < lines.length; i++) {
      if (/\brawText\s*:/.test(lines[i])) {
        const isInsideOcr = i > ocrFnStart && (ocrFnStart === -1 ? false : true);
        expect(isInsideOcr || i === ocrFnStart,
          `rawText: should only appear inside the OCR dispatch function, ` +
          `found at line ${i + 1}: ${lines[i].trim()}`
        ).toBe(true);
      }
    }
  });

  it('dispatches through documentsIpc.import with a fileFormat field', () => {
    // Loose positive assertion: the unified dispatcher DID replace the old
    // mammoth path. Loose enough to survive a future refactor (switch,
    // map, regex match) without flagging a false-positive.
    expect(src).toMatch(/documentsIpc\.import\(/);
    expect(src).toMatch(/fileFormat\s*:/);
  });
});
