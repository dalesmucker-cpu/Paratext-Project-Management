/**
 * Lightweight in-view i18n. The host's `localizedStrings.json` powers menu labels, but webviews
 * can't read it directly, so this module mirrors a small EN/ES dictionary for in-view text. Strings
 * are also added to `contributions/localizedStrings.json` so the host's localization pipeline stays
 * the source of truth for keys that need to be shared.
 */
import { useCallback } from 'react';

export type Lang = 'en' | 'es';

type Dict = Record<string, string>;

const en: Dict = {
  'verifier.title': 'Key Terms Verifier',
  'verifier.toggleSidebarShow': 'Show sidebar',
  'verifier.toggleSidebarHide': 'Hide sidebar',
  'verifier.changeProject': 'Change project',
  'verifier.saving': 'Saving...',
  'verifier.selectProjectEmpty': 'No project selected.',
  'verifier.selectProject': 'Select project',
  'verifier.loading': 'Loading key terms from Paratext...',
  'verifier.refresh': 'Refresh',
  'verifier.searchPlaceholder': 'Search term, gloss, strong...',
  'verifier.semanticDomain': 'Semantic domain',
  'verifier.allDomains': 'All domains',
  'verifier.filterAll': 'All',
  'verifier.filterComplete': 'Complete',
  'verifier.filterPartial': 'Partial',
  'verifier.filterMissing': 'Missing',
  'verifier.completed': '% Complete',
  'verifier.termsCount': '%1 / %2 terms',
  'verifier.statusComplete': 'Complete',
  'verifier.statusPartial': 'Partial',
  'verifier.statusMissing': 'Missing',
  'verifier.emptyList': 'No terms match the filters.',
  'verifier.selectTermPrompt': 'Select a term from the sidebar to start verifying.',
  'verifier.renderingsTitle': 'Target-language translations',
  'verifier.addRenderingPlaceholder': 'Add a new translation...',
  'verifier.add': 'Add',
  'verifier.proposedBy': 'Proposed by: %1',
  'verifier.statusDraft': 'Draft',
  'verifier.statusProposed': 'Proposed',
  'verifier.statusDisputed': 'Disputed',
  'verifier.statusApproved': 'Approved',
  'verifier.tagPlaceholder': '+tag',
  'verifier.noRenderings': 'No proposed translations for this term.',
  'verifier.expectedPassages': 'Expected passages',
  'verifier.scanning': 'Scanning...',
  'verifier.notScanned': 'Not scanned',
  'verifier.scanPassages': 'Scan',
  'verifier.rescanPassages': 'Re-scan',
  'verifier.scanPrompt': 'Click "Scan" to check the translation text for these passages.',
  'verifier.found': '✓ Found (%1)',
  'verifier.missing': '✗ Missing',
  'verifier.morphologyTitle': 'Morphology configuration',
  'verifier.languageName': 'Language name',
  'verifier.fuzzyMatch': 'Fuzzy match (Levenshtein)',
  'verifier.maxDistance': 'Max distance (1-4):',
  'verifier.prefixes': 'Common prefixes to ignore',
  'verifier.suffixes': 'Common suffixes to ignore',
  'verifier.infixes': 'Common infixes to ignore',
  'verifier.prefixPlaceholder': 'ni-',
  'verifier.suffixPlaceholder': '-ini',
  'verifier.infixPlaceholder': '-in-',
  'verifier.labelPlaceholder': 'Label...',
  'verifier.collabNotesTitle': 'Team discussion notes',
  'verifier.notesPlaceholder': 'Write a note for the team...',
  'verifier.sendNote': 'Send note',
  'verifier.noNotes': 'No comments on this term yet.',
  'verifier.errorLoading': 'Error loading key terms: %1',
  'verifier.errorSaving': 'Error saving: %1',
  'verifier.selectProjectTitle': 'Select project',
  'verifier.selectProjectPrompt': 'Choose a project to verify key terms:',
  'verifier.toggleLanguage': 'Toggle language',
  'verifier.strongLabel': 'Strong',
  'verifier.domainsLabel': 'Domains',
  'verifier.votes': 'votes',

  'analytics.title': 'Key Terms Analytics Dashboard',
  'analytics.consistencyCheck': 'Consistency check',
  'analytics.scanning': 'Scanning...',
  'analytics.book': 'Book',
  'analytics.refreshScan': 'Refresh scan',
  'analytics.changeProject': 'Change project',
  'analytics.toggleLanguage': 'Toggle language',
  'analytics.retry': '(retry)',
  'analytics.progressIn': 'Progress in %1',
  'analytics.verified': 'verified',
  'analytics.foundOf': 'Found %1 of %2 key terms with approved translations.',
  'analytics.exportReports': 'Export reports',
  'analytics.mostMissing': 'Most missing terms',
  'analytics.noMissingInBook': 'No missing key terms in this book.',
  'analytics.chapterHeatmap': 'Chapter heatmap',
  'analytics.legendComplete': 'Complete',
  'analytics.legendPartial': 'Partial',
  'analytics.legendMissing': 'Missing',
  'analytics.chapterLabel': 'Chapter %1, %2 of %3 found',
  'analytics.chapterDetails': 'Chapter %1 details',
  'analytics.termsFoundOf': '%1 of %2 terms found',
  'analytics.colGloss': 'Gloss / term',
  'analytics.colLemma': 'Lemma',
  'analytics.colRenderings': 'Expected renderings',
  'analytics.colMatch': 'Match in text',
  'analytics.colActions': 'Actions',
  'analytics.missing': 'Missing',
  'analytics.viewVerse': 'View verse',
  'analytics.edit': 'Edit',
  'analytics.noTermsInChapter': 'No expected key terms in chapter %1.',
  'analytics.noneApproved': 'None approved',
  'analytics.loadingMetrics': 'Loading key term metrics...',
  'analytics.noProject': 'No project active',
  'analytics.noProjectDesc':
    'Open or select a Scripture project in Paratext to view key term statistics.',
  'analytics.errorLoading': 'Error loading key terms: %1',
  'analytics.errorExportingCsv': 'Error exporting CSV',
  'analytics.errorExportingHtml': 'Error exporting HTML report',
  'analytics.exportedCsv': 'CSV report exported to:',
  'analytics.exportedHtml': 'HTML report exported to:',
  'analytics.csvYes': 'Yes',
  'analytics.csvNo': 'No',
  'analytics.htmlReportTitle': 'Key Terms Report',
  'analytics.htmlReportHeading': 'Key Terms Verification Report',
  'analytics.htmlBook': 'Book',
  'analytics.htmlReportDate': 'Report date',
  'analytics.htmlMatchPercent': 'Match percentage',
  'analytics.htmlTermsFound': 'Terms found',
  'analytics.htmlMatchDetails': 'Match details by verse',
  'analytics.htmlRef': 'Reference',
  'analytics.htmlTerm': 'Term',
  'analytics.htmlLemma': 'Lemma',
  'analytics.htmlExpectedRenderings': 'Expected renderings',
  'analytics.htmlStatus': 'Status',
  'analytics.htmlMatchedText': 'Matched text',
  'analytics.htmlFound': '✓ Found',
  'analytics.htmlMissing': '✗ Missing',
  'analytics.selectProjectTitle': 'Select project',
  'analytics.selectProjectPromptAnalytics': 'Choose a project to view key term statistics:',
};

