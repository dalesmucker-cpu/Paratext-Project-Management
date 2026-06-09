import { WebViewProps } from '@papi/core';
import papi from '@papi/frontend';
import { useDialogCallback } from '@papi/frontend/react';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  const loadData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    try {
      const dataStr = await papi.commands.sendCommand('paratextProjectManager.getKeyTermsData', projectId);
      const parsed = JSON.parse(dataStr) as KeyTermsStore;
      setStore(parsed);
    } catch (e: any) {
      setError(`Error al cargar datos de términos clave: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Scan current book
  const scanBook = useCallback(async () => {
    if (!projectId) return;
    setScanning(true);
    try {
      const res = await papi.commands.sendCommand(
        'paratextProjectManager.scanBookRenderings',
        projectId,
        selectedBook
      ) as string;
      const parsed = JSON.parse(res) as { matches: VerseMatchStatus[] };
      if (parsed && parsed.matches) {
        setScanMatches(parsed.matches);
      }
    } catch (e: any) {
      console.error('Failed to scan book renderings:', e);
    } finally {
      setScanning(false);
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
    const chapter = parseInt(chapStr, 10);
    const verse = parseInt(verseStr, 10);
    
    try {
      await papi.commands.sendCommand(
        'paratextProjectManager.navigateToVerse',
        projectId,
        book,
        chapter,
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
        'paratextProjectManager.saveDownloadedFile',
        filename,
        csvContent,
        'utf8'
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
            body { font-family: sans-serif; padding: 24px; color: #334155; bg-color: #f8fafc; }
            h1 { color: #1e3a8a; }
            h2 { color: #475569; margin-top: 24px; }
            .metrics { display: flex; gap: 16px; margin-bottom: 24px; }
            .card { background: white; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; flex: 1; text-align: center; }
            .card .num { font-size: 24px; font-weight: bold; color: #4f46e5; }
            table { width: 100%; border-collapse: collapse; background: white; margin-top: 12px; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; }
            th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
            th { background-color: #f1f5f9; font-weight: bold; color: #475569; }
            .status-yes { color: #15803d; font-weight: bold; }
            .status-no { color: #b91c1c; font-weight: bold; }
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
                  <td>${m.reference}</td>
                  <td>${m.gloss}</td>
                  <td style="font-family: serif;">${m.lemma}</td>
                  <td>${m.expectedRenderings.join(', ') || '<i>Ninguna aprobada</i>'}</td>
                  <td class="${m.matchResult.found ? 'status-yes' : 'status-no'}">${m.matchResult.found ? '✓ Encontrado' : '✗ Faltante'}</td>
                  <td>${m.matchResult.matchedText || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </body>
        </html>
      `;

      const filename = `key-terms-analytics-${selectedBook}-${Date.now()}.html`;
      const downloadPath = await papi.commands.sendCommand(
        'paratextProjectManager.saveDownloadedFile',
        filename,
        htmlContent,
        'utf8'
      ) as string;

      alert(`Reporte HTML exportado exitosamente a:\n${downloadPath}`);
    } catch (e: any) {
      alert(`Error al exportar reporte HTML: ${e.message || e}`);
    }
  }, [store, projectId, selectedBook, scanMatches, bookStats]);

  if (!projectId) {
    return (
      <div className="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:p-8 tw:text-center tw:gap-4 tw:text-sm">
        <p className="tw:text-gray-600">Ningún proyecto seleccionado.</p>
        <button
          className="tw:px-4 tw:py-2 tw:bg-indigo-600 tw:text-white tw:rounded-lg tw:hover:bg-indigo-700 tw:cursor-pointer"
          onClick={selectProject}
        >
          Seleccionar Proyecto
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="tw:flex tw:items-center tw:justify-center tw:h-full tw:text-sm tw:text-gray-500">
        Cargando analíticas de términos clave...
      </div>
    );
  }

  return (
    <div className="tw:flex tw:flex-col tw:h-full tw:bg-slate-50 tw:text-slate-800 tw:font-sans">
      {/* Top Header */}
      <div className="tw:px-6 tw:py-4 tw:bg-white tw:border-b tw:border-slate-200 tw:flex tw:items-center tw:justify-between tw:flex-shrink-0">
        <div className="tw:flex tw:items-center tw:gap-4">
          <span className="tw:text-xl tw:font-black tw:bg-gradient-to-r tw:from-indigo-600 tw:to-violet-600 tw:bg-clip-text tw:text-transparent">
            Panel de Control de Términos Clave
          </span>
          {scanning && (
            <span className="tw:text-xs tw:text-slate-400 tw:animate-pulse">
              Escaneando libro...
            </span>
          )}
        </div>

        <div className="tw:flex tw:items-center tw:gap-3">
          {/* Book Dropdown Selector */}
          <select
            value={selectedBook}
            onChange={(e) => {
              setSelectedBook(e.target.value as BibleBook);
              setSelectedChapter(1);
            }}
            className="tw:border tw:border-slate-200 tw:rounded-lg tw:px-3 tw:py-1.5 tw:text-xs tw:font-semibold tw:bg-white"
          >
            {booksWithTerms.map(b => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>

          <button
            onClick={scanBook}
            className="tw:px-3 tw:py-1.5 tw:bg-slate-100 tw:hover:bg-slate-200 tw:border tw:border-slate-200 tw:rounded-lg tw:text-xs tw:font-medium tw:cursor-pointer"
          >
            Actualizar Escaneo
          </button>

          <button
            className="tw:px-3 tw:py-1.5 tw:bg-indigo-50 tw:text-indigo-700 tw:border tw:border-indigo-100 tw:rounded-lg tw:text-xs tw:font-medium tw:hover:bg-indigo-100 tw:cursor-pointer"
            onClick={selectProject}
          >
            Cambiar Proyecto
          </button>
        </div>
      </div>

      {/* Main Workspace */}
      <div className="tw:flex-1 tw:flex tw:overflow-hidden">
        {/* Left Side: Stats and problematic terms */}
        <div className="tw:w-80 tw:border-r tw:border-slate-200 tw:bg-white tw:p-4 tw:flex tw:flex-col tw:gap-4 tw:overflow-y-auto tw:flex-shrink-0">
          {/* Stats Card */}
          <div className="tw:bg-gradient-to-br tw:from-indigo-500 tw:to-violet-600 tw:p-4 tw:rounded-xl tw:text-white tw:shadow-md tw:space-y-2">
            <h3 className="tw:text-xs tw:font-bold tw:uppercase tw:tracking-wider tw:opacity-85">Coincidencia en {selectedBook}</h3>
            <div className="tw:flex tw:items-baseline tw:gap-2">
              <span className="tw:text-4xl tw:font-black">{bookStats.percent}%</span>
              <span className="tw:text-xs tw:opacity-75">completado</span>
            </div>
            <div className="tw:text-xs tw:opacity-90 tw:border-t tw:border-white/20 tw:pt-2">
              {bookStats.foundCount} de {bookStats.expectedCount} términos clave con traducciones aprobadas encontradas en el texto.
            </div>
          </div>

          {/* Export Action Card */}
          <div className="tw:bg-slate-50 tw:p-4 tw:rounded-xl tw:border tw:border-slate-100 tw:space-y-3">
            <h4 className="tw:font-bold tw:text-xs tw:text-slate-700 uppercase">Exportar Reportes</h4>
            <div className="tw:flex tw:gap-2">
              <button
                onClick={handleExportCSV}
                className="tw:flex-1 tw:py-2 tw:bg-white tw:hover:bg-slate-50 tw:border tw:border-slate-200 tw:rounded-lg tw:text-[10px] tw:font-semibold tw:shadow-sm tw:cursor-pointer"
              >
                Exportar CSV
              </button>
              <button
                onClick={handleExportHTML}
                className="tw:flex-1 tw:py-2 tw:bg-white tw:hover:bg-slate-50 tw:border tw:border-slate-200 tw:rounded-lg tw:text-[10px] tw:font-semibold tw:shadow-sm tw:cursor-pointer"
              >
                Reporte HTML
              </button>
            </div>
          </div>

          {/* Problematic terms list */}
          <div className="tw:space-y-2.5 tw:flex-1">
            <h4 className="tw:font-bold tw:text-xs tw:text-slate-700 uppercase tw:tracking-wide">Términos Más Faltantes</h4>
            <div className="tw:space-y-2 tw:overflow-y-auto">
              {problematicTerms.map(({ term, missingCount }) => (
                <div
                  key={term.id}
                  onClick={() => handleOpenKeyTerms(term.id)}
                  className="tw:p-2.5 tw:border tw:border-slate-100 tw:bg-slate-50/50 hover:tw:bg-slate-50 tw:rounded-lg tw:cursor-pointer tw:transition-colors tw:flex tw:items-start tw:justify-between tw:gap-2"
                >
                  <div className="tw:space-y-0.5">
                    <div className="tw:font-semibold tw:text-xs tw:text-slate-700">{term.gloss}</div>
                    <div className="tw:text-[10px] tw:text-slate-400 tw:font-serif">{term.lemma}</div>
                  </div>
                  <span className="tw:px-1.5 tw:py-0.5 tw:bg-rose-50 tw:text-rose-600 tw:border tw:border-rose-100 tw:rounded-full tw:text-[9px] tw:font-bold">
                    -{missingCount}
                  </span>
                </div>
              ))}
              {problematicTerms.length === 0 && (
                <div className="tw:text-xs tw:text-slate-400 tw:text-center tw:py-4">
                  ¡Excelente! No faltan términos clave en este libro.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Heatmap and chapter details */}
        <div className="tw:flex-1 tw:p-6 tw:overflow-y-auto tw:space-y-6">
          <div className="tw:space-y-3">
            <h3 className="tw:font-bold tw:text-sm tw:text-slate-700 uppercase tw:tracking-wider">Matriz de Capítulos (Heatmap)</h3>
            
            {/* Heatmap Grid */}
            <div className="tw:grid tw:grid-cols-4 sm:tw:grid-cols-6 md:tw:grid-cols-8 lg:tw:grid-cols-10 tw:gap-3">
              {chaptersInBook.map(chap => {
                const metrics = chapterMetrics[chap];
                const expected = metrics?.expected ?? 0;
                const found = metrics?.found ?? 0;
                const isSelected = selectedChapter === chap;

                let cardClass = 'tw:bg-slate-100 tw:border-slate-200 tw:text-slate-400';
                if (expected > 0) {
                  if (found === expected) {
                    cardClass = 'tw:bg-emerald-50 tw:border-emerald-200 tw:text-emerald-700 hover:tw:bg-emerald-100/70';
                  } else if (found > 0) {
                    cardClass = 'tw:bg-amber-50 tw:border-amber-200 tw:text-amber-700 hover:tw:bg-amber-100/70';
                  } else {
                    cardClass = 'tw:bg-rose-50 tw:border-rose-200 tw:text-rose-700 hover:tw:bg-rose-100/70';
                  }
                }

                return (
                  <button
                    key={chap}
                    onClick={() => setSelectedChapter(chap)}
                    className={`tw:p-3 tw:rounded-xl tw:border tw:text-center tw:transition-all tw:cursor-pointer tw:flex tw:flex-col tw:items-center tw:gap-1 ${cardClass} ${
                      isSelected ? 'tw:ring-2 tw:ring-indigo-600 tw:scale-105' : ''
                    }`}
                  >
                    <span className="tw:text-lg tw:font-black">{chap}</span>
                    <span className="tw:text-[10px] tw:font-semibold">
                      {expected > 0 ? `${found}/${expected}` : 'N/A'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chapter detail card */}
          {selectedChapter !== null && chapterMetrics[selectedChapter] && (
            <div className="tw:bg-white tw:p-5 tw:rounded-xl tw:border tw:border-slate-200 tw:shadow-sm tw:space-y-4">
              <div className="tw:flex tw:items-center tw:justify-between">
                <h3 className="tw:font-bold tw:text-sm tw:text-slate-700 uppercase">
                  Detalles del Capítulo {selectedChapter}
                </h3>
                <span className="tw:text-xs tw:text-slate-400">
                  {selectedChapterMatches.filter(m => m.found).length} de {selectedChapterMatches.length} términos encontrados
                </span>
              </div>

              {/* Table of terms */}
              <div className="tw:overflow-x-auto">
                <table className="tw:w-full tw:text-left tw:border-collapse">
                  <thead>
                    <tr className="tw:border-b tw:border-slate-100 tw:text-xs tw:text-slate-400 uppercase">
                      <th className="tw:pb-2.5 tw:font-bold">Glosas / Término</th>
                      <th className="tw:pb-2.5 tw:font-bold">Lema</th>
                      <th className="tw:pb-2.5 tw:font-bold">Traducciones Esperadas</th>
                      <th className="tw:pb-2.5 tw:font-bold">Coincidencia en el texto</th>
                      <th className="tw:pb-2.5 tw:font-bold">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="tw:divide-y tw:divide-slate-50 tw:text-xs">
                    {selectedChapterMatches.map(m => (
                      <tr key={m.termId} className="hover:tw:bg-slate-50/50">
                        <td className="tw:py-3 tw:font-bold tw:text-slate-700">{m.gloss}</td>
                        <td className="tw:py-3 tw:font-serif tw:text-indigo-600">{m.lemma} {m.transliteration ? `(${m.transliteration})` : ''}</td>
                        <td className="tw:py-3 tw:text-slate-600">
                          {m.expectedRenderings.join(', ') || <span className="tw:text-slate-400 tw:italic">Ninguno aprobado</span>}
                        </td>
                        <td className="tw:py-3">
                          {m.found ? (
                            <span className="tw:bg-green-50 tw:text-green-700 tw:px-2 tw:py-0.5 tw:border tw:border-green-200 tw:rounded-full tw:font-semibold">
                              ✓ {m.matchedText}
                            </span>
                          ) : (
                            <span className="tw:bg-red-50 tw:text-red-700 tw:px-2 tw:py-0.5 tw:border tw:border-red-200 tw:rounded-full tw:font-semibold">
                              ✗ Faltante
                            </span>
                          )}
                        </td>
                        <td className="tw:py-3">
                          <div className="tw:flex tw:items-center tw:gap-2">
                            <button
                              onClick={() => handleNavigateToRef(m.ref)}
                              className="tw:text-indigo-600 tw:hover:underline tw:cursor-pointer"
                            >
                              Ver versículo
                            </button>
                            <button
                              onClick={() => handleOpenKeyTerms(m.termId)}
                              className="tw:text-slate-500 tw:hover:text-indigo-600 tw:cursor-pointer"
                            >
                              Editar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {selectedChapterMatches.length === 0 && (
                      <tr>
                        <td colSpan={5} className="tw:text-center tw:py-6 tw:text-slate-400">
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
