import { invoke } from '@tauri-apps/api/core';

export interface Code {
  id: string;
  projectId: string;
  name: string;
  color: string;
  description: string | null;
  createdAt: string;
}

export interface CodeTreeNode extends Code {
  children: CodeTreeNode[];
  depth: number;
}

export interface CreateCodePayload {
  projectId: string;
  parentId: string | null;
  name: string;
  color: string | null;
}

export const codesIpc = {
  create:      (p: CreateCodePayload)          => invoke<Code>('codes_create', { ...p }),
  getTree:     (projectId: string)             => invoke<CodeTreeNode[]>('codes_get_tree', { projectId }),
  move:        (id: string, newParentId: string | null) => invoke<void>('codes_move', { id, newParentId }),
  update:      (id: string, patch: Partial<Pick<Code, 'name' | 'color' | 'description'>>) =>
                                                 invoke<Code>('codes_update', { id, ...patch }),
  delete:      (id: string)                    => invoke<void>('codes_delete', { id }),
  getSubtree:  (id: string)                    => invoke<CodeTreeNode[]>('codes_get_subtree', { id }),
};
