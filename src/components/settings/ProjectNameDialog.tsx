import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { validateProjectNameClient } from '@/lib/validation';

/**
 * Modal dialog that resolves to the trimmed name the user typed, or null on cancel.
 *
 * Mirrors `EncryptionDialog`'s shape (shadcn/ui `Dialog` primitives) but for a
 * single plain-text input. Used by App.tsx's `handleCreateProject` flow.
 *
 * Validation rules surfaced in-dialog match `validate_project_name` on the
 * Rust side so the user gets immediate feedback before submitting:
 *   - Must not be empty (after trim).
 *   - Must be 64 characters or fewer.
 *   - Must not contain path traversal segments (`..` / `.`).
 *   - Must not be an absolute path (`/`).
 *   - Allowed characters: A-Z, a-z, 0-9, space, dot, underscore, hyphen.
 *
 * The Rust side re-validates on submit; these checks are purely UX.
 */
export function ProjectNameDialog({
  open,
  onConfirm,
  onCancel,
  initialValue = '',
}: {
  open: boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
  initialValue?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState('');

  const liveError = error || validateProjectNameClient(value);

  const handleSubmit = () => {
    const trimmed = value.trim();
    const err = validateProjectNameClient(trimmed);
    if (err) {
      setError(err);
      return;
    }
    onConfirm(trimmed);
  };

  const handleClose = () => {
    setValue(initialValue);
    setError('');
    onCancel();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Project Name</DialogTitle>
          <DialogDescription>
            Choose a name for your project. It will become a folder under the
            parent directory you picked. If a project with this name already
            exists, you'll need to pick a different one — your selected
            encryption passphrase is preserved but won't be applied until the
            project name is accepted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          <input
            id="project-name"
            autoFocus
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
              if (e.key === 'Escape') handleClose();
            }}
            placeholder="My Project"
            className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {liveError && <p className="text-sm text-red-600">{liveError}</p>}

          <div className="flex justify-end space-x-2">
            <button
              onClick={handleClose}
              className="px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              className="px-4 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
            >
              Create
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
