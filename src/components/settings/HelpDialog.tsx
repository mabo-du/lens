import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const SHORTCUTS = [
  { keys: 'Ctrl+K', description: 'Assign a code to selected text', context: 'Document Editor' },
  { keys: 'Ctrl+Z', description: 'Undo last annotation (create or delete)', context: 'Anywhere' },
  { keys: 'Ctrl+Shift+Z / Ctrl+Y', description: 'Redo undone annotation action', context: 'Anywhere' },
  { keys: 'Ctrl+F', description: 'Open search panel', context: 'Anywhere' },

  { keys: 'Click project name', description: 'Rename the current project', context: 'Top bar' },
  { keys: 'Right-click highlight', description: 'Edit annotation memo or delete annotation', context: 'Document Editor' },
  { keys: 'Right-click code', description: 'Create child code, rename, or delete', context: 'Code Tree' },
  { keys: 'Double-click code', description: 'Rename code inline', context: 'Code Tree' },
  { keys: 'Drag code node', description: 'Move code to new parent in tree', context: 'Code Tree' },
];

export function HelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>

        <div className="mt-2 space-y-1 max-h-96 overflow-y-auto">
          {SHORTCUTS.map((s) => (
            <div
              key={s.keys}
              className="flex items-center justify-between px-3 py-2 rounded hover:bg-slate-50"
            >
              <div className="flex-1">
                <div className="text-sm text-slate-700">{s.description}</div>
                <div className="text-xs text-slate-400">{s.context}</div>
              </div>
              <kbd className="ml-4 px-2 py-0.5 text-xs font-mono bg-slate-100 border border-slate-300 rounded text-slate-600 whitespace-nowrap">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-400 mt-3 text-center">
          Use Cmd instead of Ctrl on macOS
        </p>
      </DialogContent>
    </Dialog>
  );
}
