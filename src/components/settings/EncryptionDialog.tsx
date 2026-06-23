import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

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
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const strength = passwordStrength(password);

  const handleSubmit = () => {
    setError('');
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
            {mode === 'create' ? 'Enable Encryption' : 'Unlock Project'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Set a password to encrypt your project database. This password cannot be recovered if lost.'
              : 'This project is encrypted. Enter the password to open it.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
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

          {mode === 'create' && (
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

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <div className="flex justify-end space-x-2">
            <button
              onClick={handleClose}
              className="px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded transition-colors"
            >
              Cancel
            </button>
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
