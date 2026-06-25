import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface RecentProject {
  path: string;
  name: string;
  openedAt: string;
}

export interface UndoEntry {
  action: 'delete' | 'create';
  annotation: {
    id: string;
    documentId: string;
    codeId: string;
    startChar: number;
    endChar: number;
    createdBy: string;
    createdAt: string;
  };
}

interface UiState {
  leftPanelWidth: number;
  rightPanelWidth: number;
  activeDocumentId: string | null;
  activeCodeViewId: string | null;
  expandedCodeNodeIds: string[];
  textSelection: { startChar: number; endChar: number } | null;
  recentProjects: RecentProject[];
  annotationUndoStack: UndoEntry[];
  annotationRedoStack: UndoEntry[];
  theme: 'light' | 'dark' | 'system';
  defaultCodeColor: string;

  /// Set to true once on app mount if the Rust binary was compiled with
  /// the `sqlcipher` Cargo feature. When false, the live-at-rest project
  /// encryption is unavailable (PRAGMA key is silently ignored by plain
  /// SQLite) and the UI hides the encryption option in `EncryptionDialog`.
  encryptionAvailable: boolean | null;

  setLeftPanelWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  setActiveDocument: (id: string | null) => void;
  setActiveCodeView: (id: string | null) => void;
  toggleCodeNodeExpanded: (id: string) => void;
  setTextSelection: (sel: { startChar: number; endChar: number } | null) => void;
  clearTextSelection: () => void;
  addRecentProject: (project: RecentProject) => void;
  removeRecentProject: (path: string) => void;
  pushUndo: (entry: UndoEntry) => void;
  undoAnnotation: () => UndoEntry | null;
  redoAnnotation: () => UndoEntry | null;
  fixStackTopAnnotation: (stack: 'undo' | 'redo', annotation: UndoEntry['annotation']) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setDefaultCodeColor: (color: string) => void;
  setEncryptionAvailable: (b: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      leftPanelWidth: 20,
      rightPanelWidth: 25,
      activeDocumentId: null,
      activeCodeViewId: null,
      expandedCodeNodeIds: [],
      textSelection: null,
      recentProjects: [],
      annotationUndoStack: [],
      annotationRedoStack: [],
      theme: 'system' as const,
      defaultCodeColor: '#6366f1',
      encryptionAvailable: null,

      setLeftPanelWidth: (w) => set({ leftPanelWidth: w }),
      setRightPanelWidth: (w) => set({ rightPanelWidth: w }),
      setActiveDocument: (id) => set({ activeDocumentId: id }),
      setActiveCodeView: (id) => set({ activeCodeViewId: id }),
      toggleCodeNodeExpanded: (id) =>
        set((state) => ({
          expandedCodeNodeIds: state.expandedCodeNodeIds.includes(id)
            ? state.expandedCodeNodeIds.filter((x) => x !== id)
            : [...state.expandedCodeNodeIds, id],
        })),
      setTextSelection: (sel) => set({ textSelection: sel }),
      clearTextSelection: () => set({ textSelection: null }),
      addRecentProject: (project) =>
        set((state) => {
          const filtered = state.recentProjects.filter(
            (p) => p.path !== project.path,
          );
          return {
            recentProjects: [project, ...filtered].slice(0, 10),
          };
        }),
      removeRecentProject: (path) =>
        set((state) => ({
          recentProjects: state.recentProjects.filter((p) => p.path !== path),
        })),
      pushUndo: (entry) =>
        set((state) => ({
          annotationUndoStack: [
            ...state.annotationUndoStack.slice(-49),
            entry,
          ],
          annotationRedoStack: [],
        })),
      undoAnnotation: () => {
        const state = get();
        if (state.annotationUndoStack.length === 0) return null;
        const entry =
          state.annotationUndoStack[state.annotationUndoStack.length - 1];
        set({
          annotationUndoStack: state.annotationUndoStack.slice(0, -1),
          annotationRedoStack: [
            ...state.annotationRedoStack,
            {
              ...entry,
              action:
                entry.action === 'create'
                  ? ('delete' as const)
                  : ('create' as const),
            },
          ],
        });
        return entry;
      },
      redoAnnotation: () => {
        const state = get();
        if (state.annotationRedoStack.length === 0) return null;
        const entry =
          state.annotationRedoStack[state.annotationRedoStack.length - 1];
        set({
          annotationRedoStack: state.annotationRedoStack.slice(0, -1),
          annotationUndoStack: [
            ...state.annotationUndoStack.slice(-49),
            {
              ...entry,
              action:
                entry.action === 'create'
                  ? ('delete' as const)
                  : ('create' as const),
            },
          ],
        });
        return entry;
      },
      fixStackTopAnnotation: (stack, annotation) =>
        set((state) => {
          const target = stack === 'undo' ? 'annotationUndoStack' : 'annotationRedoStack';
          const arr = state[target];
          if (arr.length === 0) return {};
          const updated = [...arr];
          updated[updated.length - 1] = { ...updated[updated.length - 1], annotation };
          return { [target]: updated };
        }),
      setTheme: (theme) => set({ theme }),
      setDefaultCodeColor: (color) => set({ defaultCodeColor: color }),
      setEncryptionAvailable: (encryptionAvailable) => set({ encryptionAvailable }),
    }),
    {
      name: 'lens-ui-storage',
      partialize: (state) => ({
        leftPanelWidth: state.leftPanelWidth,
        rightPanelWidth: state.rightPanelWidth,
        expandedCodeNodeIds: state.expandedCodeNodeIds,
        recentProjects: state.recentProjects,
        theme: state.theme,
        defaultCodeColor: state.defaultCodeColor,
      }),
    },
  ),
);
