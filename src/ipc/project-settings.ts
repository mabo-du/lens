import { invoke } from '@tauri-apps/api/core';

export const projectSettingsIpc = {
  /** Read a project setting. Returns the value string, or null if not set. */
  get: (key: string) => invoke<string | null>('project_setting_get', { key }),

  /** Upsert a project setting. Rejects empty keys. */
  set: (key: string, value: string) => invoke<void>('project_setting_set', { key, value }),
};
