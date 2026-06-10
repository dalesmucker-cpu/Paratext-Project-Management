import { WebViewProps } from '@papi/core';
import papi from '@papi/frontend';
import { useDialogCallback } from '@papi/frontend/react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  RefreshCw, 
  Download, 
  CheckCircle2, 
  XCircle, 
  Edit3, 
  BookOpen, 
  FileSpreadsheet, 
  Trophy,
  AlertTriangle,
  FolderOpen,
  PieChart,
  Layers,
  FileText
} from 'lucide-react';
import type { KeyTermsStore, KeyTerm, VerseMatchStatus } from './types/key-terms.types';
import { BIBLE_BOOKS, type BibleBook } from './types/shared.constants';

globalThis.webViewComponent = function KeyTermsAnalyticsWebView({
  projectId,
  useWebViewState,
  updateWebViewDefinition,
}: WebViewProps) {
  // Key Terms Store state
  const [store, setStore] = useState<KeyTermsStore | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Selected book for analytics
  const [selectedBook, setSelectedBook] = useWebViewState<BibleBook>('selectedBook', 'MAT');
  
  // Scan matches from book scan
  const [scanMatches, setScanMatches] = useState<VerseMatchStatus[]>([]);
  const [scanning, setScanning] = useState(false);
  
  // Selected chapter for detail panel
  const [selectedChapter, setSelectedChapter] = useState<number | null>(1);

  // Dialog to select project
  const selectProject = useDialogCallback(
    'platform.selectProject',
    useMemo(
      () => ({
        title: 'Seleccionar Proyecto',
        prompt: 'Elige un proyecto para ver estadísticas de términos clave:',
        includeProjectInterfaces: ['platformScripture.USJ_Chapter'],
      }),
      [],
    ),
    useCallback(
      (selectedId) => {
        if (selectedId) updateWebViewDefinition({ projectId: selectedId });
      },
      [updateWebViewDefinition],
    ),
  );

  // Load basic store data
  const loadDataRequestRef = useRef(0);

  const loadData = useCallback(async () => {
    if (!projectId) return;
    const requestId = ++loadDataRequestRef.current;
    const isCurrentRequest = () => requestId === loadDataRequestRef.current;
    setLoading(true);
    setError('');
    try {
      const dataStr = await papi.commands.sendCommand('paratextProjectManager.getKeyTermsData', projectId);
      if (!isCurrentRequest()) return;
      const parsed = JSON.parse(dataStr) as KeyTermsStore;
      setStore(parsed);
    } catch (e: any) {
      if (!isCurrentRequest()) return;
      setError(`Error al cargar datos de términos clave: ${e.message || e}`);
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Scan current book
  const scanBookRequestRef = useRef(0);

  const scanBook = useCallback(async () => {
    if (!projectId) return;
    const requestId = ++scanBookRequestRef.current;
    const isCurrentRequest = () => requestId === scanBookRequestRef.current;
    setScanning(true);
    try {
      const res = await papi.commands.sendCommand(
        'paratextProjectManager.scanBookRenderings',
        projectId,
        selectedBook
      ) as string;
      if (!isCurrentRequest()) return;
      const parsed = JSON.parse(res) as { matches: VerseMatchStatus[] };
      if (parsed && parsed.matches) {
        setScanMatches(parsed.matches);
      }
    } catch (e: any) {
      console.error('Failed to scan book renderings:', e);
    } finally {
      if (isCurrentRequest()) setScanning(false);
    }
  }, [projectId, selectedBook]);

  // Scan when selectedBook or store changes
  useEffect(() => {
    if (store && projectId) {
      scanBook();
    }
  }, [selectedBook, store, projectId]);

  // List of books that actually have expected key terms in the database
  const booksWithTerms = useMemo(() => {
    if (!store) return [];
    const books = new Set<string>();
    for (const term of store.terms) {
      for (const ref of term.references) {
        const book = ref.split(' ')[0];
        if (book) books.add(book);
      }
    }
    return Array.from(books).sort((a, b) => {
      const idxA = BIBLE_BOOKS.indexOf(a as BibleBook);
      const idxB = BIBLE_BOOKS.indexOf(b as BibleBook);
      return idxA - idxB;
    });
  }, [store]);

  // BUG FIX: Automatically select the first book with terms when store loads if current selectedBook is not in list
  useEffect(() => {
    if (booksWithTerms.length > 0 && !booksWithTerms.includes(selectedBook)) {
      setSelectedBook(booksWithTerms[0] as BibleBook);
    }
  }, [booksWithTerms, selectedBook, setSelectedBook]);

  // Total chapters in the selected book (based on key terms references)
  const chaptersInBook = useMemo(() => {
    if (!store) return [];
    const chapters = new Set<number>();
    const prefix = `${selectedBook} `;
    for (const term of store.terms) {
      for (const ref of term.references) {
        if (ref.startsWith(prefix)) {
          const chapStr = ref.split(' ')[1].split(':')[0];
          chapters.add(parseInt(chapStr, 10));
        }
      }
    }
    return Array.from(chapters).sort((a, b) => a - b);
  }, [store, selectedBook]);

  // BUG FIX: Automatically select the first chapter when chapters in book changes
  useEffect(() => {
    if (chaptersInBook.length > 0) {
      if (selectedChapter === null || !chaptersInBook.includes(selectedChapter)) {
        setSelectedChapter(chaptersInBook[0]);
      }
    } else {
      setSelectedChapter(null);
    }
  }, [chaptersInBook, selectedChapter]);

  // Compute completion metrics per chapter:
  // maps chapter number -> { expected: number, found: number, matches: VerseMatchStatus[] }
  const chapterMetrics = useMemo(() => {
    const metrics: Record<number, { expected: number; found: number; matches: VerseMatchStatus[] }> = {};
    
    // Initialize for all chapters
    for (const chap of chaptersInBook) {
      metrics[chap] = { expected: 0, found: 0, matches: [] };
    }

    if (!store) return metrics;

    // Filter relevant terms for this book
    const prefix = `${selectedBook} `;
    const relevantTerms = store.terms.filter(t => t.references.some(ref => ref.startsWith(prefix)));

    // Group expected occurrences by chapter
    for (const term of relevantTerms) {
      const termUniqueChapters = new Set<number>();
      for (const ref of term.references) {
        if (ref.startsWith(prefix)) {
          const chap = parseInt(ref.split(' ')[1].split(':')[0], 10);
          termUniqueChapters.add(chap);
        }
      }
      
      for (const chap of termUniqueChapters) {
        if (metrics[chap]) {
          metrics[chap].expected += 1;
        }
      }
    }

    // Process scan results to count found terms per chapter
    // Group matches by chapter
    for (const match of scanMatches) {
      const refParts = match.reference.split(' ');
      if (refParts[0] !== selectedBook) continue;
      const chap = parseInt(refParts[1].split(':')[0], 10);
      
      if (metrics[chap]) {
        metrics[chap].matches.push(match);
      }
    }

    // For each chapter, count how many unique expected terms were actually found
    for (const chap of chaptersInBook) {
      const chapMatches = metrics[chap].matches;
      const uniqueFoundTerms = new Set<string>();
      
      for (const m of chapMatches) {
        if (m.matchResult.found) {
          uniqueFoundTerms.add(m.termId);
        }
      }
      metrics[chap].found = uniqueFoundTerms.size;
    }

    return metrics;
  }, [store, selectedBook, chaptersInBook, scanMatches]);

  // Overall stats for the selected book
  const bookStats = useMemo(() => {
    let totalExpectedTerms = 0;
    const foundTerms = new Set<string>();
    const allBookTerms = new Set<string>();

    if (!store) return { expectedCount: 0, foundCount: 0, percent: 0 };

    const prefix = `${selectedBook} `;
    for (const term of store.terms) {
      const hasRef = term.references.some(ref => ref.startsWith(prefix));
      if (hasRef) {
        allBookTerms.add(term.id);
      }
    }

    totalExpectedTerms = allBookTerms.size;

    for (const m of scanMatches) {
      if (m.matchResult.found) {
        foundTerms.add(m.termId);
      }
    }

    const foundCount = foundTerms.size;
    const percent = totalExpectedTerms > 0 ? Math.round((foundCount / totalExpectedTerms) * 100) : 0;

    return {
      expectedCount: totalExpectedTerms,
      foundCount,
      percent,
    };
  }, [store, selectedBook, scanMatches]);

  // Most problematic missing terms in the selected book
  const problematicTerms = useMemo(() => {
    if (!store) return [];
    
    const prefix = `${selectedBook} `;
    const termOccurrences: Record<string, { term: KeyTerm; missingCount: number; occurrences: string[] }> = {};

    for (const term of store.terms) {
      const refs = term.references.filter(ref => ref.startsWith(prefix));
      if (refs.length > 0) {
        termOccurrences[term.id] = {
          term,
          missingCount: 0,
          occurrences: refs,
        };
      }
    }

    // Count missing instances from scan matches
    for (const m of scanMatches) {
      if (!m.matchResult.found && termOccurrences[m.termId]) {
        termOccurrences[m.termId].missingCount += 1;
      }
    }

    return Object.values(termOccurrences)
      .filter(x => x.missingCount > 0)
      .sort((a, b) => b.missingCount - a.missingCount)
      .slice(0, 10);
  }, [store, selectedBook, scanMatches]);

  // Term matches in selected chapter
  const selectedChapterMatches = useMemo(() => {
    if (selectedChapter === null || !chapterMetrics[selectedChapter]) return [];
    
    // Get expected terms in this chapter
    const prefix = `${selectedBook} ${selectedChapter}:`;
    if (!store) return [];

    const expectedInChapter = store.terms.filter(t => t.references.some(ref => ref.startsWith(prefix)));

    return expectedInChapter.map(term => {
      // Find matches for this term in this chapter
      const termMatches = scanMatches.filter(m => m.termId === term.id && m.reference.startsWith(prefix));
      const anyFound = termMatches.some(m => m.matchResult.found);
      const matchedText = termMatches.find(m => m.matchResult.found)?.matchResult.matchedText;
      const ref = termMatches[0]?.reference || term.references.find(r => r.startsWith(prefix)) || '';

      return {
        termId: term.id,
        gloss: term.gloss,
        lemma: term.lemma,
        transliteration: term.transliteration,
        ref,
        expectedRenderings: term.renderings.filter(r => r.status === 'approved').map(r => r.text),
        found: anyFound,
        matchedText,
      };
    });
  }, [store, selectedBook, selectedChapter, chapterMetrics, scanMatches]);

  // Navigate to specific verse reference
  const handleNavigateToRef = useCallback(async (ref: string) => {
    if (!projectId || !ref) return;
    const parts = ref.split(' ');
    if (parts.length < 2) return;
    const book = parts[0];
    const [chapStr, verseStr] = parts[1].split(':');
    const chapterNum = parseInt(chapStr, 10);
    const verse = parseInt(verseStr, 10);
    
    try {
      await papi.commands.sendCommand(
        'paratextProjectManager.navigateToVerse',
        projectId,
        book,
        chapterNum,
        verse
      );
    } catch (e) {
      console.error('Failed to navigate from analytics:', e);
    }
  }, [projectId]);

  // Open Key Terms panel for selected term
  const handleOpenKeyTerms = useCallback(async (termId: string) => {
    if (!projectId) return;
    try {
      await papi.commands.sendCommand('paratextProjectManager.openKeyTerms', projectId);
      // Small delay to allow panel to mount/initialize
      await new Promise(r => setTimeout(r, 450));
      await papi.commands.sendCommand('paratextProjectManager.selectKeyTerm', projectId, termId);
    } catch (e) {
      console.error('Failed to open key terms editor:', e);
    }
  }, [projectId]);

  // Export to CSV
  const handleExportCSV = useCallback(async () => {
    if (!store || !projectId) return;
    try {
      const csvLines = [
        'Libro,Referencia,Término,Lema,Glosas,Renderings Esperados,Encontrado,Texto Coincidente,Tipo de Coincidencia'
      ];

      for (const m of scanMatches) {
        const refParts = m.reference.split(' ');
        const book = refParts[0];
        const ref = refParts[1];
        const expected = m.expectedRenderings.join(' | ');
        const found = m.matchResult.found ? 'Sí' : 'No';
        const matchedText = m.matchResult.matchedText || '';
        const matchType = m.matchResult.matchType || 'none';
        
        csvLines.push(
          `"${book}","${ref}","${m.gloss}","${m.lemma}","${m.gloss}","${expected}","${found}","${matchedText}","${matchType}"`
        );
      }

      const csvContent = csvLines.join('\n');
      const filename = `key-terms-analytics-${selectedBook}-${Date.now()}.csv`;
      
      const downloadPath = await papi.commands.sendCommand(
        'paratextProjectManager.saveToDownloads',
        filename,
        csvContent
      ) as string;

      alert(`Reporte CSV exportado exitosamente a:\n${downloadPath}`);
    } catch (e: any) {
      alert(`Error al exportar CSV: ${e.message || e}`);
    }
  }, [store, projectId, selectedBook, scanMatches]);

  // Export to HTML Report
  const handleExportHTML = useCallback(async () => {
    if (!store || !projectId) return;
    try {
      const htmlContent = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <title>Reporte de Términos Clave - ${selectedBook}</title>
          <style>
            body { font-family: sans-serif; padding: 24px; color: #f8fafc; background-color: #0f172a; }
            h1 { color: #818cf8; font-weight: 900; }
            h2 { color: #94a3b8; margin-top: 24px; border-bottom: 1px solid #334155; padding-bottom: 8px; }
            .metrics { display: flex; gap: 16px; margin-bottom: 24px; }
            .card { background: #1e293b; padding: 20px; border-radius: 12px; border: 1px solid #334155; flex: 1; text-align: center; }
            .card .num { font-size: 32px; font-weight: 900; color: #a78bfa; margin-bottom: 4px; }
            table { width: 100%; border-collapse: collapse; background: #1e293b; margin-top: 12px; border-radius: 12px; overflow: hidden; border: 1px solid #334155; }
            th, td { padding: 14px; text-align: left; border-bottom: 1px solid #334155; }
            th { background-color: #0f172a; font-weight: bold; color: #94a3b8; }
            .status-yes { color: #34d399; font-weight: bold; background: rgba(52, 211, 153, 0.1); padding: 4px 8px; border-radius: 9999px; display: inline-block; }
            .status-no { color: #f87171; font-weight: bold; background: rgba(248, 113, 113, 0.1); padding: 4px 8px; border-radius: 9999px; display: inline-block; }
          </style>
        </head>
        <body>
          <h1>Reporte de Verificación de Términos Clave</h1>
          <p><strong>Libro:</strong> ${selectedBook}</p>
          <p><strong>Fecha del Reporte:</strong> ${new Date().toLocaleDateString()}</p>
          
          <div class="metrics">
            <div class="card">
              <div class="num">${bookStats.percent}%</div>
              <div>Porcentaje de Coincidencia</div>
            </div>
            <div class="card">
              <div class="num">${bookStats.foundCount} / ${bookStats.expectedCount}</div>
              <div>Términos Encontrados</div>
            </div>
          </div>

          <h2>Detalles de Coincidencias por Versículo</h2>
          <table>
            <thead>
              <tr>
                <th>Referencia</th>
                <th>Término</th>
                <th>Lema</th>
                <th>Traducciones Esperadas</th>
                <th>Estado</th>
                <th>Texto Encontrado</th>
              </tr>
            </thead>
            <tbody>
              ${scanMatches.map(m => `
                <tr>
                  <td><b>${m.reference}</b></td>
                  <td>${m.gloss}</td>
                  <td style="font-family: serif; color: #a5b4fc;">${m.lemma}</td>
                  <td>${m.expectedRenderings.join(', ') || '<i>Ninguna aprobada</i>'}</td>
                  <td><span class="${m.matchResult.found ? 'status-yes' : 'status-no'}">${m.matchResult.found ? '✓ Encontrado' : '✗ Faltante'}</span></td>
                  <td><b>${m.matchResult.matchedText || '-'}</b></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </body>
        </html>
      `;

      const filename = `key-terms-analytics-${selectedBook}-${Date.now()}.html`;
      const downloadPath = await papi.commands.sendCommand(
        'paratextProjectManager.saveToDownloads',
        filename,
        htmlContent
      ) as string;

      alert(`Reporte HTML exportado exitosamente a:\n${downloadPath}`);
    } catch (e: any) {
      alert(`Error al exportar reporte HTML: ${e.message || e}`);
    }
  }, [store, projectId, selectedBook, scanMatches, bookStats]);

  if (!projectId) {
    return (
      <div className="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:p-8 tw:text-center tw:gap-6 tw:text-sm tw:bg-slate-950 tw:text-slate-200">
        <div className="tw:p-4 tw:bg-slate-900 tw:rounded-full tw:border tw:border-slate-800 tw:text-slate-400 tw:animate-bounce">
          <FolderOpen size={48} />
        </div>
        <div className="tw:space-y-2">
          <p className="tw:text-lg tw:font-bold tw:text-slate-300">Ningún proyecto activo seleccionado</p>
          <p className="tw:text-xs tw:text-slate-500 tw:max-w-xs">Abre o selecciona un proyecto de Scripture en Paratext para visualizar las estadísticas de los términos clave.</p>
        </div>
        <button
          className="tw:px-5 tw:py-2.5 tw:bg-gradient-to-r tw:from-indigo-600 tw:to-violet-600 tw:text-white tw:rounded-xl tw:hover:from-indigo-500 tw:hover:to-violet-500 tw:cursor-pointer tw:font-semibold tw:shadow-lg tw:shadow-indigo-500/10 tw:transition-all hover:tw:scale-105"
          onClick={() => selectProject()}
        >
          Seleccionar Proyecto
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:bg-slate-950 tw:text-slate-200 tw:gap-4">
        <RefreshCw size={36} className="tw:text-indigo-400 tw:animate-spin" />
        <span className="tw:text-xs tw:text-slate-400 tw:font-medium">Cargando métricas de términos clave...</span>
      </div>
    );
  }

  return (
    <div className="tw:flex tw:flex-col tw:h-full tw:bg-slate-950 tw:text-slate-200 tw:font-sans">
      {/* Top Header */}
      <div className="tw:px-6 tw:py-4 tw:bg-slate-900/60 tw:border-b tw:border-slate-800/80 tw:flex tw:items-center tw:justify-between tw:flex-shrink-0 tw:backdrop-blur-md">
        <div className="tw:flex tw:items-center tw:gap-3">
          <div className="tw:bg-gradient-to-br tw:from-indigo-500 tw:to-violet-600 tw:p-2 tw:rounded-xl tw:shadow-lg tw:shadow-indigo-500/20">
            <PieChart size={20} className="tw:text-white" />
          </div>
          <div className="tw:flex tw:flex-col">
            <span className="tw:text-lg tw:font-extrabold tw:bg-gradient-to-r tw:from-indigo-400 tw:via-violet-400 tw:to-pink-500 tw:bg-clip-text tw:text-transparent">
              Tablero de Analíticas de Términos Clave
            </span>
            <span className="tw:text-[10px] tw:text-slate-500 tw:font-semibold uppercase tracking-wider">Verificación de Consistencia</span>
          </div>
          {scanning && (
            <div className="tw:flex tw:items-center tw:gap-1.5 tw:ml-2 tw:bg-indigo-950/40 tw:border tw:border-indigo-500/30 tw:rounded-full tw:py-0.5 tw:px-2.5">
              <span className="tw:relative tw:flex tw:h-2 w-2">
                <span className="tw:animate-ping tw:absolute tw:inline-flex tw:h-full tw:w-full tw:rounded-full tw:bg-indigo-400 tw:opacity-75"></span>
                <span className="tw:relative tw:inline-flex tw:rounded-full tw:h-2 w-2 tw:bg-indigo-500"></span>
              </span>
              <span className="tw:text-[9px] tw:text-indigo-300 tw:font-bold uppercase tracking-wider">Escaneando...</span>
            </div>
          )}
        </div>

        <div className="tw:flex tw:items-center tw:gap-3">
          {/* Book Dropdown Selector */}
          <div className="tw:flex tw:items-center tw:gap-2 tw:bg-slate-900 tw:border tw:border-slate-850 tw:rounded-xl tw:px-3 tw:py-1.5">
            <span className="tw:text-[10px] tw:text-slate-500 tw:font-bold uppercase tracking-wide">Libro</span>
            <select
              value={selectedBook}
              onChange={(e) => {
                setSelectedBook(e.target.value as BibleBook);
                setSelectedChapter(1);
              }}
              className="tw:text-xs tw:font-bold tw:bg-transparent tw:text-indigo-400 tw:outline-none tw:border-none tw:cursor-pointer tw:pr-2"
            >
              {booksWithTerms.map(b => (
                <option key={b} value={b} className="tw:bg-slate-900 tw:text-slate-200 tw:font-bold">
                  {b}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={scanBook}
            disabled={scanning}
            className="tw:flex tw:items-center tw:gap-2 tw:px-4 tw:py-2 tw:bg-slate-900 hover:tw:bg-slate-850 tw:border tw:border-slate-800 disabled:tw:opacity-50 tw:rounded-xl tw:text-xs tw:font-bold tw:cursor-pointer tw:transition-all hover:tw:scale-[1.02]"
          >
            <RefreshCw size={14} className={scanning ? 'tw:animate-spin' : ''} />
            Actualizar Escaneo
          </button>

          <button
            onClick={() => selectProject()}
            className="tw:flex tw:items-center tw:gap-2 tw:px-4 tw:py-2 tw:bg-indigo-950/50 hover:tw:bg-indigo-900/60 tw:text-indigo-300 tw:border tw:border-indigo-500/25 tw:rounded-xl tw:text-xs tw:font-bold tw:cursor-pointer tw:transition-all hover:tw:scale-[1.02]"
          >
            Cambiar Proyecto
          </button>
        </div>
      </div>

      {error && (
        <div className="tw:bg-red-950/40 tw:border-b tw:border-red-500/30 tw:px-6 tw:py-2.5 tw:text-red-300 tw:text-xs tw:font-semibold tw:flex tw:items-center tw:gap-2">
          <AlertTriangle size={14} className="tw:text-red-450" />
          {error}
        </div>
      )}

      {/* Main Workspace */}
      <div className="tw:flex-1 tw:flex tw:overflow-hidden">
        {/* Left Side: Stats and problematic terms */}
        <div className="tw:w-80 tw:border-r tw:border-slate-900 tw:bg-slate-950/40 tw:p-5 tw:flex tw:flex-col tw:gap-5 tw:overflow-y-auto tw:flex-shrink-0">
          
          {/* Stats Card */}
          <div className="tw:relative tw:bg-gradient-to-br tw:from-indigo-600 tw:to-violet-750 tw:p-5 tw:rounded-2xl tw:text-white tw:shadow-lg tw:shadow-indigo-950/40 tw:space-y-4 tw:overflow-hidden">
            <div className="tw:absolute tw:top-0 tw:right-0 tw:-mt-6 tw:-mr-6 tw:w-24 tw:h-24 tw:bg-white/5 tw:rounded-full tw:blur-xl"></div>
            <div className="tw:flex tw:items-center tw:justify-between">
              <h3 className="tw:text-[10px] tw:font-black tw:uppercase tw:tracking-widest tw:text-indigo-200">Progreso en {selectedBook}</h3>
              <Trophy size={16} className="tw:text-indigo-200 tw:animate-pulse" />
            </div>
            
            <div className="tw:flex tw:items-baseline tw:gap-1">
              <span className="tw:text-5xl tw:font-black tracking-tighter">{bookStats.percent}%</span>
              <span className="tw:text-xs tw:text-indigo-200 tw:font-semibold">verificado</span>
            </div>

            {/* Micro Progress Bar */}
            <div className="tw:w-full tw:h-2 tw:bg-indigo-950/50 tw:rounded-full tw:overflow-hidden">
              <div 
                className="tw:h-full tw:bg-gradient-to-r tw:from-emerald-450 tw:to-teal-400 tw:transition-all tw:duration-500"
                style={{ width: `${bookStats.percent}%` }}
              ></div>
            </div>

            <div className="tw:text-[11px] tw:text-indigo-150 tw:font-medium tw:leading-relaxed">
              Encontrados <span className="tw:text-white tw:font-bold">{bookStats.foundCount}</span> de <span className="tw:text-white tw:font-bold">{bookStats.expectedCount}</span> términos clave correspondientes con traducciones aprobadas.
            </div>
          </div>

          {/* Export Action Card */}
          <div className="tw:bg-slate-900/40 tw:p-4 tw:rounded-2xl tw:border tw:border-slate-900 tw:space-y-3">
            <h4 className="tw:font-bold tw:text-[10px] tw:text-slate-400 tw:uppercase tw:tracking-wider tw:flex tw:items-center tw:gap-1.5">
              <Download size={12} />
              Exportar Reportes
            </h4>
            <div className="tw:flex tw:gap-2">
              <button
                onClick={handleExportCSV}
                className="tw:flex-1 tw:py-2 tw:bg-slate-900 hover:tw:bg-slate-850 tw:border tw:border-slate-800 tw:rounded-xl tw:text-[10px] tw:font-bold tw:shadow-sm tw:cursor-pointer tw:transition-all tw:flex tw:items-center tw:justify-center tw:gap-1"
              >
                <FileSpreadsheet size={12} className="tw:text-slate-400" />
                CSV
              </button>
              <button
                onClick={handleExportHTML}
                className="tw:flex-1 tw:py-2 tw:bg-slate-900 hover:tw:bg-slate-850 tw:border tw:border-slate-800 tw:rounded-xl tw:text-[10px] tw:font-bold tw:shadow-sm tw:cursor-pointer tw:transition-all tw:flex tw:items-center tw:justify-center tw:gap-1"
              >
                <FileText size={12} className="tw:text-slate-400" />
                HTML
              </button>
            </div>
          </div>

          {/* Problematic terms list */}
          <div className="tw:space-y-3 tw:flex-1 tw:flex tw:flex-col tw:overflow-hidden">
            <h4 className="tw:font-bold tw:text-[10px] tw:text-slate-400 tw:uppercase tw:tracking-wider tw:flex tw:items-center tw:gap-1.5">
              <AlertTriangle size={12} className="tw:text-rose-400" />
              Términos Más Faltantes
            </h4>
            <div className="tw:space-y-2 tw:overflow-y-auto tw:flex-1 tw:pr-1">
              {problematicTerms.map(({ term, missingCount }) => (
                <div
                  key={term.id}
                  onClick={() => handleOpenKeyTerms(term.id)}
                  className="tw:p-3 tw:border tw:border-slate-900 tw:bg-slate-900/20 hover:tw:bg-slate-900/50 hover:tw:border-slate-850 tw:rounded-xl tw:cursor-pointer tw:transition-all tw:flex tw:items-center tw:justify-between tw:gap-3 group"
                >
                  <div className="tw:space-y-1">
                    <div className="tw:font-bold tw:text-xs tw:text-slate-200 group-hover:tw:text-indigo-300 tw:transition-colors">{term.gloss}</div>
                    <div className="tw:text-[10px] tw:text-slate-550 tw:font-serif italic">{term.lemma}</div>
                  </div>
                  <div className="tw:flex tw:items-center tw:gap-2">
                    <span className="tw:px-2 tw:py-0.5 tw:bg-rose-950/45 tw:text-rose-450 tw:border tw:border-rose-900/30 tw:rounded-full tw:text-[9px] tw:font-bold">
                      -{missingCount}
                    </span>
                  </div>
                </div>
              ))}
              {problematicTerms.length === 0 && (
                <div className="tw:text-xs tw:text-slate-500 tw:text-center tw:py-8 tw:italic">
                  🎉 ¡No faltan términos clave en este libro!
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Heatmap and chapter details */}
        <div className="tw:flex-1 tw:p-6 tw:overflow-y-auto tw:space-y-6">
          <div className="tw:space-y-3">
            <h3 className="tw:font-bold tw:text-[10px] tw:text-slate-400 tw:uppercase tw:tracking-wider tw:flex tw:items-center tw:gap-1.5">
              <Layers size={12} />
              Matriz de Capítulos (Heatmap)
            </h3>
            
            {/* Heatmap Grid */}
            <div className="tw:grid tw:grid-cols-4 sm:tw:grid-cols-6 md:tw:grid-cols-8 lg:tw:grid-cols-10 tw:gap-3">
              {chaptersInBook.map(chap => {
                const metrics = chapterMetrics[chap];
                const expected = metrics?.expected ?? 0;
                const found = metrics?.found ?? 0;
                const isSelected = selectedChapter === chap;

                let cardClass = 'tw:bg-slate-900/20 tw:border-slate-900 tw:text-slate-500 hover:tw:border-slate-800';
                if (expected > 0) {
                  if (found === expected) {
                    cardClass = 'tw:bg-emerald-950/20 tw:border-emerald-500/40 tw:text-emerald-400 hover:tw:bg-emerald-900/25 hover:tw:border-emerald-400';
                  } else if (found > 0) {
                    cardClass = 'tw:bg-amber-950/15 tw:border-amber-550/40 tw:text-amber-400 hover:tw:bg-amber-900/20 hover:tw:border-amber-400';
                  } else {
                    cardClass = 'tw:bg-rose-950/15 tw:border-rose-550/40 tw:text-rose-450 hover:tw:bg-rose-900/20 hover:tw:border-rose-400';
                  }
                }

                return (
                  <button
                    key={chap}
                    onClick={() => setSelectedChapter(chap)}
                    className={`tw:p-3.5 tw:rounded-2xl tw:border tw:text-center tw:transition-all tw:cursor-pointer tw:flex tw:flex-col tw:items-center tw:gap-1 hover:tw:scale-[1.05] ${cardClass} ${
                      isSelected ? 'tw:ring-2 tw:ring-indigo-500 tw:border-indigo-400 tw:bg-indigo-950/20 tw:scale-[1.05]' : ''
                    }`}
                  >
                    <span className="tw:text-lg tw:font-black tracking-tight">{chap}</span>
                    <span className="tw:text-[9px] tw:font-bold opacity-80">
                      {expected > 0 ? `${found}/${expected}` : 'N/A'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chapter detail card */}
          {selectedChapter !== null && chapterMetrics[selectedChapter] && (
            <div className="tw:bg-slate-900/35 tw:p-6 tw:rounded-2xl tw:border tw:border-slate-900 tw:shadow-xl tw:space-y-4">
              <div className="tw:flex tw:items-center tw:justify-between tw:pb-3 tw:border-b tw:border-slate-900">
                <div className="tw:flex tw:items-center tw:gap-2">
                  <h3 className="tw:font-extrabold tw:text-sm tw:text-slate-100 uppercase">
                    Detalles del Capítulo {selectedChapter}
                  </h3>
                  <span className="tw:px-2 tw:py-0.5 tw:bg-slate-850 tw:border tw:border-slate-800 tw:rounded-full tw:text-[9px] tw:font-bold tw:text-slate-400">
                    {selectedBook} {selectedChapter}
                  </span>
                </div>
                <span className="tw:text-xs tw:text-slate-400 tw:font-medium">
                  {selectedChapterMatches.filter(m => m.found).length} de {selectedChapterMatches.length} términos encontrados
                </span>
              </div>

              {/* Table of terms */}
              <div className="tw:overflow-x-auto">
                <table className="tw:w-full tw:text-left tw:border-collapse">
                  <thead>
                    <tr className="tw:border-b tw:border-slate-900 tw:text-[10px] tw:text-slate-400 uppercase tracking-wider">
                      <th className="tw:pb-3 tw:font-bold">Glosas / Término</th>
                      <th className="tw:pb-3 tw:font-bold">Lema</th>
                      <th className="tw:pb-3 tw:font-bold">Traducciones Esperadas</th>
                      <th className="tw:pb-3 tw:font-bold">Coincidencia en el texto</th>
                      <th className="tw:pb-3 tw:font-bold">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="tw:divide-y tw:divide-slate-900/60 tw:text-xs">
                    {selectedChapterMatches.map(m => (
                      <tr key={m.termId} className="hover:tw:bg-slate-900/40 tw:transition-colors">
                        <td className="tw:py-3.5 tw:font-bold tw:text-slate-200">{m.gloss}</td>
                        <td className="tw:py-3.5 tw:font-serif tw:text-indigo-400 tw:text-xs">
                          {m.lemma} {m.transliteration ? <span className="tw:text-slate-500 tw:text-[10px] tw:font-sans">({m.transliteration})</span> : ''}
                        </td>
                        <td className="tw:py-3.5 tw:text-slate-350">
                          {m.expectedRenderings.join(', ') || <span className="tw:text-slate-655 tw:italic">Ninguno aprobado</span>}
                        </td>
                        <td className="tw:py-3.5">
                          {m.found ? (
                            <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:bg-emerald-950/45 tw:text-emerald-400 tw:px-2.5 tw:py-1 tw:border tw:border-emerald-900/35 tw:rounded-lg tw:font-bold tw:text-[10px]">
                              <CheckCircle2 size={12} />
                              {m.matchedText}
                            </span>
                          ) : (
                            <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:bg-rose-950/45 tw:text-rose-450 tw:px-2.5 tw:py-1 tw:border tw:border-rose-900/35 tw:rounded-lg tw:font-bold tw:text-[10px]">
                              <XCircle size={12} />
                              Faltante
                            </span>
                          )}
                        </td>
                        <td className="tw:py-3.5">
                          <div className="tw:flex tw:items-center tw:gap-3">
                            <button
                              onClick={() => handleNavigateToRef(m.ref)}
                              className="tw:flex tw:items-center tw:gap-1 tw:text-indigo-400 hover:tw:text-indigo-300 tw:hover:underline tw:cursor-pointer tw:font-semibold"
                            >
                              <BookOpen size={12} />
                              Ver versículo
                            </button>
                            <button
                              onClick={() => handleOpenKeyTerms(m.termId)}
                              className="tw:flex tw:items-center tw:gap-1 tw:text-slate-400 hover:tw:text-slate-200 tw:cursor-pointer tw:font-semibold"
                            >
                              <Edit3 size={12} />
                              Editar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {selectedChapterMatches.length === 0 && (
                      <tr>
                        <td colSpan={5} className="tw:text-center tw:py-8 tw:text-slate-500 tw:italic">
                          No hay términos clave esperados en el Capítulo {selectedChapter}.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
