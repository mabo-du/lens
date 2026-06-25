/**
 * Audio IPC — v2+ scaffold stubs.
 *
 * The media machinery runs through `tauri-plugin-shell` invoking the
 * whisper.cpp sidecar (built by `scripts/build-sidecar.sh`) and the
 * Rust-side parser writes rows into the `transcript_segment` table.
 * v0.2 ships the typed surface so the Kova + WaveSurfer wiring team
 * can plug in their components without redoing this contract.
 */
import { invoke } from '@tauri-apps/api/core';

export interface MediaSegment {
  id: string;
  documentId: string;
  startMs: number;
  endMs: number;
  codeId: string | null;
  memo: string | null;
  createdBy: string;
}

export interface TranscriptLine {
  id: string;
  documentId: string;
  text: string;
  startMs: number;
  endMs: number;
  charOffset: number;
}

export const audioIpc = {
  async mediaSegments(documentId: string): Promise<MediaSegment[]> {
    try {
      return await invoke<MediaSegment[]>('audio_media_segments', { documentId });
    } catch (e) {
      console.warn('[audio] media_segments unavailable', e);
      return [];
    }
  },
  async transcript(documentId: string): Promise<TranscriptLine[]> {
    try {
      return await invoke<TranscriptLine[]>('audio_transcript', { documentId });
    } catch (e) {
      console.warn('[audio] transcript unavailable', e);
      return [];
    }
  },
};
