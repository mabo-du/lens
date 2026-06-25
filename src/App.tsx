
import { Workspace } from "./components/workspace/Workspace";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { useProjectStore } from "./store/projectStore";
import { documentsIpc } from "./ipc/documents";
import { codesIpc } from "./ipc/codes";
import { memosIpc } from "./ipc/memos";
import { projectsIpc } from "./ipc/projects";
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useUiStore } from './store/uiStore';
import { qdpxImportIpc } from './ipc/qdpx_import';
import { useEffect, useState } from 'react';
import { EncryptionDialog } from './components/settings/EncryptionDialog';
import { ConflictDialog } from './components/settings/ConflictDialog';
import { ProjectNameDialog } from './components/settings/ProjectNameDialog';
import { encryptionIpc } from './ipc/encryption';
import { usePromptDialog } from './hooks/usePromptDialog';
import { Beaker, FolderOpen, Plus, X } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import "./App.css";

function App() {
  const theme = useUiStore(s => s.theme);

  // Apply theme on startup and when changed
  useEffect(() => {
    const isDark =
      theme === 'dark' ||
      (theme === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', isDark);
  }, [theme]);

  // Listen for system theme changes when in 'system' mode
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.classList.toggle('dark', e.matches);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const activeProject = useProjectStore(s => s.activeProject);
  const setActiveProject = useProjectStore(s => s.setActiveProject);
  const setDocuments = useProjectStore(s => s.setDocuments);
  const setCodes = useProjectStore(s => s.setCodes);
  const setMemos = useProjectStore(s => s.setMemos);

  const addRecentProject = useUiStore(s => s.addRecentProject);
  const recentProjects = useUiStore(s => s.recentProjects);
  const removeRecentProject = useUiStore(s => s.removeRecentProject);
  const setEncryptionAvailable = useUiStore(s => s.setEncryptionAvailable);

  // On mount, ask the Rust side whether this build was linked with
  // SQLCipher. Used by `EncryptionDialog` to hide project-level
  // encryption when the live-at-rest pathway isn't available.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const available = await encryptionIpc.available();
        if (!cancelled) setEncryptionAvailable(available);
      } catch {
        if (!cancelled) setEncryptionAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setEncryptionAvailable]);

  // Prompt dialogs (shared hook)
  const encryptPrompt = usePromptDialog<string>();
  const [encryptMode, setEncryptMode] = useState<'create' | 'unlock'>('create');
  const promptEncryption = (mode: 'create' | 'unlock') => {
    setEncryptMode(mode);
    return encryptPrompt.prompt();
  };

  const namePrompt = usePromptDialog<string>();
  const conflictPrompt = usePromptDialog<'merge' | 'replace'>();

  const loadProjectData = async (proj: { id: string; name: string; description: string | null; createdAt: string; updatedAt: string }, folderPath: string) => {
    setActiveProject(proj);
    const docs = await documentsIpc.list(proj.id);
    setDocuments(docs);
    const codesList = await codesIpc.getTree(proj.id);
    setCodes(codesList);
    const memosList = await memosIpc.listByProject(proj.id);
    setMemos(memosList);
    addRecentProject({ path: folderPath, name: proj.name, openedAt: new Date().toISOString() });
  };

  const handleOpenProject = async (folderPath?: string) => {
    const selected = folderPath || await openDialog({ directory: true });
    if (selected && typeof selected === 'string') {
      try {
        // Check for a live collaboration lock before opening.
        const lockWarning = await projectsIpc.checkLock(selected);
        if (lockWarning && !confirm(lockWarning + '\n\nOpen anyway?')) {
          return;
        }
        // Check if project is encrypted
        let encryptionKey: string | undefined;
        const encrypted = await projectsIpc.isEncrypted(selected);
        if (encrypted) {
          const pw = await promptEncryption('unlock');
          if (!pw) return;
          encryptionKey = pw;
        }
        const proj = await projectsIpc.open(selected, encryptionKey ?? undefined);
        await loadProjectData(proj, selected);
      } catch (e) {
        toast.error("Failed to open project: " + e);
      }
    }
  };



  const handleQdpxImport = async () => {
    if (!activeProject) return;
    const files = await openDialog({
      multiple: false,
      filters: [{ name: 'REFI-QDA Project', extensions: ['qdpx'] }],
    });
    if (!files || typeof files !== 'string') return;

    // Determine conflict mode
    const store = useProjectStore.getState();
    const hasData = store.documents.length > 0 || store.codes.length > 0;
    let mode: 'merge' | 'replace' = 'merge';
    if (hasData) {
      const choice = await conflictPrompt.prompt();
      if (!choice) return; // user cancelled
      mode = choice;
    }

    try {
      const result = await qdpxImportIpc.import(files, mode);
      if (mode === 'replace') {
        toast.success(result, {
          action: { label: 'Undo', onClick: handleUndoImport },
          duration: 8000,
        });
      } else {
        toast.success(result);
      }
      // Reload project data
      const proj = useProjectStore.getState().activeProject!;
      const docs = await documentsIpc.list(proj.id);
      setDocuments(docs);
      const codesList = await codesIpc.getTree(proj.id);
      setCodes(codesList);
      const memosList = await memosIpc.listByProject(proj.id);
      setMemos(memosList);
    } catch (e) {
      toast.error(`Import failed: ${e}`);
    }
  };

  const handleUndoImport = async () => {
    try {
      const result = await qdpxImportIpc.undo();
      toast.success(result);
      // Reload project data
      const proj = useProjectStore.getState().activeProject!;
      const docs = await documentsIpc.list(proj.id);
      setDocuments(docs);
      const codesList = await codesIpc.getTree(proj.id);
      setCodes(codesList);
      const memosList = await memosIpc.listByProject(proj.id);
      setMemos(memosList);
    } catch (e) {
      toast.error(`Undo failed: ${e}`);
    }
  };

  const handleCreateSampleProject = async () => {
    const selected = await openDialog({ directory: true });
    if (selected && typeof selected === 'string') {
      try {
        const proj = await projectsIpc.createSample(selected);
        // Sample project is never encrypted
        setActiveProject(proj);
        setDocuments([]);
        setCodes([]);
        setMemos([]);
        // Reload to get the seeded data
        const docs = await documentsIpc.list(proj.id);
        setDocuments(docs);
        const codesList = await codesIpc.getTree(proj.id);
        setCodes(codesList);
        const memosList = await memosIpc.listByProject(proj.id);
        setMemos(memosList);
        addRecentProject({ path: `${selected}/Sample Project`, name: proj.name, openedAt: new Date().toISOString() });
      } catch (e) {
        toast.error(`Failed to create sample project: ${e}`);
      }
    }
  };

  const handleCreateProject = async () => {
    const selected = await openDialog({ directory: true });
    if (!selected || typeof selected !== 'string') return;

    // P1.8: Prompt for a project name (no longer hardcoded "New Project").
    const name = await namePrompt.prompt();
    if (!name) return;

    try {
      const encryptionKey = await promptEncryption('create');
      // UI's "Create without password" button resolves the prompt with
      // an empty string. Convert that to `undefined` so the Rust side
      // receives `None` (no `.encrypted` flag, no PRAGMA key).
      const realKey =
        encryptionKey && encryptionKey.length > 0 ? encryptionKey : undefined;
      const proj = await projectsIpc.create(name, "", selected, realKey);
      const folderPath = `${selected}/${proj.name}`;
      setActiveProject(proj);
      setDocuments([]);
      setCodes([]);
      setMemos([]);
      addRecentProject({ path: folderPath, name: proj.name, openedAt: new Date().toISOString() });
    } catch (e) {
      toast.error("Failed to create project: " + e);
    }
  };

  // We load annotations per document in DocumentEditor now, so no need to do it here.

  if (!activeProject) {
    return (
      <>
        <EncryptionDialog
          open={encryptPrompt.open}
          mode={encryptMode}
          onConfirm={(pw) => encryptPrompt.resolve(pw)}
          onCancel={() => encryptPrompt.resolve(null)}
        />
        <ProjectNameDialog
          open={namePrompt.open}
          onConfirm={(name) => namePrompt.resolve(name)}
          onCancel={() => namePrompt.resolve(null)}
        />
        <div className="flex h-screen items-center justify-center bg-slate-100">
        <div className="p-8 bg-white shadow-md rounded-lg text-center space-y-6">
          <div className="mx-auto w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center mb-4">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">LENS</h1>
            <p className="text-slate-500 mt-2 text-sm">Qualitative Data Analysis</p>
          </div>
          <div className="flex flex-col space-y-3 mt-6">
            <button onClick={handleCreateProject} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center justify-center space-x-2">
              <Plus className="w-4 h-4" />
              <span>New Project</span>
            </button>
            <button onClick={handleCreateSampleProject} className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 flex items-center justify-center space-x-2">
              <Beaker className="w-4 h-4" />
              <span>Sample Project</span>
            </button>
            <button onClick={() => handleOpenProject()} className="px-4 py-2 bg-slate-200 text-slate-800 rounded hover:bg-slate-300 flex items-center justify-center space-x-2">
              <FolderOpen className="w-4 h-4" />
              <span>Open Project</span>
            </button>

          </div>
          {recentProjects.length > 0 && (
            <div className="mt-6 pt-4 border-t border-slate-200">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Recent Projects</h3>
              <div className="space-y-1">
                {recentProjects.map(rp => (
                  <div key={rp.path} className="group flex items-center">
                    <button
                      onClick={() => handleOpenProject(rp.path)}
                      className="flex-1 text-left px-3 py-2 rounded text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-800 transition-colors truncate"
                      title={rp.path}
                    >
                      <div className="font-medium truncate">{rp.name}</div>
                      <div className="text-xs text-slate-400 truncate">{rp.path}</div>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeRecentProject(rp.path); }}
                      className="px-2 py-1 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-all"
                      title="Remove from recent"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <Toaster />
        </div>
      </div>
      </>
    );
  }

  return (
    <TooltipProvider delay={500}>
      <EncryptionDialog
        open={encryptPrompt.open}
        mode={encryptMode}
        onConfirm={(pw) => encryptPrompt.resolve(pw)}
        onCancel={() => encryptPrompt.resolve(null)}
      />
      <ProjectNameDialog
        open={namePrompt.open}
        onConfirm={(name) => namePrompt.resolve(name)}
        onCancel={() => namePrompt.resolve(null)}
      />
      <ConflictDialog
        open={conflictPrompt.open}
        onMerge={() => conflictPrompt.resolve('merge')}
        onReplace={() => conflictPrompt.resolve('replace')}
        onCancel={() => conflictPrompt.resolve(null)}
      />
      <Workspace onImportQdpx={handleQdpxImport} />
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
