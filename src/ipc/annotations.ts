import { invoke } from '@tauri-apps/api/core';

export interface AnnotationRecord {
  id: string;
  documentId: string;
  codeId: string;
  startChar: number;
  endChar: number;
  createdBy: string;
  createdAt: string;
}

export interface AnnotationSegmentRecord extends AnnotationRecord {
  title: string;
  plainText: string;
}

export interface CreateAnnotationPayload {
  documentId: string;
  codeId: string;
  startChar: number;
  endChar: number;
}

export const annotationsIpc = {
  create: (p: CreateAnnotationPayload) => invoke<AnnotationRecord>('annotations_create', { ...p }),
  delete: (id: string) => invoke<void>('annotations_delete', { id }),
  listByDocument: (documentId: string) => invoke<AnnotationRecord[]>('annotations_list_by_document', { documentId }),
  listByCode: (codeId: string) => invoke<AnnotationSegmentRecord[]>('annotations_list_by_code', { codeId }),
};
