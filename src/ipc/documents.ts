import { invoke } from '@tauri-apps/api/core';

export interface DocumentRecord {
  id: string;
  projectId: string;
  title: string;
  originalPath: string | null;
  fileFormat: string;
  plainText?: string;
  textHash: string;
  extractorId: string;
  wordCount: number;
  /** Intrinsic image width (pixels). Null for non-image documents. */
  intrinsicW?: number | null;
  /** Intrinsic image height (pixels). Null for non-image documents. */
  intrinsicH?: number | null;
  importedAt: string;
  sortOrder: number;
}

export type ImportPayload = 
  | { projectId: string; filePath: string; fileFormat: string }
  | { projectId: string; filePath: string; fileFormat: string; rawText: string };

export interface DocumentAsset {
  /** base64-encoded PNG/JPG/JPEG bytes */
  b64: string;
  /** MIME type for reconstructing a data: URL on the renderer: image/png | image/jpeg */
  mime: string;
}

export const documentsIpc = {
  import: (p: ImportPayload) => invoke<DocumentRecord>('documents_import', p),
  list: (projectId: string) => invoke<DocumentRecord[]>('documents_list', { projectId }),
  getContent: (id: string) => invoke<string>('document_get_content', { id }),
  getAsset: (id: string) => invoke<DocumentAsset>('document_get_asset_base64', { id }),
  delete: (id: string) => invoke<void>('document_delete', { id }),
};
