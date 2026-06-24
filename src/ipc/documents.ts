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
  importedAt: string;
  sortOrder: number;
}

export type ImportPayload = 
  | { projectId: string; filePath: string; fileFormat: string }
  | { projectId: string; filePath: string; fileFormat: string; rawText: string };

export const documentsIpc = {
  import: (p: ImportPayload) => invoke<DocumentRecord>('documents_import', p),
  list: (projectId: string) => invoke<DocumentRecord[]>('documents_list', { projectId }),
  getContent: (id: string) => invoke<string>('document_get_content', { id }),
  delete: (id: string) => invoke<void>('document_delete', { id }),
};
