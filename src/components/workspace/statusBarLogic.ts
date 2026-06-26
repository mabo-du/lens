/**
 * statusBarLogic — pure (non-React, non-Zustand) helpers extracted from
 * `StatusBar.tsx`.
 *
 * v0.2.3 followup: when `StatusBar.tsx` exported both the `<StatusBar/>`
 * React component AND the `computeDocsCoded` pure helper, the vitest
 * unit-test file (`StatusBar.test.tsx`) imported `computeDocsCoded`
 * from `./StatusBar`. Vitest follows that import to its module root,
 * which then eagerly evaluated `StatusBar.tsx`'s top-level
 * `import { useProjectStore } from '@/store/projectStore'` and
 * `import { useUiStore } from '@/store/uiStore'` — pulling the full
 * Zustand graph (and the React `<Group>` / `<Panel>` / lucide-react
 * subgraph) into the test module's import graph. The test never
 * exercised any of those, but the side-effect of mounting stores
 * during test runs created flaky harness initialization (the test
 * was non-hermetic).
 *
 * Fix: extract the pure helper to this sibling file. `StatusBar.tsx`
 * and `StatusBar.test.tsx` now both import from `./statusBarLogic`,
 * which has no React, Zustand, or DOM dependencies. Only the
 * component file ever loads the stores.
 */

import type { DocumentRecord } from '@/ipc/documents';
import type { AnnotationRecord } from '@/ipc/annotations';

/**
 * Count distinct documents in `documents` that have at least one
 * annotation in `annotations` matching by `documentId`.
 *
 * Pure function exported specifically so the vitest suite can pin its
 * semantics without spinning up React.
 *
 * O(n + m): one Set membership write per annotation, one Set lookup per
 * document. For a 200-document / 5,000-annotation project this is
 * well under a millisecond on commodity hardware; for V1 with smaller
 * projects the cost is invisible. If a future corpus scales past
 * ~50k annotations, switch the in-memory pass to a precomputed
 * `Set<string>` kept in the ui store and updated incrementally on
 * every `addAnnotation` / `removeAnnotation`.
 */
export function computeDocsCoded(
  documents: DocumentRecord[],
  annotations: AnnotationRecord[],
): number {
  const annotatedDocIds = new Set<string>();
  for (const a of annotations) annotatedDocIds.add(a.documentId);
  let n = 0;
  for (const d of documents) {
    if (annotatedDocIds.has(d.id)) n += 1;
  }
  return n;
}
