import { useState, useRef, useCallback } from 'react';

/**
 * Shared hook for prompt-style dialogs that resolve a promise
 * when the user makes a choice or cancels.
 *
 * Usage:
 *   const { open, resolve, prompt } = usePromptDialog<'merge' | 'replace'>();
 *   const choice = await prompt(); // shows dialog, returns T | null
 */
export function usePromptDialog<T>() {
  const [open, setOpen] = useState(false);
  const resolveRef = useRef<((value: T | null) => void) | null>(null);

  const prompt = useCallback((): Promise<T | null> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setOpen(true);
    });
  }, []);

  const resolve = useCallback((value: T | null) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setOpen(false);
  }, []);

  return { open, resolve, prompt };
}
