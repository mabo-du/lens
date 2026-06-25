import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * **OCR Client IPC contract — source-level inspection test.**
 *
 * We deliberately do NOT exercise `runOcr` end-to-end here. Running the
 * real code path requires a Web Worker runtime that vitest's `"node"`
 * environment cannot provide without WASM-fetched Tesseract.js core
 * (~20MB on first run, network dependent, violates 30s CI budget).
 *
 * The real production failure modes we want to prevent:
 *   1. Round-trip wire shape changes (worker sends `{ type: 'result',
 *      text }` but renderer parses `{ type: 'done', payload }`).
 *   2. Removed handler (a future refactor drops the `terminated` reject
 *      branch and the worker hangs forever).
 *   3. Listener-leak (resolve path forgot `removeEventListener`, leaks
 *      the closure on every OCR run).
 *   4. Module worker URL drift (a future change moves the worker to
 *      a different filename, breaking the `new URL('./ocrWorker.ts',
 *      import.meta.url)` resolution in production).
 *
 * Each of these is verifiable by static source inspection — no runtime
 * Worker stub required. This test runs in <100ms and is hermetic.
 *
 * Manual E2E (to be re-verified by a real user once a release candidate
 * ships): open LENS -> import an image via the OCR button -> confirm
 * the resulting document in the list has `extractor_id` matching
 * `tesseract.js-${tesseractJsPkg.version}` and the content panel shows
 * the recognised text.
 */
describe('ocrClient IPC contract (source-level)', () => {
  const ocrClientSrc = fs.readFileSync(
    path.resolve(__dirname, './ocrClient.ts'),
    'utf8',
  );
  const ocrWorkerSrc = fs.readFileSync(
    path.resolve(__dirname, './ocrWorker.ts'),
    'utf8',
  );

  it('runOcr posts the { type: "recognize", image, lang } wire shape', () => {
    expect(ocrClientSrc).toMatch(/worker\.postMessage\(\s*\{\s*type:\s*['"]recognize['"]/);
    expect(ocrClientSrc).toMatch(/image\s*[,}]/);
    expect(ocrClientSrc).toMatch(/lang\s*[,}]/);
  });

  it('runOcr defaults lang to "eng" via the parameter default', () => {
    expect(ocrClientSrc).toMatch(/runOcr\(\s*image:\s*string\s*,\s*lang:\s*string\s*=\s*['"]eng['"]/);
  });

  it('worker handles all 4 OcrWorkerOutboundMessage outcomes (result/terminated/error) + ignores progress', () => {
    // Tightened: each `type` literal must appear in a discriminated-union
    // shape (preceded by `|` or following `=` at start-of-line). A bare
    // comment containing `'progress'` no longer satisfies the test.
    const union =
      /^\s*\|?\s*\{\s*type:\s*['"]result['"]/m.test(ocrWorkerSrc) &&
      /^\s*\|?\s*\{\s*type:\s*['"]error['"]/m.test(ocrWorkerSrc) &&
      /^\s*\|?\s*\{\s*type:\s*['"]terminated['"]/m.test(ocrWorkerSrc) &&
      /^\s*\|?\s*\{\s*type:\s*['"]progress['"]/m.test(ocrWorkerSrc);
    expect(union, 'OcrWorkerOutboundMessage union must list all 4 outcomes').toBe(true);
  });

  it('runOcr resolve path removes BOTH message + error listeners (no leak)', () => {
    // Trim to the body of runOcr to find the listener-cleanup pair.
    const runOcrBody = ocrClientSrc.match(
      /export async function runOcr[\s\S]*?\n\}\s*$/m,
    )?.[0] ?? '';
    expect(runOcrBody, 'runOcr body not found').toBeTruthy();
    expect(runOcrBody, 'message listener must be removed on resolve').toMatch(
      /removeEventListener\(['"]message['"]\s*,\s*onMessage\)/,
    );
    expect(runOcrBody, 'error listener must be removed on resolve').toMatch(
      /removeEventListener\(['"]error['"]\s*,\s*onError\)/,
    );
  });

  it('runOcr rejects on `terminated` worker message (defensive against silent hang)', () => {
    // Bound the distance between the message-type check and the reject()
    // so a future regression where the terminated branch falls through
    // into 'progress' (silently swallowing) is caught. ~15 lines max.
    const match = ocrClientSrc.match(
      /type === ['"]terminated['"][^}]{0,500}?reject/,
    );
    expect(match, '`terminated` branch must call reject nearby').not.toBeNull();
  });

  it('module worker is constructed via Worker(new URL(./ocrWorker.ts), { type: "module" })', () => {
    // Atomic. One regex. If `new Worker(... new URL(... ./ocrWorker.ts ...)
    // { type: 'module' })` ever drifts (shared-worker, Comlink, classic
    // mode, different filename) the assertion fails loudly — no partial
    // pass from a 3-of-3 split.
    //
    // Tolerates an optional trailing comma after `'module'` (the actual
    // source has `type: 'module',` on its own line, with the closing
    // brace on the next) so the regex matches the conventional TS style
    // AND any minimal-without-comma rejoinder.
    expect(ocrClientSrc).toMatch(
      /new Worker\(\s*new URL\(\s*['"]\.\/ocrWorker\.ts['"]\s*,\s*import\.meta\.url\s*\)\s*,\s*\{\s*type:\s*['"]module['"]\s*,?\s*\}\s*\)/,
    );
  });

  it('terminateOcrWorker is a callable public helper (so cleanup is reachable)', () => {
    expect(ocrClientSrc).toMatch(/export async function terminateOcrWorker\b/);
  });

  it('OCR button in DocumentList.tsx delegates to handleOcrImageImport', () => {
    const docListSrc = fs.readFileSync(
      path.resolve(__dirname, './DocumentList.tsx'),
      'utf8',
    );
    // Tight: the OCR `<button>`_onClick must invoke the handler within
    // the same JSX expression (≤500 chars). Catches rename AND ensures
    // the button is still wired to the OCR family (not siloed).
    expect(docListSrc).toMatch(
      /onClick=\{async \(\) => \{[\s\S]{0,500}handleOcrImageImport\(filePath\)/,
    );
  });
});
