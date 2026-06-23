import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { useProjectStore } from '@/store/projectStore';
import { useUiStore } from '@/store/uiStore';
import { searchIpc, SearchResult } from '@/ipc/search';
import { flattenCodeTree } from '@/components/editor/QdaAnnotationPlugin';
import { Search as SearchIcon, FileText, File, Info } from 'lucide-react';

function escapeSnippet(raw: string) {
  const parts = raw.split(/(<\/?mark>)/);
  const escaped = parts.map(part => {
    if (part === '<mark>' || part === '</mark>') return part;
    return part.replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m] as string));
  }).join('');
  // Defense-in-depth: strip any angle-bracket content that isn't
  // <mark> or </mark> (ACTION_PLAN §P2.6).
  return escaped.replace(/<(?!(?:\/?mark>))/g, '&lt;');
}

export function SearchDialog() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  
  const activeProject = useProjectStore(s => s.activeProject);
  const setActiveDocument = useUiStore(s => s.setActiveDocument);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!activeProject || query.trim() === '') {
      setResults([]);
      return;
    }
    
    setIsSearching(true);
    const timeoutId = setTimeout(async () => {
      try {
        let searchQuery = query.trim();
        let codeIdFilter: string | undefined;

        // Parse code: prefix (ACTION_PLAN P3.8)
        if (searchQuery.startsWith('code:')) {
          const rest = searchQuery.slice(5).trim();
          const spaceIdx = rest.indexOf(' ');
          const codeName = spaceIdx > 0 ? rest.slice(0, spaceIdx) : rest;
          searchQuery = spaceIdx > 0 ? rest.slice(spaceIdx + 1).trim() : '';

          // Look up code by name
          const flatCodes = flattenCodeTree(useProjectStore.getState().codes);
          const matched = flatCodes.find(c => c.name.toLowerCase() === codeName.toLowerCase());
          if (matched) codeIdFilter = matched.id;
        }

        const res = await searchIpc.query(activeProject.id, searchQuery, codeIdFilter);
        setResults(res);
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [query, activeProject]);

  const handleResultClick = (r: SearchResult) => {
    if (r.sourceType === 'document') {
      setActiveDocument(r.sourceId);
    } else if (r.sourceType === 'memo') {
      // Navigate to the linked code or annotation (ACTION_PLAN P3.9)
      const codes = useProjectStore.getState().codes;
      const flatCodes = flattenCodeTree(codes);
      // r.sourceName format: "Memo for CodeName" or "Memo for Annotation" or "Project Journal"
      const codeMatch = r.sourceName.match(/^Memo for (.+)$/);
      if (codeMatch && codeMatch[1] !== 'Annotation') {
        const code = flatCodes.find(c => c.name === codeMatch[1]);
        if (code) {
          const uiState = useUiStore.getState();
          uiState.setActiveCodeView(code.id);
        }
      }
    }
    setOpen(false);
  };

  const docs = results.filter(r => r.sourceType === 'document');
  const memos = results.filter(r => r.sourceType === 'memo');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[600px] p-0 overflow-hidden gap-0 bg-slate-50">
        <div className="flex items-center px-4 py-3 border-b border-slate-200 bg-white">
          <SearchIcon className="w-5 h-5 text-slate-400 mr-3" />
          <input
            autoFocus
            type="text"
            className="flex-1 bg-transparent border-none outline-none text-slate-800 placeholder-slate-400 text-base"
            placeholder="Search documents and memos..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        
        {query.trim().startsWith('code:') && (
           <div className="bg-blue-50 px-4 py-2 border-b border-blue-100 flex items-start text-xs text-blue-700">
             <Info className="w-4 h-4 mr-2 mt-0.5 shrink-0" />
             <p>Search within code returns documents containing that code. Results are not limited to coded passages.</p>
           </div>
        )}

        <div className="max-h-[400px] overflow-y-auto">
          {query.trim() === '' ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              Type to search across all your documents and memos...
            </div>
          ) : isSearching && results.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              No results found for "{query}"
            </div>
          ) : (
            <div className="p-2 space-y-4">
              {docs.length > 0 && (
                <div>
                  <h3 className="px-2 py-1 text-xs font-semibold text-slate-500 uppercase tracking-wider">Documents</h3>
                  <div className="mt-1 space-y-1">
                    {docs.map((r, i) => (
                      <button
                        key={`${r.sourceId}-${i}`}
                        className="w-full text-left px-3 py-2 rounded-md hover:bg-slate-200/50 focus:bg-slate-200/50 focus:outline-none transition-colors group"
                        onClick={() => handleResultClick(r)}
                      >
                        <div className="flex items-center text-sm font-medium text-slate-700 mb-1">
                          <File className="w-4 h-4 mr-2 text-blue-500" />
                          {r.sourceName}
                        </div>
                        <div 
                          className="text-xs text-slate-600 pl-6 leading-relaxed line-clamp-2 [&>mark]:bg-yellow-200 [&>mark]:text-slate-900 [&>mark]:font-medium [&>mark]:px-0.5 [&>mark]:rounded-sm"
                          dangerouslySetInnerHTML={{ __html: escapeSnippet(r.snippet) }}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {memos.length > 0 && (
                <div>
                  <h3 className="px-2 py-1 text-xs font-semibold text-slate-500 uppercase tracking-wider">Memos</h3>
                  <div className="mt-1 space-y-1">
                    {memos.map((r, i) => (
                      <button
                        key={`${r.sourceId}-${i}`}
                        className="w-full text-left px-3 py-2 rounded-md hover:bg-slate-200/50 focus:bg-slate-200/50 focus:outline-none transition-colors group"
                        onClick={() => handleResultClick(r)}
                      >
                        <div className="flex items-center text-sm font-medium text-slate-700 mb-1">
                          <FileText className="w-4 h-4 mr-2 text-purple-500" />
                          {r.sourceName}
                        </div>
                        <div 
                          className="text-xs text-slate-600 pl-6 leading-relaxed line-clamp-2 [&>mark]:bg-yellow-200 [&>mark]:text-slate-900 [&>mark]:font-medium [&>mark]:px-0.5 [&>mark]:rounded-sm"
                          dangerouslySetInnerHTML={{ __html: escapeSnippet(r.snippet) }}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
