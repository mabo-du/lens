/**
 * Playwright E2E fixture — a stripped-down Workspace mount that runs
 * in the browser (no Tauri) so the test specs in `tests/e2e/*.spec.ts`
 * can exercise CodeTree, DocumentEditor, DocumentList, and SearchDialog
 * without a full Tauri dev server.
 *
 * The four panel-realistic mounts (Codes, "Test Interview Transcript",
 * DocumentList, Ctrl+F search) live side-by-side as a horizontal flex of
 * divs, each one wired to mocked `__TAURI_INTERNALS__.invoke` calls
 * captured into `window.__LENS_TEST__.invocations` for assertion.
 *
 * Exposed window globals:
 *   - `__LENS_TEST__`           — { invocations: Invocation[]; reset(): void }
 *   - `useProjectStore`         — ZUstand projectStore (read-only here)
 *   - `useUiStore`              — ZUstand uiStore (read/write)
 *   - `__TAURI_INTERNALS__`     — invoke(cmd, args) stub
 */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/App.css';

import { CodeTree } from '@/components/code-tree/CodeTree';
import { DocumentEditor } from '@/components/editor/DocumentEditor';
import { DocumentList } from '@/components/document-list/DocumentList';
import { SearchDialog } from '@/components/search/SearchDialog';
import { FuzzyCodePicker } from '@/components/editor/FuzzyCodePicker';
import { TooltipProvider } from '@/components/ui/tooltip';

import { useProjectStore } from '@/store/projectStore';
import { useUiStore } from '@/store/uiStore';

// -----------------------------------------------------------------------------
// IPC mock — a single in-memory backend that simulates what the Rust side
// would return. Each invocation is appended to __LENS_TEST__.invocations
// and tests assert against that log.
// -----------------------------------------------------------------------------
import { documentsIpc } from '@/ipc/documents';
import { codesIpc } from '@/ipc/codes';
import { annotationsIpc } from '@/ipc/annotations';
import { searchIpc } from '@/ipc/search';
import { memosIpc } from '@/ipc/memos';
import { projectsIpc } from '@/ipc/projects';
import { qdpxImportIpc } from '@/ipc/qdpx_import';
import { exportIpc } from '@/ipc/export';
import { encryptionIpc } from '@/ipc/encryption';
import { settingsIpc } from '@/ipc/settings';
import { audioIpc } from '@/ipc/audio';

interface Invocation {
  cmd: string;
  args: unknown;
}

