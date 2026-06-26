import { describe, it, expect } from 'vitest';
import { computeDocsCoded } from './statusBarLogic';
import type { DocumentRecord } from '@/ipc/documents';
import type { AnnotationRecord } from '@/ipc/annotations';

function doc(id: string): DocumentRecord {
  return {
    id,
    projectId: 'p1',
    title: id,
    originalPath: null,
    fileFormat: 'txt',
    textHash: `hash-${id}`,
    extractorId: 'plain-text-1.0',
    wordCount: 100,
    intrinsicW: null,
    intrinsicH: null,
    importedAt: '2026-01-01T00:00:00Z',
    sortOrder: 0,
  };
}

function ann(documentId: string): AnnotationRecord {
  return {
    id: `ann-${documentId}`,
    documentId,
    codeId: 'c1',
    startChar: 0,
    endChar: 5,
    createdBy: 'mark',
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function anns(...docIds: string[]): AnnotationRecord[] {
  return docIds.map(ann);
}

function docs(...ids: string[]): DocumentRecord[] {
  return ids.map(doc);
}

describe('computeDocsCoded', () => {
  it('returns 0 when there are no annotations', () => {
    expect(computeDocsCoded(docs('d1', 'd2'), [])).toBe(0);
  });

  it('returns 0 when documents is empty', () => {
    expect(computeDocsCoded([], anns('d1'))).toBe(0);
  });

  it('counts distinct documents that have any annotation', () => {
    expect(
      computeDocsCoded(docs('d1', 'd2', 'd3'), anns('d1', 'd1', 'd2')),
    ).toBe(2);
  });

  it('returns total document count when every doc is annotated', () => {
    expect(
      computeDocsCoded(docs('d1', 'd2'), anns('d1', 'd2', 'd2')),
    ).toBe(2);
  });

  it('ignores annotation rows whose documentId is not in the documents list', () => {
    expect(computeDocsCoded(docs('d1'), anns('d1', 'd-ghost'))).toBe(1);
  });
});
