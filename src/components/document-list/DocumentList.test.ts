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

  it('does not pass rawText to documentsIpc.import (native path is path-only)', () => {
    // After mammoth removal, all formats (.txt/.docx/.pdf) dispatch with
    // `{ projectId, filePath, fileFormat }` and the Rust side picks the
    // extractor (see `commands/import.rs:documents_import_internal`). The
    // `rawText` union variant in `ImportPayload` is now unreachable from the
    // frontend; its presence in DocumentList would surface as a regression.
    expect(src).not.toMatch(/rawText\s*:/);
  });

  it('dispatches through documentsIpc.import with a fileFormat field', () => {
    // Loose positive assertion: the unified dispatcher DID replace the old
    // mammoth path. Loose enough to survive a future refactor (switch,
    // map, regex match) without flagging a false-positive.
    expect(src).toMatch(/documentsIpc\.import\(/);
    expect(src).toMatch(/fileFormat\s*:/);
  });
});
