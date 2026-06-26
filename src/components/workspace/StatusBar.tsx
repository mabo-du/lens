/**
 * Status Bar — Phase 6.4 "Cheap Live Counters" from `LENS_Implementation_Plan.md`.
 *
 * Pulls three project-state counters straight from the Zustand stores via
 * narrow selectors so re-renders happen only when one of the underlying
 * values actually changes. No DB queries on every annotation.
 *
 *   - Total annotations in the active project (O(1) read).
 *   - "X / Y" documents-coded ratio (a single Set-membership pass; memo'd).
 *   - Word count of the active document (read from `DocumentRecord.wordCount`,
 *     a value already populated at import time by the Rust text-normalisation
 *     pipeline).
 *
 * The DB-side storage for both counts and ratio is unchanged. This component
 * exists to surface those values in a small persistent footer without each
 * annotation event triggering a count query back to SQLite.
 */
import { useMemo } from 'react';
import { Hash, FileText, Activity } from 'lucide-react';
import { useProjectStore } from '@/store/projectStore';
import { useUiStore } from '@/store/uiStore';
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

export function StatusBar() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const documents = useProjectStore((s) => s.documents);
  const annotations = useProjectStore((s) => s.annotations);
  const activeDocumentId = useUiStore((s) => s.activeDocumentId);

  const docsCoded = useMemo(
    () => computeDocsCoded(documents, annotations),
    [documents, annotations],
  );

  const activeDoc = useMemo<DocumentRecord | null>(() => {
    if (!activeDocumentId) return null;
    return documents.find((d) => d.id === activeDocumentId) ?? null;
  }, [documents, activeDocumentId]);

  if (!activeProject) return null;

  const totalAnns = annotations.length;
  const totalDocs = documents.length;
  const ratioLabel = totalDocs === 0 ? '—' : `${docsCoded} / ${totalDocs}`;
  const wordCount = activeDoc?.wordCount ?? null;
  const docLabel = activeDoc?.title ?? 'no document selected';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="status-bar"
      className="h-7 bg-slate-200 border-t border-slate-300 px-3 text-xs text-slate-700 flex items-center gap-5 shrink-0"
    >
      <span className="flex items-center gap-1.5">
        <Hash className="w-3 h-3" aria-hidden="true" />
        <span className="tabular-nums" data-testid="status-annotation-count">
          {totalAnns.toLocaleString()}
        </span>
        <span className="text-slate-500">annotation{totalAnns === 1 ? '' : 's'}</span>
      </span>

      <span className="flex items-center gap-1.5">
        <FileText className="w-3 h-3" aria-hidden="true" />
        <span className="tabular-nums" data-testid="status-docs-coded">
          {ratioLabel}
        </span>
        <span className="text-slate-500">docs coded</span>
      </span>

      <span className="flex items-center gap-1.5">
        <Activity className="w-3 h-3" aria-hidden="true" />
        <span className="tabular-nums" data-testid="status-word-count">
          {wordCount === null ? '—' : wordCount.toLocaleString()}
        </span>
        <span className="text-slate-500">words (active doc)</span>
      </span>

      <span
        className="ml-auto text-slate-500 truncate max-w-[40%]"
        data-testid="status-active-doc"
        title={docLabel}
      >
        {docLabel}
      </span>
    </div>
  );
}
