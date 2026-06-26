/**
 * useTranscriptIndex — V2+ transcript synchronisation hook.
 *
 * On document-open, the IPC returns `TranscriptLine[]` already ordered
 * by `start_ms`. This hook builds a flat index (`[startMs, ...]` aligned
 * 1:1 with the lines) and exposes O(log n) lookup helpers for the two
 * core sync contracts described in the LENS Audio Transcription research
 * reports (SYNTHESIS.md, Phase 8c).
 *
 *   1. Click-word-seeks-audio: `getWordAtTime(playheadMs)`.
 *   2. Select-time-highlights-transcript:
 *      `getWordsInTimeRange(selectionStartMs, selectionEndMs)`.
 *
 * Memory budget: ~2 MB per open transcript at 50k words (32 bytes/row).
 * No library dependencies — plain binary search over `Float64Array`.
 */

import { useCallback, useMemo } from 'react';
import type { TranscriptLine } from '@/ipc/audio';

export interface TranscriptIndex {
  /** Sorted array of start-ms values (aligned 1:1 with `lines`). */
  startMsArray: number[];
  /** The transcript lines, ordered by start_ms ascending. */
  lines: TranscriptLine[];
}

/**
 * Build an index from IPA-returned transcript lines.
 *
 * The IPC already returns `TranscriptLine[]` sorted by `start_ms`, so
 * this is a simple O(n) scan — no sort needed.
 */
export function buildTranscriptIndex(
  lines: TranscriptLine[],
): TranscriptIndex {
  return {
    startMsArray: lines.map((l) => l.startMs),
    lines,
  };
}

/**
 * Pure helper — returns the transcript line whose time window contains
 * `timeMs`, or `null` if no line covers that timestamp.
 *
 * Binary search on the `startMsArray`; O(log n).
 */
export function findWordAtTime(
  index: TranscriptIndex,
  timeMs: number,
): TranscriptLine | null {
  const { startMsArray, lines } = index;
  if (!startMsArray.length) return null;

  // Lower-bound: last segment where startMs <= timeMs
  let lo = 0;
  let hi = startMsArray.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (startMsArray[mid] <= timeMs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const candidate = lo - 1;
  if (candidate < 0) return null;

  const line = lines[candidate];
  return line.startMs <= timeMs && timeMs <= line.endMs ? line : null;
}

/**
 * Pure helper — returns all transcript lines whose time window
 * **overlaps** the interval [startMs, endMs] (standard interval
 * overlap: `word.startMs <= endMs AND word.endMs >= startMs`).
 *
 * This is the correct semantic for transcript-highlighting when a
 * user creates a media selection: any word whose time window
 * touches the selection should be highlighted.
 *
 * Dual binary search: find the first line whose `endMs >= startMs`,
 * then the last line whose `startMs <= endMs`. O(log n + k).
 */
export function findWordsInTimeRange(
  index: TranscriptIndex,
  startMs: number,
  endMs: number,
): TranscriptLine[] {
  const { lines } = index;
  if (!lines.length || endMs <= startMs) return [];

  // First line whose endMs >= rangeStart (overlap could start here).
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (lines[mid].endMs < startMs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const overlapStartIdx = lo;
  if (overlapStartIdx >= lines.length) return [];

  // Last line whose startMs <= rangeEnd (overlap could end here).
  lo = 0;
  hi = lines.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (lines[mid].startMs <= endMs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const overlapEndIdx = lo - 1;
  if (overlapEndIdx < overlapStartIdx) return [];

  return lines.slice(overlapStartIdx, overlapEndIdx + 1);
}

/**
 * React hook — memoizes the flat index and exposes the lookup helpers
 * with stable callback references.
 */
export function useTranscriptIndex(lines: TranscriptLine[]) {
  const index = useMemo(() => buildTranscriptIndex(lines), [lines]);

  const getWordAtTime = useCallback(
    (timeMs: number) => findWordAtTime(index, timeMs),
    [index],
  );

  const getWordsInTimeRange = useCallback(
    (startMs: number, endMs: number) =>
      findWordsInTimeRange(index, startMs, endMs),
    [index],
  );

  return { index, getWordAtTime, getWordsInTimeRange };
}
