import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useUiStore } from '@/store/uiStore';

function passwordStrength(pw: string): { label: string; color: string; pct: number } {
  if (!pw) return { label: 'Enter password', color: 'bg-slate-200', pct: 0 };
  let score = 0;
  if (pw.length >= 8) score += 2;
  if (pw.length >= 12) score += 1;
  if (/[A-Z]/.test(pw)) score += 1;
  if (/[a-z]/.test(pw)) score += 1;
  if (/[0-9]/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  if (pw.length >= 16) score += 1;

  const pct = Math.min(score / 8, 1);
  if (pct <= 0.25) return { label: 'Weak', color: 'bg-red-500', pct };
  if (pct <= 0.5) return { label: 'Fair', color: 'bg-amber-500', pct };
  if (pct <= 0.75) return { label: 'Good', color: 'bg-blue-500', pct };
  return { label: 'Strong', color: 'bg-emerald-500', pct };
}

export function EncryptionDialog({
  open,
  mode,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  mode: 'create' | 'unlock';
  onConfirm: (password: string) => void;
  onCancel: () => void;
}) {
  const encryptionAvailable = useUiStore((s) => s.encryptionAvailable);
  // Encryption is unavailable in this build when the Rust binary was
  // NOT compiled with `--features sqlcipher`. In that case, PRAGMA key
  // would be silently ignored on plain SQLite — so we'd be lying to the
  // user if we let them opt in. Hide the password entry instead.
  const encryptionUnsupported =
    mode === 'create' && encryptionAvailable === false;

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const strength = passwordStrength(password);

  const handleSubmit = () => {
    setError('');
    if (encryptionUnsupported) return;
    if (!password) {
      setError('Password must not be empty');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (mode === 'create' && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    onConfirm(password);
  };

  const handleClose = () => {
    setPassword('');
    setConfirmPassword('');
    setError('');
    onCancel();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create'
              ? encryptionUnsupported
                ? 'Create Project'
                : 'Enable Encryption'
              : 'Unlock Project'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? encryptionUnsupported
                ? 'Encryption is not available in this LENS build (SQLCipher linkage is required to activate PRAGMA key). The project will be created without at-rest encryption; you can still create encrypted .lensbackup archives later.'
                : 'Set a password to opt in to encryption. Encrypted backups then use this passphrase (or the recovery key shown at backup time) for offline-safe archives. The password cannot be recovered — there is no back door, by design.'
              : 'This project is encrypted. Enter the password to open it.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {encryptionUnsupported && (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <strong>Encryption unavailable in this build.</strong> The
              <code className="mx-1 px-1 py-0.5 bg-amber-100 rounded">sqlcipher</code>
              Cargo feature isn't enabled, so PRAGMA key would be silently
              ignored. Create the project without a password for now; you
              can use <em>File → Create Encrypted Backup</em> for offline-
              safe archives.
            </div>
          )}

          {!encryptionUnsupported && (
            <div>
              <label htmlFor="enc-password" className="sr-only">
                {mode === 'create' ? 'Encryption password' : 'Password'}
              </label>
              <input
                id="enc-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder={mode === 'create' ? 'Encryption password' : 'Password'}
                className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {mode === 'create' && password && (
                <div className="mt-2">
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${strength.color}`}
                      style={{ width: `${strength.pct * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{strength.label}</p>
                </div>
              )}
            </div>
          )}

          {mode === 'create' && !encryptionUnsupported && (
            <div>
              <label htmlFor="enc-confirm" className="sr-only">
                Confirm password
              </label>
              <input
                id="enc-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {mode === 'create' && !encryptionUnsupported && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <strong>Live database only:</strong> your password unlocks
              this database — no back door by design. Per-backup recovery
              keys (File menu's encrypted backups) unlock that backup,
              not the database. Choose <em>Create without password</em> if
              unsure.
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <div className="flex justify-end space-x-2">
            {mode === 'create' && (
              <button
                onClick={() => onConfirm('')}
                className="px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded transition-colors"
                title={encryptionUnsupported
                  ? 'Create the project without encryption (SQLCipher unavailable).'
                  : 'Create the project without encryption. You can encrypt backups later.'}
              >
                Create without password
              </button>
            )}
            <button
              onClick={handleClose}
              className="px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded transition-colors"
            >
              Cancel
            </button>
            {!encryptionUnsupported && (
              <button
                onClick={handleSubmit}
                className={`px-4 py-1.5 text-sm text-white rounded transition-colors ${
                  mode === 'create'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {mode === 'create' ? 'Enable Encryption' : 'Unlock'}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
