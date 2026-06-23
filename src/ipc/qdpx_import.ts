import { invoke } from '@tauri-apps/api/core';

export const qdpxImportIpc = {
  import: (filePath: string, mode: 'merge' | 'replace') =>
    invoke<string>('qdpx_import', { filePath, mode }),
  undo: () => invoke<string>('qdpx_import_undo'),
};
