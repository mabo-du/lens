import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface RecentProject {
  path: string;
  name: string;
  openedAt: string;
}

interface UiState {
  leftPanelWidth: number;
  rightPanelWidth: number;
  activeDocumentId: string | null;
  activeCodeViewId: string | null;
  expandedCodeNodeIds: string[];
  textSelection: { startChar: number; endChar: number } | null;
  recentProjects: RecentProject[];
  
  setLeftPanelWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  setActiveDocument: (id: string | null) => void;
  setActiveCodeView: (id: string | null) => void;
  toggleCodeNodeExpanded: (id: string) => void;
  setTextSelection: (sel: { startChar: number; endChar: number } | null) => void;
  clearTextSelection: () => void;
  addRecentProject: (project: RecentProject) => void;
  removeRecentProject: (path: string) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      leftPanelWidth: 20,
      rightPanelWidth: 25,
      activeDocumentId: null,
      activeCodeViewId: null,
      expandedCodeNodeIds: [],
      textSelection: null,
      recentProjects: [],

      setLeftPanelWidth: (w) => set({ leftPanelWidth: w }),
      setRightPanelWidth: (w) => set({ rightPanelWidth: w }),
      setActiveDocument: (id) => set({ activeDocumentId: id }),
      setActiveCodeView: (id) => set({ activeCodeViewId: id }),
      toggleCodeNodeExpanded: (id) => set((state) => ({
        expandedCodeNodeIds: state.expandedCodeNodeIds.includes(id)
          ? state.expandedCodeNodeIds.filter((x) => x !== id)
          : [...state.expandedCodeNodeIds, id],
      })),
      setTextSelection: (sel) => set({ textSelection: sel }),
      clearTextSelection: () => set({ textSelection: null }),
      addRecentProject: (project) => set((state) => {
        const filtered = state.recentProjects.filter(p => p.path !== project.path);
        return { recentProjects: [project, ...filtered].slice(0, 10) };
      }),
      removeRecentProject: (path) => set((state) => ({
        recentProjects: state.recentProjects.filter(p => p.path !== path)
      })),
    }),
    {
      name: 'lens-ui-storage',
      // We only persist panel widths and tree states
      partialize: (state) => ({
        leftPanelWidth: state.leftPanelWidth,
        rightPanelWidth: state.rightPanelWidth,
        expandedCodeNodeIds: state.expandedCodeNodeIds,
        recentProjects: state.recentProjects,
      }),
    }
  )
);
