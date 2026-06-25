/**
 * Media (audio/video) annotation — v2+ scaffold.
 *
 * The MVP for v0.2 ships no audio/video support but lays down the
 * integration surface so v2 can wire Konva + WaveSurfer.js against
 * the same components without redoing the IPC schema.
 *
 * Wireable in v2:
 *  - WaveSurfer.js + WebVTT/SRT → transcript_segment rows.
 *  - For documents with linked transcripts, click a media range →
 *    highlight the matching text span.
 *  - Audio-visual waveform region picker + Ctrl+K code assignment.
 *
 * This scaffold also exports the `media_selection` row shape so the
 * Rust side can ship migrations and storage without depending on the
 * renderer being complete.
 */
import { useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { audioIpc, MediaSegment, TranscriptLine } from '@/ipc/audio';
import { Music2, Mic, Sparkles } from 'lucide-react';

interface AudioViewerProps {
  documentId: string;
}

/**
 * Surface a "coming-soon" placeholder while exposing enough state hooks
 * that the v2 wiring team can drop in the WaveSurfer component without
 * touching call-sites.
 */
export function AudioViewer({ documentId }: AudioViewerProps) {
  const mediaSegments = useMediaSegments(documentId);
  const transcript = useTranscriptLines(documentId);
  const [activeRange, setActiveRange] = useState<[number, number] | null>(null);

  if (mediaSegments.length === 0 && transcript.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 text-slate-400">
        <div className="text-center max-w-sm">
          <Music2 className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p className="text-sm">
            Audio and video annotation is a v2+ feature. Once a media document is imported,
            the waveform and transcript will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <header className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-blue-500" />
          <h2 className="text-xl font-semibold text-slate-800">Audio Transcript</h2>
        </div>
        <span className="text-xs text-slate-400 inline-flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> v2 preview
        </span>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
        {transcript.map((line) => {
          const inside =
            activeRange && line.startMs >= activeRange[0] && line.endMs <= activeRange[1];
          return (
            <p
              key={line.id}
              onClick={() => setActiveRange([line.startMs, line.endMs])}
              className={`text-sm leading-relaxed cursor-pointer rounded px-1 ${
                inside ? 'bg-blue-100' : 'hover:bg-slate-100'
              }`}
              data-ms={`${line.startMs}-${line.endMs}`}
              data-char-offset={line.charOffset}
            >
              <span className="text-slate-400 mr-2 tabular-nums">
                {formatTime(line.startMs)}
              </span>
              {line.text}
            </p>
          );
        })}
      </div>

      {activeRange && (
        <footer className="px-6 py-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-600">
          Range selected: {formatTime(activeRange[0])} → {formatTime(activeRange[1])}.
          {' '}
          <button
            type="button"
            onClick={() => setActiveRange(null)}
            className="underline ml-2"
          >
            Clear
          </button>
        </footer>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hooks / helpers — encapsulate the IPC contract so v2 wiring can swap
// implementations without prop-drilling changes.
// ---------------------------------------------------------------------------

function useMediaSegments(documentId: string): MediaSegment[] {
  const [rows, setRows] = useState<MediaSegment[]>([]);
  useEffect(() => {
    let cancelled = false;
    audioIpc
      .mediaSegments(documentId)
      .then((r) => !cancelled && setRows(r))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [documentId]);
  return rows;
}

function useTranscriptLines(documentId: string): TranscriptLine[] {
  const project = useProjectStore((s) => s.activeProject);
  const [rows, setRows] = useState<TranscriptLine[]>([]);
  useEffect(() => {
    if (!project) {
      setRows([]);
      return;
    }
    let cancelled = false;
    audioIpc
      .transcript(documentId)
      .then((r) => !cancelled && setRows(r))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [documentId, project?.id]);
  return useMemo(() => rows, [rows]);
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${pad(minutes)}:${pad(remainder)}`;
}
function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
