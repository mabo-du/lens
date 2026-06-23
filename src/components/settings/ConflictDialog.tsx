import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export function ConflictDialog({
  open,
  onMerge,
  onReplace,
  onCancel,
}: {
  open: boolean;
  onMerge: () => void;
  onReplace: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Import Conflict</DialogTitle>
          <DialogDescription>
            Project already contains data. How should the import proceed?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <button
            onClick={onMerge}
            className="w-full px-4 py-3 text-left rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors"
          >
            <div className="font-semibold text-blue-800 text-sm">Merge</div>
            <div className="text-xs text-blue-600 mt-0.5">
              Add imported items alongside existing data
            </div>
          </button>

          <button
            onClick={onReplace}
            className="w-full px-4 py-3 text-left rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 transition-colors"
          >
            <div className="font-semibold text-red-800 text-sm">Replace</div>
            <div className="text-xs text-red-600 mt-0.5">
              Delete all existing data first, then import
            </div>
          </button>

          <div className="flex justify-end">
            <button
              onClick={onCancel}
              className="px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded transition-colors"
            >
              Cancel Import
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
