import { useEffect, useRef, useState, useCallback } from 'react';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { useProjectStore } from '@/store/projectStore';
import { useUiStore } from '@/store/uiStore';
import { buildQdaAnnotationPlugin, qdaAnnotationPluginKey, flattenCodeTree } from './QdaAnnotationPlugin';
import { charOffsetToPmPos, pmPosToCharOffset } from '@/utils/offset-utils';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { annotationsIpc } from '@/ipc/annotations';
import { documentsIpc } from '@/ipc/documents';
import { AnnotationMemoDialog } from '../memos/AnnotationMemoDialog';
import { toast } from 'sonner';

import 'prosemirror-view/style/prosemirror.css';

const plainTextSchema = new Schema({
  nodes: {
    doc:       { content: 'paragraph+' },
    paragraph: { content: 'text*', toDOM: () => ['p', 0] },
    text:      {},
  },
  marks: {},
});

export function DocumentEditor() {
  const activeDocumentId = useUiStore(s => s.activeDocumentId);
  const setTextSelection = useUiStore(s => s.setTextSelection);
  const clearTextSelection = useUiStore(s => s.clearTextSelection);
  const document = useProjectStore(s => s.documents.find(d => d.id === activeDocumentId));
  const codes = useProjectStore(s => s.codes);
  const annotations = useProjectStore(s => s.annotations);
  const setAnnotations = useProjectStore(s => s.setAnnotations);
  const updateDocument = useProjectStore(s => s.updateDocument);
  const memos = useProjectStore(s => s.memos);

  const editorViewRef = useRef<EditorView | null>(null);
  const editorMountRef = useRef<HTMLDivElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [markers, setMarkers] = useState<{ id: string, top: number, color: string }[]>([]);
  const [editingAnnId, setEditingAnnId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeDocumentId) return;
    annotationsIpc.listByDocument(activeDocumentId)
      .then(setAnnotations)
      .catch(console.error);
    
    // Fetch plainText if missing
    if (document && !document.plainText) {
      documentsIpc.getContent(activeDocumentId)
        .then(plainText => updateDocument(activeDocumentId, { plainText }))
        .catch(console.error);
    }
  }, [activeDocumentId, setAnnotations, document?.plainText]);

  // 1. Initialise EditorView
  useEffect(() => {
    if (!editorMountRef.current || !document) return;
    
    const plainText = document.plainText;
    const docNode = plainTextSchema.node('doc', null, [
      plainTextSchema.node('paragraph', null,
        plainText ? [plainTextSchema.text(plainText)] : []
      )
    ]);

    const view = new EditorView(editorMountRef.current, {
      state: EditorState.create({
        doc: docNode,
        plugins: [buildQdaAnnotationPlugin()],
      }),
      editable: () => false,
      dispatchTransaction: (tr) => {
        // For a read-only editor we still need to let PM update its state
        const newState = view.state.apply(tr);
        view.updateState(newState);
      },
    });

    editorViewRef.current = view;

    // Immediately sync annotations just in case
    const tr = view.state.tr;
    tr.setMeta(qdaAnnotationPluginKey, { annotations, codes, memos });
    view.dispatch(tr);

    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
  }, [document?.id]); // Re-create on document switch

  // 2. Sync Annotations from Zustand
  useEffect(() => {
    if (!editorViewRef.current) return;
    const tr = editorViewRef.current.state.tr;
    tr.setMeta(qdaAnnotationPluginKey, { annotations, codes, memos });
    editorViewRef.current.dispatch(tr);
  }, [annotations, codes, memos]);

  // 3. Margin Indicators
  const updateMarkers = useCallback(() => {
    if (!editorViewRef.current || !editorContainerRef.current) return;
    const containerRect = editorContainerRef.current.getBoundingClientRect();
    const scrollTop = editorContainerRef.current.scrollTop;
    
    const flatCodes = flattenCodeTree(codes);

    setMarkers(annotations.map(ann => {
      const pos = charOffsetToPmPos(ann.startChar);
      try {
        const coords = editorViewRef.current!.coordsAtPos(pos);
        return {
          id: ann.id,
          top: coords.top - containerRect.top + scrollTop,
          color: flatCodes.find(c => c.id === ann.codeId)?.color ?? '#888',
        };
      } catch (e) {
        // PM might throw if pos is out of bounds during transition
        return null;
      }
    }).filter(m => m !== null) as { id: string, top: number, color: string }[]);
  }, [annotations, codes]);

  useEffect(() => {
    // We delay the first marker calculation slightly to allow PM to render
    const rafId = requestAnimationFrame(() => {
      updateMarkers();
    });
    return () => cancelAnimationFrame(rafId);
  }, [annotations, codes, updateMarkers]);

  // 4. Capture Selection
  const handleMouseUp = () => {
    if (!editorViewRef.current) return;
    const { from, to, empty } = editorViewRef.current.state.selection;
    if (!empty) {
      setTextSelection({
        startChar: pmPosToCharOffset(from),
        endChar: pmPosToCharOffset(to),
      });
    } else {
      clearTextSelection();
    }
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ annotationId: string, x: number, y: number }>;
      setEditingAnnId(customEvent.detail.annotationId);
    };
    window.addEventListener('qda-annotation-contextmenu', handler);
    return () => window.removeEventListener('qda-annotation-contextmenu', handler);
  }, []);

  if (!document) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-slate-400 bg-white">
        <svg className="w-16 h-16 mb-4 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
        <p className="text-lg font-medium text-slate-500">No Document Selected</p>
        <p className="text-sm mt-2 max-w-sm text-center">Select a document from the left panel or click 'Import' to add new documents to your project.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-6 py-4 border-b border-slate-200">
        <h2 className="text-xl font-semibold text-slate-800">{document.title}</h2>
      </div>
      
      <ContextMenu>
        <ContextMenuTrigger className="flex-1 flex flex-col min-h-0">
          <div 
            ref={editorContainerRef} 
            className="flex-1 relative overflow-y-auto px-6 py-4"
            onScroll={updateMarkers}
            onMouseUp={handleMouseUp}
          >
            <div ref={editorMountRef} className="prose max-w-none prose-slate" />
            
            <div style={{ position: 'absolute', top: 0, right: 0, width: '8px', height: '100%', pointerEvents: 'none' }}>
              {markers.map(m => (
                <div key={m.id} style={{
                  position: 'absolute',
                  top: m.top,
                  height: '4px',
                  width: '100%',
                  backgroundColor: m.color,
                  borderRadius: '2px',
                }} />
              ))}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem 
            onClick={() => {
              // Only dispatch if there's an active text selection
              const selection = useUiStore.getState().textSelection;
              if (!selection) {
                toast.error('Select text in the document first, then assign a code.');
                return;
              }
              window.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
            }}
          >
            Assign Code... (Ctrl+K)
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <AnnotationMemoDialog 
        annotationId={editingAnnId} 
        onClose={() => setEditingAnnId(null)} 
      />
    </div>
  );
}
