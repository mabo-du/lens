import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';

export interface BackupExportResult {
  outputPath: string;
  recoveryKey: string;
  sizeBytes: number;
}

export interface BackupRestoreResult {
  projectDir: string;
  projectName: string;
  projectId: string;
}

/**
 * IPC facade for the encrypted backup commands in
 * `src-tauri/src/commands/backup.rs`.
 *
 * LENS creates `.lensbackup` files — a full snapshot of the current
 * project's `project.qdaproj` SQLite database, encrypted with AES-256-GCM
 * keyed by Argon2id(passphrase + salt). An additional 256-bit recovery
 * key is generated and shown to the user once; supplying the recovery
 * key is sufficient to decrypt the backup even if the passphrase is
 * lost (the user is expected to write it down offline).
 */
export const backupIpc = {
  /**
   * Encrypt the active project and write the `.lensbackup` to `outputPath`.
   * Returns the path written, the printable recovery key (shown once),
   * and the file size in bytes.
   */
  export: (outputPath: string, passphrase: string) =>
    invoke<BackupExportResult>('backup_export', { outputPath, passphrase }),

  /**
   * Decrypt a `.lensbackup` to a new project folder under
   * `destinationDir`. Either `passphrase` or `recoveryKey` (with
   * `useRecoveryKey: true`) is required. Returns metadata about the
   * restored project so the caller can open it.
   */
  restore: (
    inputPath: string,
    destinationDir: string,
    passphrase: string,
    recoveryKey: string | null,
    useRecoveryKey: boolean,
  ) =>
    invoke<BackupRestoreResult>('backup_restore', {
      inputPath,
      destinationDir,
      passphrase,
      recoveryKey,
      useRecoveryKey,
    }),

  /** Native folder picker for a `.lensbackup` output file. */
  pickExportPath: async (defaultName: string): Promise<string | null> => {
    const result = await saveDialog({
      title: 'Save encrypted backup',
      defaultPath: `${defaultName}.lensbackup`,
      filters: [{ name: 'LENS Encrypted Backup', extensions: ['lensbackup'] }],
    });
    return typeof result === 'string' ? result : null;
  },

  /** Native file picker for an existing `.lensbackup`. */
  pickInputPath: async (): Promise<string | null> => {
    const result = await openDialog({
      title: 'Open encrypted backup',
      multiple: false,
      directory: false,
      filters: [{ name: 'LENS Encrypted Backup', extensions: ['lensbackup'] }],
    });
    return typeof result === 'string' ? result : null;
  },

  /** Native folder picker for restoration destination. */
  pickRestoreDestination: async (): Promise<string | null> => {
    const result = await openDialog({
      title: 'Choose a folder to restore into',
      multiple: false,
      directory: true,
    });
    return typeof result === 'string' ? result : null;
  },
};
