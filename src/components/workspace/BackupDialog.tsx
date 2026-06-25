import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { backupIpc, BackupExportResult } from '@/ipc/backup';
import { useProjectStore } from '@/store/projectStore';
import { toast } from 'sonner';
import { projectsIpc } from '@/ipc/projects';

type Mode = 'create' | 'restore';
type Phase = 'idle' | 'working' | 'create-success' | 'restore-success';

export function BackupDialog({
  open,
  onOpenChange,
  defaultMode = 'create',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultMode?: Mode;
}) {
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [phase, setPhase] = useState<Phase>('idle');
  const [passphrase, setPassphrase] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [useRecoveryKey, setUseRecoveryKey] = useState(false);
  const [lastResult, setLastResult] = useState<BackupExportResult | null>(null);
  const [restoredPath, setRestoredPath] = useState<string | null>(null);
  const [restoredName, setRestoredName] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);

  const activeProject = useProjectStore((s) => s.activeProject);

  const reset = () => {
    setPhase('idle');
    setPassphrase('');
    setRecoveryKey('');
    setUseRecoveryKey(false);
    setError('');
    setLastResult(null);
    setRestoredPath(null);
    setRestoredName(null);
    setRecoveryConfirmed(false);
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    reset();
  };

  const closeDialog = () => {
    onOpenChange(false);
    // Reset on close so the next open starts fresh
    setTimeout(reset, 200);
  };

  const copyRecoveryKey = async () => {
    if (!lastResult) return;
    try {
      await navigator.clipboard.writeText(lastResult.recoveryKey);
      toast.success('Recovery key copied to clipboard');
    } catch (e) {
      toast.error(`Failed to copy: ${e}`);
    }
  };

  const handleCreate = async () => {
    if (!activeProject) {
      setError('No project is open.');
      return;
    }
    if (passphrase.length < 8) {
      setError('Passphrase must be at least 8 characters.');
      return;
    }
    try {
      setError('');
      setPhase('working');
      const outputPath = await backupIpc.pickExportPath(activeProject.name);
      if (!outputPath) {
        setPhase('idle');
        return;
      }
      const result = await backupIpc.export(outputPath, passphrase);
      setLastResult(result);
      setPhase('create-success');
      // Drop passphrase from memory once the export is done.
      setPassphrase('');
    } catch (e) {
      setPhase('idle');
      setError(`Backup failed: ${e}`);
    }
  };

  const handleRestore = async () => {
    if (!useRecoveryKey && passphrase.length < 8) {
      setError('Passphrase must be at least 8 characters.');
      return;
    }
    if (useRecoveryKey && recoveryKey.replace(/[^0-9a-fA-F]/g, '').length !== 64) {
      setError('Recovery key must be 64 hex characters (with or without dashes).');
      return;
    }
    try {
      setError('');
      setPhase('working');
      const inputPath = await backupIpc.pickInputPath();
      if (!inputPath) {
        setPhase('idle');
        return;
      }
      const destinationDir = await backupIpc.pickRestoreDestination();
      if (!destinationDir) {
        setPhase('idle');
        return;
      }
      const result = await backupIpc.restore(
        inputPath,
        destinationDir,
        passphrase,
        useRecoveryKey ? recoveryKey : null,
        useRecoveryKey,
      );
      setRestoredPath(result.projectDir);
      setRestoredName(result.projectName);
      setPhase('restore-success');
      setPassphrase('');
      setRecoveryKey('');
    } catch (e) {
      setPhase('idle');
      setError(`Restore failed: ${e}`);
    }
  };

  const openRestoredProject = async () => {
    if (!restoredPath) return;
    try {
      // `backup_restore` writes a fresh `.qdaproj` to disk WITHOUT
      // creating a `.encrypted` flag — the encryption lives in the
      // backup snapshot itself, not at rest on the live db. So always
      // open with `undefined` (Rust receives `None`).
      const proj = await projectsIpc.open(restoredPath, undefined);
      useProjectStore.getState().setActiveProject(proj);
      closeDialog();
      toast.success(`Restored: ${restoredName ?? proj.name}`);
    } catch (e) {
      setError(`Failed to open restored project: ${e}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : closeDialog())}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {phase === 'create-success'
              ? 'Backup Created'
              : phase === 'restore-success'
              ? 'Backup Restored'
              : mode === 'create'
              ? 'Create Encrypted Backup'
              : 'Restore from Backup'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'A .lensbackup file contains a full encrypted snapshot of the current project. Save it somewhere safe (offline archive, secure cloud).'
              : 'Decrypt a .lensbackup file with either its passphrase or its recovery key (the printable code shown when the backup was created).'}
          </DialogDescription>
        </DialogHeader>

        {phase !== 'create-success' && phase !== 'restore-success' && (
          <div className="flex items-center space-x-1 mt-2 border border-slate-200 rounded p-1 w-fit">
            <button
              onClick={() => switchMode('create')}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                mode === 'create'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Create
            </button>
            <button
              onClick={() => switchMode('restore')}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                mode === 'restore'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Restore
            </button>
          </div>
        )}

        <div className="space-y-4 mt-2">
          {phase === 'idle' && mode === 'create' && (
            <>
              <div>
                <label htmlFor="backup-pass" className="sr-only">Encryption passphrase</label>
                <input
                  id="backup-pass"
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Encryption passphrase (≥ 8 chars)"
                  className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                After the backup completes, LENS will show a one-time
                <strong> recovery key</strong>. Write it down or store it in a
                password manager — losing it means losing the backup.
              </div>
            </>
          )}

          {phase === 'idle' && mode === 'restore' && (
            <>
              <div className="flex items-center space-x-2 text-xs">
                <label className="flex items-center space-x-1 cursor-pointer">
                  <input
                    type="radio"
                    checked={!useRecoveryKey}
                    onChange={() => setUseRecoveryKey(false)}
                  />
                  <span>Use passphrase</span>
                </label>
                <label className="flex items-center space-x-1 cursor-pointer">
                  <input
                    type="radio"
                    checked={useRecoveryKey}
                    onChange={() => setUseRecoveryKey(true)}
                  />
                  <span>Use recovery key</span>
                </label>
              </div>
              {!useRecoveryKey ? (
                <div>
                  <label htmlFor="restore-pass" className="sr-only">Passphrase</label>
                  <input
                    id="restore-pass"
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="Encryption passphrase"
                    className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                </div>
              ) : (
                <div>
                  <label htmlFor="restore-key" className="sr-only">Recovery key</label>
                  <input
                    id="restore-key"
                    type="text"
                    value={recoveryKey}
                    onChange={(e) => setRecoveryKey(e.target.value)}
                    placeholder="abcdef01-2345-6789-abcd-ef0123456789-…"
                    className="w-full px-3 py-2 border border-slate-200 rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                </div>
              )}
            </>
          )}

          {phase === 'working' && (
            <div className="text-sm text-slate-500 text-center py-2">Working…</div>
          )}

          {phase === 'create-success' && lastResult && (
            <>
              <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                <strong>Saved to:</strong> <span className="font-mono break-all">{lastResult.outputPath}</span>
                <br />
                <span className="text-emerald-600">{lastResult.sizeBytes} bytes</span>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Recovery Key (write this down)
                </label>
                <div className="mt-1 p-3 bg-slate-900 text-emerald-300 font-mono text-xs rounded break-all">
                  {lastResult.recoveryKey}
                </div>
                <div className="flex space-x-2 mt-2">
                  <button
                    onClick={copyRecoveryKey}
                    className="px-3 py-1.5 text-xs bg-slate-200 hover:bg-slate-300 rounded"
                  >
                    Copy
                  </button>
                </div>
                <label className="flex items-center space-x-2 mt-3 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={recoveryConfirmed}
                    onChange={(e) => setRecoveryConfirmed(e.target.checked)}
                  />
                  <span>I have saved this recovery key in a secure place.</span>
                </label>
              </div>
            </>
          )}

          {phase === 'restore-success' && (
            <>
              <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                <strong>Restored to:</strong> <span className="font-mono break-all">{restoredPath}</span>
              </div>
              <p className="text-xs text-slate-600">
                You can now open the restored project to review / continue working on it.
              </p>
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end space-x-2">
            <button onClick={closeDialog} className="px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded transition-colors">
              {phase === 'create-success' || phase === 'restore-success' ? 'Close' : 'Cancel'}
            </button>
            {phase === 'idle' && mode === 'create' && (
              <button
                onClick={handleCreate}
                disabled={passphrase.length < 8}
                className="px-4 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                Choose file & create
              </button>
            )}
            {phase === 'idle' && mode === 'restore' && (
              <button
                onClick={handleRestore}
                disabled={!useRecoveryKey && passphrase.length < 8}
                className="px-4 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                Choose file & restore
              </button>
            )}
            {phase === 'create-success' && (
              <button
                onClick={closeDialog}
                disabled={!recoveryConfirmed}
                className="px-4 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                {recoveryConfirmed ? "I've saved the key" : 'Confirm to close'}
              </button>
            )}
            {phase === 'restore-success' && (
              <button
                onClick={openRestoredProject}
                className="px-4 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
              >
                Open restored project
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
