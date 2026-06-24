import { useEffect, useState } from 'react';
import { useUiStore } from '@/store/uiStore';
import { useProjectStore } from '@/store/projectStore';
import { annotationsIpc, AnnotationSegmentRecord } from '@/ipc/annotations';
import { flattenCodeTree } from '../editor/QdaAnnotationPlugin';

function extractWithContext(plainText: string, startChar: number, endChar: number, contextLines = 2): string {
  const lines = plainText.split('\n');
  let charCount = 0;
  let startLine = 0, endLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineEnd = charCount + lines[i].length;
    if (charCount <= startChar && startChar <= lineEnd) startLine = i;
    if (charCount <= endChar && endChar <= lineEnd) { endLine = i; break; }
    charCount += lines[i].length + 1; // +1 for the \n
  }

  const from = Math.max(0, startLine - contextLines);
  const to = Math.min(lines.length - 1, endLine + contextLines);
  return lines.slice(from, to + 1).join('\n');
}

export function CodeSegments() {
  const activeCodeViewId = useUiStore(s => s.activeCodeViewId);
  const setActiveCodeView = useUiStore(s => s.setActiveCodeView);
  const setActiveDocument = useUiStore(s => s.setActiveDocument);
  const codes = useProjectStore(s => s.codes);
  
  const [segments, setSegments] = useState<AnnotationSegmentRecord[]>([]);

  const activeCode = flattenCodeTree(codes).find(c => c.id === activeCodeViewId);

  useEffect(() => {
    if (!activeCodeViewId) return;
    async function fetchSegments() {
      try {
        const data = await annotationsIpc.listByCode(activeCodeViewId!);
        setSegments(data);
      } catch (e) {
        console.error("Failed to fetch segments", e);
      }
    }
    fetchSegments();
  }, [activeCodeViewId]);

  if (!activeCodeViewId || !activeCode) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-slate-200 bg-slate-100 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full border border-black/20" style={{ backgroundColor: activeCode.color }} />
          <h3 className="font-medium text-slate-800">{activeCode.name}</h3>
        </div>
        <button 
          onClick={() => setActiveCodeView(null)}
          className="text-xs text-slate-500 hover:text-slate-800"
        >
          Close
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {segments.length === 0 ? (
          <div className="text-sm text-slate-500 text-center">No annotations found for this code.</div>
        ) : (
          segments.map(seg => {
            const context = extractWithContext(seg.plainText, seg.startChar, seg.endChar, 2);
            return (
              <div key={seg.id} className="text-sm border border-slate-200 rounded-md bg-white shadow-sm overflow-hidden">
                <div className="bg-slate-50 border-b border-slate-200 px-3 py-2 flex justify-between">
                  <span className="font-medium text-slate-700">{seg.title}</span>
                  <button 
                    onClick={() => setActiveDocument(seg.documentId)}
                    className="text-blue-600 hover:underline"
                  >
                    Go to Document
                  </button>
                </div>
                <div className="p-3 text-slate-600 whitespace-pre-wrap font-serif">
                  {context}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
