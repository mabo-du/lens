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
  server: {
    port: 57599,
    strictPort: true,
  },
});
