import { invoke } from '@tauri-apps/api/core';

export interface SearchResult {
  sourceType: string;
  sourceId: string;
  sourceName: string;
  snippet: string;
  sortOrder: number;
}

export const searchIpc = {
  query: (projectId: string, query: string, codeIdFilter: string | null = null) => 
    invoke<SearchResult[]>('search_query', { projectId, query, codeIdFilter }),
};