const SEED_PROJECT = { id: 'proj-1', name: 'Test Project', description: '', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' };
const SEED_TEXT = 'This is a sample interview transcript generated for end-to-end testing of the LENS workspace. The quick brown fox jumps over the lazy dog. Researchers can use the document to verify text selection, code assignment via the tree, and full-text search via Ctrl+F. The transcript discusses usability, accessibility, and qualitative coding methodology.';
const SEED_DOC = {
  id: 'doc-text-1',
  projectId: 'proj-1',
  title: 'Test Interview Transcript',
  originalPath: '/tmp/sample-transcript.txt',
  fileFormat: 'txt',
  plainText: SEED_TEXT,
  textHash: 'fixture-hash',
  extractorId: 'lens-test-1.0.0',
  wordCount: SEED_TEXT.split(/\s+/).length,
  importedAt: '2025-01-01T00:00:00Z',
  sortOrder: 0,
};

// Reconciliation — strip fields that don't appear in the production
// DocumentRecord shape (e.g. `document.list()` only returns a subset).
const SEED_DOC_PLAIN: Record<string, unknown> = {
  id: SEED_DOC.id,
  projectId: SEED_DOC.projectId,
  title: SEED_DOC.title,
  originalPath: SEED_DOC.originalPath,
  fileFormat: SEED_DOC.fileFormat,
  plainText: SEED_DOC.plainText,
  textHash: SEED_DOC.textHash,
  extractorId: SEED_DOC.extractorId,
  wordCount: SEED_DOC.wordCount,
  importedAt: SEED_DOC.importedAt,
  sortOrder: SEED_DOC.sortOrder,
};

// 1. Install the __LENS_TEST__ harness on the window BEFORE React mounts so
// the gotoWorkspace() reset() call in spec files can find it.
const invocations: Invocation[] = [];
const lensTest = {
  invocations,
  reset() {
    invocations.length = 0;
    // Reset stores to seeded state.
    useProjectStore.getState().setActiveProject(SEED_PROJECT as never);
    useProjectStore.getState().setDocuments([SEED_DOC_PLAIN] as never);
    useProjectStore.getState().setCodes([]);
    useProjectStore.getState().setAnnotations([]);
    useProjectStore.getState().setMemos([]);
    useUiStore.getState().setActiveDocument(null);
    useUiStore.getState().setActiveCodeViewId(null);
    useUiStore.getState().clearTextSelection?.();
  },
  // Log a synthetic call (useful for tests that want to assert that
  // mutations triggered the right ordering of IPC calls).
  log(cmd: string, args: unknown) {
    invocations.push({ cmd, args });
  },
};
(window as unknown as { __LENS_TEST__: typeof lensTest }).__LENS_TEST__ = lensTest;

// 2. Mock `window.__TAURI_INTERNALS__.invoke` so every ipc/*.ts callsite
// falls back to our in-memory store rather than reaching the real Rust.
const newId = (prefix: string) => `${prefix}-${(crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 14)).slice(0, 12)}`;
const installedCodes: Array<{ id: string; name: string; color: string; children: []; depth: number; projectId: string; description: string | null; createdAt: string }> = [];
let installedDocs: Array<Record<string, unknown>> = [...(useProjectStore.getState().documents.length === 0 ? [SEED_DOC_PLAIN] : [])];
let installedAnnotations: Array<{ id: string; documentId: string; codeId: string; startChar: number; endChar: number; createdBy?: string; createdAt: string }> = [];

const tauriInternals = {
  async invoke<T = unknown>(cmd: string, args: unknown = {}): Promise<T> {
    lensTest.log(cmd, args);
    switch (cmd) {
      case 'codes_create': {
        const a = args as { name?: string; color?: string | null; parentId?: string | null };
        const newCode = {
          id: newId('code'),
          name: a.name ?? 'New Code',
          color: a.color ?? '#6366f1',
          children: [],
          depth: 0,
          projectId: 'proj-1',
          description: null,
          createdAt: new Date().toISOString(),
        };
        installedCodes.push(newCode);
        // Propagate to projectStore so CodeTree re-renders.
        useProjectStore.getState().addCodes?.([newCode] as never) ??
          useProjectStore.getState().setCodes?.([newCode] as never);
        return newCode as unknown as T;
      }
      case 'codes_get_tree':
        return installedCodes as unknown as T;
      case 'codes_update':
        return {} as T;
      case 'codes_delete': {
        const a = args as { id: string };
        const idx = installedCodes.findIndex(c => c.id === a.id);
        if (idx >= 0) installedCodes.splice(idx, 1);
        return {} as T;
      }
      case 'annotations_create': {
        const a = args as { documentId: string; codeId: string; startChar: number; endChar: number };
        const ann = {
          id: newId('ann'),
          documentId: a.documentId,
          codeId: a.codeId,
          startChar: a.startChar,
          endChar: a.endChar,
          createdBy: 'user-fixture-1',
          createdAt: new Date().toISOString(),
        };
        installedAnnotations.push(ann);
        return ann as unknown as T;
      }
      case 'annotations_list_by_document':
        return installedAnnotations.filter(a => a.documentId === (args as { documentId: string }).documentId) as unknown as T;
      case 'documents_list':
        return installedDocs as unknown as T;
      case 'documents_import': {
        const a = args as { filePath: string; fileFormat: string };
        const fileName = a.filePath.split('/').pop() ?? 'unknown';
        const doc = { ...SEED_DOC_PLAIN, id: newId('doc'), title: fileName, fileFormat: a.fileFormat, originalPath: a.filePath };
        installedDocs.push(doc);
        return doc as unknown as T;
      }
      case 'documents_get_content':
        return SEED_TEXT as unknown as T;
      case 'document_delete':
        return {} as T;
      case 'search_query': {
        const a = args as { query: string };
        if (!a.query) return [];
        // Always include at least one result for any non-empty query,
        // and especially highlight "usability" if it matches the seed.
        const snippet = SEED_TEXT.includes(a.query)
          ? `The transcript discusses <mark>${a.query}</mark>, accessibility, and qualitative coding methodology.`
          : `Mention of <mark>${a.query}</mark> in this sample document.`;
        return [{ sourceType: 'document', sourceId: SEED_DOC.id, sourceName: SEED_DOC.title, snippet }] as unknown as T;
      }
      case 'memos_list_by_project':
        return [];
      default:
        // Fall through to no-op so other commands don't crash.
        return {} as T;
    }
  },
  async transformCallback(): Promise<number> {
    return 0;
  },
};
(window as unknown as { __TAURI_INTERNALS__: typeof tauriInternals }).__TAURI_INTERNALS__ = tauriInternals;

// 3. Stub the Tauri plugin helpers that some components import but
// aren't needed for the fixture. Returning promises keeps every caller
// happy without React errors.
(window as unknown as { __TAURI_PLUGIN_DIALOG__: { open: () => Promise<null> } }).__TAURI_PLUGIN_DIALOG__ = {
  open: async () => null,
};
(window as unknown as { __TAURI_PLUGIN_FS__: { writeFile: () => Promise<void> } }).__TAURI_PLUGIN_FS__ = {
  async writeFile() { /* no-op */ },
};

// 4. Pre-install the seeded project + document so the workspace renders
// something on first paint instead of an empty Project splash.
useProjectStore.setState({
  activeProject: SEED_PROJECT,
  documents: [SEED_DOC_PLAIN],
  codes: [],
  annotations: [],
  memos: [],
} as never);
useUiStore.setState({
  activeDocumentId: 'doc-text-1',
  textSelection: null,
} as never);

// -----------------------------------------------------------------------------
// Root component — a flex row with the three panels side-by-side, the
// search dialog mounted at root, ctrl+f shortcut, and tooltip provider.
// -----------------------------------------------------------------------------
function FixtureWorkspace() {
  return (
    <TooltipProvider delay={500}>
      <div className="flex flex-row h-full w-full bg-slate-100">
        <div className="w-64 border-r border-slate-200 flex flex-col shrink-0">
          <DocumentList />
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <DocumentEditor />
        </div>
        <div className="w-72 border-l border-slate-200 flex flex-col shrink-0">
          <CodeTree />
        </div>
      </div>
      <SearchDialog />
      {/* CodeTree already mounts its own CodeDialog; FuzzyCodePicker is
          declared globally on the Workspace page in production so we
          surface it here too. The CodeDialog shim was removed —
          duplicating getByRole('dialog') is a footgun for NUnit-style
          selectors. */}
      <FakeFuzzyCodePickerMount />
    </TooltipProvider>
  );
}

/**
 * Mount-only shim for the FuzzyCodePicker — production's Workspace
 * already mounts it, but the fixture does not contain a full Workspace
 * so we surface it here. CodeDialog is left to CodeTree itself.
 */
function FakeFuzzyCodePickerMount() {
  return <FuzzyCodePicker />;
}

const root = createRoot(document.getElementById('root')!);
root.render(<FixtureWorkspace />);

// 5. Expose the store hooks for tests that mutate state from the test
// harness (e.g. uiStore.setTextSelection + useProjectStore.setCodes).
(window as unknown as { useProjectStore: typeof useProjectStore }).useProjectStore = useProjectStore;
(window as unknown as { useUiStore: typeof useUiStore }).useUiStore = useUiStore;
