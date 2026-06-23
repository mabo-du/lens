import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Tree, NodeRendererProps } from 'react-arborist';
import { useProjectStore } from '@/store/projectStore';
import { useUiStore } from '@/store/uiStore';
import { CodeTreeNode, codesIpc } from '@/ipc/codes';
import { annotationsIpc } from '@/ipc/annotations';
import { CodeDialog } from './CodeDialog';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Plus, Trash2, Edit2, FileText } from 'lucide-react';

import { memosIpc } from '@/ipc/memos';
import { toast } from 'sonner';

/** Common code node fields used by context menu callbacks (avoids double type cast). */
export interface CodeNodeMeta {
  id: string;
  projectId: string;
  name: string;
  color: string;
  description: string | null;
}

export const CodeTreeContext = React.createContext<{
  setEditNode: (node: CodeNodeMeta) => void;
  setMemoNode: (node: CodeNodeMeta) => void;
  setDeleteNode: (node: CodeNodeMeta) => void;
}>({
  setEditNode: () => {},
  setMemoNode: () => {},
  setDeleteNode: () => {},
});

function CodeMemoPanel({ code, onClose }: { code: CodeNodeMeta, onClose: () => void }) {
  const [content, setContent] = useState('');
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    memosIpc.get(code.projectId, code.id).then(m => setContent(m?.body || ''));
  }, [code]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Cancel pending save when memo panel is dismissed
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  });

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value; // capture before timeout closure
    setContent(value);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      memosIpc.save(code.projectId, value, code.id);
    }, 1000);
  };

  return (
    <div className="h-48 border-t border-slate-200 bg-white flex flex-col shrink-0">
      <div className="flex items-center justify-between p-2 bg-slate-100 border-b border-slate-200">
        <span className="text-xs font-semibold text-slate-600 truncate mr-2">Memo: {code.name}</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
      </div>
      <textarea
        className="flex-1 p-2 text-sm resize-none focus:outline-none"
        value={content}
        onChange={handleChange}
        placeholder={`Write a memo for ${code.name}...`}
      />
    </div>
  );
}

// Type that Arborist understands (children must be null for leaf nodes)
type ArboristNode = Omit<CodeTreeNode, 'children'> & {
  children: ArboristNode[] | null;
};

function toArboristData(nodes: CodeTreeNode[]): ArboristNode[] {
  return nodes.map(n => ({
    ...n,
    children: n.children.length > 0 ? toArboristData(n.children) : null,
  }));
}

