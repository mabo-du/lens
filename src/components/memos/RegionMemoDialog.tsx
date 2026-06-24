import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useProjectStore } from '@/store/projectStore';
import { memosIpc } from '@/ipc/memos';
import { toast } from 'sonner';

/**
 * Memo dialog for an image region OR polygon (text annotation memos
 * keep using `AnnotationMemoDialog` which has a Delete button on the
 * textarea — text annotations are deleted from the memo dialog;
 * image shapes get deletion from the ImageViewer's action menu
 * because the action menu also exposes the Memo affordance).
 *
 * The caller supplies `codeName` so the dialog can show the code
 * context without needing access to the text-annotations store. The
 * underlying memo is fetched via `memosIpc.get(projectId, null,
 * selectionId)` — that part is identical to AnnotationMemoDialog
 * because the memo table's `linked_selection_id` column already
 * supports any selection type.
 *
 * Autosave is wrapped in try/catch/finally so a rejected save (FK
 * violation on a concurrent shape delete, IPC error, etc.) surfaces
 * a toast AND resets the "Saving..." indicator — otherwise a caught
 * rejection would leave the indicator stuck.
 */
export function RegionMemoDialog({
  selectionId,
  codeName,
  onClose,
}: {
  selectionId: string | null;
  codeName: string;
  onClose: () => void;
}) {
  const activeProject = useProjectStore(s => s.activeProject);
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clear pending timeout on unmount.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Load existing memo body when target selectionId arrives.
  useEffect(() => {
    if (selectionId && activeProject) {
      memosIpc
        .get(activeProject.id, null, selectionId)
        .then(memo => setContent(memo?.body ?? ''));
    }
  }, [selectionId, activeProject]);

  // Cancel pending save when target selectionId leaves.
  useEffect(() => {
    if (!selectionId) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  }, [selectionId]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setContent(value);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(async () => {
      if (activeProject && selectionId) {
        setIsSaving(true);
        try {
          await memosIpc.save(activeProject.id, value, null, selectionId);
        } catch (e) {
          // Surface save failures — `setIsSaving(false)` would otherwise
          // never fire and the dialog would be stuck on "Saving...".
          console.error('Failed to save memo:', e);
          toast.error(`Failed to save memo: ${String(e)}`);
        } finally {
          setIsSaving(false);
        }
      }
    }, 1000);
  };

  return (
    <Dialog open={!!selectionId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Region Memo</DialogTitle>
          <div className="text-sm text-slate-500">
            For code: <span className="font-semibold text-slate-700">{codeName}</span>
          </div>
        </DialogHeader>
        <div className="mt-4 relative flex flex-col h-48">
          <textarea
            className="w-full h-full p-3 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-sm"
            placeholder="Write a memo for this region..."
            value={content}
            onChange={handleChange}
            disabled={!selectionId}
          />
          <div className="absolute bottom-3 right-4 flex items-center space-x-3">
            <span className="text-xs text-slate-400">
              {isSaving ? 'Saving...' : 'Saved'}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
