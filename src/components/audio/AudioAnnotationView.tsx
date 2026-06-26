/**
 * AudioAnnotationView — v2+ component combining waveform, transcript, and code assignment.
 *
 * Layout (top to bottom):
 *   1. Toolbar: code picker dropdown + "assign" status
 *   2. AudioWaveform (wavesurfer.js 7.x) with region-based time-range selection
 *   3. Transcript viewer (word lines with click-to-seek)
 *
 * Wiring:
 *   - When the user drags a region on the waveform, `onRegionCreated` fires
 *     and calls `audioIpc.mediaSelectionCreate()` with the selected code.
 *   - Clicking a transcript line sets the waveform playhead to that timestamp.
 *   - Media segments (existing annotations) render as colored bars on the waveform.
 */
import { useCallback, useEffect, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { audioIpc, type MediaSegment, type TranscriptLine } from '@/ipc/audio';
import { useAssetBlobUrl } from '@/hooks/useAssetBlobUrl';
import { AudioWaveform } from './AudioWaveform';
import { InlineCodePicker } from '@/components/ui/InlineCodePicker';
import { Music2, Mic, Plus } from 'lucide-react';

interface AudioAnnotationViewProps {
  documentId: string;
  /** Top-level codes available for assignment. */
  codes: { id: string; name: string; color: string }[];
}

export function AudioAnnotationView({ documentId, codes }: AudioAnnotationViewProps) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const [segments, setSegments] = useState<MediaSegment[]>([]);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [selectedCodeId, setSelectedCodeId] = useState<string>(codes[0]?.id ?? '');
  const [playheadMs, setPlayheadMs] = useState<number>(0);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const audioSrc = useAssetBlobUrl(activeProject ? documentId : undefined);

  // Load media segments and transcript on mount / project change.
  useEffect(() => {
    if (!activeProject) return;
    let cancelled = false;

    audioIpc.mediaSegments(documentId).then((r) => { if (!cancelled) setSegments(r); }).catch(() => {});
    audioIpc.transcript(documentId).then((r) => { if (!cancelled) setTranscript(r); }).catch(() => {});

    return () => { cancelled = true; };
  }, [documentId, activeProject?.id]);

  // Called when the user drags a region on the waveform.
  const handleRegionCreated = useCallback(
    (startMs: number, endMs: number) => {
      if (!selectedCodeId) {
        setStatus('Select a code first');
        return;
      }
      setStatus('Creating…');
      audioIpc
        .mediaSelectionCreate(documentId, selectedCodeId, startMs, endMs)
        .then((seg) => {
          setSegments((prev) => [...prev, seg]);
          setStatus(`Assigned "${codes.find((c) => c.id === selectedCodeId)?.name ?? selectedCodeId}" at ${formatTime(startMs)}–${formatTime(endMs)}`);
          setTimeout(() => setStatus(null), 3000);
        })
        .catch((e) => {
          setStatus(`Error: ${String(e)}`);
        });
    },
    [documentId, selectedCodeId, codes],
  );

  // Click-to-seek: clicking a transcript line sets the playhead.
  const handleTranscriptClick = useCallback((line: TranscriptLine) => {
    setPlayheadMs(line.startMs);
    setPlaying(false);
  }, []);

  if (!activeProject) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 text-slate-400">
        <div className="text-center">
          <Music2 className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p className="text-sm">Open a project to annotate audio.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Toolbar */}
      <header className="px-4 py-2 border-b border-slate-200 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-blue-500" />
          <h2 className="text-sm font-semibold text-slate-700">Audio Annotation</h2>
        </div>

        <div className="flex items-center gap-2">
          <InlineCodePicker
            codes={codes}
            selectedCodeId={selectedCodeId}
            onSelect={setSelectedCodeId}
          />

          {segments.length > 0 && (
            <span className="text-xs text-slate-400">
              {segments.length} segment{segments.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </header>

      {/* Waveform */}
      <div className="px-4 pt-3">
        <AudioWaveform
          src={audioSrc}
          onRegionCreated={handleRegionCreated}
          playheadMs={playheadMs}
          playing={playing}
        />
      </div>

      {/* Status toast */}
      {status && (
        <div className="mx-4 mt-2 px-3 py-1.5 rounded bg-blue-50 text-blue-700 text-xs flex items-center gap-1">
          <Plus className="w-3 h-3" />
          {status}
        </div>
      )}

      {/* Segments bar */}
      {segments.length > 0 && (
        <div className="px-4 pt-2 flex flex-wrap gap-1">
          {segments.map((seg) => {
            const code = codes.find((c) => c.id === seg.codeId);
            return (
              <span
                key={seg.id}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]"
                style={{
                  backgroundColor: code?.color ? `${code.color}20` : '#f1f5f9',
                  color: code?.color ?? '#64748b',
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full inline-block"
                  style={{ backgroundColor: code?.color ?? '#94a3b8' }}
                />
                {code?.name ?? seg.codeId ?? 'unnamed'}: {formatTime(seg.startMs)}–{formatTime(seg.endMs)}
              </span>
            );
          })}
        </div>
      )}

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
        {transcript.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-xs text-slate-400">
            No transcript yet. Import an audio document with a Whisper transcript to populate.
          </div>
        ) : (
          transcript.map((line) => {
            const isActive = line.startMs <= playheadMs && line.endMs > playheadMs;
            return (
              <p
                key={line.id}
                onClick={() => handleTranscriptClick(line)}
                className={`text-xs leading-relaxed cursor-pointer rounded px-1 py-0.5 transition-colors ${
                  isActive ? 'bg-indigo-100 text-indigo-800' : 'hover:bg-slate-100 text-slate-700'
                }`}
                data-ms={`${line.startMs}-${line.endMs}`}
              >
                <span className="text-slate-400 mr-1.5 tabular-nums font-mono text-[10px]">
                  {formatTime(line.startMs)}
                </span>
                {line.text}
              </p>
            );
          })
        )}
      </div>
    </div>
  );
}

// Shared time formatter (mirrors WhisperTranscriptViewer).
function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${pad(minutes)}:${pad(remainder)}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
