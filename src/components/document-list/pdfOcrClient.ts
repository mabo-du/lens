/**
 * PDF OCR pipeline — renders PDF pages to images via pdf.js, then runs
 * Tesseract.js OCR on each page image. Combines all page text into a
 * single string that the Rust `documents_import` pipeline receives via
 * the `rawText` parameter with `fileFormat: 'ocr_pdf'`.
 *
 * Phase 1.5 (v0.1.5): wired into DocumentList.tsx's checkScannedPdf flow.
 */

import { convertFileSrc } from '@tauri-apps/api/core';
import * as pdfjsLib from 'pdfjs-dist';
import { runOcr } from './ocrClient';
import { TESSERACT_JS_EXTRACTOR_ID } from './ocrWorker';

/**
 * Render a single PDF page to an image data URL (PNG) at the given scale.
 * Uses an off-screen canvas so no DOM is required.
 */
async function renderPageToImage(
  page: pdfjsLib.PDFPageProxy,
  scale: number = 2.0,
): Promise<string> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2d canvas context');

  await page.render({
    canvasContext: ctx,
    viewport,
  }).promise;

  const dataUrl = canvas.toDataURL('image/png');
  // Clean up the canvas element
  canvas.width = 0;
  canvas.height = 0;
  return dataUrl;
}

export interface PdfOcrResult {
  /** Combined OCR text from all pages */
  text: string;
  /** Number of pages processed */
  pageCount: number;
  /** The extractor_id to use when importing */
  extractorId: string;
}

/**
 * Render every page of a PDF to images and run Tesseract.js OCR on each.
 * Returns the combined text for import as `ocr_pdf`.
 */
export async function runPdfOcr(
  filePath: string,
  onProgress?: (current: number, total: number) => void,
): Promise<PdfOcrResult> {
  const url = convertFileSrc(filePath);
  const loadingTask = pdfjsLib.getDocument(url);
  try {
    const pdf = await loadingTask.promise;
    const pageTexts: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress?.(i, pdf.numPages);
      const page = await pdf.getPage(i);
      try {
        const dataUrl = await renderPageToImage(page);
        const { text } = await runOcr(dataUrl);
        pageTexts.push(text);
      } catch (err) {
        console.error(`OCR failed for page ${i} of ${pdf.numPages}:`, err);
        // Continue with remaining pages — partial text is better than none.
      } finally {
        page.cleanup();
      }
    }

    return {
      text: pageTexts.join('\n\n'),
      pageCount: pdf.numPages,
      extractorId: TESSERACT_JS_EXTRACTOR_ID,
    };
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}
