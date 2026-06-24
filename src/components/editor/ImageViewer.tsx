/**
 * ImageViewer — Konva-backed image annotation canvas (Phase C-2).
 *
 * Two drawing modes selectable from a top-left toolbar pill:
 *
 *   - **Rectangle** (default): drag-to-create bounding-box regions
 *     rendered as Konva `<Rect>` elements. Coordinates normalised to
 *     0..1 at the IPC boundary so REFI-QDA `AreaReference` export can
 *     consume them verbatim.
 *
 *   - **Polygon**: click-to-add-vertex drawing of free-form polygons
 *     rendered as Konva `<Line closed=true>` with code-coloured stroke
 *     and 0.2-alpha fill. Snap-to-close within 12px of vertex 0 is a
 *     visual aid (highlight ring + live-preview line stretches to v[0])
 *     but the close commit is explicit: right-click OR Enter, with Esc
 *     cancelling the in-flight draft.
 *
 * Both modes share the same code-picker toolbar (single active code for
 * the next create), the right-click polygon/bbox delete affordance on
 * persisted shapes, and the load-on-mount-plus-refresh IPC pattern.
 *
 * Out of scope for this slice: memo-on-region binding; performance
 * benchmarking under WSL / Raspberry Pi 4.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Line, Circle, Text } from 'react-konva';
import type Konva from 'konva';

import { documentsIpc, type DocumentRecord, type DocumentAsset } from '@/ipc/documents';
import { imageRegionsIpc, type ImageRegionRecord } from '@/ipc/image-regions';
import { imagePolygonsIpc, type ImagePolygonRecord } from '@/ipc/image-polygons';
import { type Code } from '@/ipc/codes';
import { useProjectStore } from '@/store/projectStore';
import { toast } from 'sonner';

type Mode = 'bbox' | 'polygon';

interface DraftRect {
  startX: number;
  startY: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Vertex {
  x: number; // pixel space
  y: number;
}

const MIN_DRAG_PX = 4; // suppress accidental drag-create on click (bbox mode)
const SNAP_RADIUS_PX = 12; // snap-to-close distance from vertex 0 (polygon mode)
const MIN_POLYGON_VERTICES = 3;

export function ImageViewer({ document }: { document: DocumentRecord }) {
  const codes = useProjectStore(s => s.codes);
  const {
    intrinsicW,
    intrinsicH,
    id: documentId,
    title,
  } = document;

  const intrinsicWNum = intrinsicW ?? 0;
  const intrinsicHNum = intrinsicH ?? 0;

  const [image, setImage] = useState<HTMLImageElement | null>(null);

  // BBox-mode state.
  const [regions, setRegions] = useState<ImageRegionRecord[]>([]);
  const [draftRect, setDraftRect] = useState<DraftRect | null>(null);

  // Polygon-mode state.
  const [polygons, setPolygons] = useState<ImagePolygonRecord[]>([]);
  const [draftVertices, setDraftVertices] = useState<Vertex[]>([]);
  const [cursorPos, setCursorPos] = useState<Vertex | null>(null);

  // Shared state.
  const [mode, setMode] = useState<Mode>('bbox');
  const [selectedCodeId, setSelectedCodeId] = useState<string | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);

  // 1. Load the bitmap.
  useEffect(() => {
    let cancelled = false;
    setImage(null);
    (async () => {
      try {
        const asset: DocumentAsset = await documentsIpc.getAsset(documentId);
        const dataUrl = `data:${asset.mime};base64,${asset.b64}`;
        const img = new window.Image();
        img.onload = () => {
          if (!cancelled) setImage(img);
        };
        img.onerror = () => {
          if (!cancelled) toast.error(`Failed to decode image asset for ${title}`);
        };
        img.src = dataUrl;
      } catch (e) {
        if (!cancelled) toast.error(`Failed to load image asset: ${String(e)}`);
      }
    })();
    return () => { cancelled = true; };
  }, [documentId, title]);

  // 2. Refresh lists whenever the document changes + after a create/delete.
  const refreshRegions = useCallback(async () => {
    try {
      const list = await imageRegionsIpc.listByDocument(documentId);
      setRegions(list);
    } catch (e) {
      toast.error(`Failed to list image regions: ${String(e)}`);
    }
  }, [documentId]);

  const refreshPolygons = useCallback(async () => {
    try {
      const list = await imagePolygonsIpc.listByDocument(documentId);
      setPolygons(list);
    } catch (e) {
      toast.error(`Failed to list image polygons: ${String(e)}`);
    }
  }, [documentId]);

  useEffect(() => {
    refreshRegions();
    refreshPolygons();
  }, [refreshRegions, refreshPolygons]);

  // 3. Build a code lookup for colour rendering.
  const codeById = useMemo(() => {
    const m = new Map<string, Code>();
    for (const c of codes) m.set(c.id, c);
    return m;
  }, [codes]);

  // Helper: get stage-local pointer position (consistent with the existing Stage size).
  const getStagePointer = (e: Konva.KonvaEventObject<PointerEvent>): Vertex | null => {
    const stage = e.target.getStage();
    if (!stage) return null;
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    return { x: pos.x, y: pos.y };
  };

  // 4a. Bbox-mode pointer handlers (drag-to-create).
  const handleBboxPointerDown = (pos: Vertex) => {
    setDraftRect({ startX: pos.x, startY: pos.y, x: pos.x, y: pos.y, w: 0, h: 0 });
  };

  const handleBboxPointerMove = (pos: Vertex) => {
    if (!draftRect) return;
    const x = Math.min(draftRect.startX, pos.x);
    const y = Math.min(draftRect.startY, pos.y);
    const w = Math.abs(pos.x - draftRect.startX);
    const h = Math.abs(pos.y - draftRect.startY);
    setDraftRect({ ...draftRect, x, y, w, h });
  };

  const handleBboxPointerUp = async () => {
    const draft = draftRect;
    setDraftRect(null);
    if (!draft || draft.w < MIN_DRAG_PX || draft.h < MIN_DRAG_PX) return;
    if (!selectedCodeId || intrinsicWNum <= 0 || intrinsicHNum <= 0) return;

    const bboxLeft = clampRatio(draft.x / intrinsicWNum);
    const bboxTop = clampRatio(draft.y / intrinsicHNum);
    const bboxRight = clampRatio((draft.x + draft.w) / intrinsicWNum);
    const bboxBottom = clampRatio((draft.y + draft.h) / intrinsicHNum);

    try {
      await imageRegionsIpc.create({
        documentId,
        codeId: selectedCodeId,
        bboxLeft,
        bboxTop,
        bboxRight,
        bboxBottom,
      });
      await refreshRegions();
    } catch (e) {
      toast.error(`Failed to save region: ${String(e)}`);
    }
  };

  // 4b. Polygon-mode pointer handlers (click-to-add-vertex).
  //   - Move: update cursor pos for live preview; no vertex added.
  //   - Down: push vertex at cursor pos (no drag concept in polygon mode).
  const handlePolygonPointerDown = (pos: Vertex) => {
    setDraftVertices(prev => [...prev, pos]);
    setCursorPos(pos);
  };

  const handlePolygonPointerMove = (pos: Vertex) => {
    setCursorPos(pos);
  };

  const handlePolygonPointerUp = () => {
    // Polygon mode does not consume pointerup — vertex placement happens on pointerdown.
  };

  // 5. Stage-level onContextMenu dispatch.
  //   - bbox mode: Stage ctxmenu is unused (per-region ctxmenu still works).
  //   - polygon mode: commit the in-flight draft (subject to vertex-count validation).
  // CRITICAL: in polygon mode the right-click target might be a *persisted*
  // polygon Line — its per-shape `onContextMenu` already runs (delete).
  // Konva bubbles, so without `e.target === stage` we'd accidentally
  // delete a polygon AND commit the draft in one gesture. Filter so the
  // commit path only fires for free-area right-clicks.
  const handleStageContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (mode !== 'polygon') return;
    const stage = e.target.getStage();
    if (!stage || e.target !== stage) return;
    e.evt.preventDefault();
    void commitPolygon();
  };

  // 6. Commit a polygon (called on right-click in polygon mode OR Enter key).
  const commitPolygon = async () => {
    if (mode !== 'polygon') return;
    if (draftVertices.length < MIN_POLYGON_VERTICES) {
      toast.error(`Polygons need at least ${MIN_POLYGON_VERTICES} vertices — add more before closing.`);
      return;
    }
    if (!selectedCodeId || intrinsicWNum <= 0 || intrinsicHNum <= 0) {
      toast.error('Pick a code from the toolbar before closing the polygon.');
      return;
    }
    // Normalise to 0..1 proportional coords.
    const vertices = draftVertices.map(v => [
      clampRatio(v.x / intrinsicWNum),
      clampRatio(v.y / intrinsicHNum),
    ]);
    const snapshot = draftVertices;
    setDraftVertices([]);
    setCursorPos(null);
    try {
      await imagePolygonsIpc.create({
        documentId,
        codeId: selectedCodeId,
        vertices,
      });
      await refreshPolygons();
    } catch (e) {
      // Restore the draft so the researcher can retry without re-clicking every vertex.
      setDraftVertices(snapshot);
      toast.error(`Failed to save polygon: ${String(e)}`);
    }
  };

  // 7. Cancel the in-flight draft (Esc).
  const cancelPolygonDraft = () => {
    if (mode !== 'polygon') return;
    if (draftVertices.length === 0) return;
    setDraftVertices([]);
    setCursorPos(null);
    toast.info('Polygon draft cancelled.');
  };

  // 8. Window-level Esc / Enter handlers.
  //   - Stage absorbs pointer events but not keyboard, and ProseMirror
  //     not mounted for image documents, so the global listener is safe.
  useEffect(() => {
    if (mode !== 'polygon') return;
    const onKey = (ev: KeyboardEvent) => {
      // Don't swallow keys while the user is typing in another input elsewhere.
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        cancelPolygonDraft();
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        void commitPolygon();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, draftVertices.length, selectedCodeId, intrinsicWNum, intrinsicHNum, documentId]);

  // 9. Stage pointer dispatcher.
  const handlePointerDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (!selectedCodeId) {
      toast.error('Pick a code from the toolbar before drawing a region.');
      return;
    }
    const pos = getStagePointer(e);
    if (!pos) return;
    if (mode === 'bbox') {
      handleBboxPointerDown(pos);
    } else {
      handlePolygonPointerDown(pos);
    }
  };

  const handlePointerMove = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const pos = getStagePointer(e);
    if (!pos) return;
    if (mode === 'bbox') {
      handleBboxPointerMove(pos);
    } else {
      handlePolygonPointerMove(pos);
    }
  };

  const handlePointerUp = () => {
    if (mode === 'bbox') {
      void handleBboxPointerUp();
    } else {
      handlePolygonPointerUp();
    }
  };

  // 10. Mode switching cancels any in-flight draft of the other mode.
  const handleModeChange = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setDraftRect(null);
    setDraftVertices([]);
    setCursorPos(null);
  };

  // 11. Right-click delete affordances (per-shape).
  const handleRegionContextMenu = async (regionId: string) => {
    try {
      await imageRegionsIpc.delete(regionId);
      await refreshRegions();
    } catch (e) {
      toast.error(`Failed to delete region: ${String(e)}`);
    }
  };

  const handlePolygonContextMenu = async (polygonId: string) => {
    try {
      await imagePolygonsIpc.delete(polygonId);
      await refreshPolygons();
    } catch (e) {
      toast.error(`Failed to delete polygon: ${String(e)}`);
    }
  };

  // 12. Polygon's active code colour (or fallback) for stroke / fill.
  const activeCodeColor = (codeById.get(selectedCodeId ?? '')?.color) ?? '#6366f1';

  // 13. Snap-to-close math.
  //   - Active when ≥ 3 vertices already placed AND cursor within SNAP_RADIUS_PX of vertex 0.
  //   - Effective cursor pos used by the live preview "snaps" to vertex 0
  //     (line stretches to v[0] rather than floating a few pixels away).
  const snapActive = useMemo(() => {
    if (mode !== 'polygon') return false;
    if (draftVertices.length < MIN_POLYGON_VERTICES) return false;
    if (!cursorPos) return false;
    const v0 = draftVertices[0];
    const dx = cursorPos.x - v0.x;
    const dy = cursorPos.y - v0.y;
    return dx * dx + dy * dy <= SNAP_RADIUS_PX * SNAP_RADIUS_PX;
  }, [mode, draftVertices, cursorPos]);

  const effectiveCursor = useMemo<Vertex | null>(() => {
    if (mode !== 'polygon') return null;
    if (!cursorPos) return null;
    if (snapActive) return draftVertices[0] ?? cursorPos;
    return cursorPos;
  }, [mode, cursorPos, snapActive, draftVertices]);

  // 14. Flatten draft vertices + effective cursor for the live preview Line `points` array.
  const livePreviewPoints = useMemo<number[] | null>(() => {
    if (mode !== 'polygon') return null;
    if (draftVertices.length === 0) return null;
    if (!effectiveCursor) return null;
    const last = draftVertices[draftVertices.length - 1];
    return [last.x, last.y, effectiveCursor.x, effectiveCursor.y];
  }, [mode, draftVertices, effectiveCursor]);

  // 15. Draft polygon outline points (closed, low-alpha fill).
  const draftLinePoints = useMemo<number[] | null>(() => {
    if (mode !== 'polygon') return null;
    if (draftVertices.length < 2) return null;
    return draftVertices.flatMap(v => [v.x, v.y]);
  }, [mode, draftVertices]);

  // Help text per mode.
  const helpText = mode === 'bbox'
    ? 'Drag on the image to create a region · Right-click a region to delete'
    : 'Click to add vertex · Right-click or Enter to close · Esc to cancel · ' +
      '(snap-to-close within 12 px of vertex 0)';

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-6 py-4 border-b border-slate-200">
        <h2 className="text-xl font-semibold text-slate-800">{title}</h2>
        <p className="text-xs text-slate-500 mt-1">
          {intrinsicWNum} × {intrinsicHNum} px · image document
        </p>

        {/* Mode toggle (top-left) + code picker bar */}
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          {/* Mode toggle pill */}
          <div
            role="tablist"
            aria-label="Drawing mode"
            className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 p-0.5 mr-2"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'bbox'}
              data-testid="mode-bbox"
              onClick={() => handleModeChange('bbox')}
              className={`px-3 py-1 text-xs font-medium rounded ${
                mode === 'bbox'
                  ? 'bg-white shadow-sm text-slate-900'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Rectangle
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'polygon'}
              data-testid="mode-polygon"
              onClick={() => handleModeChange('polygon')}
              className={`px-3 py-1 text-xs font-medium rounded ${
                mode === 'polygon'
                  ? 'bg-white shadow-sm text-slate-900'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Polygon
            </button>
          </div>

          <span className="text-xs text-slate-500">Active code:</span>
          {codes.length === 0 && (
            <span className="text-xs text-slate-400">No codes yet — create one in the Code Tree panel first.</span>
          )}
          {codes.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedCodeId(c.id === selectedCodeId ? null : c.id)}
              className={`px-2 py-1 rounded text-xs font-medium border ${
                selectedCodeId === c.id
                  ? 'ring-2 ring-offset-1 ring-slate-900 border-slate-900'
                  : 'border-slate-200 hover:border-slate-400'
              }`}
              style={{ background: c.color, color: '#fff' }}
              title={c.description ?? undefined}
            >
              {c.name}
            </button>
          ))}
          <span className="text-xs text-slate-400 ml-auto">{helpText}</span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center bg-slate-50 overflow-auto">
        {intrinsicWNum <= 0 || intrinsicHNum <= 0 ? (
          <p className="text-slate-500">Image has no intrinsic dimensions on file.</p>
        ) : !image ? (
          <p className="text-slate-500">Loading image…</p>
        ) : (
          <Stage
            ref={stageRef}
            width={intrinsicWNum}
            height={intrinsicHNum}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onContextMenu={handleStageContextMenu}
            style={{ cursor: selectedCodeId ? 'crosshair' : 'default' }}
          >
            {/* Base layer: bitmap, non-listening. */}
            <Layer listening={false}>
              <KonvaImage image={image} width={intrinsicWNum} height={intrinsicHNum} />
            </Layer>

            {/* Annotation layer: regions, polygons, draft, live preview, snap ring. */}
            <Layer>
              {/* Persisted bbox regions. */}
              {regions.map(r => (
                <Rect
                  key={r.id}
                  x={r.bboxLeft * intrinsicWNum}
                  y={r.bboxTop * intrinsicHNum}
                  width={(r.bboxRight - r.bboxLeft) * intrinsicWNum}
                  height={(r.bboxBottom - r.bboxTop) * intrinsicHNum}
                  stroke={codeById.get(r.codeId)?.color ?? '#6366f1'}
                  strokeWidth={2}
                  dash={[6, 4]}
                  onContextMenu={(e) => {
                    e.evt.preventDefault();
                    handleRegionContextMenu(r.id);
                  }}
                />
              ))}
              {regions.map(r => {
                const code = codeById.get(r.codeId);
                return (
                  <Text
                    key={`label-${r.id}`}
                    x={r.bboxLeft * intrinsicWNum + 4}
                    y={r.bboxTop * intrinsicHNum - 18}
                    text={code?.name ?? '(code)'}
                    fontSize={12}
                    fill="#fff"
                    padding={2}
                    background={code?.color ?? '#6366f1'}
                    listening={false}
                  />
                );
              })}

              {/* Persisted polygons. */}
              {polygons.map(poly => {
                const code = codeById.get(poly.codeId);
                const color = code?.color ?? '#6366f1';
                const flat = poly.vertices.flatMap(([vx, vy]) => [vx * intrinsicWNum, vy * intrinsicHNum]);
                if (flat.length < 4) return null;
                return (
                  <Line
                    key={poly.id}
                    points={flat}
                    closed
                    stroke={color}
                    strokeWidth={2}
                    fill={`${color}33` /* 0x33 ≈ 20 % alpha */}
                    onContextMenu={(e) => {
                      e.evt.preventDefault();
                      handlePolygonContextMenu(poly.id);
                    }}
                  />
                );
              })}
              {polygons.map(poly => {
                const code = codeById.get(poly.codeId);
                if (!poly.vertices.length) return null;
                const [vx, vy] = poly.vertices[0];
                return (
                  <Text
                    key={`label-${poly.id}`}
                    x={vx * intrinsicWNum + 4}
                    y={vy * intrinsicHNum - 18}
                    text={code?.name ?? '(code)'}
                    fontSize={12}
                    fill="#fff"
                    padding={2}
                    background={code?.color ?? '#6366f1'}
                    listening={false}
                  />
                );
              })}

              {/* Draft bbox rect. */}
              {draftRect && draftRect.w > 0 && draftRect.h > 0 && (
                <Rect
                  x={draftRect.x}
                  y={draftRect.y}
                  width={draftRect.w}
                  height={draftRect.h}
                  stroke={activeCodeColor}
                  strokeWidth={1.5}
                  dash={[3, 3]}
                  fill="rgba(99, 102, 241, 0.08)"
                  listening={false}
                />
              )}

              {/* Draft polygon outline (low-alpha fill). */}
              {draftLinePoints && (
                <Line
                  points={draftLinePoints}
                  closed={draftVertices.length >= MIN_POLYGON_VERTICES}
                  stroke={activeCodeColor}
                  strokeWidth={1.5}
                  dash={[3, 3]}
                  fill={
                    draftVertices.length >= MIN_POLYGON_VERTICES
                      ? `${activeCodeColor}14` /* 0x14 ≈ 8 % alpha */
                      : undefined
                  }
                  listening={false}
                />
              )}

              {/* Placed vertex dots for the in-flight draft. */}
              {draftVertices.map((v, i) => (
                <Circle
                  key={`vertex-${i}`}
                  x={v.x}
                  y={v.y}
                  radius={3}
                  fill={activeCodeColor}
                  stroke="#fff"
                  strokeWidth={1}
                  listening={false}
                />
              ))}

              {/* Snap-to-close highlighted ring on vertex 0. */}
              {snapActive && draftVertices[0] && (
                <Circle
                  x={draftVertices[0].x}
                  y={draftVertices[0].y}
                  radius={8}
                  stroke={activeCodeColor}
                  strokeWidth={2}
                  dash={[4, 3]}
                  listening={false}
                />
              )}

              {/* Live preview: line from last placed vertex to (snapped) cursor. */}
              {livePreviewPoints && (
                <Line
                  points={livePreviewPoints}
                  stroke={activeCodeColor}
                  strokeWidth={1}
                  dash={[2, 4]}
                  listening={false}
                />
              )}
            </Layer>
          </Stage>
        )}
      </div>
    </div>
  );
}

function clampRatio(v: number): number {
  // Belt-and-suspenders: even though rust validates, never send NaN/Infinity.
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
