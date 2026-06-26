/**
 * Vitest coverage for `src/hooks/useTranscriptIndex.ts`.
 *
 * Tests the pure helpers `buildTranscriptIndex`, `findWordAtTime`,
 * and `findWordsInTimeRange` independently. The React hook delegates
 * to these, so covering the math covers the hook.
 */

import { describe, expect, it } from 'vitest';
import {
  buildTranscriptIndex,
  findWordAtTime,
  findWordsInTimeRange,
} from './useTranscriptIndex';
import type { TranscriptLine } from '@/ipc/audio';

/** Compact TranscriptLine builder. */
const line = (
  partial: Partial<TranscriptLine> = {},
): TranscriptLine => ({
  id: partial.id ?? 'seg-1',
  documentId: partial.documentId ?? 'd1',
  text: partial.text ?? 'word',
  startMs: partial.startMs ?? 0,
  endMs: partial.endMs ?? 100,
  charOffset: partial.charOffset ?? 0,
});

describe('buildTranscriptIndex', () => {
  it('returns empty arrays for empty input', () => {
    const idx = buildTranscriptIndex([]);
    expect(idx.startMsArray).toEqual([]);
    expect(idx.lines).toEqual([]);
  });

  it('builds an O(n) index from sorted lines', () => {
    const lines = [
      line({ startMs: 0, endMs: 100, text: 'a' }),
      line({ startMs: 150, endMs: 250, text: 'b' }),
      line({ startMs: 300, endMs: 400, text: 'c' }),
    ];
    const idx = buildTranscriptIndex(lines);
    expect(idx.startMsArray).toEqual([0, 150, 300]);
    expect(idx.lines).toBe(lines);
  });

  it('is a pure function (same input → same output)', () => {
    const lines = [line({ startMs: 0 })];
    expect(buildTranscriptIndex(lines)).toEqual(buildTranscriptIndex(lines));
  });

  it('preserves 1:1 alignment between startMsArray and lines', () => {
    const lines = [
      line({ startMs: 10, endMs: 50, text: 'hello' }),
      line({ startMs: 60, endMs: 120, text: 'world' }),
    ];
    const idx = buildTranscriptIndex(lines);
    expect(idx.startMsArray).toHaveLength(2);
    expect(idx.lines[0].startMs).toBe(idx.startMsArray[0]);
    expect(idx.lines[1].startMs).toBe(idx.startMsArray[1]);
  });
});

describe('findWordAtTime', () => {
  const idx = buildTranscriptIndex([
    line({ startMs: 0, endMs: 200, text: 'Hello' }),
    line({ startMs: 250, endMs: 450, text: 'world' }),
    line({ startMs: 500, endMs: 800, text: 'this' }),
    line({ startMs: 850, endMs: 1100, text: 'is' }),
    line({ startMs: 1200, endMs: 1500, text: 'LENS' }),
  ]);

  it('returns null on an empty index', () => {
    expect(findWordAtTime(buildTranscriptIndex([]), 100)).toBeNull();
  });

  it('returns null when timeMs is before the first word', () => {
    expect(findWordAtTime(idx, -50)).toBeNull();
  });

  it('finds the correct word at a given timestamp', () => {
    const found = findWordAtTime(idx, 260);
    expect(found).not.toBeNull();
    expect(found!.text).toBe('world');
  });

  it('finds the word at the start boundary (inclusive)', () => {
    const found = findWordAtTime(idx, 0);
    expect(found).not.toBeNull();
    expect(found!.text).toBe('Hello');
  });

  it('finds the word at the end boundary (inclusive)', () => {
    const found = findWordAtTime(idx, 200);
    expect(found).not.toBeNull();
    expect(found!.text).toBe('Hello');
  });

  it('returns null for a time between two words', () => {
    expect(findWordAtTime(idx, 230)).toBeNull();
  });

  it('finds the last word in the transcript', () => {
    const found = findWordAtTime(idx, 1300);
    expect(found).not.toBeNull();
    expect(found!.text).toBe('LENS');
  });

  it('returns null when timeMs is after the last word', () => {
    expect(findWordAtTime(idx, 9999)).toBeNull();
  });

  it('behaves correctly for a single-word transcript', () => {
    const single = buildTranscriptIndex([line({ startMs: 0, endMs: 500 })]);
    expect(findWordAtTime(single, 0)?.text).toBe('word');
    expect(findWordAtTime(single, 250)?.text).toBe('word');
    expect(findWordAtTime(single, 500)?.text).toBe('word');
    expect(findWordAtTime(single, 501)).toBeNull();
    expect(findWordAtTime(single, -1)).toBeNull();
  });
});

describe('findWordsInTimeRange', () => {
  const idx = buildTranscriptIndex([
    line({ startMs: 0, endMs: 200, text: 'A' }),
    line({ startMs: 250, endMs: 450, text: 'B' }),
    line({ startMs: 500, endMs: 800, text: 'C' }),
    line({ startMs: 850, endMs: 1100, text: 'D' }),
    line({ startMs: 1200, endMs: 1500, text: 'E' }),
  ]);

  it('returns empty for empty index', () => {
    expect(findWordsInTimeRange(buildTranscriptIndex([]), 0, 100)).toEqual([]);
  });

  it('returns empty when endMs <= startMs', () => {
    expect(findWordsInTimeRange(idx, 100, 100)).toEqual([]);
    expect(findWordsInTimeRange(idx, 200, 100)).toEqual([]);
  });

  it('returns empty when the range is entirely before the first word', () => {
    expect(findWordsInTimeRange(idx, -100, -50)).toEqual([]);
  });

  it('returns empty when the range is entirely after the last word', () => {
    expect(findWordsInTimeRange(idx, 2000, 3000)).toEqual([]);
  });

  it('returns words that overlap the range (interval overlap)', () => {
    // A [0,200] overlaps at the boundary, B and C fully inside, D [850,1100] partial.
    const found = findWordsInTimeRange(idx, 200, 900);
    expect(found.map((l) => l.text)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('returns words that overlap a range starting at the head', () => {
    // C's endMs=800 overlaps range [0,500] (partial overlap at the tail).
    const found = findWordsInTimeRange(idx, 0, 500);
    expect(found.map((l) => l.text)).toEqual(['A', 'B', 'C']);
  });

  it('returns words that overlap a range ending at the tail', () => {
    // B's [250,450] overlaps range [400,1500] (partial overlap at the head).
    const found = findWordsInTimeRange(idx, 400, 1500);
    expect(found.map((l) => l.text)).toEqual(['B', 'C', 'D', 'E']);
  });

  it('returns a single word for a narrow range inside one word', () => {
    // Range [510,520] overlaps C [500,800] — C contains the range.
    const found = findWordsInTimeRange(idx, 510, 520);
    expect(found.map((l) => l.text)).toEqual(['C']);
  });

  it('returns empty when the range falls in a gap between words', () => {
    expect(findWordsInTimeRange(idx, 220, 240)).toEqual([]);
  });

  it('handles range that spans the full transcript', () => {
    const found = findWordsInTimeRange(idx, 0, 2000);
    expect(found.map((l) => l.text)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('works on a single-word transcript', () => {
    const single = buildTranscriptIndex([line({ startMs: 0, endMs: 500 })]);
    expect(findWordsInTimeRange(single, 0, 500).map((l) => l.text)).toEqual([
      'word',
    ]);
    expect(findWordsInTimeRange(single, 200, 300).map((l) => l.text)).toEqual([
      'word',
    ]);
  });
});
