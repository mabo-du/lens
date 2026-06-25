import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * **ImageViewer contract test (source-level).**
 *
 * ImageViewer's runtime code path (Konva canvas + drag-to-create bbox +
 * click-to-add-vertex polygons + memo badge + action dialog) cannot be
 * exercised hermetically in vitest: jsdom does not implement HTMLCanvas
 * .
 *
 * getContext('2d') and react-konva's stage would crash on mount. The
 * contract we need to lock down is everything that crosses the
 * React↔IPC boundary — the surveyable public surface of the component,
 * its IPC dispatches, and the helper module it imports from. This is the
 * same source-inspection pattern as `DocumentList.test.ts` and
 * `ocrClient.test.ts`: regex-level assertions on the source file.
 *
 * **Manual E2E** (to be re-verified by a release candidate): open a
 * project, import a PNG, switch the document to that PNG, click + drag
 * to create a region, right-click the region to open the action dialog,
 * attach a memo, delete the region. Each step's effect should be
 * visible in the document list / memos panel.
 */
describe('ImageViewer IPC + canvas contract', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, './ImageViewer.tsx'),
    'utf8',
  );

  it('component is exported by name (catches rename)', () => {
    expect(src).toMatch(/export function ImageViewer\b/);
  });

  it('imports imageRegionsIpc + imagePolygonsIpc + memosIpc + documentsIpc', () => {
    expect(src).toMatch(/from ['"]@\/ipc\/image-regions['"]/);
    expect(src).toMatch(/from ['"]@\/ipc\/image-polygons['"]/);
    expect(src).toMatch(/from ['"]@\/ipc\/memos['"]/);
    expect(src).toMatch(/from ['"]@\/ipc\/documents['"]/);
  });

  it('draws on a Konva <Stage> (vendor-neutral shape contract)', () => {
    expect(src).toMatch(/<Stage\b/);
    // Konva <Layer> wrapped <Rect> for both draft + persisted regions
    // is the production-shape anchor.
    expect(src).toMatch(/<Layer\b[\s\S]*?<Rect\b/);
  });

  it('dispatches imageRegionsIpc.create with the canonical wire shape', () => {
    // The component uses ES6 property shorthand (`documentId,` not
    // `documentId: documentId,`). The regex below matches BOTH the
    // shorthand comma-form (any line  boundary, not just EOF — the
    // previous version used a `$` anchor that broke at line 55) and
    // the explicit colon-form. A non-greedy capture binds the match to
    // the `{...}` body so an unrelated JSDoc comment can't satisfy it.
    expect(src).toMatch(
      /imageRegionsIpc\.create\(\s*\{[\s\S]*?documentId\b(?:\s*,|\s*:\s*documentId\b)[\s\S]*?codeId\b(?:\s*,|\s*:\s*selectedCodeId\b)[\s\S]*?bboxBottom/,
    );
  });

  it('dispatches imagePolygonsIpc.create with normalised [0..1]² vertices', () => {
    expect(src).toMatch(/imagePolygonsIpc\.create\(/);
    expect(src).toMatch(/clampRatio\(\s*v\.x\s*\/\s*intrinsicWNum\s*\)/);
    expect(src).toMatch(/clampRatio\(\s*v\.y\s*\/\s*intrinsicHNum\s*\)/);
  });

  it('guards polygon commit with MIN_VERTICES (=3) before posting', () => {
    // canCommitPolygonDraft runs draftShouldClose (3+ vertices). If a
    // refactor accidentally deletes the guard, the backend's MAX check
    // would still hold but the user would silently lose polygon drafts.
    expect(src).toMatch(/canCommitPolygonDraft\(\)/);
    expect(src).toMatch(/Polygons need at least 3 vertices/);
  });

  it('delete path routes through imageRegionsIpc.delete OR imagePolygonsIpc.delete', () => {
    expect(src).toMatch(/imageRegionsIpc\.delete\(\s*pa\.selectionId\s*\)/);
    expect(src).toMatch(/imagePolygonsIpc\.delete\(\s*pa\.selectionId\s*\)/);
  });

  it('refreshes the memo-presence badge after delete (FK CASCADE removes the memo)', () => {
    // Real Cascade delete: deleting a region/polygon with an attached
    // memo should also remove the memo. The component MUST re-read
    // memo list so the badge flips off, otherwise the user sees a stale
    // indicator.
    expect(src).toMatch(
      /handleDeleteFromAction[\s\S]*?refreshMemoExistence\(\)/,
    );
  });

  it('uses RegionMemoDialog for shape-action memo-edit flow', () => {
    expect(src).toMatch(/<RegionMemoDialog\b/);
    expect(src).toMatch(/selectionId=\{editingSelectionId\}/);
  });
});
