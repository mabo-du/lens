import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useProjectStore } from '@/store/projectStore';
import { memosIpc } from '@/ipc/memos';

export function ProjectJournalDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (o: boolean) => void }) {
  const activeProject = useProjectStore(s => s.activeProject);
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (open && activeProject) {
      memosIpc.get(activeProject.id).then(memo => {
        setContent(memo?.body || '');
      });
    }
  }, [open, activeProject]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Cancel pending save when dialog closes
  useEffect(() => {
    if (!open) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  }, [open]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value; // capture before timeout closure
    setContent(value);
    
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    
    timeoutRef.current = setTimeout(async () => {
      if (activeProject) {
        setIsSaving(true);
        await memosIpc.save(activeProject.id, value);
        setIsSaving(false);
      }
    }, 1000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] h-[600px] flex flex-col">
        <DialogHeader>
          <DialogTitle>Project Journal</DialogTitle>
        </DialogHeader>
        <div className="flex-1 mt-4 relative flex flex-col">
          <textarea
            className="w-full h-full p-4 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-sans text-sm"
            placeholder="Write your reflexive journal notes here..."
            value={content}
            onChange={handleChange}
          />
          <div className="absolute bottom-4 right-6 text-xs text-slate-400">
            {isSaving ? 'Saving...' : 'Saved'}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
