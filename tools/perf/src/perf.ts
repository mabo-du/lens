/**
 * LENS v0.2 — Konva perf benchmark (round-77).
 *
 * Pure Konva perf numbers — no IPC, no React, no Tauri. The test fixture
 * (tests/e2e/fixture) keeps our React tree lightweight; this file
 * isolates the Konva draw-time metric by mounting a Konva Stage in-page
 * on top of synthetic PNG bitmaps at three sizes:
 *
 *   - small: 256×256   (mobile thumbnail)
 *   - medium: 1024×1024 (typical page-sized screenshot)
 *   - large: 2048×2048 (high-DPI capture / Raspberry Pi RPi3-class targets)
 *
 * For each size we run:
 *
 *   - N bbox draws: drag-creates a Rect, doesn't commit (no IPC), measures
 *     `layer.batchDraw()` + `layer.draw()` cycle time averaged across N.
 *   - N polygon vertex pushes: adds a vertex to the draft polygon (no IPC),
 *     measures `layer.batchDraw()` + `layer.draw()` cycle time.
 *
 * Output is structured JSON written to the #results <pre> + console.log
 * so the Playwright test (`tools/perf/perf-bench.spec.ts`) can capture
 * the numbers and emit `tools/perf/results.json`.
 *
 * NOTE: A true Konva-vs-custom-canvas comparison is out of scope for this
 * round; documented in `docs/research-papers/v0.2-konva-perf-baseline.md`
 * as a v0.3+ track.
 */

import Konva from 'konva';

interface SizeResult {
  intrinsic_w: number;
  intrinsic_h: number;
  bbox_draw_ms_avg: number;
  polygon_push_ms_avg: number;
  iteration_count: number;
}

interface BenchResult {
  konva_version: string;
  user_agent: string;
  sizes: SizeResult[];
}

const SIZES: ReadonlyArray<readonly [number, number]> = [
  [256, 256],
  [1024, 1024],
  [2048, 2048],
];

const ITERATIONS = 200;

function makeSyntheticPng(w: number, h: number): HTMLImageElement {
  // Build a tiny inline synthetic bitmap via Canvas2D. The actual
  // pixel content doesn't matter for benchmarking draw-time — we just
  // need a bitmap that decodes + paints at the requested intrinsic
  // size. A solid mid-grey works.
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable (Playwright fixture env too old?)');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, w, h);
  // Add some non-trivial pixels so pixel-fill cost is realistic.
  ctx.fillStyle = '#c08080';
  for (let y = 0; y < h; y += 16) {
    for (let x = 0; x < w; x += 16) {
      ctx.fillRect(x, y, 8, 8);
    }
  }
  // Convert to data URL and create HTMLImageElement (mirrors
  // ImageViewer's `documentsIpc.getAsset().b64` data-URL flow).
  const dataUrl = canvas.toDataURL('image/png');
  const img = new window.Image();
  img.src = dataUrl;
  return img;
}

function benchBboxDraws(stage: Konva.Stage, layer: Konva.Layer, w: number, h: number, n: number): number {
  // Tear down any prior rect from previous iterations.
  layer.find('Rect').forEach(n => n.destroy());
  // One Rect at a time; measure each batchDraw.
  let total = 0;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const x = (i * 7) % w;
    const y = (i * 11) % h;
    const rectW = Math.min(80, w - x);
    const rectH = Math.min(80, h - y);
    const r = new Konva.Rect({ x, y, width: rectW, height: rectH, stroke: '#ff0000', strokeWidth: 2, dash: [6, 4] });
    layer.add(r);
    layer.draw();
    total += performance.now() - t0;
  }
  return total / n;
}

function benchPolygonPushes(stage: Konva.Stage, layer: Konva.Layer, w: number, h: number, n: number): number {
  // One Line per iteration; tear down between.
  layer.find('Line').forEach(n => n.destroy());
  let total = 0;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) / 4;
    const verts: number[] = [];
    const sides = 16 + (i % 8);
    for (let k = 0; k < sides; k++) {
      verts.push(cx + Math.cos((k / sides) * Math.PI * 2) * r, cy + Math.sin((k / sides) * Math.PI * 2) * r);
    }
    const line = new Konva.Line({
      points: verts,
      closed: true,
      stroke: '#0000ff',
      strokeWidth: 2,
      fill: 'rgba(0, 0, 255, 0.2)',
    });
    layer.add(line);
    layer.draw();
    total += performance.now() - t0;
  }
  return total / n;
}

async function main() {
  const results: BenchResult = {
    konva_version: (Konva as unknown as { version: string }).version,
    user_agent: navigator.userAgent,
    sizes: [],
  };

  const host = document.getElementById('stage-host') as HTMLDivElement;

  for (const [w, h] of SIZES) {
    // Build a fresh stage per size so each measurement uses a clean canvas.
    host.innerHTML = '';
    const stage = new Konva.Stage({ container: host, width: w, height: h });
    const baseLayer = new Konva.Layer({ listening: false });
    const img = makeSyntheticPng(w, h);
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`synthetic PNG ${w}x${h} failed to decode`));
    });
    baseLayer.add(new Konva.Image({ image: img, width: w, height: h }));
    stage.add(baseLayer);
    const annotLayer = new Konva.Layer();
    stage.add(annotLayer);

    const bboxAvg = benchBboxDraws(stage, annotLayer, w, h, ITERATIONS);
    const polyAvg = benchPolygonPushes(stage, annotLayer, w, h, ITERATIONS);

    results.sizes.push({
      intrinsic_w: w,
      intrinsic_h: h,
      bbox_draw_ms_avg: +bboxAvg.toFixed(4),
      polygon_push_ms_avg: +polyAvg.toFixed(4),
      iteration_count: ITERATIONS,
    });

    baseLayer.destroy();
    annotLayer.destroy();
    stage.destroy();
    host.innerHTML = '';
  }

  const pre = document.getElementById('results') as HTMLPreElement;
  pre.textContent = JSON.stringify(results, null, 2);
  // eslint-disable-next-line no-console
  console.log('LENS_PERF_RESULT', JSON.stringify(results));
}

main().catch(e => {
  const pre = document.getElementById('results') as HTMLPreElement | null;
  if (pre) pre.textContent = `ERROR: ${String(e)}`;
  // eslint-disable-next-line no-console
  console.error('perf bench failed:', e);
});
