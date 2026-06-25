
import { useProjectStore } from '@/store/projectStore';
import { useUiStore } from '@/store/uiStore';
import { FileText, File, FileType2, Trash2, Image, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';
import { documentsIpc, DocumentRecord } from '@/ipc/documents';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { runOcr } from './ocrClient';
import { TESSERACT_JS_EXTRACTOR_ID } from './ocrWorker';
import { extractPdfText, getPdfPageCount } from './pdfjsClient';
import { runPdfOcr } from './pdfOcrClient';

// TESSERACT_JS_EXTRACTOR_ID is derived at build time from the
// `version` export of the `tesseract.js` package (see ocrWorker.ts),
// so a `package.json` bump propagates automatically instead of
// silently drifting from the actual runtime version.
export { TESSERACT_JS_EXTRACTOR_ID };

export function DocumentList() {
  const documents = useProjectStore(s => s.documents);
  const activeDocumentId = useUiStore(s => s.activeDocumentId);
  const setActiveDocument = useUiStore(s => s.setActiveDocument);
  const activeProject = useProjectStore(s => s.activeProject);
  const addDocuments = useProjectStore(s => s.addDocuments);

  const removeDocument = useProjectStore(s => s.removeDocument);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [ocrPendingFile, setOcrPendingFile] = useState<string | null>(null);

  const handleDeleteDocument = async (docId: string, title: string) => {
    if (!confirm(`Delete "${title}"? This will also delete all associated annotations.`)) return;
    setDeletingId(docId);
    try {
      await documentsIpc.delete(docId);
      // If the deleted document was the active one, clear the active document
      if (useUiStore.getState().activeDocumentId === docId) {
        const remaining = documents.filter(d => d.id !== docId);
        useUiStore.getState().setActiveDocument(remaining.length > 0 ? remaining[0].id : null);
      }
      removeDocument(docId);
    } catch (e) {
      console.error('Failed to delete document:', e);
      toast.error(`Failed to delete document: ${e}`);
    } finally {
      setDeletingId(null);
    }
  };

  // We map the extractor to an icon for visual feedback
  const getIcon = (format: string) => {
    switch (format) {
      case 'txt': return <FileText className="w-4 h-4 text-slate-500" />;
      case 'docx': return <FileType2 className="w-4 h-4 text-blue-500" />;
      case 'pdf': return <File className="w-4 h-4 text-red-500" />;
      case 'ocr_pdf': return <File className="w-4 h-4 text-orange-500" />;
      case 'png':
      case 'jpg':
      case 'jpeg':
        return <Image className="w-4 h-4 text-purple-500" />;
      default: return <File className="w-4 h-4 text-slate-500" />;
    }
  };

  /**
   * Phase 1 OCR fallback path for image files (.png/.jpg/.jpeg).
   *
   * Reads the image bytes via Tauri's `convertFileSrc` (so the asset
   * is reachable from the renderer's local origin — the CSP'd context
   * blocks raw filesystem reads directly), runs Tesseract.js in a
   * module Web Worker, and forwards the recognised text to the
   * Rust-side `documents_import` with `fileFormat: 'ocr_pdf'` and
   * `extractorIdOverride` matching the Rust validator regex.
   *
   * Scope note (v0.1.4): PDF OCR is intentionally NOT wired here.
   * PDF page rendering (`pdf -> image`) requires `pdfjs-dist` which
   * is a v0.1.5+ dependency; the canonical PDF path remains the
   * Rust pdfplumber sidecar.
   */
  const handleOcrImageImport = async (imagePath: string) => {
    if (!activeProject) return;
    if (!confirm(
      'Run Tesseract.js OCR on this image and import as an `ocr_pdf` document?\n\n' +
      'The original image file is still copied to assets/ unchanged. ' +
      'Only the extracted text becomes searchable / codable.',
    )) {
      return;
    }
    setOcrPendingFile(imagePath);
    try {
      const imageUrl = convertFileSrc(imagePath);
      toast.info('Running Tesseract.js OCR...');
      const { text } = await runOcr(imageUrl);
      toast.success(`OCR complete (${text.length} chars)`);
      const doc = await documentsIpc.import({
        projectId: activeProject.id,
        filePath: imagePath,
        fileFormat: 'ocr_pdf',
        rawText: text,
        extractorIdOverride: TESSERACT_JS_EXTRACTOR_ID,
      } as Parameters<typeof documentsIpc.import>[0]);
      addDocuments([doc]);
      setActiveDocument(doc.id);
    } catch (e) {
      console.error(`OCR failed for ${imagePath}:`, e);
      toast.error(`OCR failed: ${e}`);
    } finally {
      setOcrPendingFile(null);
    }
  };

  /**
   * Phase 1.5 PDF OCR handle — renders PDF pages to images via pdf.js,
   * runs Tesseract.js OCR on each page, combines the text, and imports
   * as `ocr_pdf` with the tesseract.js extractor ID.
   */
  const handlePdfOcrImport = async (pdfPath: string) => {
    if (!activeProject) return;
    const run = confirm(
      'This PDF appears to have little or no embedded text.\n\n' +
      'Run Tesseract.js OCR on each page? This may take a while for large PDFs. ' +
      'The original PDF is preserved in assets/ ; only the recognised text is imported.',
    );
    if (!run) return;
    setOcrPendingFile(pdfPath);
    try {
      let toastId: string | number | undefined;
      const { text, pageCount, extractorId } = await runPdfOcr(pdfPath, (current, total) => {
        if (toastId !== undefined) {
          toast.info(`OCR page ${current} of ${total}...`, { id: toastId });
        } else {
          toastId = toast.info(`OCR page ${current} of ${total}...`);
        }
      });
      if (toastId !== undefined) toast.dismiss(toastId);
      toast.success(`OCR complete — ${pageCount} pages, ${text.length} chars`);
      const doc = await documentsIpc.import({
        projectId: activeProject.id,
        filePath: pdfPath,
        fileFormat: 'ocr_pdf',
        rawText: text,
        extractorIdOverride: extractorId,
      } as Parameters<typeof documentsIpc.import>[0]);
      addDocuments([doc]);
      setActiveDocument(doc.id);
    } catch (e) {
      console.error(`PDF OCR failed for ${pdfPath}:`, e);
      toast.error(`PDF OCR failed: ${e}`);
    } finally {
      setOcrPendingFile(null);
    }
  };

  /**
   * Phase 1 scanned-PDF detection: after pdfplumber returns text, check
   * whether it's suspiciously short. If the PDF has more than 1 page and
   * the extracted text is < 100 chars, surface the OCR dialog.
   */
  const checkScannedPdf = async (filePath: string, doc: DocumentRecord) => {
    if (!doc.plainText || doc.plainText.length >= 100) return;
    try {
      const pageCount = await getPdfPageCount(filePath);
      if (pageCount > 1) {
        await handlePdfOcrImport(filePath);
      }
    } catch {
      // page-count best-effort; don't block import on pdf.js failure
    }
  };

  const handleImport = async () => {
    if (!activeProject) return;
    const projectId = activeProject.id;
    const files = await open({
      multiple: true,
      filters: [
        {
          name: 'Documents',
          extensions: ['txt', 'docx', 'pdf', 'png', 'jpg', 'jpeg'],
        },
      ],
    });
    if (!files || files.length === 0) return;

    if (!confirm("Documents cannot be edited after import. Redact sensitive information before importing.\n\nProceed with import?")) {
      return;
    }

    const fileList = Array.isArray(files) ? files : [files];
    const newDocs: DocumentRecord[] = [];

    for (const filePath of fileList) {
      const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
      const supportedExts = ['txt', 'docx', 'pdf', 'png', 'jpg', 'jpeg'];
      if (!supportedExts.includes(ext)) {
        toast.error(`Unsupported file extension: ${ext}`);
        continue;
      }
      try {
        const doc = await documentsIpc.import({ projectId, filePath, fileFormat: ext });
        newDocs.push(doc);
        // Phase 1.5: scanned-PDF detection for pdfplumber imports
        if (ext === 'pdf') {
          checkScannedPdf(filePath, doc);
        }
      } catch (e) {
        // Phase 1.5: pdf.js fallback — if the Rust pdfplumber sidecar
        // fails (missing binary, encrypted PDF, etc.), extract text
        // in the browser via pdf.js and retry via the `rawText` path.
        if (ext === 'pdf') {
          try {
            toast.info('pdfplumber unavailable — falling back to pdf.js...');
            const text = await extractPdfText(filePath);
            toast.success(`pdf.js extracted ${text.length} chars`);
            const doc = await documentsIpc.import({
              projectId,
              filePath,
              fileFormat: 'pdf',
              rawText: text,
              extractorIdOverride: undefined,
            } as Parameters<typeof documentsIpc.import>[0]);
            newDocs.push(doc);
            checkScannedPdf(filePath, doc);
          } catch (fallbackErr) {
            console.error(`pdf.js fallback also failed for ${filePath}:`, fallbackErr);
            toast.error(`Failed to import PDF ${filePath}: both pdfplumber and pdf.js failed`);
          }
        } else {
          console.error(`Failed to import ${filePath}:`, e);
          toast.error(`Failed to import ${filePath}: ${e}`);
        }
      }
    }

    if (newDocs.length > 0) {
      addDocuments(newDocs);
      setActiveDocument(newDocs[0].id);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 border-r border-slate-200">
      <div className="p-4 border-b border-slate-200 flex justify-between items-center">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Documents</h2>
        <button 
          onClick={handleImport}
          className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-800 px-2 py-1 rounded transition-colors"
        >
          Import
        </button>
        <button
          title="Run Tesseract.js OCR on an image file and import as ocr_pdf"
          onClick={async () => {
            if (!activeProject) return;
            const files = await open({
              multiple: false,
              filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
            });
            if (!files) return;
            const filePath = Array.isArray(files) ? files[0] : files;
            await handleOcrImageImport(filePath);
          }}
          disabled={ocrPendingFile !== null}
          className="text-xs bg-orange-100 hover:bg-orange-200 text-orange-800 px-2 py-1 rounded transition-colors flex items-center gap-1 disabled:opacity-50"
        >
          <ScanLine className="w-3 h-3" />
          {ocrPendingFile ? 'OCR...' : 'OCR'}
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2">
        {documents.length === 0 ? (
          <div className="text-sm text-slate-500 p-4 text-center">
            No documents imported yet.
          </div>
        ) : (
          <ul className="space-y-1">
            {documents.map(doc => (
              <li key={doc.id} className="group flex items-center">
                <button
                  onClick={() => setActiveDocument(doc.id)}
                  className={`flex-1 flex items-center space-x-3 px-3 py-2 rounded-md text-sm text-left transition-colors ${
                    activeDocumentId === doc.id 
                      ? 'bg-blue-100 text-blue-900 font-medium' 
                      : 'hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  {getIcon(doc.fileFormat)}
                  <span className="truncate flex-1">{doc.title}</span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteDocument(doc.id, doc.title); }}
                  disabled={deletingId === doc.id}
                  className="px-2 py-1 opacity-0 group-hover:opacity-100 hover:bg-red-100 rounded transition-all text-red-500 hover:text-red-700 disabled:opacity-50"
                  title="Delete document"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
