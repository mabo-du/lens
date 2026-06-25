import { invoke } from '@tauri-apps/api/core';

/**
 * IPC facade for `src-tauri/src/commands/encryption.rs`.
 *
 * `available()` returns `true` iff the binary was built with the
 * `sqlcipher` Cargo feature; this is a compile-time indicator — the
 * UI reads it on mount and hides the project-level encryption option
 * in `EncryptionDialog` when the plain-SQLite engine is linked (and
 * `PRAGMA key` would be silently ignored).
 *
 * `generateRecoveryKey()` returns a strong printable recovery key
 * (32 bytes / 256 bits, formatted as 64 hex characters grouped 8 per
 * dash). It is shown to the user exactly once after a backup is
 * created and never persisted by LENS — the user is responsible for
 * writing it down offline.
 */
export const encryptionIpc = {
  available: () => invoke<boolean>('encryption_available'),
  generateRecoveryKey: () => invoke<string>('recovery_key_generate'),
};