const es: Dict = {
  'verifier.title': 'Verificador de Términos Clave',
  'verifier.toggleSidebarShow': 'Mostrar panel lateral',
  'verifier.toggleSidebarHide': 'Ocultar panel lateral',
  'verifier.changeProject': 'Cambiar Proyecto',
  'verifier.saving': 'Guardando...',
  'verifier.selectProjectEmpty': 'Ningún proyecto seleccionado.',
  'verifier.selectProject': 'Seleccionar Proyecto',
  'verifier.loading': 'Cargando términos clave de Paratext...',
  'verifier.refresh': 'Actualizar',
  'verifier.searchPlaceholder': 'Buscar término, glosa, strong...',
  'verifier.semanticDomain': 'Dominio Semántico',
  'verifier.allDomains': 'Todos los dominios',
  'verifier.filterAll': 'Todos',
  'verifier.filterComplete': 'Completos',
  'verifier.filterPartial': 'Parciales',
  'verifier.filterMissing': 'Faltantes',
  'verifier.completed': '% Completado',
  'verifier.termsCount': '%1 / %2 términos',
  'verifier.statusComplete': 'Completo',
  'verifier.statusPartial': 'Parcial',
  'verifier.statusMissing': 'Faltante',
  'verifier.emptyList': 'Ningún término coincide con los filtros.',
  'verifier.selectTermPrompt':
    'Selecciona un término de la lista lateral para empezar a verificar.',
  'verifier.renderingsTitle': 'Traducciones en el idioma meta',
  'verifier.addRenderingPlaceholder': 'Agregar nueva traducción...',
  'verifier.add': 'Agregar',
  'verifier.proposedBy': 'Propuesto por: %1',
  'verifier.statusDraft': 'Borrador',
  'verifier.statusProposed': 'Propuesto',
  'verifier.statusDisputed': 'Discutido',
  'verifier.statusApproved': 'Aprobado',
  'verifier.tagPlaceholder': '+tag',
  'verifier.noRenderings': 'No hay traducciones propuestas para este término.',
  'verifier.expectedPassages': 'Pasajes esperados',
  'verifier.scanning': 'Escaneando...',
  'verifier.notScanned': 'No escaneado',
  'verifier.scanPassages': 'Escanear',
  'verifier.rescanPassages': 'Re-escanear',
  'verifier.scanPrompt':
    'Haz clic en "Escanear" para verificar el texto de la traducción en estos pasajes.',
  'verifier.found': '✓ Encontrado (%1)',
  'verifier.missing': '✗ Falta',
  'verifier.morphologyTitle': 'Configuración Morfológica',
  'verifier.languageName': 'Nombre del idioma',
  'verifier.fuzzyMatch': 'Búsqueda Difusa (Levenshtein)',
  'verifier.maxDistance': 'Distancia máx (1-4):',
  'verifier.prefixes': 'Prefijos comunes a ignorar',
  'verifier.suffixes': 'Sufijos comunes a ignorar',
  'verifier.infixes': 'Infijos comunes a ignorar',
  'verifier.prefixPlaceholder': 'ni-',
  'verifier.suffixPlaceholder': '-ini',
  'verifier.infixPlaceholder': '-in-',
  'verifier.labelPlaceholder': 'Etiqueta...',
  'verifier.collabNotesTitle': 'Notas de Discusión del Equipo',
  'verifier.notesPlaceholder': 'Escribe una nota para el equipo...',
  'verifier.sendNote': 'Enviar nota',
  'verifier.noNotes': 'No hay comentarios sobre la traducción de este término.',
  'verifier.errorLoading': 'Error al cargar datos de términos clave: %1',
  'verifier.errorSaving': 'Error al guardar datos: %1',
  'verifier.selectProjectTitle': 'Seleccionar Proyecto',
  'verifier.selectProjectPrompt': 'Elige un proyecto para verificar términos clave:',
  'verifier.toggleLanguage': 'Cambiar idioma',
  'verifier.strongLabel': 'Strong',
  'verifier.domainsLabel': 'Dominios',
  'verifier.votes': 'votos',

  'analytics.title': 'Tablero de Analíticas de Términos Clave',
  'analytics.consistencyCheck': 'Verificación de Consistencia',
  'analytics.scanning': 'Escaneando...',
  'analytics.book': 'Libro',
  'analytics.refreshScan': 'Actualizar Escaneo',
  'analytics.changeProject': 'Cambiar Proyecto',
  'analytics.toggleLanguage': 'Cambiar idioma',
  'analytics.retry': '(reintentar)',
  'analytics.progressIn': 'Progreso en %1',
  'analytics.verified': 'verificado',
  'analytics.foundOf':
    'Encontrados %1 de %2 términos clave correspondientes con traducciones aprobadas.',
  'analytics.exportReports': 'Exportar Reportes',
  'analytics.mostMissing': 'Términos Más Faltantes',
  'analytics.noMissingInBook': '¡No faltan términos clave en este libro!',
  'analytics.chapterHeatmap': 'Matriz de Capítulos (Heatmap)',
  'analytics.legendComplete': 'Completo',
  'analytics.legendPartial': 'Parcial',
  'analytics.legendMissing': 'Faltante',
  'analytics.chapterLabel': 'Capítulo %1, %2 de %3 encontrados',
  'analytics.chapterDetails': 'Detalles del Capítulo %1',
  'analytics.termsFoundOf': '%1 de %2 términos encontrados',
  'analytics.colGloss': 'Glosas / Término',
  'analytics.colLemma': 'Lema',
  'analytics.colRenderings': 'Traducciones Esperadas',
  'analytics.colMatch': 'Coincidencia en el texto',
  'analytics.colActions': 'Acciones',
  'analytics.missing': 'Faltante',
  'analytics.viewVerse': 'Ver versículo',
  'analytics.edit': 'Editar',
  'analytics.noTermsInChapter': 'No hay términos clave esperados en el Capítulo %1.',
  'analytics.noneApproved': 'Ninguna aprobada',
  'analytics.loadingMetrics': 'Cargando métricas de términos clave...',
  'analytics.noProject': 'Ningún proyecto activo seleccionado',
  'analytics.noProjectDesc':
    'Abre o selecciona un proyecto de Scripture en Paratext para visualizar las estadísticas de los términos clave.',
  'analytics.errorLoading': 'Error al cargar datos de términos clave: %1',
  'analytics.errorExportingCsv': 'Error al exportar CSV',
  'analytics.errorExportingHtml': 'Error al exportar reporte HTML',
  'analytics.exportedCsv': 'Reporte CSV exportado exitosamente a:',
  'analytics.exportedHtml': 'Reporte HTML exportado exitosamente a:',
  'analytics.csvYes': 'Sí',
  'analytics.csvNo': 'No',
  'analytics.htmlReportTitle': 'Reporte de Términos Clave',
  'analytics.htmlReportHeading': 'Reporte de Verificación de Términos Clave',
  'analytics.htmlBook': 'Libro',
  'analytics.htmlReportDate': 'Fecha del Reporte',
  'analytics.htmlMatchPercent': 'Porcentaje de Coincidencia',
  'analytics.htmlTermsFound': 'Términos Encontrados',
  'analytics.htmlMatchDetails': 'Detalles de Coincidencias por Versículo',
  'analytics.htmlRef': 'Referencia',
  'analytics.htmlTerm': 'Término',
  'analytics.htmlLemma': 'Lema',
  'analytics.htmlExpectedRenderings': 'Traducciones Esperadas',
  'analytics.htmlStatus': 'Estado',
  'analytics.htmlMatchedText': 'Texto Encontrado',
  'analytics.htmlFound': '✓ Encontrado',
  'analytics.htmlMissing': '✗ Faltante',
  'analytics.selectProjectTitle': 'Seleccionar Proyecto',
  'analytics.selectProjectPromptAnalytics':
    'Elige un proyecto para ver estadísticas de términos clave:',
};

