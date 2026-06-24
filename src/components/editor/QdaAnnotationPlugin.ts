import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { AnnotationRecord } from "@/ipc/annotations";
import { CodeTreeNode } from "@/ipc/codes";
import { MemoRecord } from "@/ipc/memos";
import { charOffsetToPmPos } from "@/utils/offset-utils";

export const qdaAnnotationPluginKey = new PluginKey("qdaAnnotationPlugin");

// Helper to lighten a hex color to create a background fill
function alpha(hex: string, opacity: number): string {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export function flattenCodeTree(nodes: CodeTreeNode[]): CodeTreeNode[] {
  const result: CodeTreeNode[] = [];
  const traverse = (nodes: CodeTreeNode[]) => {
    for (const node of nodes) {
      result.push(node);
      if (node.children?.length) traverse(node.children);
    }
  };
  traverse(nodes);
  return result;
}

export function buildQdaAnnotationPlugin() {
  return new Plugin({
    key: qdaAnnotationPluginKey,
    state: {
      init() {
        return DecorationSet.empty;
      },
      apply(tr, oldSet) {
        // If the transaction has our custom metadata, rebuild the set
        const metadata = tr.getMeta(qdaAnnotationPluginKey);
        if (metadata) {
          const { annotations, codes, memos }: { annotations: AnnotationRecord[], codes: CodeTreeNode[], memos: MemoRecord[] } = metadata;
          
          const decos: Decoration[] = [];
          const flatCodes = flattenCodeTree(codes);
          
          annotations.forEach(ann => {
            const code = flatCodes.find(c => c.id === ann.codeId);
            if (!code) return; // Code was deleted but annotation remains
            
            const from = charOffsetToPmPos(ann.startChar);
            const to = charOffsetToPmPos(ann.endChar);
            
            // Safety bound check
            if (from < to && to <= tr.doc.content.size - 1) {
               const memo = memos.find(m => m.linkedSelectionId === ann.id);
               decos.push(Decoration.inline(from, to, {
                 class: "qda-highlight",
                 style: `background-color: ${alpha(code.color, 0.35)}; border-bottom: 2px solid ${code.color};`,
                 title: memo ? memo.body : undefined,
                 "data-annotation-id": ann.id,
                 "data-code-id": code.id
               }));
            }
          });
          
          return DecorationSet.create(tr.doc, decos);
        }
        
        // Otherwise, map the existing set through the transaction (e.g. if the document changed)
        return oldSet.map(tr.mapping, tr.doc);
      }
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
      handleDOMEvents: {
        contextmenu(_view, event) {
          const target = event.target as HTMLElement;
          const annId = target.getAttribute('data-annotation-id');
          if (annId) {
            window.dispatchEvent(new CustomEvent('qda-annotation-contextmenu', {
              detail: { annotationId: annId, x: event.clientX, y: event.clientY }
            }));
            event.preventDefault();
            return true; // handled
          }
          return false;
        }
      }
    }
  });
}
