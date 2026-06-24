/**
 * Playwright workspace fixture — renders DocumentEditor + CodeTree + SearchDialog.
 *
 * Extends the Tauri-IPC mock with text-document IPC handlers (annotations,
 * codes, search, document content) so E2E tests can verify the full
 * text-coding workflow without a real Tauri runtime.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'sonner';

// ---------------------------------------------------------------------------
// 1. Tauri-IPC SHIM (must run before any @tauri-apps/api/core import)
// ---------------------------------------------------------------------------

interface FixtureAnnotation {
  id: string;
  documentId: string;
  codeId: string;
  startChar: number;
  endChar: number;
  createdBy: string;
  createdAt: string;
}

interface FixtureCode {
  id: string;
  projectId: string;
  name: string;
  color: string;
  description: string | null;
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

const PLAIN_TEXT = `This is a sample interview transcript for testing purposes.

The participant described their experience with the new system in detail. They mentioned several key themes including usability challenges and unexpected benefits. The training program was cited as particularly helpful for onboarding new team members.

A second theme that emerged was the importance of communication between teams. The participant noted that the new tools improved collaboration significantly. However, there were some concerns about data privacy and access controls.

Finally, the participant reflected on the overall impact of the changes. They felt that while the transition was difficult at first, the long-term benefits outweighed the initial challenges. Team morale improved after the first month of use.`;

const mockFixture = {
  projects: [
    { id: 'proj-1', name: 'Test Project', description: null, createdAt: '2026-06-24T00:00:00Z', updatedAt: '2026-06-24T00:00:00Z' },
  ],
  documents: [
    {
      id: 'doc-text-1', projectId: 'proj-1', title: 'Test Interview Transcript',
      originalPath: null, fileFormat: 'txt',
      plainText: PLAIN_TEXT,
      textHash: 'mock-hash', extractorId: 'mock', wordCount: 150,
      importedAt: '2026-06-24T00:00:00Z', sortOrder: 0,
      intrinsicW: null, intrinsicH: null,
    },
  ],
  codes: [] as FixtureCode[],
  annotations: [] as FixtureAnnotation[],
  memos: [] as FixtureMemo[],
};

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
    mockFixture.codes.length = 0;
    mockFixture.annotations.length = 0;
    mockFixture.memos.length = 0;
    lensTest.invocations.length = 0;
  },
  fixture: mockFixture,
};

const invoke = async (cmd: string, args: unknown): Promise<unknown> => {
  lensTest.invocations.push({ cmd, args, ts: Date.now() });
  switch (cmd) {
    // ---- Documents ---------------------------------------------------------
    case 'document_get_content':
      return PLAIN_TEXT;

    // ---- Annotations -------------------------------------------------------
    case 'annotations_create': {
      const a = args as { documentId: string; codeId: string; startChar: number; endChar: number };
      const ann: FixtureAnnotation = {
        id: genId(),
        documentId: a.documentId,
        codeId: a.codeId,
        startChar: a.startChar,
        endChar: a.endChar,
        createdBy: 'test-user',
        createdAt: new Date().toISOString(),
      };
      mockFixture.annotations.push(ann);
      return ann;
    }
    case 'annotations_list_by_document':
      return mockFixture.annotations.filter(
        a => a.documentId === (args as { documentId: string }).documentId,
      );
    case 'annotations_delete':
      mockFixture.annotations = mockFixture.annotations.filter(
        a => a.id !== (args as { id: string }).id,
      );
      return null;
    case 'annotations_list_by_code':
      return mockFixture.annotations.filter(
        a => a.codeId === (args as { codeId: string }).codeId,
      );

    // ---- Codes -------------------------------------------------------------
    case 'codes_create': {
      const a = args as { projectId: string; parentId: string | null; name: string; color: string | null };
      const code: FixtureCode = {
        id: genId(),
        projectId: a.projectId,
        name: a.name,
        color: a.color ?? '#6366f1',
        description: null,
        createdAt: new Date().toISOString(),
      };
      mockFixture.codes.push(code);
      return code;
    }
    case 'codes_get_tree': {
      // Return flat tree — each code has empty children array.
      return mockFixture.codes.map(c => ({ ...c, children: [], depth: 0 }));
    }
    case 'codes_update': {
      const a = args as { id: string; name?: string; color?: string; description?: string };
      const code = mockFixture.codes.find(c => c.id === a.id);
      if (!code) throw new Error(`Code ${a.id} not found`);
      if (a.name !== undefined) code.name = a.name;
      if (a.color !== undefined) code.color = a.color;
      if (a.description !== undefined) code.description = a.description;
      return code;
    }
    case 'codes_delete':
      mockFixture.codes = mockFixture.codes.filter(c => c.id !== (args as { id: string }).id);
      return null;
    case 'codes_move':
      // No-op in flat mock — codes have no parents.
      return null;

    // ---- Search ------------------------------------------------------------
    case 'search_query': {
      const a = args as { projectId: string; query: string; codeIdFilter: string | null };
      const q = a.query.toLowerCase();
      const results: Array<{ sourceType: string; sourceId: string; sourceName: string; snippet: string; sortOrder: number }> = [];

      // Search document plain text
      for (const doc of mockFixture.documents) {
        const text = doc.plainText ?? '';
        const idx = text.toLowerCase().indexOf(q);
        if (idx >= 0) {
          const start = Math.max(0, idx - 30);
          const end = Math.min(text.length, idx + q.length + 30);
          let snippet = text.slice(start, end);
          if (start > 0) snippet = '...' + snippet;
          if (end < text.length) snippet = snippet + '...';
          // Mark the match
          const matchStart = snippet.toLowerCase().indexOf(q);
          if (matchStart >= 0) {
            snippet = snippet.slice(0, matchStart) + '<mark>' + snippet.slice(matchStart, matchStart + q.length) + '</mark>' + snippet.slice(matchStart + q.length);
          }
          results.push({
            sourceType: 'document',
            sourceId: doc.id,
            sourceName: doc.title,
            snippet,
            sortOrder: doc.sortOrder,
          });
        }
      }

      // Search memos
      for (const memo of mockFixture.memos) {
        const idx = memo.body.toLowerCase().indexOf(q);
        if (idx >= 0) {
          const start = Math.max(0, idx - 30);
          const end = Math.min(memo.body.length, idx + q.length + 30);
          let snippet = memo.body.slice(start, end);
          if (start > 0) snippet = '...' + snippet;
          if (end < memo.body.length) snippet = snippet + '...';
          const matchStart = snippet.toLowerCase().indexOf(q);
          if (matchStart >= 0) {
            snippet = snippet.slice(0, matchStart) + '<mark>' + snippet.slice(matchStart, matchStart + q.length) + '</mark>' + snippet.slice(matchStart + q.length);
          }
          results.push({
            sourceType: 'memo',
            sourceId: memo.id,
            sourceName: memo.linkedCodeId ? `Memo for code-${memo.linkedCodeId}` : 'Project Journal',
            snippet,
            sortOrder: 0,
          });
        }
      }

      return results;
    }

    // ---- Memos -------------------------------------------------------------
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
        m => (args as { linkedCodeId: string | null }).linkedCodeId === m.linkedCodeId
      ) ?? null;

    // ---- User --------------------------------------------------------------
    case 'local_user_get_name':
      return 'test-user';

    default:
      // eslint-disable-next-line no-console
      console.warn('[lens-test] unhandled invoke call:', cmd, args);
      return null;
  }
};

// Inject shim BEFORE first call to invoke()
(window as unknown as { __TAURI_INTERNALS__: { invoke: typeof invoke } }).__TAURI_INTERNALS__ = { invoke };
(window as unknown as { __LENS_TEST__: LENS_TEST }).__LENS_TEST__ = lensTest;

// ---------------------------------------------------------------------------
// 2. Store seeding
// ---------------------------------------------------------------------------

import { useProjectStore } from '@/store/projectStore';
import { useUiStore } from '@/store/uiStore';

useProjectStore.setState({
  activeProject: mockFixture.projects[0],
  codes: [] as unknown as Parameters<typeof useProjectStore.setState>[0]['codes'],
  documents: mockFixture.documents as unknown as Parameters<typeof useProjectStore.setState>[0]['documents'],
  annotations: [],
  memos: [],
});

useUiStore.setState({ activeDocumentId: 'doc-text-1' });

// Expose stores on window so tests can inject state via page.evaluate.
(window as unknown as Record<string, unknown>).useProjectStore = useProjectStore;
(window as unknown as Record<string, unknown>).useUiStore = useUiStore;

// ---------------------------------------------------------------------------
// 3. Mount workspace (DocumentEditor + CodeTree + SearchDialog)
// ---------------------------------------------------------------------------

import { DocumentEditor } from '@/components/editor/DocumentEditor';
import { CodeTree } from '@/components/code-tree/CodeTree';
import { SearchDialog } from '@/components/search/SearchDialog';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      {/* Left: Code Tree */}
      <div style={{ width: '250px', flexShrink: 0, borderRight: '1px solid #e2e8f0' }}>
        <CodeTree />
      </div>
      {/* Center: Document Editor */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <DocumentEditor />
      </div>
    </div>
    <SearchDialog />
    <Toaster />
  </React.StrictMode>,
);
