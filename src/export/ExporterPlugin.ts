import { Project } from '@/ipc/projects';
import { DocumentRecord } from '@/ipc/documents';
import { CodeTreeNode } from '@/ipc/codes';
import { AnnotationRecord } from '@/ipc/annotations';
import { MemoRecord } from '@/ipc/memos';

export interface ExportPayload {
  project: Project;
  documents: DocumentRecord[];
  codes: CodeTreeNode[];         // full hierarchy
  annotations: AnnotationRecord[]; // text selections joined with code_id
  memos: MemoRecord[];
  // localUser is MVP fallback
  localUser: { id: string; displayName: string };
  projectFolderPath: string;
}

export interface ExportPlugin {
  readonly id: string;           // e.g. 'qdpx' | 'qdc' | 'csv' | 'html'
  readonly label: string;        // Human-readable name shown in export menu
  readonly fileExtension: string;
  readonly mimeType: string;
  
  // Return either a binary array for things like zip, or string for plain text/CSV
  export(payload: ExportPayload): Promise<Uint8Array | string>;
}

export class ExporterRegistry {
  private plugins = new Map<string, ExportPlugin>();
  
  register(plugin: ExportPlugin) { 
    this.plugins.set(plugin.id, plugin); 
  }
  
  get(id: string): ExportPlugin | undefined { 
    return this.plugins.get(id); 
  }
  
  list(): ExportPlugin[] { 
    return [...this.plugins.values()]; 
  }
}

export const exporterRegistry = new ExporterRegistry();
