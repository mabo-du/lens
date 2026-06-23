
import { useProjectStore } from '@/store/projectStore';
import { useUiStore } from '@/store/uiStore';
import { FileText, File, FileType2 } from 'lucide-react';
import { documentsIpc, DocumentRecord } from '@/ipc/documents';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
// DOCX extraction via Mammoth.js — keep version in sync with
// MAMMOTH_EXTRACTOR_ID in src-tauri/src/commands/import.rs.
import * as mammoth from 'mammoth';
import { toast } from 'sonner';

export function DocumentList() {
  const documents = useProjectStore(s => s.documents);
  const activeDocumentId = useUiStore(s => s.activeDocumentId);
  const setActiveDocument = useUiStore(s => s.setActiveDocument);
  const activeProject = useProjectStore(s => s.activeProject);
  const addDocuments = useProjectStore(s => s.addDocuments);

  // We map the extractor to an icon for visual feedback
  const getIcon = (format: string) => {
    switch (format) {
      case 'txt': return <FileText className="w-4 h-4 text-slate-500" />;
      case 'docx': return <FileType2 className="w-4 h-4 text-blue-500" />;
      case 'pdf': return <File className="w-4 h-4 text-red-500" />;
      case 'ocr_pdf': return <File className="w-4 h-4 text-orange-500" />;
      default: return <File className="w-4 h-4 text-slate-500" />;
    }
  };

  const handleImport = async () => {
    if (!activeProject) return;
    const projectId = activeProject.id;
    const files = await open({
      multiple: true,
      filters: [{ name: 'Documents', extensions: ['txt', 'docx', 'pdf'] }],
    });
    if (!files || files.length === 0) return;

    if (!confirm("Documents cannot be edited after import. Redact sensitive information before importing.\n\nProceed with import?")) {
      return;
    }

    const fileList = Array.isArray(files) ? files : [files];
    const newDocs: DocumentRecord[] = [];

    for (const filePath of fileList) {
      const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
      try {
        if (ext === 'docx') {
          const fileData = await readFile(filePath);
          const result = await mammoth.extractRawText({ arrayBuffer: fileData.buffer });
          const doc = await documentsIpc.import({ projectId, filePath, fileFormat: 'docx', rawText: result.value });
          newDocs.push(doc);
        } else if (ext === 'txt' || ext === 'pdf') {
          const doc = await documentsIpc.import({ projectId, filePath, fileFormat: ext });
          newDocs.push(doc);
        }
      } catch (e) {
        console.error(`Failed to import ${filePath}:`, e);
        toast.error(`Failed to import ${filePath}: ${e}`);
      }
    }

    if (newDocs.length > 0) {
      addDocuments(newDocs);
      setActiveDocument(newDocs[0].id);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 border-r border-slate-200">
      <div className="p-4 border-b border-slate-200 flex justify-between items-center">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Documents</h2>
        <button 
          onClick={handleImport}
          className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-800 px-2 py-1 rounded transition-colors"
        >
          Import
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2">
        {documents.length === 0 ? (
          <div className="text-sm text-slate-500 p-4 text-center">
            No documents imported yet.
          </div>
        ) : (
          <ul className="space-y-1">
            {documents.map(doc => (
              <li key={doc.id}>
                <button
                  onClick={() => setActiveDocument(doc.id)}
                  className={`w-full flex items-center space-x-3 px-3 py-2 rounded-md text-sm text-left transition-colors ${
                    activeDocumentId === doc.id 
                      ? 'bg-blue-100 text-blue-900 font-medium' 
                      : 'hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  {getIcon(doc.fileFormat)}
                  <span className="truncate flex-1">{doc.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
