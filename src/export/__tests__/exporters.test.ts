import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { QdpxExporter } from '../QdpxExporter';
import { QdcExporter } from '../QdcExporter';
import { CsvExporter } from '../CsvExporter';
import { HtmlReporter } from '../HtmlReporter';
import type { ExportPayload } from '../ExporterPlugin';

const mockPayload: ExportPayload = {
  project: {
    id: 'p1',
    name: 'Test Project',
    description: '',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  projectFolderPath: '/tmp/test-project',
  localUser: { id: 'u1', displayName: 'Alice' },
  documents: [
    {
      id: 'd1',
      projectId: 'p1',
      title: 'Doc One',
      originalPath: null,
      fileFormat: 'txt',
      plainText: 'Hello world, this is a test document for export.',
      textHash: 'hash-d1',
      extractorId: 'txt',
      wordCount: 9,
      intrinsicW: null,
      intrinsicH: null,
      importedAt: '2024-01-01T00:00:00Z',
      sortOrder: 0,
    },
    {
      id: 'd2',
      projectId: 'p1',
      title: 'Doc Two',
      originalPath: '/tmp/test-project/assets/d2.pdf',
      fileFormat: 'pdf',
      plainText: 'Second document with different format.',
      textHash: 'hash-d2',
      extractorId: 'pdf',
      wordCount: 5,
      intrinsicW: null,
      intrinsicH: null,
      importedAt: '2024-01-02T00:00:00Z',
      sortOrder: 1,
    },
  ],
  codes: [
    {
      id: 'c1',
      projectId: 'p1',
      name: 'Code A',
      color: '#ff0000',
      description: 'First code',
      createdAt: '2024-01-01T00:00:00Z',
      depth: 0,
      children: [
        {
          id: 'c2',
          projectId: 'p1',
          name: 'Code A.1',
          color: '#00ff00',
          description: null,
          createdAt: '2024-01-01T00:00:00Z',
          depth: 1,
          children: [],
        },
      ],
    },
    {
      id: 'c3',
      projectId: 'p1',
      name: 'Code B',
      color: '#0000ff',
      description: null,
      createdAt: '2024-01-01T00:00:00Z',
      depth: 0,
      children: [],
    },
  ],
  annotations: [
    {
      id: 'a1',
      documentId: 'd1',
      codeId: 'c1',
      startChar: 0,
      endChar: 5,
      createdBy: 'u1',
      createdAt: '2024-01-02T00:00:00Z',
    },
    {
      id: 'a2',
      documentId: 'd1',
      codeId: 'c3',
      startChar: 13,
      endChar: 17,
      createdBy: 'u1',
      createdAt: '2024-01-02T00:00:00Z',
    },
  ],
  memos: [
    {
      id: 'm1',
      projectId: 'p1',
      linkedCodeId: null,
      linkedSelectionId: 'a1',
      body: 'A memo about the first annotation',
      createdBy: 'u1',
      createdAt: '2024-01-03T00:00:00Z',
      updatedAt: '2024-01-03T00:00:00Z',
    },
  ],
};

describe('Exporters', () => {
  describe('QdpxExporter (REFI-QDA Project)', () => {
    it('produces a valid zip with project.qde and sources folder', async () => {
      const result = await QdpxExporter.export(mockPayload);
      expect(result).toBeInstanceOf(Uint8Array);

      const zip = await JSZip.loadAsync(result as Uint8Array);
      expect(zip.file('project.qde')).toBeDefined();
      expect(zip.file('Sources/d1.txt')).toBeDefined();
      expect(zip.file('Sources/d2.txt')).toBeDefined();
    });

    it('project.qde xml contains project name, users, codes (including nested), and annotations', async () => {
      const result = await QdpxExporter.export(mockPayload);
      const zip = await JSZip.loadAsync(result as Uint8Array);
      const xml = await zip.file('project.qde')!.async('string');

      expect(xml).toContain('name="Test Project"');
      expect(xml).toContain('xmlns="urn:QDA-XML:project:1.0"');
      expect(xml).toContain('<User');
      expect(xml).toContain('name="Alice"');
      // Top-level code
      expect(xml).toContain('name="Code A"');
      // Nested code (Code A.1)
      expect(xml).toContain('name="Code A.1"');
      expect(xml).toContain('name="Code B"');
      // Annotations
      expect(xml).toContain('startPosition="0"');
      expect(xml).toContain('endPosition="5"');
      expect(xml).toContain('startPosition="13"');
      expect(xml).toContain('endPosition="17"');
    });

    it('embeds normalized plain text in Sources for each document', async () => {
      const result = await QdpxExporter.export(mockPayload);
      const zip = await JSZip.loadAsync(result as Uint8Array);
      const txt = await zip.file('Sources/d1.txt')!.async('string');
      expect(txt).toBe('Hello world, this is a test document for export.');
    });
  });

  describe('QdcExporter (REFI-QDA Codebook)', () => {
    it('produces a valid xml string', async () => {
      const result = await QdcExporter.export(mockPayload);
      expect(typeof result).toBe('string');

      const xml = result as string;
      expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
      expect(xml).toContain('<CodeBook');
      expect(xml).toContain('xmlns="urn:QDA-XML:codebook:1.0"');
    });

    it('flattens nested codes with their parent-child structure', async () => {
      const xml = (await QdcExporter.export(mockPayload)) as string;

      // All three codes should appear in the codebook
      expect(xml).toContain('name="Code A"');
      expect(xml).toContain('name="Code A.1"');
      expect(xml).toContain('name="Code B"');

      // Code A.1 should be nested inside Code A
      const codeAIdx = xml.indexOf('name="Code A"');
      const codeA1Idx = xml.indexOf('name="Code A.1"');
      const codeBIdx = xml.indexOf('name="Code B"');
      expect(codeAIdx).toBeLessThan(codeA1Idx);
      // Code B is at top level, not inside Code A
      expect(codeA1Idx).toBeLessThan(codeBIdx);
    });

    it('converts hex colors to #AARRGGBB ARGB format', async () => {
      const xml = (await QdcExporter.export(mockPayload)) as string;
      // Our #ff0000 → #FFFF0000
      expect(xml).toContain('#FFFF0000');
      expect(xml).toContain('#FF00FF00');
      expect(xml).toContain('#FF0000FF');
    });
  });

  describe('CsvExporter (Annotations)', () => {
    it('produces a CSV with the expected header row', async () => {
      const csv = (await CsvExporter.export(mockPayload)) as string;
      const headerLine = csv.split('\n')[0];
      expect(headerLine).toBe(
        'Document,Code,Code ID,Start Char,End Char,Memo,Text Segment',
      );
    });

    it('maps annotation startChar/endChar to code names and document titles', async () => {
      const csv = (await CsvExporter.export(mockPayload)) as string;
      const lines = csv.split('\n');

      // Annotation a1: d1, c1 (Code A), 0-5, memo "A memo...", segment "Hello"
      expect(lines[1]).toBe(
        'Doc One,Code A,c1,0,5,A memo about the first annotation,Hello',
      );
      // Annotation a2: d1, c3 (Code B), 13-17, segment "this"
      // "this" has no CSV-special chars so it appears unquoted.
      expect(lines[2]).toBe('Doc One,Code B,c3,13,17,,this');
    });

    it('escapes commas, quotes, and newlines in fields', async () => {
      const trickyPayload: ExportPayload = {
        ...mockPayload,
        documents: [
          {
            ...mockPayload.documents[0],
            // Nine characters: A , B , " C " \n D
            plainText: 'A,B,"C"\nD',
          },
        ],
        annotations: [
          {
            id: 'aX',
            documentId: 'd1',
            codeId: 'c1',
            startChar: 0,
            endChar: 9, // entire plainText
            createdBy: 'u1',
            createdAt: '2024-01-02T00:00:00Z',
          },
        ],
        memos: [],
      };
      const csv = (await CsvExporter.export(trickyPayload)) as string;
      // Segment contains comma + quotes + newline → wrapped in quotes,
      // internal quotes doubled. The segment literal maps to:
      //   A,B,"C"\nD  →  "A,B,""C""\nD"
      // (use a regex so we can represent the embedded \n unambiguously)
      expect(csv).toMatch(/"A,B,""C""\nD"/);
      // The full data row should end with the escaped segment.
      // CSV row format: Document,Code,Code ID,Start Char,End Char,Memo,Text Segment
      expect(csv).toMatch(/Doc One,Code A,c1,0,9,,"A,B,""C""\nD"/);
    });
  });

  describe('HtmlReporter (Printable Report)', () => {
    it('produces a complete HTML document with project title and date', async () => {
      const html = (await HtmlReporter.export(mockPayload)) as string;
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Project Report: Test Project');
      expect(html).toContain('Exported on');
    });

    it('includes a section per code (top-level) with content count', async () => {
      const html = (await HtmlReporter.export(mockPayload)) as string;
      expect(html).toMatch(/<h2[^>]*>Code A<\/h2>/);
      expect(html).toMatch(/<h2[^>]*>Code B<\/h2>/);
      // Code A has 1 annotation
      expect(html).toMatch(/Code A[\s\S]*?1 annotations/);
      // Code B has 1 annotation
      expect(html).toMatch(/Code B[\s\S]*?1 annotations/);
    });

    it('embeds annotation text segment and memo', async () => {
      const html = (await HtmlReporter.export(mockPayload)) as string;
      expect(html).toContain('Hello');
      expect(html).toContain('Doc One');
      expect(html).toContain('A memo about the first annotation');
    });
  });
});
