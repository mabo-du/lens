import { Group, Panel, Separator } from 'react-resizable-panels';
import { DocumentList } from '../document-list/DocumentList';
import { DocumentEditor } from '../editor/DocumentEditor';
import { useUiStore } from '@/store/uiStore';

import { CodeTree } from '../code-tree/CodeTree';
import { CodeSegments } from '../code-view/CodeSegments';
import { FuzzyCodePicker } from '../editor/FuzzyCodePicker';
import { ProjectJournalDialog } from '../memos/ProjectJournalDialog';
import { SearchDialog } from '../search/SearchDialog';
import { useProjectStore } from '@/store/projectStore';
import { Book, Download, LogOut, Pencil, Settings } from 'lucide-react';
import React, { useState, ReactNode, useRef, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { exportIpc } from '@/ipc/export';
import { exporterRegistry } from '@/export/index';
import { projectsIpc } from '@/ipc/projects';
import { annotationsIpc } from '@/ipc/annotations';
import { SettingsDialog } from '../settings/SettingsDialog';

function TopNav({ onJournalOpen, onCloseProject, onSettingsOpen }: { onJournalOpen: () => void; onCloseProject: () => void; onSettingsOpen: () => void }) {
  const activeProject = useProjectStore(s => s.activeProject);
  const setActiveProject = useProjectStore(s => s.setActiveProject);
  const [exporting, setExporting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming && renameInputRef.current) renameInputRef.current.focus();
  }, [renaming]);

  const handleRename = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === activeProject?.name) {
      setRenaming(false);
      return;
    }
    try {
      const updated = await projectsIpc.rename(trimmed);
      setActiveProject(updated);
      // Update the recentProjects entry with the new name
      const uiState = useUiStore.getState();
      const rp = uiState.recentProjects.find(p => p.name === activeProject?.name);
      if (rp) {
        uiState.addRecentProject({ ...rp, name: updated.name, openedAt: new Date().toISOString() });
      }
    } catch (e) {
      toast.error(`Failed to rename project: ${e}`);
    }
    setRenaming(false);
  };

  const startRename = () => {
    setRenameValue(activeProject?.name || '');
    setRenaming(true);
  };
  
  const handleExport = async (pluginId: string) => {
    if (!activeProject) return;
    const plugin = exporterRegistry.get(pluginId);
    if (!plugin) return;
    
    const filePath = await save({
      filters: [{ name: plugin.label, extensions: [plugin.fileExtension] }],
      defaultPath: `${activeProject.name.replace(/[^a-z0-9]/gi, '_')}_Export.${plugin.fileExtension}`,
    });
    
    if (!filePath) return;
    
    try {
      setExporting(true);
      const payload = await exportIpc.prepare(activeProject.id);
      const data = await plugin.export(payload);
      
      let writeData: Uint8Array;
      if (typeof data === 'string') {
        writeData = new TextEncoder().encode(data);
      } else {
        writeData = data;
      }
      
      await writeFile(filePath, writeData);
      toast.success(`Exported successfully to ${filePath.split(/[\\/]/).pop()}`);
    } catch (e) {
      console.error("Export failed", e);
      toast.error(`Export failed: ${e}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="h-12 bg-slate-800 text-slate-200 flex items-center justify-between px-4 shrink-0">
      {renaming && activeProject ? (
        <form onSubmit={(e) => { e.preventDefault(); handleRename(); }} className="flex items-center space-x-1">
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(false); }}
            className="bg-slate-700 text-slate-200 px-2 py-0.5 rounded text-sm font-semibold outline-none ring-1 ring-blue-500 w-48"
            maxLength={64}
          />
        </form>
      ) : (
        <button
          onClick={startRename}
          className="font-semibold text-sm tracking-wide hover:text-blue-300 transition-colors flex items-center space-x-1 group"
          title="Click to rename project"
        >
          <span>{activeProject?.name || 'LENS'}</span>
          <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
        </button>
      )}
      <div className="flex items-center space-x-2">
        {activeProject && (
          <Popover>
            <PopoverTrigger className="flex items-center space-x-2 hover:bg-slate-700 px-3 py-1.5 rounded transition-colors text-sm disabled:opacity-50" disabled={exporting}>
              <Download className="w-4 h-4" />
              <span>{exporting ? 'Exporting...' : 'Export'}</span>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-1" align="end">
              <div className="text-xs font-semibold text-slate-500 px-2 py-1.5 uppercase tracking-wider">Export Format</div>
              {exporterRegistry.list().map(plugin => (
                <button 
                  key={plugin.id}
                  onClick={() => handleExport(plugin.id)}
                  className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-slate-100 text-slate-700"
                >
                  {plugin.label}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}
        <button 
          className="flex items-center space-x-2 hover:bg-slate-700 px-3 py-1.5 rounded transition-colors text-sm"
          onClick={onJournalOpen}
        >
          <Book className="w-4 h-4" />
          <span>Project Journal</span>
        </button>
        {activeProject && (
          <button 
            className="flex items-center space-x-2 hover:bg-red-800 px-3 py-1.5 rounded transition-colors text-sm"
            onClick={onCloseProject}
            title="Close Project"
          >
            <LogOut className="w-4 h-4" />
            <span>Close</span>
          </button>
        )}
        <button
          className="flex items-center space-x-2 hover:bg-slate-700 px-2 py-1.5 rounded transition-colors text-sm"
          onClick={onSettingsOpen}
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

class PanelErrorBoundary extends React.Component<
  { name: string; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="p-4 text-red-600 text-sm h-full overflow-auto">
          <p className="font-semibold">{this.props.name} encountered an error.</p>
          <p className="text-xs mt-1 text-slate-500">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export function Workspace() {
  const leftPanelWidth = useUiStore(s => s.leftPanelWidth);
  const rightPanelWidth = useUiStore(s => s.rightPanelWidth);
  const setLeftPanelWidth = useUiStore(s => s.setLeftPanelWidth);
  const setRightPanelWidth = useUiStore(s => s.setRightPanelWidth);
  const activeCodeViewId = useUiStore(s => s.activeCodeViewId);

  const handleLayout = (layout: Record<string, number>) => {
    if (layout['left'] !== undefined) setLeftPanelWidth(layout['left']);
    if (layout['right'] !== undefined) setRightPanelWidth(layout['right']);
  };

  const centerPanelWidth = 100 - leftPanelWidth - rightPanelWidth;
  const [journalOpen, setJournalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const setActiveProject = useProjectStore(s => s.setActiveProject);

  // Undo/Redo keyboard shortcuts (ACTION_PLAN P4.6)
  const undoAnnotation = useUiStore(s => s.undoAnnotation);
  const redoAnnotation = useUiStore(s => s.redoAnnotation);
  const fixStackTopAnnotation = useUiStore(s => s.fixStackTopAnnotation);
  const undoingRef = useRef(false);

  const executeUndoRedo = async (
    entry: { action: 'delete' | 'create'; annotation: { id: string; documentId: string; codeId: string; startChar: number; endChar: number; createdBy: string; createdAt: string } },
    targetStack: 'undo' | 'redo',
  ) => {
    try {
      if (entry.action === 'delete') {
        await annotationsIpc.delete(entry.annotation.id);
        useProjectStore.getState().removeAnnotation(entry.annotation.id);
      } else {
        const created = await annotationsIpc.create({
          documentId: entry.annotation.documentId,
          codeId: entry.annotation.codeId,
          startChar: entry.annotation.startChar,
          endChar: entry.annotation.endChar,
        });
        useProjectStore.getState().addAnnotation(created);
        // Fix the stack entry annotation ID so subsequent undo/redo targets the correct row
        useUiStore.getState().fixStackTopAnnotation(targetStack, created);
      }
    } catch (err) {
      console.error(`${targetStack === 'undo' ? 'Undo' : 'Redo'} failed:`, err);
      toast.error(`${targetStack === 'undo' ? 'Undo' : 'Redo'} failed: ${err}`);
    }
  };

  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        if (undoingRef.current) return;
        undoingRef.current = true;
        try {
          const entry = undoAnnotation();
          if (!entry) return;
          await executeUndoRedo(entry, 'redo');
        } finally {
          undoingRef.current = false;
        }
      } else if ((e.key === 'z' && (e.metaKey || e.ctrlKey) && e.shiftKey) || (e.key === 'y' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        if (undoingRef.current) return;
        undoingRef.current = true;
        try {
          const entry = useUiStore.getState().redoAnnotation();
          if (!entry) return;
          await executeUndoRedo(entry, 'undo');
        } finally {
          undoingRef.current = false;
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [undoAnnotation, redoAnnotation, fixStackTopAnnotation]);

  const handleCloseProject = async () => {
    try {
      await projectsIpc.close();
    } catch (e) {
      console.error('Failed to close project:', e);
    }
    setActiveProject(null);
  };

  return (
    <div className="flex flex-col h-screen w-full bg-slate-100 font-sans">
      <TopNav onJournalOpen={() => setJournalOpen(true)} onCloseProject={handleCloseProject} onSettingsOpen={() => setSettingsOpen(true)} />
      <Group
        onLayoutChanged={(sizes) => {
          // react-resizable-panels v4 passes sizes as a Record<string, number>
          // (a "Layout" map keyed by Panel id). Horizontal is the default
          // orientation; no `direction` prop is supported in v4.
          handleLayout(sizes as Record<string, number>);
        }}
      >
        <Panel id="left" defaultSize={leftPanelWidth} minSize={15}>
          <PanelErrorBoundary name="Document List">
            <DocumentList />
          </PanelErrorBoundary>
        </Panel>

        <Separator className="w-1 bg-slate-200 hover:bg-slate-300 transition-colors cursor-col-resize" />

        <Panel id="center" defaultSize={centerPanelWidth} minSize={30}>
          <PanelErrorBoundary name="Document Editor">
            <DocumentEditor />
          </PanelErrorBoundary>
        </Panel>

        <Separator className="w-1 bg-slate-200 hover:bg-slate-300 transition-colors cursor-col-resize" />

        <Panel id="right" defaultSize={rightPanelWidth} minSize={20}>
          <PanelErrorBoundary name="Right Panel">
            <div className="flex-1 overflow-y-auto">
              {activeCodeViewId ? <CodeSegments /> : <CodeTree />}
            </div>
          </PanelErrorBoundary>
        </Panel>
      </Group>
      <FuzzyCodePicker />
      <ProjectJournalDialog open={journalOpen} onOpenChange={setJournalOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <SearchDialog />
    </div>
  );
}
