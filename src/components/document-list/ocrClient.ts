/**
 * Main-thread shim for the Tesseract.js OCR Web Worker.
 *
 * Spawns the module worker (`./ocrWorker.ts` bundled by Vite) and
 * exposes a Promise<string> API for use in DocumentList.tsx.
 *
 * Usage:
 *   const text = await runOcr(imageDataUrl);
 *
 * Worker protocol matches `ocrWorker.ts::OcrWorkerInboundMessage`.
 */
import type { OcrWorkerOutboundMessage } from './ocrWorker';

export type OcrResult = { text: string };

let workerInstance: Worker | null = null;

function getWorker(): Worker {
  if (workerInstance) return workerInstance;
  // Vite bundles the worker with `?worker` import or with the
  // `new URL(..., import.meta.url)` pattern. The latter is the
  // canonical Module Worker idiom and works with Tauri 2 + Vite 7.
  workerInstance = new Worker(new URL('./ocrWorker.ts', import.meta.url), {
    type: 'module',
  });
  return workerInstance;
}

export async function runOcr(image: string, lang: string = 'eng'): Promise<OcrResult> {
  const worker = getWorker();
  return new Promise<OcrResult>((resolve, reject) => {
    const onMessage = (ev: MessageEvent<OcrWorkerOutboundMessage>) => {
      const msg = ev.data;
      if (msg.type === 'result') {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        resolve({ text: msg.text });
      } else if (msg.type === 'error') {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        reject(new Error(msg.message));
      } else if (msg.type === 'progress') {
        // Could dispatch to a progress UI; intentionally no-op for v0.1.4.
      } else if (msg.type === 'terminated') {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        reject(new Error('OCR worker terminated unexpectedly'));
      }
    };
    const onError = (err: ErrorEvent) => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      reject(new Error(err.message ?? 'OCR worker error'));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ type: 'recognize', image, lang });
  });
}

export async function terminateOcrWorker(): Promise<void> {
  if (!workerInstance) return;
  workerInstance.postMessage({ type: 'terminate' });
  workerInstance = null;
}
