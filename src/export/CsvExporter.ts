import { ExportPayload, ExportPlugin, exporterRegistry } from './ExporterPlugin';
import type { CodeTreeNode } from '@/ipc/codes';

export const CsvExporter: ExportPlugin = {
  id: 'csv',
  label: 'Annotations (CSV)',
  fileExtension: 'csv',
  mimeType: 'text/csv',
  
  async export(payload: ExportPayload): Promise<string> {
    const lines: string[] = [];
    
    // Header
    lines.push(['Document', 'Code', 'Code ID', 'Start Char', 'End Char', 'Memo', 'Text Segment'].map(escapeCsv).join(','));

    // We need to map code IDs to code names
    const codeMap = new Map<string, string>();
    const flattenCodes = (nodes: CodeTreeNode[]) => {
      for (const node of nodes) {
        codeMap.set(node.id, node.name);
        if (node.children) flattenCodes(node.children);
      }
    };
    flattenCodes(payload.codes);

    // Map doc IDs to docs
    const docMap = new Map(payload.documents.map(d => [d.id, d]));
    
    // Map annotations to memos
    const memoMap = new Map(payload.memos.map(m => [m.linkedSelectionId, m.body]));

    for (const ann of payload.annotations) {
      const doc = docMap.get(ann.documentId);
      if (!doc) continue;
      
      const codeName = codeMap.get(ann.codeId) || 'Unknown Code';
      const memo = memoMap.get(ann.id) || '';
      
      // Extract text segment
      const segment = (doc.plainText ?? '').substring(ann.startChar, ann.endChar);
      
      lines.push([
        doc.title,
        codeName,
        ann.codeId,
        ann.startChar.toString(),
        ann.endChar.toString(),
        memo,
        segment
      ].map(escapeCsv).join(','));
    }

    return lines.join('\n');
  }
};

function escapeCsv(field: string): string {
  if (field === null || field === undefined) return '""';
  const str = String(field);
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

exporterRegistry.register(CsvExporter);
