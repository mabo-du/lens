/**
 * pdf.js renderer-side utilities for text extraction and page counting.
 *
 * Used by DocumentList.tsx to implement the Phase 1 PDF fallback path:
 *   - When the Rust pdfplumber sidecar fails, pdf.js extracts text in the
 *     browser and the result is sent back via the `rawText` IPC parameter.
 *   - When the sidecar returns very little text, pdf.js provides a fast
 *     page count so the app can surface the scanned-PDF OCR dialog.
 *
 * Both functions convert the file path via Tauri's `convertFileSrc` so
 * pdf.js can load the file from the local origin (CSP'd context blocks
 * raw file:// URIs).
 */

import { convertFileSrc } from '@tauri-apps/api/core';
import * as pdfjsLib from 'pdfjs-dist';

// pdf.js worker — use the CDN worker for the E2E fixture environment.
// In production (Tauri), the worker is loaded from the bundled assets
// by pdfjs-dist's own resolution. The explicit workerSrc prevents a
// console warning and ensures the worker is always available.
//
// TODO(v1.1): bundle pdf.worker.min.mjs alongside the app so the
// fallback works offline. The CDN path is acceptable for the E2E
// fixture (which runs with network access) but violates the local-first
// promise in production.
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';

/**
 * Quick page count — opens the PDF, reads the document catalog, and
 * returns the number of pages. Does NOT extract any text, so it is
 * fast and safe for the scanned-PDF detection path (which only wants
 * to know if a multi-page PDF has near-zero extracted text).
 */
export async function getPdfPageCount(filePath: string): Promise<number> {
  const url = convertFileSrc(filePath);
  const loadingTask = pdfjsLib.getDocument(url);
  try {
    const pdf = await loadingTask.promise;
    return pdf.numPages;
  } finally {
    // pdf.js keeps internal workers alive; clean up to avoid leaks.
    await loadingTask.destroy().catch(() => {});
  }
}

/**
 * Full text extraction — opens the PDF, iterates every page, extracts
 * text content via `page.getTextContent()`, and joins the results.
 *
 * Returns the extracted plain text (not normalised — the Rust
 * `documents_import` pipeline handles normalisation on the
 * `rawText` path).
 */
export async function extractPdfText(filePath: string): Promise<string> {
  const url = convertFileSrc(filePath);
  const loadingTask = pdfjsLib.getDocument(url);
  try {
    const pdf = await loadingTask.promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => {
          if ('str' in item) return item.str;
          return '';
        })
        .join(' ');
      pages.push(pageText);
      page.cleanup();
    }
    return pages.join('\n\n');
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}