const dictionaries: Record<Lang, Dict> = { en, es };

/** Format a localized string with positional `%1`, `%2`, ... substitutions. */
function format(template: string, ...args: (string | number)[]): string {
  return template.replace(/%(\d+)/g, (_match, idx) => {
    const i = parseInt(idx, 10) - 1;
    return i >= 0 && i < args.length ? String(args[i]) : '';
  });
}

/**
 * Translate a key, prefixed with the given namespace (e.g. `'verifier'`, `'analytics'`). Falls back
 * to the other language if the key is missing, then to the key itself.
 */
export function t(
  namespace: string,
  key: string,
  lang: Lang,
  ...args: (string | number)[]
): string {
  const full = `${namespace}.${key}`;
  const dict = dictionaries[lang];
  const fallback = dictionaries[lang === 'en' ? 'es' : 'en'];
  const raw = dict[full] ?? fallback[full] ?? full;
  return format(raw, ...args);
}

/**
 * Hook for in-view localization. Returns a translator bound to the chosen language plus a
 * `toggleLang` helper. Language persists via `useWebViewState`.
 */
export function useLocalizedStrings(lang: string, setLang: (l: string) => void, namespace: string) {
  const current: Lang = lang === 'en' ? 'en' : 'es';
  const tx = useCallback(
    (key: string, ...args: (string | number)[]) => t(namespace, key, current, ...args),
    [namespace, current],
  );
  const toggleLang = useCallback(() => {
    setLang(current === 'en' ? 'es' : 'en');
  }, [current, setLang]);
  return { tx, toggleLang, lang: current };
}
