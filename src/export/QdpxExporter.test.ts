import { describe, it, expect, vi, beforeAll } from 'vitest';

// jszip + xmldom both run in node (vitest env = node per vite.config.ts).
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

import { exporterRegistry, type ExportPayload } from './ExporterPlugin';

// Mock the Tauri plugin-fs readFile so the richTextPath branch in
// QdpxExporter does not try to read a real asset from disk under tests.
// We use plain-text sources in the synthetic payload so the richTextPath
// branch is never hit; this mock returns an empty buffer just in case.
vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(async () => new Uint8Array()),
}));

beforeAll(() => {
  // Importing QdpxExporter has the side-effect of registering itself.
  // Dynamic import inside beforeAll so the vi.mock above takes effect.
  return import('./QdpxExporter');
});

function buildSyntheticPayload(): ExportPayload {
  return {
    project: {
      id: 'proj-1',
      name: 'Round Trip Demo',
      description: null,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-02T00:00:00Z',
    },
    documents: [
      {
        id: 'doc-1',
        projectId: 'proj-1',
        title: 'Interview Transcript',
        fileFormat: 'txt',
        originalPath: null,
        plainText: 'Hello world. This is the body.\n\nSecond paragraph.',
        importedAt: '2025-01-01T00:00:00Z',
      } as ExportPayload['documents'][number],
    ],
    codes: [
      {
        id: 'code-1',
        projectId: 'proj-1',
        name: 'Greeting',
        description: 'Opening salutations',
        color: '#22c55e',
        createdAt: '2025-01-01T00:00:00Z',
        depth: 0,
        children: [
          {
            id: 'code-2',
            projectId: 'proj-1',
            name: 'Hello',
            description: null,
            color: '#ef4444',
            createdAt: '2025-01-01T00:00:00Z',
            depth: 1,
            children: [],
          },
        ],
      },
    ],
    annotations: [
      {
        id: 'ann-1',
        documentId: 'doc-1',
        codeId: 'code-1',
        startChar: 0,
        endChar: 5, // "Hello"
        createdBy: 'user-1',
        createdAt: '2025-01-01T00:00:00Z',
      } as ExportPayload['annotations'][number],
    ],
    memos: [],
    localUser: { id: 'user-1', displayName: 'Tester' },
    projectFolderPath: '/tmp/lens-projects/round-trip-demo',
  };
}

describe('QdpxExporter round-trip', () => {
  it('is registered in the global exporterRegistry', () => {
    const plugin = exporterRegistry.get('qdpx');
    expect(plugin).toBeDefined();
    expect(plugin?.fileExtension).toBe('qdpx');
  });

  it('produces a zip that contains project.qde + Sources/<id>.txt', async () => {
    const plugin = exporterRegistry.get('qdpx');
    if (!plugin) throw new Error('QdpxExporter not registered');
    const data = await plugin.export(buildSyntheticPayload());
    expect(data).toBeInstanceOf(Uint8Array);

    const zip = await JSZip.loadAsync(data);
    expect(zip.file('project.qde')).not.toBeNull();
    const txtEntry = zip.file('Sources/doc-1.txt');
    expect(txtEntry).not.toBeNull();
    const txt = await txtEntry!.async('string');
    expect(txt).toBe('Hello world. This is the body.\n\nSecond paragraph.');
  });

  it('project.qde XML structure: namespace, codes (with nesting), sources, annotation coding', async () => {
    const plugin = exporterRegistry.get('qdpx');
    if (!plugin) throw new Error('QdpxExporter not registered');
    const data = await plugin.export(buildSyntheticPayload());
    const zip = await JSZip.loadAsync(data);
    const xml = await zip.file('project.qde')!.async('string');

    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const root = doc.documentElement;
    if (!root) throw new Error('XML root missing');
    expect(root.tagName).toBe('Project');
    expect(root.getAttribute('name')).toBe('Round Trip Demo');

    // Codes -- top-level + nested
    const codes = root.getElementsByTagName('Codes')[0];
    if (!codes) throw new Error('Codes element missing');
    const codeEls = codes.getElementsByTagName('Code');
    expect(codeEls.length).toBe(2); // 'Greeting' + 'Hello' (nested)
    const greeting = codeEls.item(0);
    const hello = codeEls.item(1);
    if (!greeting || !hello) throw new Error('Code elements missing');
    expect(greeting.getAttribute('name')).toBe('Greeting');
    expect(greeting.getAttribute('color')?.toUpperCase()).toBe('#FF22C55E');
    expect(hello.getAttribute('name')).toBe('Hello');
    expect(hello.parentNode).toBe(greeting); // nested

    // Sources
    const sourceEls = root.getElementsByTagName('TextSource');
    expect(sourceEls.length).toBe(1);
    const source = sourceEls.item(0);
    if (!source) throw new Error('TextSource missing');
    expect(source.getAttribute('guid')).toBe('doc-1');
    expect(source.getAttribute('plainTextPath')).toBe('doc-1.txt');

    // Annotation -> PlainTextSelection -> Coding -> CodeRef
    const selections = source.getElementsByTagName('PlainTextSelection');
    expect(selections.length).toBe(1);
    const sel = selections.item(0);
    if (!sel) throw new Error('PlainTextSelection missing');
    expect(sel.getAttribute('startPosition')).toBe('0');
    expect(sel.getAttribute('endPosition')).toBe('5');
    const codings = sel.getElementsByTagName('Coding');
    expect(codings.length).toBe(1);
    const coding = codings.item(0);
    if (!coding) throw new Error('Coding missing');
    // UUID v4: 8-4-4-4-12 hex, with 4 as first nibble of the third group
    expect(coding.getAttribute('guid')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const codeRef = coding.getElementsByTagName('CodeRef')[0];
    if (!codeRef) throw new Error('CodeRef missing');
    expect(codeRef.getAttribute('targetGUID')).toBe('code-1');
  });

  it('colorToArgb fallback returns indigo when hex has no leading #', async () => {
    // End-to-end check: pass a code with a no-`#` colour string and confirm
    // the resulting XML has `#FF6366F1` (the QdpxExporter fallback) instead
    // of an attribute error or a malformed `<Code color="6366f1">`.
    const payload = buildSyntheticPayload();
    // Override the existing code colour: pass '6366f1' with NO leading #.
    payload.codes[0]!.color = '6366f1';
    const plugin = exporterRegistry.get('qdpx')!;
    const data = await plugin.export(payload);
    const zip = await JSZip.loadAsync(data);
    const xml = await zip.file('project.qde')!.async('string');
    // The fallback path emits `#FF6366F1` (full opacity + indigo).
    expect(xml).toMatch(/color="#FF6366F1"/);
    // Sanity: no bare `6366f1` value slipped through (would mean the bug
    // was reintroduced where the fallback step was skipped).
    expect(xml).not.toMatch(/color="6366f1"/);
  });

  it('handles a project with zero documents + zero codes (still has project.qde)', async () => {
    const payload = buildSyntheticPayload();
    const data = await exporterRegistry.get('qdpx')!.export({
      ...payload,
      documents: [],
      annotations: [],
      codes: [],
    });
    const zip = await JSZip.loadAsync(data);
    expect(zip.file('project.qde')).not.toBeNull();
    // We assert what we'd be willing to find, not what must be absent
    // (JSZip does not formally guarantee an empty Sources/ folder is
    // dropped; either way, no Sources/<id>.txt file should exist).
    expect(zip.file('Sources/doc-1.txt')).toBeNull();
  });
});
