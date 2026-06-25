import { invoke } from '@tauri-apps/api/core';

export interface AutocodeAnnotation {
  codeId: string;
  codeName: string;
  annotationId: string;
  startOffset: number;
  endOffset: number;
}

export interface AutocodeResult {
  appliedCount: number;
  annotations: AutocodeAnnotation[];
}

export const ollamaIpc = {
  /**
   * Send a text chunk to the Ollama auto-coder.
   *
   * Chunk must be non-empty and ≤100_000 chars (the Rust validator
   * rejects early, no request round-trip wasted on oversized chunks).
   *
   * The Rust backend queries the project's codebook, builds a prompt,
   * POSTs to http://localhost:11434/api/generate, parses the LLM
   * response for codeName/startOffset/endOffset triples, and creates
   * annotations for each matched code.
   *
   * Requires Ollama running locally with llama3.2 (or change
   * OLLAMA_MODEL in the Rust source).
   */
  async autocode(
    projectId: string,
    documentId: string,
    rawText: string,
  ): Promise<AutocodeResult> {
    const res = await invoke<AutocodeResult>('autocode_chunk', {
      projectId,
      documentId,
      rawText,
    });
    return res;
  },
};