function CodeNode({ node, style, dragHandle }: NodeRendererProps<ArboristNode>) {
  const setActiveCodeView = useUiStore(s => s.setActiveCodeView);
  const textSelection = useUiStore(s => s.textSelection);
  const activeDocumentId = useUiStore(s => s.activeDocumentId);
  const clearTextSelection = useUiStore(s => s.clearTextSelection);
  const addAnnotation = useProjectStore(s => s.addAnnotation);

  const ctx = React.useContext(CodeTreeContext);

  const handleClick = async () => {
    if (textSelection && activeDocumentId) {
      try {
        const ann = await annotationsIpc.create({
          documentId: activeDocumentId,
          codeId: node.data.id,
          startChar: textSelection.startChar,
          endChar: textSelection.endChar,
        });
        addAnnotation(ann);
      } catch (e) {
        console.error("Failed to assign code", e);
        toast.error("Failed to assign code.");
      } finally {
        clearTextSelection();
      }
    } else {
      setActiveCodeView(node.data.id);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block w-full">
        <div 
          style={style} 
          ref={dragHandle} 
          className={`flex items-center group cursor-pointer ${node.isSelected ? 'bg-slate-200' : 'hover:bg-slate-100'} px-2 py-1 rounded-md ${textSelection ? 'animate-pulse hover:bg-blue-100' : ''}`}
          onClick={handleClick}
        >
          <div 
            className="w-3 h-3 rounded-full mr-2 shrink-0 border border-black/20"
            style={{ backgroundColor: node.data.color }}
          />
          <span className="text-sm text-slate-700 truncate">{node.data.name}</span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => ctx.setEditNode(node.data)}>
          <Edit2 className="w-4 h-4 mr-2" /> Edit Code
        </ContextMenuItem>
        <ContextMenuItem onClick={() => ctx.setMemoNode(node.data)}>
          <FileText className="w-4 h-4 mr-2" /> Edit Memo
        </ContextMenuItem>
        <ContextMenuItem onClick={() => ctx.setDeleteNode(node.data)} className="text-red-600 focus:text-red-600">
          <Trash2 className="w-4 h-4 mr-2" /> Delete Code
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function CodeTree() {
  const codes = useProjectStore(s => s.codes);
  const setCodes = useProjectStore(s => s.setCodes);
  const activeProject = useProjectStore(s => s.activeProject);
  const data = useMemo(() => toArboristData(codes), [codes]);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const [treeHeight, setTreeHeight] = useState(500);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      setTreeHeight(entries[0].contentRect.height);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const [createOpen, setCreateOpen] = useState(false);
  const [editNode, setEditNode] = useState<CodeNodeMeta | null>(null);
  const [memoNode, setMemoNode] = useState<CodeNodeMeta | null>(null);
  const [deleteNode, setDeleteNode] = useState<CodeNodeMeta | null>(null);

  useEffect(() => {
    if (deleteNode) {
      const runDelete = async () => {
        if (!activeProject) return;
        if (!confirm(`Are you sure you want to delete the code '${deleteNode.name}'? This will also delete any child codes and all associated annotations.`)) {
          setDeleteNode(null);
          return;
        }
        try {
          await codesIpc.delete(deleteNode.id);
          const updated = await codesIpc.getTree(activeProject.id);
          setCodes(updated);
          setDeleteNode(null);
        } catch (e) {
          console.error(e);
          toast.error('Failed to delete code');
          setDeleteNode(null);
        }
      };
      runDelete();
    }
  }, [deleteNode, activeProject, setCodes]);

  const contextValue = useMemo(() => ({
    setEditNode: (n: CodeNodeMeta) => { setEditNode(n); setCreateOpen(true); },
    setMemoNode,
    setDeleteNode,
  }), []);

  const handleMove = async ({ dragIds, parentId }: { dragIds: string[]; parentId: string | null }) => {
    if (!activeProject) return;
    for (const id of dragIds) {
      await codesIpc.move(id, parentId ?? null);
    }
    const updated = await codesIpc.getTree(activeProject.id);
    setCodes(updated);
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 border-r border-slate-200">
      <div className="p-3 border-b border-slate-200 bg-slate-100 flex items-center justify-between">
        <h2 className="font-semibold text-sm text-slate-700">Codes</h2>
        <button 
          onClick={() => setCreateOpen(true)}
          className="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-slate-700 transition-colors"
          title="New Code"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <div ref={containerRef} className="flex-1 overflow-hidden p-2" onContextMenu={(e) => { e.preventDefault(); }}>
        <CodeTreeContext.Provider value={contextValue}>
          {data.length === 0 ? (
            <div className="p-4 text-center text-slate-500 text-sm">No codes yet.</div>
          ) : (
            <Tree
              data={data}
              width="100%"
              height={treeHeight}
              rowHeight={30}
              disableDrag={false}
              disableDrop={false}
              selectionFollowsFocus={false}
              onMove={handleMove}
            >
              {CodeNode}
            </Tree>
          )}
        </CodeTreeContext.Provider>
      </div>
      <CodeDialog 
        open={createOpen} 
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setEditNode(null);
        }} 
        codeToEdit={editNode || undefined}
      />
      {memoNode && <CodeMemoPanel code={memoNode} onClose={() => setMemoNode(null)} />}
    </div>
  );
}
