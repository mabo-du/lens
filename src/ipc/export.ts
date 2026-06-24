import { invoke } from '@tauri-apps/api/core';
import { ExportPayload } from '../export/ExporterPlugin';

export const exportIpc = {
  prepare: (projectId: string) => 
    invoke<ExportPayload>('export_prepare', { projectId }),
};
