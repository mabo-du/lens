import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useProjectStore } from '@/store/projectStore';
import { CodeTreeNode } from '@/ipc/codes';
import { memosIpc } from '@/ipc/memos';

export function AnnotationMemoDialog({ annotationId, onClose }: { annotationId: string | null, onClose: () => void }) {
  const activeProject = useProjectStore(s => s.activeProject);
  const annotations = useProjectStore(s => s.annotations);
  const codes = useProjectStore(s => s.codes);
  
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const annotation = annotations.find(a => a.id === annotationId);
  // flatten codes to find name
  let codeName = 'Unknown Code';
  if (annotation) {
    const flatten = (nodes: CodeTreeNode[]): CodeTreeNode[] => nodes.reduce((acc, n) => [...acc, n, ...(n.children ? flatten(n.children) : [])], [] as CodeTreeNode[]);
    const flatCodes = flatten(codes);
    codeName = flatCodes.find(c => c.id === annotation.codeId)?.name || 'Unknown Code';
  }

  // Clean up timeout on unmount (ACTION_PLAN P2.2)
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (annotationId && activeProject) {
      memosIpc.get(activeProject.id, null, annotationId).then(memo => {
        setContent(memo?.body || '');
      });
    }
  }, [annotationId, activeProject]);

  // Clean up timeout when dialog closes (ACTION_PLAN P2.2)
  useEffect(() => {
    if (!annotationId) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  }, [annotationId]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value; // capture before timeout (ACTION_PLAN B3)
    setContent(value);
    
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    
    timeoutRef.current = setTimeout(async () => {
      if (activeProject && annotationId) {
        setIsSaving(true);
        await memosIpc.save(activeProject.id, value, null, annotationId);
        setIsSaving(false);
      }
    }, 1000);
  };

  return (
    <Dialog open={!!annotationId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Annotation Memo</DialogTitle>
          <div className="text-sm text-slate-500">For code: <span className="font-semibold text-slate-700">{codeName}</span></div>
        </DialogHeader>
        <div className="mt-4 relative flex flex-col h-48">
          <textarea
            className="w-full h-full p-3 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-sm"
            placeholder="Write a memo for this specific annotation..."
            value={content}
            onChange={handleChange}
          />
          <div className="absolute bottom-3 right-4 text-xs text-slate-400">
            {isSaving ? 'Saving...' : 'Saved'}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
