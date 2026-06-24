// Separate Vite config for the Playwright fixture (`tests/e2e/fixture/`).
// Kept distinct from the main app's `vite.config.ts` (which serves index.html
// at the project root on port 57598 under Tauri dev) so the Playwright
// harness doesn't fight Tauri for the same port.
//
// Path-alias `@` -> `src/` is required because `ImageViewer.tsx` and friends
// import via `@/components/...`, `@/ipc/...`, etc.
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Round-81 FIX — exclude vitest unit-test files from the fixture bundle.
 *
 * Symptom (visible in CI job logs): `npx playwright test` starts; within
 * ~1.6 s we see vitest runtime errors emitted on stdout, even though the
 * playwright step never invokes vitest:
 *
 *   - `ReferenceError: __dirname is not defined in ES module scope`
 *     at `src/components/document-list/DocumentList.test.ts:5`
 *   - `Error: Vitest mocker was not initialized in this environment.
 *      vi.queueMock() is forbidden.`
 *     at `src/export/QdpxExporter.test.ts:13`
 *   - `TypeError: Cannot read properties of undefined (reading 'config')`
 *     at `polygonState.test.ts:24` and `offset-utils.test.ts:4` (inside
 *     @vitest/runner initSuite)
 *
 * Root cause: Playwright v1.61 uses Vite internally to transform the
 * config + spec files. That internal Vite process has `bundler`
 * moduleResolution and resolves relative imports through `/@fs/...` etc.
 * The fixture is built with `vite build` and pulls in
 * `src/components/editor/ImageViewer` etc. via the `@` alias. Somewhere
 * in that resolution chain (likely a barrel re-export like
 * `src/components/editor/index.ts`), the module graph is reaching a
 * sibling `*.test.ts` file. That file lands in the transform pipeline,
 * executes `__dirname` (no Node shim available) and `vi.mock(...)`
 * (no vitest runtime), and the bubbled ReferenceError + TypeError
 * surface on the playwright test step's stdout. The fact that
 * `vitest ^4.1.9` is loaded as a devDependency and shares its runner
 * module path is what stitches the failures together.
 *
 * Fix: a pre-plugin that intercepts every resolution to a `*.test.ts` or
 * `*.spec.ts` file, returns an empty ESM module for it, AND a load hook
 * that strips any explicit `.test.tsx` import attempt. This breaks the
 * reference chain cleanly without altering source files or test files.
 *
 * The plugin intentionally runs `enforce: 'pre'` so it sits in front of
 * `@vitejs/plugin-react`'s JSX transform — React JSX is irrelevant once
 * we've redirected test imports to a stub.
 */
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const stubTestFiles = (): Plugin => ({
  name: 'lens-stub-test-files',
  enforce: 'pre',
  resolveId(source, importer) {
    // Direct bare-specifier import like `import('./foo.test.ts')`.
    if (TEST_FILE_PATTERN.test(source)) {
      return { id: VIRTUAL_STUB_ID, external: false };
    }
    // Absolute path / @fs/... import reaching a test file on disk.
    if (importer && TEST_FILE_PATTERN.test(importer)) {
      return { id: VIRTUAL_STUB_ID, external: false };
    }
    return null;
  },
  load(id) {
    if (id === VIRTUAL_STUB_ID) {
      // Empty ESM module — no imports, no exports, no side effects.
      // Vite will dedupe across all test-file resolutions; legitimate
      // test files in `npm test` (vitest) are unaffected because that
      // path doesn't go through this fixture's vite build.
      return 'export {};\n';
    }
    return null;
  },
});
const VIRTUAL_STUB_ID = '\0lens-stub-test-files';

export default defineConfig({
  root: path.resolve(__dirname, 'fixture'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../../src'),
    },
  },
  plugins: [stubTestFiles(), react()],
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
  },
});
