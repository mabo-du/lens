import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useProjectStore } from '@/store/projectStore';
import { useUiStore } from '@/store/uiStore';
import { CodeTreeNode } from '@/ipc/codes';
import { memosIpc } from '@/ipc/memos';
import { annotationsIpc } from '@/ipc/annotations';
import { toast } from 'sonner';

export function AnnotationMemoDialog({ annotationId, onClose }: { annotationId: string | null, onClose: () => void }) {
  const activeProject = useProjectStore(s => s.activeProject);
  const annotations = useProjectStore(s => s.annotations);
  const codes = useProjectStore(s => s.codes);
  
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const removeAnnotation = useProjectStore(s => s.removeAnnotation);
  const pushUndo = useUiStore(s => s.pushUndo);

  const annotation = annotations.find(a => a.id === annotationId);
  // flatten codes to find name
  let codeName = 'Unknown Code';
  if (annotation) {
    const flatten = (nodes: CodeTreeNode[]): CodeTreeNode[] => nodes.reduce((acc, n) => [...acc, n, ...(n.children ? flatten(n.children) : [])], [] as CodeTreeNode[]);
    const flatCodes = flatten(codes);
    codeName = flatCodes.find(c => c.id === annotation.codeId)?.name || 'Unknown Code';
  }

  // Clean up pending write timeout on unmount
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

  // Cancel pending save when dialog closes
  useEffect(() => {
    if (!annotationId) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  }, [annotationId]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value; // capture before timeout closure
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
          <div className="absolute bottom-3 right-4 flex items-center space-x-3">
            <button
              className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
              disabled={isDeleting}
              onClick={async () => {
                if (!annotationId || !activeProject) return;
                if (!confirm('Delete this annotation? This cannot be undone.')) return;
                setIsDeleting(true);
                try {
                  // Push undo entry before deleting
                  if (annotation) {
                    pushUndo({ action: 'create', annotation });
                  }
                  await annotationsIpc.delete(annotationId);
                  removeAnnotation(annotationId);
                  onClose();
                } catch (e) {
                  console.error('Failed to delete annotation', e);
                  toast.error('Failed to delete annotation');
                } finally {
                  setIsDeleting(false);
                }
              }}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
            <span className="text-xs text-slate-400">
              {isSaving ? 'Saving...' : 'Saved'}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
