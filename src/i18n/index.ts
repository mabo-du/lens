/**
 * i18n foundation — minimal matcher.
 *
 * v0.2 ships English as the baseline (default) and Spanish as the first
 * localised companion, with a simple `t()` lookup that falls through to
 * the English string when a key is missing in the active locale.
 *
 * v0.2 follow-up:
 *  - Wire react-i18next (or stay label-based; the latter pulls no deps).
 *  - Locale picker in the Settings panel.
 *  - French + Arabic + Portuguese translators.
 *  - Plural rules.
 */

export type Locale = 'en' | 'es';

type Dictionary = Record<string, string>;

const en: Dictionary = {
  'app.title': 'LENS',
  'app.tagline': 'Qualitative Data Analysis',
  'project.new': 'New Project',
  'project.open': 'Open Project',
  'project.sample': 'Sample Project',
  'project.close': 'Close',
  'workspace.codes': 'Codes',
  'workspace.documents': 'Documents',
  'workspace.import': 'Import',
  'code.new': 'New Code',
  'code.save': 'Save Code',
  'code.cancel': 'Cancel',
  'code.name': 'Name',
  'code.color': 'Color',
  'code.parent': 'Parent Code',
  'code.description': 'Description',
  'code.empty': 'No codes yet.',
  'document.empty': 'No documents imported yet.',
  'document.delete.confirm': 'Delete "{title}"? This will also delete all associated annotations.',
  'search.placeholder': 'Search documents and memos...',
  'search.empty': 'Type to search across all your documents and memos...',
  'search.noResults': 'No results found for "{query}"',
  'search.group.documents': 'Documents',
  'search.group.memos': 'Memos',
  'settings.title': 'Settings',
  'settings.displayName': 'Display name',
  'settings.theme': 'Theme',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.theme.system': 'System',
  'settings.defaultCodeColor': 'Default code colour',
  'annotation.assign': 'Assign code…',
};

const es: Dictionary = {
  'app.title': 'LENS',
  'app.tagline': 'Análisis Cualitativo de Datos',
  'project.new': 'Nuevo proyecto',
  'project.open': 'Abrir proyecto',
  'project.sample': 'Proyecto de muestra',
  'project.close': 'Cerrar',
  'workspace.codes': 'Códigos',
  'workspace.documents': 'Documentos',
  'workspace.import': 'Importar',
  'code.new': 'Nuevo código',
  'code.save': 'Guardar código',
  'code.cancel': 'Cancelar',
  'code.name': 'Nombre',
  'code.color': 'Color',
  'code.parent': 'Código padre',
  'code.description': 'Descripción',
  'code.empty': 'Aún no hay códigos.',
  'document.empty': 'Aún no se han importado documentos.',
  'document.delete.confirm': '¿Eliminar "{title}"? Esto también eliminará todas las anotaciones asociadas.',
  'search.placeholder': 'Buscar en documentos y memos...',
  'search.empty': 'Escribe para buscar en todos tus documentos y memos...',
  'search.noResults': 'Sin resultados para "{query}"',
  'search.group.documents': 'Documentos',
  'search.group.memos': 'Memos',
  'settings.title': 'Ajustes',
  'settings.displayName': 'Nombre para mostrar',
  'settings.theme': 'Tema',
  'settings.theme.light': 'Claro',
  'settings.theme.dark': 'Oscuro',
  'settings.theme.system': 'Sistema',
  'settings.defaultCodeColor': 'Color de código por defecto',
  'annotation.assign': 'Asignar código…',
};

const dictionaries: Record<Locale, Dictionary> = { en, es };

let active: Locale = detectLocale();

function detectLocale(): Locale {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('lens-locale') : null;
  if (stored === 'es' || stored === 'en') return stored;
  if (typeof navigator !== 'undefined' && /^es\b/i.test(navigator.language)) return 'es';
  return 'en';
}

export function currentLocale(): Locale {
  return active;
}

export function setLocale(next: Locale): void {
  active = next;
  if (typeof localStorage !== 'undefined') localStorage.setItem('lens-locale', next);
}

export function t(key: keyof typeof en, vars?: Record<string, string | number>): string {
  const templ = dictionaries[active][key] ?? dictionaries.en[key] ?? key;
  if (!vars) return templ;
  return templ.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

/** Test/dev hook: re-detects locale from localStorage / navigator. */
export function reloadLocale(): void {
  active = detectLocale();
}
