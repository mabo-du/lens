/**
 * Analytics IPC — v0.2 scaffold stubs.
 *
 * The Rust side wires `analytics_code_frequency` + `analytics_co_occurrence`
 * `#[tauri::command]` handlers running Key Queries #5 and #6 from the
 * LENS_Implementation_Plan. The renderer-side stubs return typed
 * `[]` arrays when the command is missing so v0.2 frontend work can
 * ship before the Rust handlers are implemented; failing loud is
 * preferable to silently rendering empty charts in production once
 * a real binary is built.
 */
import { invoke } from '@tauri-apps/api/core';

export interface CodeFrequencyRow {
  codeId: string;
  count: number;
}

export interface CoOccurrenceRow {
  codeA: string;
  codeB: string;
  count: number;
}

export interface IcrResult {
  coverageA: number;
  coverageB: number;
  agreement: number;
  expected: number;
  kappa: number;
  labelled: string;
}

export interface IcrResultRow {
  coderA: string;
  coderB: string;
  codeId: string;
  documentId: string;
  result: IcrResult | null;
}

export const analyticsIpc = {
  async codeFrequency(projectId: string): Promise<CodeFrequencyRow[]> {
    try {
      return await invoke<CodeFrequencyRow[]>('analytics_code_frequency', { projectId });
    } catch (e) {
      console.warn('[analytics] code_frequency unavailable', e);
      return [];
    }
  },
  async coOccurrence(projectId: string): Promise<CoOccurrenceRow[]> {
    try {
      return await invoke<CoOccurrenceRow[]>('analytics_co_occurrence', { projectId });
    } catch (e) {
      console.warn('[analytics] co_occurrence unavailable', e);
      return [];
    }
  },
  async icr(
    projectId: string,
    coderA: string,
    coderB: string,
    codeId: string,
    documentId: string,
  ): Promise<IcrResult | null> {
    try {
      return await invoke<IcrResult | null>('analytics_icr', {
        projectId,
        coderA,
        coderB,
        codeId,
        documentId,
      });
    } catch (e) {
      console.warn('[analytics] icr unavailable', e);
      return null;
    }
  },
  async icrMatrix(projectId: string): Promise<IcrResultRow[]> {
    try {
      return await invoke<IcrResultRow[]>('analytics_icr_matrix', { projectId });
    } catch (e) {
      console.warn('[analytics] icr_matrix unavailable', e);
      return [];
    }
  },
};
