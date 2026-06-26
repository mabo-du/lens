/**
 * Transcribe IPC — v2+ transcription pipeline contracts.
 *
 * Mirrors the two-channel async streaming pattern agreed in the
 * deep-research synthesis (SYNTHESIS.md, Phases 8b–8c):
 *
 *   1. `audio_transcribe_start` returns a `jobId` immediately.
 *   2. The sidecar emits `audio://job/{jobId}/progress`,
 *      `audio://job/{jobId}/done`, or `audio://job/{jobId}/error`
 *      events as newline-delimited JSON on stdout.
 *
 * The Rust side (`src-tauri/src/commands/audio.rs`) will grow write
 * commands (`audio_transcribe_start`) and the sidecar envelope parser
 * in Phase 8b. This module is the renderer-side typed listener surface,
 * ready for the `<TranscribeProgress>` UI to plug into.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

/** Sent by the renderer to kick off a transcription job. */
export interface TranscribeStartPayload {
  documentId: string;
  model?: string; // "tiny" | "base" | "small" | "medium" | "large"
  language?: string; // "en" | "es" | "fr" | "ar" | "pt"
}

/** Streamed by the sidecar to report incremental progress. */
export interface TranscribeProgressPayload {
  jobId: string;
  /** 0–100 (float, may be fractional) */
  pct: number;
  /** Estimated milliseconds remaining, or null if unknown. */
  etaMs: number | null;
  /** Partial transcript text accumulated so far (may be incomplete). */
  partialText?: string;
}

/** Emitted by the sidecar on successful completion. */
export interface TranscribeDonePayload {
  jobId: string;
  // v0.2.3 followup: align `transcriptSegments` row shape with the
  // canonical `TranscriptLine` from `@/ipc/audio` (which carries a
  // `text` field). The v0.2.2 draft used `word` here, which drifted
  // from `TranscriptLine.text` and would have caused
  // `findWordAtTime` (from `useTranscriptIndex`) to read `.text =
  // undefined` once the v2 whisper.cpp sidecar started emitting real
  // transcripts. Each segment is a sentence-/line-level window rather
  // than a per-word token; downstream code already keys on `.text`.
  transcriptSegments: Array<{
    text: string;
    startMs: number;
    endMs: number;
    charOffset: number;
  }>;
  plainText: string;
  wordCount: number;
}

/** Emitted by the sidecar (or caught from subprocess stderr) on failure. */
export interface TranscribeErrorPayload {
  jobId: string;
  error: string;
}

/** Returned synchronously by `audio_transcribe_start`. */
export interface TranscribeStartResult {
  jobId: string;
}

// ---------------------------------------------------------------------------
// Event-channel contract
// ---------------------------------------------------------------------------

/** The event channel prefix shared by all transcription events. */
const channel = (jobId: string, event: string): string =>
  `audio://job/${jobId}/${event}`;

export const transcribeIpc = {
  /**
   * Listen for transcription progress events.
   *
   * Returns an `UnlistenFn` — call it in a `useEffect` cleanup or
   * store it in a ref to unsubscribe when the job completes.
   *
   * @example
   *   useEffect(() => {
   *     const unlisten = transcribeIpc.onProgress(jobId, (p) => {
   *       setProgress(p.pct);
   *     });
   *     return () => { unlisten.then(fn => fn()); };
   *   }, [jobId]);
   */
  onProgress(
    jobId: string,
    callback: (payload: TranscribeProgressPayload) => void,
  ): Promise<UnlistenFn> {
    return listen<TranscribeProgressPayload>(
      channel(jobId, 'progress'),
      (event) => callback(event.payload),
    );
  },

  /**
   * Listen for the final `done` event.
   *
   * The consumer should persist `transcriptSegments` + `plainText`
   * to the database and update the player UI to show the full transcript.
   */
  onDone(
    jobId: string,
    callback: (payload: TranscribeDonePayload) => void,
  ): Promise<UnlistenFn> {
    return listen<TranscribeDonePayload>(
      channel(jobId, 'done'),
      (event) => callback(event.payload),
    );
  },

  /**
   * Listen for transcription errors.
   *
   * The consumer should surface a toast (symmetrical to the existing
   * pdfplumber "sidecar not found" toast) and abort the job UI.
   */
  onError(
    jobId: string,
    callback: (payload: TranscribeErrorPayload) => void,
  ): Promise<UnlistenFn> {
    return listen<TranscribeErrorPayload>(
      channel(jobId, 'error'),
      (event) => callback(event.payload),
    );
  },
};
