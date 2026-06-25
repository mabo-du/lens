import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

/**
 * E2E test helper: imports a document without the native file dialog.
 * Called from Playwright via `page.evaluate(() => window.__LENS_E2E_IMPORT__(...))`.
 * Only available in dev builds; production builds should strip this.
 */
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__LENS_E2E_IMPORT__ = async (
    projectId: string,
    filePath: string,
    fileFormat: string,
    rawText?: string,
  ) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('documents_import', {
      projectId,
      filePath,
      fileFormat,
      rawText: rawText ?? null,
      extractorIdOverride: null,
    });
  };

  (window as unknown as Record<string, unknown>).__LENS_E2E_PROJECT_CREATE__ = async (
    name: string,
    targetDir: string,
  ) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('projects_create', {
      name,
      description: null,
      targetDir,
      encryptionKey: null,
    });
  };
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
