/**
 * Playwright fixture entry.
 *
 * Bootstraps a Tauri-IPC mock (`window.__TAURI_INTERNALS__.invoke`) BEFORE
 * importing the ImageViewer component tree, so the production IPC paths
 * (`documentsIpc.getAsset`, `imagePolygonsIpc.create`, etc.) resolve against
 * an in-memory fixture store rather than the real Tauri runtime.
 *
 * The mock logs every invocation to `window.__LENS_TEST__.invocations` so
 * Playwright tests can assert that a given IPC was called with the expected
 * arguments.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'sonner';

// ---------------------------------------------------------------------------
// 1. Tauri-IPC SHIM  (must run before any `@tauri-apps/api/core` import)
// ---------------------------------------------------------------------------

interface FixtureRegion {
  id: string;
  documentId: string;
  codeId: string;
  regionType: 'bbox';
  regionData: string;
  bboxLeft: number;
  bboxTop: number;
  bboxRight: number;
  bboxBottom: number;
  createdBy: string | null;
  createdAt: string;
}
interface FixturePolygon {
  id: string;
  documentId: string;
  codeId: string;
  vertices: number[][];
  createdBy: string | null;
  createdAt: string;
}
interface FixtureMemo {
  id: string;
  projectId: string;
  linkedCodeId: string | null;
  linkedSelectionId: string | null;
  body: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const mockFixture = {
  projects: [
    { id: 'proj-1', name: 'Test Project', description: null, createdAt: '2026-06-24T00:00:00Z', updatedAt: '2026-06-24T00:00:00Z' },
  ],
  codes: [
    { id: 'code-1', projectId: 'proj-1', name: 'Test Code', color: '#ff0000', description: null, createdAt: '2026-06-24T00:00:00Z' },
  ],
  documents: [
    {
      id: 'doc-1', projectId: 'proj-1', title: 'Test Image', originalPath: null,
      fileFormat: 'png', textHash: 'mock', extractorId: 'mock', wordCount: 0,
      intrinsicW: 256, intrinsicH: 256,
      importedAt: '2026-06-24T00:00:00Z', sortOrder: 0,
    },
  ],
  regions: [] as FixtureRegion[],
  polygons: [] as FixturePolygon[],
  memos: [] as FixtureMemo[],
};

// 1×1 transparent PNG (70 bytes decoded). Sufficient for ImageViewer's
// `data:image/png;base64,{asset.b64}` URL load flow — it can decode and
// fire the onload handler; the Stage renders at intrinsicW × intrinsicH
// (256 × 256) and applies clicks/we draw all coordinates relative to that
// logical canvas.
const PNG_B64_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let idSeq = 1;
const genId = () => `mock-${idSeq++}`;

interface LENS_TEST {
  invocations: Array<{ cmd: string; args: unknown; ts: number }>;
  reset: () => void;
  fixture: typeof mockFixture;
}

const lensTest: LENS_TEST = {
  invocations: [],
  reset: () => {
    idSeq = 1;
    mockFixture.regions.length = 0;
    mockFixture.polygons.length = 0;
    mockFixture.memos.length = 0;
    lensTest.invocations.length = 0;
  },
  fixture: mockFixture,
};

const invoke = async (cmd: string, args: unknown): Promise<unknown> => {
  lensTest.invocations.push({ cmd, args, ts: Date.now() });
  switch (cmd) {
    case 'document_get_asset_base64':
      return { b64: PNG_B64_1X1, mime: 'image/png' };
    case 'image_selection_list_by_document':
      return mockFixture.regions.filter(r => r.documentId === (args as { documentId: string }).documentId);
    case 'image_selection_create': {
      const a = args as { documentId: string; codeId: string; bboxLeft: number; bboxTop: number; bboxRight: number; bboxBottom: number };
      const region: FixtureRegion = {
        id: genId(),
        documentId: a.documentId,
        codeId: a.codeId,
        regionType: 'bbox',
        regionData: JSON.stringify({ left: a.bboxLeft, top: a.bboxTop, right: a.bboxRight, bottom: a.bboxBottom }),
        bboxLeft: a.bboxLeft,
        bboxTop: a.bboxTop,
        bboxRight: a.bboxRight,
        bboxBottom: a.bboxBottom,
        createdBy: null,
        createdAt: new Date().toISOString(),
      };
      mockFixture.regions.push(region);
      return region;
    }
    case 'image_selection_delete':
      mockFixture.regions = mockFixture.regions.filter(r => r.id !== (args as { id: string }).id);
      return null;
    case 'image_polygon_list_by_document':
      return mockFixture.polygons.filter(p => p.documentId === (args as { documentId: string }).documentId);
    case 'image_polygon_create': {
      const a = args as { documentId: string; codeId: string; verticesJson?: string };
      const vertices = a.verticesJson ? JSON.parse(a.verticesJson) : [];
      const polygon: FixturePolygon = {
        id: genId(),
        documentId: a.documentId,
        codeId: a.codeId,
        vertices,
        createdBy: null,
        createdAt: new Date().toISOString(),
      };
      mockFixture.polygons.push(polygon);
      return polygon;
    }
    case 'image_polygon_delete':
      mockFixture.polygons = mockFixture.polygons.filter(p => p.id !== (args as { id: string }).id);
      return null;
    case 'memos_list_by_project':
      return mockFixture.memos.filter(m => m.projectId === 'proj-1');
    case 'memos_save': {
      const a = args as { projectId: string; linkedCodeId: string | null; linkedSelectionId: string | null; body: string };
      const memo: FixtureMemo = {
        id: genId(),
        projectId: a.projectId,
        linkedCodeId: a.linkedCodeId,
        linkedSelectionId: a.linkedSelectionId,
        body: a.body,
        createdBy: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockFixture.memos.push(memo);
      return memo;
    }
    case 'memos_get':
      return mockFixture.memos.find(
        m => (args as { projectId: string; linkedSelectionId: string | null }).linkedSelectionId === m.linkedSelectionId &&
             (args as { linkedSelectionId: string | null }).linkedCodeId === m.linkedCodeId
      ) ?? null;
    case 'local_user_get_name':
      return 'test-user';
    default:
      // Unhandled; log to console so tests can observe but ignore.
      // eslint-disable-next-line no-console
      console.warn('[lens-test] unhandled invoke call:', cmd, args);
      return null;
  }
};

// Inject shim BEFORE first call to `invoke()`.
// Note: `@tauri-apps/api/core` invokes `window.__TAURI_INTERNALS__.invoke`
// at CALL time (not import time), so any synchronous assignment on this
// file's top level covers all subsequent ImageViewer calls.
(window as unknown as { __TAURI_INTERNALS__: { invoke: typeof invoke } }).__TAURI_INTERNALS__ = { invoke };
(window as unknown as { __LENS_TEST__: LENS_TEST }).__LENS_TEST__ = lensTest;

// ---------------------------------------------------------------------------
// 2. Project store seed  (must precede any component reads usesProjectStore)
// ---------------------------------------------------------------------------

import { useProjectStore } from '@/store/projectStore';
useProjectStore.setState({
  activeProject: mockFixture.projects[0],
  codes: mockFixture.codes,
  documents: mockFixture.documents,
  annotations: [],
  memos: [],
});

// ---------------------------------------------------------------------------
// 3. Mount ImageViewer
// ---------------------------------------------------------------------------

import { ImageViewer } from '@/components/editor/ImageViewer';
import type { DocumentRecord } from '@/ipc/documents';

const fixtureDoc = mockFixture.documents[0] as DocumentRecord;

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ImageViewer document={fixtureDoc} />
    <Toaster />
  </React.StrictMode>,
);
