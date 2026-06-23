
import { Workspace } from "./components/workspace/Workspace";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { useProjectStore } from "./store/projectStore";
import { documentsIpc } from "./ipc/documents";
import { codesIpc } from "./ipc/codes";
import { memosIpc } from "./ipc/memos";
import { projectsIpc } from "./ipc/projects";
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import "./App.css";

function App() {
  const activeProject = useProjectStore(s => s.activeProject);
  const setActiveProject = useProjectStore(s => s.setActiveProject);
  const setDocuments = useProjectStore(s => s.setDocuments);
  const setCodes = useProjectStore(s => s.setCodes);
  const setMemos = useProjectStore(s => s.setMemos);

  const handleOpenProject = async () => {
    const selected = await openDialog({ directory: true });
    if (selected && typeof selected === 'string') {
      try {
        const proj = await projectsIpc.open(selected);
        setActiveProject(proj);
        const docs = await documentsIpc.list(proj.id);
        setDocuments(docs);
        const codesList = await codesIpc.getTree(proj.id);
        setCodes(codesList);
        const memosList = await memosIpc.listByProject(proj.id);
        setMemos(memosList);
      } catch (e) {
        toast.error("Failed to open project: " + e);
      }
    }
  };

  const handleCreateProject = async () => {
    const selected = await openDialog({ directory: true });
    if (selected && typeof selected === 'string') {
      try {
        const proj = await projectsIpc.create("New Project", "", selected);
        setActiveProject(proj);
        setDocuments([]);
        setCodes([]);
        setMemos([]);
      } catch (e) {
        toast.error("Failed to create project: " + e);
      }
    }
  };

  // We load annotations per document in DocumentEditor now, so no need to do it here.

  if (!activeProject) {
    return (
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
            <button onClick={handleCreateProject} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
              New Project
            </button>
            <button onClick={handleOpenProject} className="px-4 py-2 bg-slate-200 text-slate-800 rounded hover:bg-slate-300">
              Open Project
            </button>
          </div>
          <Toaster />
        </div>
      </div>
    );
  }

  return (
    <>
      <Workspace />
      <Toaster />
    </>
  );
}

export default App;
