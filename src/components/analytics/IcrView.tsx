/**
 * IcrView — Inter-coder Reliability (Cohen's κ) tab for AnalyticsWorkspace.
 *
 * Two modes:
 *   - Pairwise: pick two coders, a code, and a document → compute κ
 *   - Matrix: fetch all combos from the Rust backend (analytics_icr_matrix)
 *     and show a sortable table sorted by κ descending.
 *
 * Extracted from AnalyticsWorkspace.tsx to keep the dashboard file
 * manageable as more tabs are added.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { analyticsIpc, type IcrResultRow } from '@/ipc/analytics';
import { cohensKappa, disagreementSpans, type IRAnnotation } from '@/utils/icr';
import { List, Network, RefreshCw } from 'lucide-react';

export function IcrView({
  annotations,
  documents,
  topCodes,
}: {
  annotations: { id: string; documentId: string; codeId: string; startChar: number; endChar: number; createdBy: string }[];
  documents: { id: string; title: string; plainText?: string; fileFormat: string }[];
  topCodes: { id: string; name: string; color: string }[];
}) {
  const [viewMode, setViewMode] = useState<'pairwise' | 'matrix'>('pairwise');
  const [coderA, setCoderA] = useState('');
  const [coderB, setCoderB] = useState('');
  const [codeId, setCodeId] = useState('');
  const [docId, setDocId] = useState('');

  const coders = useMemo(() => {
    const seen = new Set<string>();
    for (const a of annotations) {
      if (a.createdBy) seen.add(a.createdBy);
    }
    return Array.from(seen).sort();
  }, [annotations]);

  const textDocs = useMemo(
    () => documents.filter((d) => d.fileFormat !== 'image' && d.fileFormat !== 'audio' && d.fileFormat !== 'video'),
    [documents],
  );

  if (coders.length < 2) return <EmptyState message="At least two distinct coders are needed. Tag some text spans with different createdBy values." />;
  if (textDocs.length === 0) return <EmptyState message="Import a text document first. ICR works on character-level text spans." />;

  return (
    <div className="space-y-4">
      {/* View-mode toggle */}
      <div className="flex items-center gap-1 text-sm">
        <button
          type="button"
          onClick={() => setViewMode('pairwise')}
          className={`px-2 py-1 text-xs rounded ${viewMode === 'pairwise' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <Network className="w-3 h-3 inline mr-0.5" />
          Pairwise
        </button>
        <button
          type="button"
          onClick={() => setViewMode('matrix')}
          className={`px-2 py-1 text-xs rounded ${viewMode === 'matrix' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <List className="w-3 h-3 inline mr-0.5" />
          Matrix
        </button>
      </div>

      {viewMode === 'pairwise' ? (
        <PairwiseView
          annotations={annotations}
          documents={documents}
          topCodes={topCodes}
          coders={coders}
          textDocs={textDocs}
          coderA={coderA} setCoderA={setCoderA}
          coderB={coderB} setCoderB={setCoderB}
          codeId={codeId} setCodeId={setCodeId}
          docId={docId} setDocId={setDocId}
        />
      ) : (
        <MatrixView topCodes={topCodes} documents={documents} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pairwise mode — original single-pair κ computation
// ---------------------------------------------------------------------------

function PairwiseView({
  annotations,
  documents,
  topCodes,
  coders,
  textDocs,
  coderA, setCoderA,
  coderB, setCoderB,
  codeId, setCodeId,
  docId, setDocId,
}: {
  annotations: { id: string; documentId: string; codeId: string; startChar: number; endChar: number; createdBy: string }[];
  documents: { id: string; title: string; plainText?: string; fileFormat: string }[];
  topCodes: { id: string; name: string; color: string }[];
  coders: string[];
  textDocs: { id: string; title: string; plainText?: string; fileFormat: string }[];
  coderA: string; setCoderA: (v: string) => void;
  coderB: string; setCoderB: (v: string) => void;
  codeId: string; setCodeId: (v: string) => void;
  docId: string; setDocId: (v: string) => void;
}) {
  const doc = documents.find((d) => d.id === docId);
  const docLength = doc?.plainText?.length ?? 0;

  const coderSpans = useMemo(() => {
    if (!coderA || !coderB || !codeId || !docId || docLength === 0) return null;
    const toIR = (createdBy: string): IRAnnotation[] =>
      annotations
        .filter((a) => a.createdBy === createdBy && a.codeId === codeId && a.documentId === docId)
        .map((a) => ({ codeId: a.codeId, documentId: a.documentId, startChar: a.startChar, endChar: a.endChar, createdBy: a.createdBy }));
    return { spansA: toIR(coderA), spansB: toIR(coderB) } as const;
  }, [coderA, coderB, codeId, docId, docLength, annotations]);

  const result = useMemo(() => {
    if (!coderSpans) return null;
    return cohensKappa(coderSpans.spansA, coderSpans.spansB, codeId, docId, docLength);
  }, [coderSpans, codeId, docId, docLength]);

  const disagreeSpans = useMemo(() => {
    if (!coderSpans) return [];
    return disagreementSpans(coderSpans.spansA, coderSpans.spansB, codeId, docId, docLength);
  }, [coderSpans, codeId, docId, docLength]);

  return (
    <>
      {/* Selectors */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-slate-600 font-medium">Coder A</span>
          <select value={coderA} onChange={(e) => setCoderA(e.target.value)} className="border rounded px-2 py-1.5 bg-white">
            <option value="">Select coder…</option>
            {coders.map((c) => (
              <option key={c} value={c} disabled={c === coderB}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-600 font-medium">Coder B</span>
          <select value={coderB} onChange={(e) => setCoderB(e.target.value)} className="border rounded px-2 py-1.5 bg-white">
            <option value="">Select coder…</option>
            {coders.map((c) => (
              <option key={c} value={c} disabled={c === coderA}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-600 font-medium">Code</span>
          <select value={codeId} onChange={(e) => setCodeId(e.target.value)} className="border rounded px-2 py-1.5 bg-white">
            <option value="">Select code…</option>
            {topCodes.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-600 font-medium">Document</span>
          <select value={docId} onChange={(e) => setDocId(e.target.value)} className="border rounded px-2 py-1.5 bg-white">
            <option value="">Select document…</option>
            {textDocs.map((d) => (<option key={d.id} value={d.id}>{d.title}</option>))}
          </select>
        </label>
      </div>

      {/* Result card */}
      {result && (
        <div className="bg-white border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">
              Cohen&rsquo;s κ for &ldquo;{topCodes.find((c) => c.id === codeId)?.name ?? codeId}&rdquo;
            </h3>
            <KappaBadge kappa={result.kappa} label={result.labelled} />
          </div>

          <div className="grid grid-cols-3 gap-4 text-sm">
            <StatCell label="Cohen&rsquo;s κ" value={result.kappa.toFixed(3)} />
            <StatCell label="Observed agreement" value={(result.agreement * 100).toFixed(1) + '%'} />
            <StatCell label="Chance agreement" value={(result.expected * 100).toFixed(1) + '%'} />
            <StatCell label="Chars coded by A" value={String(result.coverageA)} />
            <StatCell label="Chars coded by B" value={String(result.coverageB)} />
            <StatCell label="Doc length" value={docLength.toLocaleString()} />
          </div>

          {disagreeSpans.length > 0 && (
            <div className="text-xs text-slate-500 pt-2 border-t">
              <span className="font-medium text-slate-600">Disagreement spans:</span>{' '}
              {disagreeSpans.map(([s, e], i) => (
                <span key={i}>[{s}&ndash;{e}]{i < disagreeSpans.length - 1 && ', '}</span>
              ))}
              <span className="ml-2">({disagreeSpans.reduce((sum, [s, e]) => sum + (e - s), 0)} chars total)</span>
            </div>
          )}

          <details className="text-xs text-slate-400">
            <summary className="cursor-pointer hover:text-slate-500">Landis &amp; Koch (1977) reference</summary>
            <div className="mt-1 grid grid-cols-3 gap-1">
              {(['poor', 'slight', 'fair', 'moderate', 'substantial', 'almost perfect'] as const).map((lbl) => (
                <span key={lbl} className={`px-1 ${result.labelled === lbl ? 'font-bold text-slate-700' : ''}`}>{lbl}</span>
              ))}
            </div>
          </details>
        </div>
      )}

      {!result && coderA && coderB && codeId && docId && (
        <EmptyState message="The denominator collapsed — both coders tagged exactly the same proportion of the text (0% or 100%). κ is undefined for this case." />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Matrix mode — bulk ICR table from Rust backend (analytics_icr_matrix)
// ---------------------------------------------------------------------------

type SortCol = 'coderA' | 'coderB' | 'codeId' | 'documentId' | 'kappa' | 'agreement' | 'labelled';
type SortDir = 'asc' | 'desc' | null;

function MatrixView({
  topCodes,
  documents,
}: {
  topCodes: { id: string; name: string; color: string }[];
  documents: { id: string; title: string }[];
}) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const [rows, setRows] = useState<IcrResultRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>('kappa');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [minKappa, setMinKappa] = useState(0);

  const refresh = useCallback(async () => {
    if (!activeProject) return;
    setLoading(true);
    setError(null);
    try {
      const r = await analyticsIpc.icrMatrix(activeProject.id);
      setRows(r);
    } catch (e) {
      setError('Failed to load ICR matrix. Ensure the Rust backend is compiled with the analytics_icr_matrix command.');
      console.warn('[icr] matrix fetch failed', e);
    } finally {
      setLoading(false);
    }
  }, [activeProject]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Memoized lookups — stable references so displayRows useMemo doesn't invalidate.
  const codeName = useCallback((id: string) => topCodes.find((c) => c.id === id)?.name ?? id, [topCodes]);
  const docTitle = useCallback((id: string) => documents.find((d) => d.id === id)?.title ?? id, [documents]);

  // Derive display rows with filtering + sorting.
  const displayRows = useMemo(() => {
    const filtered = filterMatrixByMinKappa(rows, minKappa);
    return sortMatrixRows(filtered, sortCol, sortDir, codeName, docTitle);
  }, [rows, minKappa, sortCol, sortDir, codeName, docTitle]);

  const handleSort = (col: SortCol) => {
    if (sortCol !== col) { setSortCol(col); setSortDir('asc'); }
    else if (sortDir === 'asc') setSortDir('desc');
    else if (sortDir === 'desc') { setSortCol('kappa'); setSortDir('desc'); }
    else { setSortCol(col); setSortDir('asc'); }
  };

  const SortArrow = ({ col }: { col: SortCol }) => {
    if (sortCol !== col || !sortDir) return <span className="ml-1 text-slate-300">↕</span>;
    return <span className="ml-1 text-blue-500">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  // Max kappa from unfiltered rows for the slider upper bound.
  const maxKappa = useMemo(() => {
    const m = Math.max(1, ...rows.map((r) => r.result?.kappa ?? -2));
    return Math.ceil(m * 10) / 10;
  }, [rows]);

  if (!activeProject) return <EmptyState message="Open a project to load the ICR matrix." />;

  return (
    <div className="space-y-3">
      {/* Toolbar: summary + refresh + filter */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm text-slate-500">
          {rows.length > 0 ? `${displayRows.length} of ${rows.length} results` : 'No results yet'}
        </span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-slate-500">
            <span>Min κ ≥</span>
            <input
              type="number"
              min={-1}
              max={1}
              step={0.1}
              value={minKappa}
              onChange={(e) => setMinKappa(parseFloat(e.target.value) || 0)}
              className="w-16 px-1 py-0.5 border rounded text-xs"
            />
          </label>
          <input
            type="range"
            min={-1}
            max={maxKappa}
            step={0.05}
            value={minKappa}
            onChange={(e) => setMinKappa(parseFloat(e.target.value))}
            className="w-24"
            title={`Filter rows with κ ≥ ${minKappa.toFixed(2)}`}
          />
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 rounded disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-2">{error}</div>
      )}

      {!loading && !error && rows.length === 0 && (
        <EmptyState message="No ICR data available. Import documents and tag text spans as different coders (set different createdBy values), then refresh." />
      )}

      {!loading && !error && rows.length > 0 && displayRows.length === 0 && (
        <EmptyState message={`No rows with κ ≥ ${minKappa.toFixed(2)}. Lower the threshold to see more results.`} />
      )}

      {displayRows.length > 0 && (
        <div className="overflow-x-auto bg-white border rounded-lg">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-slate-50 text-slate-600">
                {(['coderA', 'coderB', 'codeId', 'documentId', 'kappa', 'agreement', 'labelled'] as SortCol[]).map((col) => (
                  <th
                    key={col}
                    onClick={() => handleSort(col)}
                    className={`px-3 py-2 cursor-pointer select-none hover:bg-slate-100 transition-colors ${col === 'kappa' ? 'text-right' : 'text-left'}`}
                  >
                    <span className="inline-flex items-center">
                      {col === 'coderA' ? 'Coder A' : col === 'coderB' ? 'Coder B' : col === 'codeId' ? 'Code' : col === 'documentId' ? 'Document' : col === 'kappa' ? 'κ' : col === 'agreement' ? 'Agreement' : 'Label'}
                      <SortArrow col={col} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((r, i) => (
                <tr key={`${r.coderA}::${r.coderB}::${r.codeId}::${r.documentId}`} className={`border-b last:border-0 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                  <td className="px-3 py-2 font-mono text-slate-700">{r.coderA}</td>
                  <td className="px-3 py-2 font-mono text-slate-700">{r.coderB}</td>
                  <td className="px-3 py-2 text-slate-700">{codeName(r.codeId)}</td>
                  <td className="px-3 py-2 text-slate-500 truncate max-w-[120px]">{docTitle(r.documentId)}</td>
                  {r.result ? (
                    <>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{r.result.kappa.toFixed(3)}</td>
                      <td className="px-3 py-2 text-slate-500">{(r.result.agreement * 100).toFixed(0)}%</td>
                      <td className="px-3 py-2">
                        <KappaBadge kappa={r.result.kappa} label={r.result.labelled} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2 text-right text-slate-400">—</td>
                      <td className="px-3 py-2 text-slate-400">—</td>
                      <td className="px-3 py-2 text-slate-400 italic">undefined</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

// Exported for potential reuse in other analytics views (e.g. a bulk ICR matrix table).
export function KappaBadge({ kappa, label }: { kappa: number; label: string }) {
  const colors: Record<string, string> = {
    poor: 'bg-red-100 text-red-800',
    slight: 'bg-orange-100 text-orange-800',
    fair: 'bg-amber-100 text-amber-800',
    moderate: 'bg-yellow-100 text-yellow-800',
    substantial: 'bg-emerald-100 text-emerald-800',
    'almost perfect': 'bg-green-100 text-green-800',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${colors[label] ?? 'bg-slate-100 text-slate-700'}`}>
      κ = {kappa.toFixed(2)} &mdash; {label}
    </span>
  );
}

// Exported alongside KappaBadge for reuse.
export function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="font-mono text-slate-800">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported sort/filter helpers — used by MatrixView and tested in IcrView.test.tsx
// ---------------------------------------------------------------------------

export type MatrixSortCol = 'coderA' | 'coderB' | 'codeId' | 'documentId' | 'kappa' | 'agreement' | 'labelled';
export type MatrixSortDir = 'asc' | 'desc' | null;

export const MATRIX_LABEL_RANK: Record<string, number> = {
  'poor': 1, 'slight': 2, 'fair': 3, 'moderate': 4, 'substantial': 5, 'almost perfect': 6,
};

export function sortMatrixRows(
  rs: IcrResultRow[],
  col: MatrixSortCol,
  dir: MatrixSortDir,
  codeName: (id: string) => string,
  docTitle: (id: string) => string,
): IcrResultRow[] {
  if (!col || !dir) return [...rs];
  const sorted = [...rs];
  const kappaVal = (r: IcrResultRow) => r.result?.kappa ?? -2;
  const agreementVal = (r: IcrResultRow) => r.result?.agreement ?? -1;

  sorted.sort((a, b) => {
    let cmp = 0;
    switch (col) {
      case 'coderA': cmp = a.coderA.localeCompare(b.coderA); break;
      case 'coderB': cmp = a.coderB.localeCompare(b.coderB); break;
      case 'codeId': cmp = codeName(a.codeId).localeCompare(codeName(b.codeId)); break;
      case 'documentId': cmp = docTitle(a.documentId).localeCompare(docTitle(b.documentId)); break;
      case 'kappa': cmp = kappaVal(a) - kappaVal(b); break;
      case 'agreement': cmp = agreementVal(a) - agreementVal(b); break;
      case 'labelled': cmp = (MATRIX_LABEL_RANK[a.result?.labelled ?? ''] ?? 0) - (MATRIX_LABEL_RANK[b.result?.labelled ?? ''] ?? 0); break;
    }
    return dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

export function filterMatrixByMinKappa(rs: IcrResultRow[], minKappa: number): IcrResultRow[] {
  return rs.filter((r) => {
    const k = r.result?.kappa;
    if (k === undefined) return minKappa <= 0;
    return k >= minKappa;
  });
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center text-slate-400">
      <p className="text-sm max-w-sm text-center">{message}</p>
    </div>
  );
}
