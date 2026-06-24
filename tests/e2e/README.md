# LENS FE E2E (Playwright)

This directory hosts the FE E2E suite, built via **Playwright + a Vite-served
React fixture** that exercises the actual production `ImageViewer.tsx` with
a Tauri-IPC shim.

## Topology

```
tests/e2e/
  fixture.vite.config.ts   # separate vite config for the fixture only
  fixture/
    index.html             # entry HTML
    src/
      main.tsx             # bootstraps window.__TAURI_INTERNALS__ shim
                           # + useProjectStore seed + <ImageViewer> mount
  playwright.config.ts     # webServer: runs fixture vite on port 57599
  image-viewer.spec.ts     # mode toggle + 4-vertex polygon + action Dialog
                           # + Edit Memo flow
  perf-bench.spec.ts       # Konva draw-time benchmark (see below)
  README.md                # this file
```

Ports:

- `57598` — main app (Tauri dev); not used by tests.
- `57599` — fixture vite dev server (strictPort); used by Playwright.

## Tauri-IPC shim

`tests/e2e/fixture/src/main.tsx` injects
`window.__TAURI_INTERNALS__ = { invoke }` synchronously **before** any
top-level `@tauri-apps/api/core` import. Each `invoke(cmd, args)` call is
logged to `window.__LENS_TEST__.invocations` and resolved against an
in-memory fixture store (`regions`, `polygons`, `memos`, etc.).

Tests can read the mock state via:

```js
await page.evaluate(() => window.__LENS_TEST__.fixture.polygons);
await page.evaluate(() => window.__LENS_TEST__.invocations);
```

Use `window.__LENS_TEST__.reset()` at the start of each test to clear
invocations + fixture arrays + the id counter.

## Running

```bash
# One-time browser install (chromium bundled with @playwright/test).
npx playwright install chromium

# Run the full E2E suite (auto-starts the fixture vite dev server).
npx playwright test

# Run only the image-viewer suite.
npx playwright test image-viewer

# Run with the Playwright UI (handy for ad-hoc debugging).
npx playwright test --ui

# A single test by title (substring match).
npx playwright test -g "4-vertex polygon"
```

## Why a fixture page, not the real app?

The real LENS app runs inside the Tauri shell (`tauri dev`); a Tauri shell
window only exists when the Tauri runtime is loaded — there is no plain
browser context we can stand Playwright up against without spinning up the
full Tauri stack (or `tauri-driver`, which is a much heavier dependency).

The fixture mirrors the same React component tree the app uses
(`ImageViewer`, `RegionMemoDialog`, action Dialog, polygon-state helpers)
but substitutes a deterministic IPC handler so tests can assert exact
IPC calls + payloads without booting a real LENS project.

## Adding a new test

1. Pick the test file based on component (`image-viewer.spec.ts` for
   `ImageViewer.tsx` family; create a new `*.spec.ts` for other components).
2. Always `await gotoFixture(page)` first — that mounts `<ImageViewer>`,
   waits for the `data-testid` hooks to be visible, and resets the mock.
3. After actions that produce IPC traffic, query
   `window.__LENS_TEST__.invocations` and assert the expected
   `cmd` + `args`.
4. For click-on-canvas interactions, use `page.mouse.click(box.x + dx, box.y + dy)`
   after fetching `canvas.boundingBox()` — `data-testid` hooks are only
   attached to the React toolbar buttons, not to Konva shapes inside the
   Stage.

## data-testid hooks surface area

| Hook | Purpose |
|---|---|
| `mode-bbox` | Rectangle tab in the mode-toggle pill |
| `mode-polygon` | Polygon tab in the mode-toggle pill |
| `region-action-edit-memo` | "Edit Memo..." button in the shape action Dialog |
| `region-action-delete` | "Delete" button in the shape action Dialog |
