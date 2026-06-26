/**
 * AudioWaveform — v2+ scaffold for wavesurfer.js-backed waveform display.
 *
 * Wraps wavesurfer.js 7.x in a React component that owns the waveform
 * instance lifecycle. The v0.2.x placeholder renders a "coming soon"
 * state with the dependency loaded; v2 wiring will:
 *
 *  1. Accept a blob/URL from the Rust asset system.
 *  2. Call `wavesurfer.load(url)` to render the waveform.
 *  3. Emit `region-created` / `region-clicked` events for time-range
 *     selection → media_selection row creation.
 *  4. Sync playhead with `useTranscriptIndex` for click-to-seek.
 *
 * This component intentionally does NOT mount wavesurfer in the
 * placeholder state — it only imports the library so tree-shaking
 * and bundle analysis stay honest.
 */
import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
// v0.2.3 followup: switch to the canonical public-dist alias
// `wavesurfer.js/plugins/regions`. The previous hardcoded
// `dist/plugins/regions.esm.js` path is internal — it's the plugin
// entry ON DISK, not the package.json-`exports`-declared alias.
// `wavesurfer.js/plugins/regions` resolves to the same ESM file via
// the `./plugins/*` mapping in wavesurfer.js's `exports`, so
// consumers like bundler fingerprinting and tree-shaking stay
// stable across wavesurfer point releases (an ESM wholesale re-pack
// would not change this path even if the dist layout shifted).
import RegionsPlugin from 'wavesurfer.js/plugins/regions';
import { Activity } from 'lucide-react';

export interface AudioWaveformProps {
  /** Audio source URL (blob: or asset: — wired by v2 Rust IPC). */
  src?: string;
  /** Called when the user selects a time range on the waveform.
   *  The parent wires this to `audioIpc.mediaSelectionCreate(documentId, codeId, startMs, endMs)`
   *  to persist the media_selection row. */
  onRegionCreated?: (startMs: number, endMs: number) => void;
  /** External playhead position for transcript sync (ms). */
  playheadMs?: number;
  /** Whether the audio is currently playing. */
  playing?: boolean;
}

export function AudioWaveform({ src, onRegionCreated, playheadMs, playing }: AudioWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [ready, setReady] = useState(false);

  // Mount wavesurfer when we have a container and a source.
  useEffect(() => {
    if (!containerRef.current || !src) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#94a3b8',
      progressColor: '#4f46e5',
      cursorColor: '#ef4444',
      cursorWidth: 1,
      height: 80,
      normalize: true,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
    });

    // Register regions plugin for time-range selection.
    const wsRegions = ws.registerPlugin(RegionsPlugin.create());
    wsRegions.on('region-created', (region) => {
      onRegionCreated?.(Math.round(region.start * 1000), Math.round(region.end * 1000));
    });

    ws.on('ready', () => setReady(true));
    ws.on('decode', () => setReady(false));

    ws.load(src);
    wsRef.current = ws;

    return () => {
      ws.destroy();
      wsRef.current = null;
      setReady(false);
    };
  }, [src]);

  // Sync play/pause from external state.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !ready) return;
    if (playing) ws.play();
    else ws.pause();
  }, [playing, ready]);

  // Sync external playhead.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !ready || playheadMs === undefined) return;
    ws.setTime(playheadMs / 1000);
  }, [playheadMs, ready]);

  // Placeholder when no source is loaded.
  if (!src) {
    return (
      <div className="flex h-20 items-center justify-center bg-slate-50 rounded border border-slate-200 text-slate-400">
        <div className="text-center">
          <Activity className="w-6 h-6 mx-auto mb-1 text-slate-300" />
          <p className="text-xs">Waveform — load an audio document to activate.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border border-slate-200 overflow-hidden bg-white">
      <div ref={containerRef} className="w-full" />
      {!ready && (
        <div className="flex items-center justify-center h-20 bg-slate-50 text-xs text-slate-400">
          Decoding audio…
        </div>
      )}
    </div>
  );
}
