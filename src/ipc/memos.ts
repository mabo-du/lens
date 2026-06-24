import { invoke } from '@tauri-apps/api/core';

export interface MemoRecord {
  id: string;
  projectId: string;
  linkedCodeId: string | null;
  linkedSelectionId: string | null;
  body: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export const memosIpc = {
  save: (projectId: string, body: string, linkedCodeId: string | null = null, linkedSelectionId: string | null = null) => 
    invoke<MemoRecord>('memos_save', { projectId, linkedCodeId, linkedSelectionId, body }),

  get: (projectId: string, linkedCodeId: string | null = null, linkedSelectionId: string | null = null) => 
    invoke<MemoRecord | null>('memos_get', { projectId, linkedCodeId, linkedSelectionId }),

  listByProject: (projectId: string) =>
    invoke<MemoRecord[]>('memos_list_by_project', { projectId }),
};
