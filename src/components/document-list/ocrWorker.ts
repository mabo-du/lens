/// <reference lib="webworker" />
declare global {
  // `__TESSERACT_JS_VERSION__` is statically substituted by Vite at build
  // time from `node_modules/tesseract.js/package.json` (see vite.config.ts).
  // The `declare global` form is portable across `isolatedModules: true`
  // and binds the identifier in both the module worker and the main
  // thread without importing package.json JSON directly.
  const __TESSERACT_JS_VERSION__: string;
}
/**
 * Tesseract.js OCR Web Worker for Phase 1 OCR.
 *
 * Loaded as a module worker by `DocumentList.tsx` via:
 *   const worker = new Worker(new URL('./ocrWorker.ts', import.meta.url), { type: 'module' });
 *
 * Message protocol (Renderer -> Worker):
 *   { type: 'recognize', image: string (data: or http(s) URL), lang?: string }
 *
 * Message protocol (Worker -> Renderer):
 *   { type: 'progress', status: string, progress: number }   // periodic, optional
 *   { type: 'result', text: string }                          // final answer
 *   { type: 'error', message: string }                        // OCR failure
 *   { type: 'terminated' }                                    // worker exited cleanly
 *
 * Tesseract.js v7 API surface (verified from node_modules/tesseract.js/src/createWorker.js,
 * v7.0.0):
 *   - `createWorker(langs = 'eng', oem = OEM.LSTM_ONLY, _options = {}, config = {})` —
 *     takes language as the FIRST positional argument; older wrong attempt at
 *     `setLanguage(...)` was a non-existent method on the Worker type.
 *   - `worker.reinitialize(langs, oem?, config?)` — load-and-switch language
 *     post-creation. Used below for per-image language override.
 *   - `worker.recognize(image)` — returns `{ data: { text: string, ... } }`.
 *
 * CSP requirement: Tesseract.js loads WASM at runtime. The Tauri's CSP must
 * include `'wasm-unsafe-eval'` in `script-src` (or script-src 'self' for
 * module workers on modern Chromium). The relaxed CSP in tauri.conf.json
 * also lists jsDelivr under `connect-src` for downloading the language
 * traineddata.
 *
 * Version sync invariant: TESSERACT_JS_VERSION below is the bottleneck for
 * the `TESSERACT_JS_EXTRACTOR_ID` string that the renderer stamps into
 * `document.extractor_id`. It must track package.json to keep the
 * forward-migration safety matrix honest. A dedicated vitest in
 * `tesseractVersion.sync.test.ts` asserts equality on every CI run.
 */
import { createWorker, OEM, type Worker as TesseractWorker } from 'tesseract.js';

/**
 * At build time, Vite statically substitutes `__TESSERACT_JS_VERSION__`
 * with a stringified version literal (see vite.config.ts). This is the
 * single source of truth for the runtime Tesseract.js version, bound
 * automatically to package.json so no manual sync test is needed.
 */
export const TESSERACT_JS_VERSION = __TESSERACT_JS_VERSION__;

export const TESSERACT_JS_EXTRACTOR_ID = `tesseract.js-${TESSERACT_JS_VERSION}`;

let workerInstance: TesseractWorker | null = null;

async function getWorker(lang: string): Promise<TesseractWorker> {
  if (workerInstance) {
    // v7 API: reinitialize(langs, oem?, config?) is the documented
    // language-switch path. Returns a Promise; we await to serialize.
    await workerInstance.reinitialize(lang);
    return workerInstance;
  }
  // v7 API: createWorker(langs='eng', oem=OEM.LSTM_ONLY, options?, config?).
  const worker = await createWorker(lang, OEM.LSTM_ONLY);
  workerInstance = worker;
  return worker;
}

self.addEventListener('message', async (event: MessageEvent) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'recognize') {
    try {
      const image: string = data.image;
      const lang: string = data.lang ?? 'eng';
      const worker = await getWorker(lang);
      const { data: result } = await worker.recognize(image);
      (self as unknown as Worker).postMessage({
        type: 'result',
        text: result.text ?? '',
      });
    } catch (err) {
      (self as unknown as Worker).postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (data.type === 'terminate') {
    if (workerInstance) {
      await workerInstance.terminate();
      workerInstance = null;
    }
    (self as unknown as Worker).postMessage({ type: 'terminated' });
  }
});

export type OcrWorkerInboundMessage =
  | { type: 'recognize'; image: string; lang?: string }
  | { type: 'terminate' };

export type OcrWorkerOutboundMessage =
  | { type: 'progress'; status: string; progress: number }
  | { type: 'result'; text: string }
  | { type: 'error'; message: string }
  | { type: 'terminated' };
