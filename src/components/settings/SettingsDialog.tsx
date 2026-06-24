import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUiStore } from '@/store/uiStore';
import { useProjectStore } from '@/store/projectStore';
import { projectsIpc } from '@/ipc/projects';
import { toast } from 'sonner';

/**
 * Persist app-wide settings (theme, default code color, recent projects) to
 * a JSON file in the OS app-data directory via `@tauri-apps/plugin-store`.
 *
 * The display name is intentionally NOT in plugin-store: that's a project-
 * scoped identity field that lives in the `local_user` table and is
 * persisted via the `projectsIpc.localUserUpdateName` IPC call below.
 *
 * Returns null in non-Tauri contexts (vite dev in browser, vitest) so the
 * UI behaves identically in both; calls silently fall through.
 */
async function loadAppSettings() {
  try {
    // `Store.load` is dynamic so vite / vitest don't have to evaluate the
    // package at module-load time. The plugin only resolves inside a Tauri
    // runtime; the catch handles non-Tauri contexts.
    const { Store } = await import('@tauri-apps/plugin-store');
    const store = await Store.load('lens-app-settings.json', {
      autoSave: false,
      // Pre-seed defaults so first-run users see a non-null theme + colour
      // without picking one. Matches colorToArgb() fallback (#FF6366F1 -> #6366f1).
      defaults: { theme: 'light', defaultCodeColor: '#6366f1' },
    });
    return {
      theme: (await store.get<'light' | 'dark' | 'system'>('theme')) ?? null,
      defaultCodeColor: (await store.get<string>('defaultCodeColor')) ?? null,
    };
  } catch {
    return { theme: null, defaultCodeColor: null };
  }
}

async function saveAppSetting<K extends 'theme' | 'defaultCodeColor'>(
  key: K,
  value: string,
) {
  try {
    const { Store } = await import('@tauri-apps/plugin-store');
    const store = await Store.load('lens-app-settings.json', {
      autoSave: false,
      // Pre-seed defaults so first-run users see a non-null theme + colour
      // without picking one. Matches colorToArgb() fallback (#FF6366F1 -> #6366f1).
      defaults: { theme: 'light', defaultCodeColor: '#6366f1' },
    });
    await store.set(key, value);
    await store.save();
  } catch {
    // non-Tauri context: silently skip; UI state remains in-memory only
  }
}

const PALETTE = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#06b6d4',
  '#84cc16', '#d946ef', '#64748b', '#e11d48', '#0ea5e9',
  '#a855f7',
];

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const defaultCodeColor = useUiStore((s) => s.defaultCodeColor);
  const setDefaultCodeColor = useUiStore((s) => s.setDefaultCodeColor);
  const activeProject = useProjectStore((s) => s.activeProject);

  const [displayName, setDisplayName] = useState('');
  const [savingName, setSavingName] = useState(false);

  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!open || hydratedRef.current) return;
    hydratedRef.current = true;
    if (activeProject) {
      projectsIpc.localUserGetName()
        .then(setDisplayName)
        .catch(() => setDisplayName('Local User'));
    }
    // Hydrate app-wide settings from plugin-store (theme, defaultCodeColor).
    loadAppSettings().then((s) => {
      if (s.theme) setTheme(s.theme);
      if (s.defaultCodeColor) setDefaultCodeColor(s.defaultCodeColor);
    });
  }, [open, activeProject, setTheme, setDefaultCodeColor]);

  const applyTheme = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    void saveAppSetting('theme', newTheme);
    // Default to 'light' for first-run MVP; users that pick 'system' opt into
    // the OS-preferences matchMedia call which is not covered by vitest/jsdom.
    const isDark =
      newTheme === 'dark' ||
      (newTheme === 'system' &&
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', isDark);
    }
  };

  const applyDefaultCodeColor = (color: string) => {
    setDefaultCodeColor(color);
    void saveAppSetting('defaultCodeColor', color);
  };

  const handleSaveName = async () => {
    const trimmed = displayName.trim();
    if (!trimmed) {
      toast.error('Display name must not be empty');
      return;
    }
    setSavingName(true);
    try {
      await projectsIpc.localUserUpdateName(trimmed);
      toast.success('Display name updated');
    } catch (e) {
      toast.error(`Failed to update name: ${e}`);
    } finally {
      setSavingName(false);
    }
  };



  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-2">
          {/* Display Name */}
          <div>
            <label htmlFor="display-name" className="text-sm font-medium text-slate-700 block mb-1.5">
              Display Name
            </label>
            <div className="flex space-x-2">
              <input
                id="display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                className="flex-1 px-3 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                maxLength={64}
                placeholder="Your name"
              />
              <button
                onClick={handleSaveName}
                disabled={savingName}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {savingName ? 'Saving...' : 'Save'}
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Displayed as the coder in exports.
            </p>
          </div>

          {/* Theme */}
          <fieldset>
            <legend className="text-sm font-medium text-slate-700 block mb-1.5">
              Theme
            </legend>
            <div role="radiogroup" aria-label="Theme" className="flex space-x-2">
              {(['light', 'dark', 'system'] as const).map((t) => (
                <button
                  key={t}
                  role="radio"
                  aria-checked={theme === t}
                  onClick={() => applyTheme(t)}
                  className={`flex-1 px-3 py-1.5 text-sm rounded border transition-colors ${
                    theme === t
                      ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </fieldset>

          {/* Default Code Color */}
          <fieldset>
            <legend className="text-sm font-medium text-slate-700 block mb-1.5">
              Default Code Color
            </legend>
            <div role="group" aria-label="Default code color palette" className="flex flex-wrap gap-2">
              {PALETTE.map((color) => (
                <button
                  key={color}
                  onClick={() => applyDefaultCodeColor(color)}
                  aria-pressed={defaultCodeColor === color}
                  aria-label={`Set default code color to ${color}`}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    defaultCodeColor === color
                      ? 'border-slate-800 scale-110 shadow-md'
                      : 'border-transparent hover:scale-105'
                  }`}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Used when auto-assigning colors to new codes.
            </p>
          </fieldset>
        </div>
      </DialogContent>
    </Dialog>
  );
}
