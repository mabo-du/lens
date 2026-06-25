/**
 * Analytics Dashboard — v0.2 scaffold.
 *
 * The MVP for v0.2 ships two charts driven by Key Queries #5 and #6 from
 * the LENS_Implementation_Plan:
 *
 *   - Co-occurrence heatmap: any-overlap definition, top 50 codes.
 *   - Code-frequency bars: stacked per-document counts.
 *
 * Both are routed through the `analyticsIpc` channel pair defined in
 * `src/ipc/analytics.ts` so the Rust backend can pre-aggregate, but the
 * React rendering is self-contained and falls back to seeded empty data
 * if the backend is offline (e.g. Playwright fixture, dev mode without
 * the Tauri shell).
 *
 * v0.2 follow-up:
 *  - Add react-force-graph view (lives in a sibling tab).
 *  - Add threshold sliders + "Analytics outdated" dirty-state pill.
 *  - Wire the bar chart to recharts (already in package.json).
 */
import { useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { analyticsIpc, CoOccurrenceRow, CodeFrequencyRow } from '@/ipc/analytics';
import { BarChart3, GitBranch, RefreshCw, AlertTriangle } from 'lucide-react';

type Tab = 'freq' | 'co';

export function AnalyticsWorkspace() {
  const activeProject = useProjectStore(s => s.activeProject);
  const codes = useProjectStore(s => s.codes);
  const [tab, setTab] = useState<Tab>('freq');
  const [freq, setFreq] = useState<CodeFrequencyRow[]>([]);
  const [coOcc, setCoOcc] = useState<CoOccurrenceRow[]>([]);
  const [dirty, setDirty] = useState(true);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    if (!activeProject) return;
    setLoading(true);
    try {
      const [f, c] = await Promise.all([
        analyticsIpc.codeFrequency(activeProject.id),
        analyticsIpc.coOccurrence(activeProject.id),
      ]);
      setFreq(f);
      setCoOcc(c);
      setDirty(false);
    } catch (e) {
      // Backend offline — keep last fetched data, mark dirty.
      setDirty(true);
      console.warn('[analytics] refresh failed', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [activeProject?.id]);

  // Mark dirty when the user adds/removes an annotation in the project store.
  const annotations = useProjectStore(s => s.annotations);
  useEffect(() => {
    setDirty(true);
  }, [annotations.length]);

  const topCodes = useMemo(() => {
    if (codes.length === 0) return [];
    void codes;
    const flat: { id: string; name: string; color: string; depth: number }[] = [];
    (function flatten(nodes: typeof codes, depth = 0) {
      for (const n of nodes) {
        if (n.depth === undefined) continue;
        flat.push({ id: n.id, name: n.name, color: n.color, depth });
        if (n.children?.length) flatten(n.children, depth + 1);
      }
    })(codes);
    return flat.slice(0, 50);
  }, [codes]);

  if (!activeProject) {
    return <EmptyState message="Open or create a project to view analytics." />;
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-slate-50 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Analytics</h1>
          <p className="text-sm text-slate-500">Code patterns across {activeProject.name}</p>
        </div>
        <div className="flex items-center gap-3">
          {dirty && (
            <button
              type="button"
              onClick={() => void refresh()}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-amber-100 text-amber-800 rounded-md hover:bg-amber-200 transition-colors"
            >
              <AlertTriangle className="w-4 h-4" />
              Analytics outdated — click to refresh
            </button>
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-slate-200 hover:bg-slate-300 rounded-md disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4 border-b border-slate-200">
        <TabButton active={tab === 'freq'} onClick={() => setTab('freq')} icon={<BarChart3 className="w-4 h-4" />} label="Code Frequency" />
        <TabButton active={tab === 'co'} onClick={() => setTab('co')} icon={<GitBranch className="w-4 h-4" />} label="Co-occurrence" />
      </div>

      {tab === 'freq' && <FrequencyView rows={freq} topCodes={topCodes} />}
      {tab === 'co' && <CoOccurrenceView rows={coOcc} topCodes={topCodes} />}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 px-4 py-2 text-sm border-b-2 transition-colors ${
        active ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-slate-600 hover:text-slate-800'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function FrequencyView({ rows, topCodes }: { rows: CodeFrequencyRow[]; topCodes: { id: string; name: string; color: string; depth: number }[] }) {
  if (topCodes.length === 0) {
    return <EmptyState message="Create some codes first to see frequency analytics." />;
  }
  const maxCount = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  return (
    <div className="space-y-2">
      {topCodes.map((c) => {
        const row = rows.find((r) => r.codeId === c.id);
        const count = row?.count ?? 0;
        const pct = (count / maxCount) * 100;
        return (
          <div key={c.id} className="flex items-center gap-3 text-sm">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
            <div className="w-48 truncate text-slate-700">{c.name}</div>
            <div className="flex-1 h-4 bg-slate-100 rounded">
              <div
                className="h-full rounded transition-all"
                style={{ width: `${pct}%`, backgroundColor: c.color }}
              />
            </div>
            <div className="w-12 text-right tabular-nums text-slate-700">{count}</div>
          </div>
        );
      })}
    </div>
  );
}

function CoOccurrenceView({ rows, topCodes }: { rows: CoOccurrenceRow[]; topCodes: { id: string; name: string; color: string; depth: number }[] }) {
  const findById = (id: string) => topCodes.find((x) => x.id === id);
  if (topCodes.length === 0) return <EmptyState message="Create some codes first to see co-occurrence analytics." />;
  if (rows.length === 0) return <EmptyState message="No overlapping annotations yet. Tag overlapping text spans with multiple codes." />;

  // Build a small lookup grid for the top 50 cells.
  const cellMap = new Map<string, number>();
  for (const r of rows) cellMap.set(`${r.codeA}::${r.codeB}`, r.count);

  const cellIds = topCodes.slice(0, 12).map((c) => c.id);
  const max = Math.max(1, ...Array.from(cellMap.values()));

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-xs">
        <thead>
          <tr>
            <th className="p-1" />
            {cellIds.map((id) => (
            <th key={id} className="p-1 align-bottom" style={{ writingMode: 'sideways-lr' }}>
              <span className="inline-flex items-center gap-1">
                <ColorDot id={id} lookup={findById} />
                <span>{findById(id)?.name ?? ''}</span>
              </span>
            </th>
          ))}
          </tr>
        </thead>
        <tbody>
          {cellIds.map((rowId) => (
            <tr key={rowId}>
              {cellIds.map((colId) => {
                const value = cellMap.get(`${rowId}::${colId}`) ?? (rowId === colId ? max : 0);
                const intensity = value / max;
                return (
                  <td
                    key={colId}
                    className="p-1 border border-slate-100 text-center"
                    title={`${value} co-occurrences`}
                    style={{ backgroundColor: rowId === colId ? '#e2e8f0' : `rgba(99,102,241,${intensity})`, color: intensity > 0.5 ? 'white' : 'inherit' }}
                  >
                    {value}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ColorDot({ id, lookup }: { id: string; lookup: (id: string) => { color: string } | undefined }) {
  const color = lookup(id)?.color ?? 'transparent';
  return <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: color }} />;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center text-slate-400">
      <p className="text-sm max-w-sm text-center">{message}</p>
    </div>
  );
}
