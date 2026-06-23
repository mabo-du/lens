import { invoke } from '@tauri-apps/api/core';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export const projectsIpc = {
  create: (name: string, description: string | null, targetDir: string) => 
    invoke<Project>('projects_create', { name, description, targetDir }),
  createSample: (targetDir: string) =>
    invoke<Project>('projects_create_sample', { targetDir }),
  open:   (projectDir: string) => 
    invoke<Project>('projects_open', { projectDir }),
  close:  () => 
    invoke<void>('projects_close'),
  rename: (name: string) =>
    invoke<Project>('projects_rename', { name }),
  localUserGetName: () =>
    invoke<string>('local_user_get_name'),
  localUserUpdateName: (name: string) =>
    invoke<void>('local_user_update_name', { name }),
};
