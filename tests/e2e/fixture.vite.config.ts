// Separate Vite config for the Playwright fixture (`tests/e2e/fixture/`).
// Kept distinct from the main app's `vite.config.ts` (which serves index.html
// at the project root on port 57598 under Tauri dev) so the Playwright
// harness doesn't fight Tauri for the same port.
//
// Path-alias `@` -> `src/` is required because `ImageViewer.tsx` and friends
// import via `@/components/...`, `@/ipc/...`, etc.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import tesseractPkg from 'tesseract.js/package.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  root: path.resolve(__dirname, 'fixture'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../../src'),
    },
  },
  plugins: [react()],
  // Mirror main vite.config.ts: `__TESSERACT_JS_VERSION__` is statically
  // substituted at build time with the version pinned in package.json.
  // ocrWorker.ts and DocumentList.tsx both read it via a `declare global`
  // block. Without this define, the fixture hits a ReferenceError and
  // React never mounts (empty #root div).
  define: {
    __TESSERACT_JS_VERSION__: JSON.stringify(tesseractPkg.version),
  },
  server: {
    host: '127.0.0.1',
    port: 57599,
    strictPort: true,
  },
  // Round-78 final: the fixture is built once via `vite build` and
  // served statically by `npx http-server` from `dist/`. We no longer
  // need a `preview` block — the static file server handles serving.
  build: {
    outDir: path.resolve(__dirname, 'fixture/dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'fixture/index.html'),
        workspace: path.resolve(__dirname, 'fixture/workspace.html'),
      },
    },
  },
});
