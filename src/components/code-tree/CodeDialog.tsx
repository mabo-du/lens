import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useProjectStore } from '@/store/projectStore';
import { codesIpc, CodeTreeNode } from '@/ipc/codes';
import { CodeNodeMeta } from './CodeTree';
import { InlineCodePicker } from '@/components/ui/InlineCodePicker';
import { toast } from 'sonner';

const PRESET_COLORS = [
  '#6366f1', '#0891b2', '#059669', '#d97706',
  '#dc2626', '#7c3aed', '#db2777', '#65a30d',
  '#0284c7', '#9333ea', '#ea580c', '#0d9488',
];

interface CodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  codeToEdit?: CodeNodeMeta;
  initialParentId?: string;
}

export function CodeDialog({ open, onOpenChange, codeToEdit, initialParentId }: CodeDialogProps) {
  const activeProject = useProjectStore(s => s.activeProject);
  const codes = useProjectStore(s => s.codes);
  const setCodes = useProjectStore(s => s.setCodes);

  const [name, setName] = useState('');
  const [color, setColor] = useState<string | null>(PRESET_COLORS[0]);
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState<string | null>(initialParentId || null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      if (codeToEdit) {
        setName(codeToEdit.name);
        setColor(codeToEdit.color || null);
        setDescription(codeToEdit.description || '');
        // Reparenting: seed with the current parent (extracted from the tree).
        setParentId(findParentId(codes, codeToEdit.id));
      } else {
        setName('');
        setColor(null);
        setDescription('');
        setParentId(initialParentId || null);
      }
    }
  }, [open, codeToEdit, initialParentId]);

  // Walk the code tree to find the parent of a given node ID.
  // Returns null for root-level codes, or a parent ID string.
  function findParentId(nodes: CodeTreeNode[], targetId: string, parent?: string): string | null {
    for (const node of nodes) {
      if (node.id === targetId) return parent ?? null;
      if (node.children?.length) {
        const found = findParentId(node.children, targetId, node.id);
        if (found !== undefined) return found;
      }
    }
    return null;
  }

  // Build parent-code options: "Root Level" sentinel + indent-hinted flat list.
  // Excludes the code being edited to prevent accidental self-referencing cycles.
  const parentCodeOptions = useMemo(() => {
    const opts: { id: string; name: string; color: string }[] = [
      { id: '', name: '— Root Level —', color: '#94a3b8' },
    ];
    (function collect(nodes: CodeTreeNode[], depth: number) {
      for (const node of nodes) {
        // Skip the code being edited itself (prevents self-referencing cycle).
        if (codeToEdit && node.id === codeToEdit.id) continue;
        const indent = '\u00A0\u00A0'.repeat(depth);
        opts.push({ id: node.id, name: indent + node.name, color: node.color ?? '#94a3b8' });
        if (node.children?.length) collect(node.children, depth + 1);
      }
    })(codes, 0);
    return opts;
  }, [codes, codeToEdit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject || !name.trim()) return;

    setIsSubmitting(true);
    try {
      if (codeToEdit) {
        await codesIpc.update(codeToEdit.id, { 
          name: name.trim(), 
          color: color ?? undefined, 
          description: description.trim() || undefined,
        });
        // Reparent if the user changed the parent selection.
        const currentParent = findParentId(codes, codeToEdit.id);
        if (parentId !== currentParent) {
          await codesIpc.move(codeToEdit.id, parentId || null);
        }
      } else {
        await codesIpc.create({
          projectId: activeProject.id, 
          parentId: parentId, 
          name: name.trim(), 
          color 
        });
      }
      const updated = await codesIpc.getTree(activeProject.id);
      setCodes(updated);
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to save code:', err);
      toast.error('Error saving code. Check console.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{codeToEdit ? 'Edit Code' : 'New Code'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <label htmlFor="code-name" className="text-sm font-medium">Name</label>
            <input
              id="code-name"
              type="text"
              className="w-full px-3 py-2 border rounded-md"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <fieldset className="border-0 p-0 m-0">
              <legend className="text-sm font-medium px-0">Color</legend>
              <div className="flex flex-wrap gap-2 mb-2 mt-2">
                {/* Auto-assign option (only when creating, not editing) */}
                {!codeToEdit && (
                  <button
                    type="button"
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] leading-none font-bold ${color === null ? 'border-slate-900 scale-110 bg-slate-100' : 'border-slate-200 bg-slate-50 text-slate-400 hover:border-slate-400'}`}
                    onClick={() => setColor(null)}
                    title="Auto-assign from palette"
                  >
                    A
                  </button>
                )}
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    className={`w-6 h-6 rounded-full border-2 ${color === c ? 'border-slate-900 scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setColor(c)}
                    aria-label={`Set color to ${c}`}
                  />
                ))}
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="color"
                  value={color ?? '#6366f1'}
                  onChange={e => setColor(e.target.value)}
                  aria-label="Custom color picker"
                  className="w-8 h-8 rounded cursor-pointer"
                  disabled={color === null}
                />
                <input
                  type="text"
                  value={color ?? ''}
                  onChange={e => setColor(e.target.value || null)}
                  placeholder="Auto (palette assigned)"
                  aria-label="Custom color hex value"
                  className="flex-1 px-3 py-1 border rounded-md font-mono text-sm uppercase"
                  pattern="^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$"
                />
              </div>
            </fieldset>
          </div>

          <div className="space-y-2">
            <label htmlFor="code-parent" className="text-sm font-medium">Parent Code</label>
            <InlineCodePicker
              id="code-parent"
              codes={parentCodeOptions}
              selectedCodeId={parentId ?? ''}
              onSelect={(id) => setParentId(id || null)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="code-description" className="text-sm font-medium">Description</label>
            <textarea
              id="code-description"
              className="w-full px-3 py-2 border rounded-md h-24 resize-none"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description of when to apply this code..."
            />
          </div>

          <DialogFooter>
            <button
              type="button"
              className="px-4 py-2 text-sm border rounded-md hover:bg-slate-50"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : 'Save Code'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
