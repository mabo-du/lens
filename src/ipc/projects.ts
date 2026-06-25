import { invoke } from '@tauri-apps/api/core';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export const projectsIpc = {
  create: (name: string, description: string | null, targetDir: string, encryptionKey?: string) => 
    invoke<Project>('projects_create', { name, description, targetDir, encryptionKey: encryptionKey || null }),
  createSample: (targetDir: string) =>
    invoke<Project>('projects_create_sample', { targetDir }),
  open:   (projectDir: string, encryptionKey?: string) => 
    invoke<Project>('projects_open', { projectDir, encryptionKey: encryptionKey || null }),
  close:  () => 
    invoke<void>('projects_close'),
  rename: (name: string) =>
    invoke<Project>('projects_rename', { name }),
  localUserGetName: () =>
    invoke<string>('local_user_get_name'),
  localUserUpdateName: (name: string) =>
    invoke<void>('local_user_update_name', { name }),
  isEncrypted: (projectDir: string) =>
    invoke<boolean>('projects_is_encrypted', { projectDir }),
  checkLock: (projectDir: string) =>
    invoke<string | null>('projects_check_lock', { projectDir }),
};
