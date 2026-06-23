import { create } from 'zustand';
import { DocumentRecord } from '@/ipc/documents';
import { CodeTreeNode } from '@/ipc/codes';
import { AnnotationRecord } from '@/ipc/annotations';
import { MemoRecord } from '@/ipc/memos';
import { Project } from '@/ipc/projects';

interface ProjectState {
  activeProject: Project | null;
  documents: DocumentRecord[];
  codes: CodeTreeNode[];
  annotations: AnnotationRecord[];
  memos: MemoRecord[];

  setActiveProject: (project: Project | null) => void;
  setDocuments: (docs: DocumentRecord[]) => void;
  addDocuments: (docs: DocumentRecord[]) => void;
  setCodes: (codes: CodeTreeNode[]) => void;
  setAnnotations: (annotations: AnnotationRecord[]) => void;
  addAnnotation: (annotation: AnnotationRecord) => void;
  removeAnnotation: (id: string) => void;
  setMemos: (memos: MemoRecord[]) => void;
  addMemo: (memo: MemoRecord) => void;
  updateDocument: (id: string, updates: Partial<DocumentRecord>) => void;
  removeDocument: (id: string) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  activeProject: null,
  documents: [],
  codes: [],
  annotations: [],
  memos: [],

  setActiveProject: (project) => set({ activeProject: project }),
  setDocuments: (docs) => set({ documents: docs }),
  addDocuments: (docs) => set((state) => ({ documents: [...state.documents, ...docs] })),
  setCodes: (codes) => set({ codes: codes }),
  setAnnotations: (annotations) => set({ annotations }),
  addAnnotation: (annotation) => set((state) => ({ 
    annotations: [...state.annotations, annotation] 
  })),
  removeAnnotation: (id) => set((state) => ({
    annotations: state.annotations.filter(a => a.id !== id)
  })),
  setMemos: (memos) => set({ memos }),
  addMemo: (memo) => set((state) => {
    const existing = state.memos.find(m => m.id === memo.id);
    if (existing) {
      return { memos: state.memos.map(m => m.id === memo.id ? memo : m) };
    }
    return { memos: [...state.memos, memo] };
  }),
  updateDocument: (id, updates) => set((state) => ({
    documents: state.documents.map(d => d.id === id ? { ...d, ...updates } : d)
  })),
  removeDocument: (id) => set((state) => ({
    documents: state.documents.filter(d => d.id !== id)
  })),
}));
