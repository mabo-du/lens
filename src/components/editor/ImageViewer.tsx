/**
 * ImageViewer — Konva-backed image annotation canvas (Phase C-2).
 *
 * Responsibilities:
 *   - Load the bitmap from the Rust side via `document_get_asset_base64`
 *     and render it at its intrinsic width/height (the `Stage` matches
 *     the image dimensions 1:1 so a drawer's coordinates already mean
 *     pixels; we normalise to 0..1 only at the IPC boundary).
 *   - Render existing image regions (loaded on mount + after each
 *     create/delete) as outlined Rect elements tinted with the assigned
 *     code colour.
 *   - Provide a drag-to-create UX: pointerdown starts a transient Rect,
 *     pointermove updates w/h, pointerup persists via
 *     `image_selection_create` with 0..1 proportional coords.
 *
 * Out of scope for this slice: polygon/freehand regions, memos bound to
 * regions (text_selection memos work for docs), region re-sizing.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Text } from 'react-konva';
import type Konva from 'konva';

import { documentsIpc, type DocumentRecord, type DocumentAsset } from '@/ipc/documents';
import { imageRegionsIpc, type ImageRegionRecord } from '@/ipc/image-regions';
import { type Code } from '@/ipc/codes';
import { useProjectStore } from '@/store/projectStore';
import { toast } from 'sonner';

interface DraftRect {
  startX: number;
  startY: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_DRAG_PX = 4; // suppress accidental drag-create on click

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
  const [regions, setRegions] = useState<ImageRegionRecord[]>([]);
  const [draftRect, setDraftRect] = useState<DraftRect | null>(null);
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

  // 2. Refresh the regions list whenever the document changes + after a create/delete.
  const refreshRegions = async () => {
    try {
      const list = await imageRegionsIpc.listByDocument(documentId);
      setRegions(list);
    } catch (e) {
      toast.error(`Failed to list image regions: ${String(e)}`);
    }
  };

  useEffect(() => {
    refreshRegions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // 3. Build a code lookup for colour rendering.
  const codeById = useMemo(() => {
    const m = new Map<string, Code>();
    for (const c of codes) m.set(c.id, c);
    return m;
  }, [codes]);

  // 4. Drag-to-create handlers.
  const handlePointerDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (!selectedCodeId) {
      toast.error('Pick a code from the toolbar before drawing a region.');
      return;
    }
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    setDraftRect({ startX: pos.x, startY: pos.y, x: pos.x, y: pos.y, w: 0, h: 0 });
  };

  const handlePointerMove = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (!draftRect) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const x = Math.min(draftRect.startX, pos.x);
    const y = Math.min(draftRect.startY, pos.y);
    const w = Math.abs(pos.x - draftRect.startX);
    const h = Math.abs(pos.y - draftRect.startY);
    setDraftRect({ ...draftRect, x, y, w, h });
  };

  const handlePointerUp = async () => {
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

  // 5. Right-click → delete on a region.
  const handleRegionContextMenu = async (regionId: string) => {
    try {
      await imageRegionsIpc.delete(regionId);
      await refreshRegions();
    } catch (e) {
      toast.error(`Failed to delete region: ${String(e)}`);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-6 py-4 border-b border-slate-200">
        <h2 className="text-xl font-semibold text-slate-800">{title}</h2>
        <p className="text-xs text-slate-500 mt-1">
          {intrinsicWNum} × {intrinsicHNum} px · image document
        </p>
        {/* Code picker bar */}
        <div className="mt-3 flex flex-wrap gap-2 items-center">
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
          <span className="text-xs text-slate-400 ml-auto">
            Drag on the image to create a region · Right-click a region to delete
          </span>
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
            style={{ cursor: selectedCodeId ? 'crosshair' : 'default' }}
          >
            <Layer listening={false}>
              <KonvaImage image={image} width={intrinsicWNum} height={intrinsicHNum} />
            </Layer>
            <Layer>
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
              {draftRect && draftRect.w > 0 && draftRect.h > 0 && (
                <Rect
                  x={draftRect.x}
                  y={draftRect.y}
                  width={draftRect.w}
                  height={draftRect.h}
                  stroke={codeById.get(selectedCodeId ?? '')?.color ?? '#6366f1'}
                  strokeWidth={1.5}
                  dash={[3, 3]}
                  fill="rgba(99, 102, 241, 0.08)"
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
