import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import tesseractPkg from "tesseract.js/package.json" with { type: "json" };

/// <reference types="vitest/config" />

const host: string | undefined = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  // `__TESSERACT_JS_VERSION__` is statically substituted at build time
  // with the version pinned in package.json. Module workers (ocrWorker.ts)
  // and the main thread (DocumentList.tsx) both read it via a
  // `declare global { const __TESSERACT_JS_VERSION__: string; }` block.
  // See docs/research-papers/QDA Multimedia Annotation Architecture.md.
  define: {
    __TESSERACT_JS_VERSION__: JSON.stringify(tesseractPkg.version),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 57598,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'prosemirror': ['prosemirror-model', 'prosemirror-state', 'prosemirror-transform', 'prosemirror-view'],
          'ui-vendor': ['@base-ui/react', 'lucide-react', 'sonner', 'cmdk', 'react-arborist', 'react-resizable-panels'],
          'handlebars': ['handlebars'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
}));
