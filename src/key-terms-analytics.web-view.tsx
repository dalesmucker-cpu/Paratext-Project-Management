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
  FileText,
  Languages,
} from 'lucide-react';
import { papiRetry, isPapiDisconnectedError } from './utils/papi-retry';
import { usePapiDisconnect } from './utils/use-papi-disconnect';
import type { KeyTermsStore, KeyTerm, VerseMatchStatus } from './types/key-terms.types';
import { BIBLE_BOOKS, type BibleBook } from './types/shared.constants';
import { useLocalizedStrings } from './utils/i18n';

globalThis.webViewComponent = function KeyTermsAnalyticsWebView({
  projectId,
  useWebViewState,
  updateWebViewDefinition,
}: WebViewProps) {
  const [lang, setLang] = useWebViewState<string>('lang', 'es');
  const { tx, toggleLang } = useLocalizedStrings(lang, setLang, 'keyTermsAnalytics');

  const [store, setStore] = useState<KeyTermsStore | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { ready, disconnected, clearDisconnected, handleCatch } = usePapiDisconnect();

  useEffect(() => {
    if (!error) return undefined;
    const timer = setTimeout(() => setError(''), 15000);
    return () => clearTimeout(timer);
  }, [error]);

  const [selectedBook, setSelectedBook] = useWebViewState<BibleBook>('selectedBook', 'MAT');
  const [scanMatches, setScanMatches] = useState<VerseMatchStatus[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(1);

  const selectProject = useDialogCallback(
    'platform.selectProject',
    useMemo(
      () => ({
        title: tx('selectProjectTitle'),
        prompt: tx('selectProjectPromptAnalytics'),
        includeProjectInterfaces: ['platformScripture.USJ_Chapter'],
      }),
      [tx],
    ),
    useCallback(
      (selectedId) => {
        if (selectedId) updateWebViewDefinition({ projectId: selectedId });
      },
      [updateWebViewDefinition],
    ),
  );

  const loadDataRequestRef = useRef(0);

  const loadData = useCallback(async () => {
    if (!projectId) return;
    const requestId = ++loadDataRequestRef.current;
    const isCurrentRequest = () => requestId === loadDataRequestRef.current;
    setLoading(true);
    setError('');
    clearDisconnected();
    try {
      const dataStr = await papiRetry(
        () => papi.commands.sendCommand('paratextProjectManager.getKeyTermsData', projectId),
        { isCancelled: () => !isCurrentRequest() },
      );
      if (!isCurrentRequest()) return;
      const parsed = JSON.parse(dataStr) as KeyTermsStore;
      setStore(parsed);
    } catch (e: any) {
      if (isCurrentRequest()) {
        if (isPapiDisconnectedError(e)) {
          setError(handleCatch(e));
        } else {
          setError(tx('errorLoading', e.message || String(e)));
        }
      }
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [projectId, tx, clearDisconnected, handleCatch]);

  useEffect(() => {
    if (ready) loadData();
  }, [ready, loadData]);

  const scanBookRequestRef = useRef(0);

  const scanBook = useCallback(async () => {
    if (!projectId) return;
    const requestId = ++scanBookRequestRef.current;
    const isCurrentRequest = () => requestId === scanBookRequestRef.current;
    setScanning(true);
    try {
      const res = await papiRetry(
        () =>
          papi.commands.sendCommand(
            'paratextProjectManager.scanBookRenderings',
            projectId,
            selectedBook,
          ),
        { isCancelled: () => !isCurrentRequest() },
      );
      if (!isCurrentRequest()) return;
      const parsed = JSON.parse(res) as { matches: VerseMatchStatus[] };
      if (parsed && parsed.matches) {
        setScanMatches(parsed.matches);
      }
    } catch (e: any) {
      if (isPapiDisconnectedError(e)) {
        setError(handleCatch(e));
      } else {
        console.error('Failed to scan book renderings:', e);
      }
    } finally {
      if (isCurrentRequest()) setScanning(false);
    }
  }, [projectId, selectedBook, handleCatch]);

  useEffect(() => {
    if (store && projectId) {
      scanBook();
    }
  }, [selectedBook, store, projectId, scanBook]);

  const booksWithTerms = useMemo(() => {
    if (!store) return [];
    const books = new Set<string>();
    for (const term of store.terms) {
      for (const ref of term.references) {
        const book = ref.split(' ')[0];
        if (book && (BIBLE_BOOKS as readonly string[]).includes(book)) {
          books.add(book);
        }
      }
    }
    return Array.from(books).sort((a, b) => {
      const idxA = BIBLE_BOOKS.indexOf(a as BibleBook);
      const idxB = BIBLE_BOOKS.indexOf(b as BibleBook);
      return idxA - idxB;
    });
  }, [store]);

  useEffect(() => {
    if (booksWithTerms.length > 0 && !booksWithTerms.includes(selectedBook)) {
      setSelectedBook(booksWithTerms[0] as BibleBook);
    }
  }, [booksWithTerms, selectedBook, setSelectedBook]);

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

  useEffect(() => {
    if (chaptersInBook.length > 0) {
      if (selectedChapter === null || !chaptersInBook.includes(selectedChapter)) {
        setSelectedChapter(chaptersInBook[0]);
      }
    } else {
      setSelectedChapter(null);
    }
  }, [chaptersInBook, selectedChapter]);

  const chapterMetrics = useMemo(() => {
    const metrics: Record<
      number,
      { expected: number; found: number; matches: VerseMatchStatus[] }
    > = {};

    for (const chap of chaptersInBook) {
      metrics[chap] = { expected: 0, found: 0, matches: [] };
    }

    if (!store) return metrics;

    const prefix = `${selectedBook} `;
    const relevantTerms = store.terms.filter((t) =>
      t.references.some((ref) => ref.startsWith(prefix)),
    );

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

    for (const match of scanMatches) {
      const refParts = match.reference.split(' ');
      if (refParts[0] !== selectedBook) continue;
      const chap = parseInt(refParts[1].split(':')[0], 10);

      if (metrics[chap]) {
        metrics[chap].matches.push(match);
      }
    }

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

  const bookStats = useMemo(() => {
    if (!store) return { expectedCount: 0, foundCount: 0, percent: 0 };

    const prefix = `${selectedBook} `;
    const allBookTerms = new Set<string>();
    for (const term of store.terms) {
      const hasRef = term.references.some((ref) => ref.startsWith(prefix));
      if (hasRef) {
        allBookTerms.add(term.id);
      }
    }

    const totalExpectedTerms = allBookTerms.size;
    const foundTerms = new Set<string>();
    for (const m of scanMatches) {
      if (m.matchResult.found) {
        foundTerms.add(m.termId);
      }
    }

    const foundCount = foundTerms.size;
    const percent =
      totalExpectedTerms > 0 ? Math.round((foundCount / totalExpectedTerms) * 100) : 0;

    return { expectedCount: totalExpectedTerms, foundCount, percent };
  }, [store, selectedBook, scanMatches]);

  const problematicTerms = useMemo(() => {
    if (!store) return [];

    const prefix = `${selectedBook} `;
    const termOccurrences: Record<
      string,
      { term: KeyTerm; missingCount: number; occurrences: string[] }
    > = {};

    for (const term of store.terms) {
      const refs = term.references.filter((ref) => ref.startsWith(prefix));
      if (refs.length > 0) {
        termOccurrences[term.id] = {
          term,
          missingCount: 0,
          occurrences: refs,
        };
      }
    }

    for (const m of scanMatches) {
      if (!m.matchResult.found && termOccurrences[m.termId]) {
        termOccurrences[m.termId].missingCount += 1;
      }
    }

    return Object.values(termOccurrences)
      .filter((x) => x.missingCount > 0)
      .sort((a, b) => b.missingCount - a.missingCount)
      .slice(0, 10);
  }, [store, selectedBook, scanMatches]);

  const selectedChapterMatches = useMemo(() => {
    if (selectedChapter === null || !chapterMetrics[selectedChapter]) return [];
    const prefix = `${selectedBook} ${selectedChapter}:`;
    if (!store) return [];

    const expectedInChapter = store.terms.filter((t) =>
      t.references.some((ref) => ref.startsWith(prefix)),
    );

    return expectedInChapter.map((term) => {
      const termMatches = scanMatches.filter(
        (m) => m.termId === term.id && m.reference.startsWith(prefix),
      );
      const anyFound = termMatches.some((m) => m.matchResult.found);
      const matchedText = termMatches.find((m) => m.matchResult.found)?.matchResult.matchedText;
      const ref =
        termMatches[0]?.reference || term.references.find((r) => r.startsWith(prefix)) || '';

      return {
        termId: term.id,
        gloss: term.gloss,
        lemma: term.lemma,
        transliteration: term.transliteration,
        ref,
        expectedRenderings: term.renderings
          .filter((r) => r.status === 'approved')
          .map((r) => r.text),
        found: anyFound,
        matchedText,
      };
    });
  }, [store, selectedBook, selectedChapter, chapterMetrics, scanMatches]);

  const handleNavigateToRef = useCallback(
    async (ref: string) => {
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
          verse,
        );
      } catch (e) {
        if (isPapiDisconnectedError(e)) handleCatch(e);
        else console.error('Failed to navigate from analytics:', e);
      }
    },
    [projectId],
  );

  const handleOpenKeyTerms = useCallback(
    async (termId: string) => {
      if (!projectId) return;
      try {
        await papi.commands.sendCommand('paratextProjectManager.openKeyTerms', projectId);
        await new Promise((r) => setTimeout(r, 450));
        await papi.commands.sendCommand('paratextProjectManager.selectKeyTerm', projectId, termId);
      } catch (e) {
        if (isPapiDisconnectedError(e)) handleCatch(e);
        else console.error('Failed to open key terms editor:', e);
      }
    },
    [projectId],
  );

  const escapeCsvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const handleExportCSV = useCallback(async () => {
    if (!store || !projectId) return;
    try {
      const csvLines = [
        'Libro,Referencia,Término,Lema,Renderings Esperados,Encontrado,Texto Coincidente,Tipo de Coincidencia',
      ];

      for (const m of scanMatches) {
        const refParts = m.reference.split(' ');
        const book = refParts[0];
        const ref = refParts[1];
        const expected = m.expectedRenderings.join(' | ');
        const found = m.matchResult.found ? tx('csvYes') : tx('csvNo');
        const matchedText = m.matchResult.matchedText || '';
        const matchType = m.matchResult.matchType || 'none';

        csvLines.push(
          [
            escapeCsvCell(book),
            escapeCsvCell(ref),
            escapeCsvCell(m.gloss),
            escapeCsvCell(m.lemma),
            escapeCsvCell(expected),
            escapeCsvCell(found),
            escapeCsvCell(matchedText),
            escapeCsvCell(matchType),
          ].join(','),
        );
      }

      const csvContent = csvLines.join('\n');
      const filename = `key-terms-analytics-${selectedBook}-${Date.now()}.csv`;

      const downloadPath = await papi.commands.sendCommand(
        'paratextProjectManager.saveToDownloads',
        filename,
        csvContent,
      );

      alert(`${tx('exportedCsv')}\n${downloadPath}`);
    } catch (e: any) {
      alert(handleCatch(e, `${tx('errorExportingCsv')}: `));
    }
  }, [store, projectId, selectedBook, scanMatches, tx]);

  const handleExportHTML = useCallback(async () => {
    if (!store || !projectId) return;
    try {
      const rowsHtml = scanMatches
        .map((m) => {
          const statusClass = m.matchResult.found ? 'status-yes' : 'status-no';
          const statusText = m.matchResult.found ? tx('htmlFound') : tx('htmlMissing');
          const renderingsHtml =
            m.expectedRenderings.length > 0
              ? escapeHtml(m.expectedRenderings.join(', '))
              : `<i>${escapeHtml(tx('noneApproved'))}</i>`;
          return `
            <tr>
              <td><b>${escapeHtml(m.reference)}</b></td>
              <td>${escapeHtml(m.gloss)}</td>
              <td style="font-family: serif;">${escapeHtml(m.lemma)}</td>
              <td>${renderingsHtml}</td>
              <td><span class="${statusClass}">${statusText}</span></td>
              <td><b>${escapeHtml(m.matchResult.matchedText || '-')}</b></td>
            </tr>
          `;
        })
        .join('');

      const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(tx('htmlReportTitle'))} - ${escapeHtml(selectedBook)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; color: #0f172a; background-color: #f8fafc; }
    h1 { color: #4f46e5; font-weight: 900; }
    h2 { color: #475569; margin-top: 24px; border-bottom: 1px solid #cbd5e1; padding-bottom: 8px; }
    .metrics { display: flex; gap: 16px; margin-bottom: 24px; }
    .card { background: #ffffff; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; flex: 1; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .card .num { font-size: 32px; font-weight: 900; color: #7c3aed; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; background: #ffffff; margin-top: 12px; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; }
    th, td { padding: 14px; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background-color: #f1f5f9; font-weight: bold; color: #475569; }
    .status-yes { color: #047857; font-weight: bold; background: rgba(16, 185, 129, 0.1); padding: 4px 8px; border-radius: 9999px; display: inline-block; }
    .status-no { color: #b91c1c; font-weight: bold; background: rgba(239, 68, 68, 0.1); padding: 4px 8px; border-radius: 9999px; display: inline-block; }
  </style>
</head>
<body>
  <h1>${escapeHtml(tx('htmlReportHeading'))}</h1>
  <p><strong>${escapeHtml(tx('htmlBook'))}:</strong> ${escapeHtml(selectedBook)}</p>
  <p><strong>${escapeHtml(tx('htmlReportDate'))}:</strong> ${escapeHtml(new Date().toLocaleDateString())}</p>

  <div class="metrics">
    <div class="card">
      <div class="num">${bookStats.percent}%</div>
      <div>${escapeHtml(tx('htmlMatchPercent'))}</div>
    </div>
    <div class="card">
      <div class="num">${bookStats.foundCount} / ${bookStats.expectedCount}</div>
      <div>${escapeHtml(tx('htmlTermsFound'))}</div>
    </div>
  </div>

  <h2>${escapeHtml(tx('htmlMatchDetails'))}</h2>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(tx('htmlRef'))}</th>
        <th>${escapeHtml(tx('htmlTerm'))}</th>
        <th>${escapeHtml(tx('htmlLemma'))}</th>
        <th>${escapeHtml(tx('htmlExpectedRenderings'))}</th>
        <th>${escapeHtml(tx('htmlStatus'))}</th>
        <th>${escapeHtml(tx('htmlMatchedText'))}</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;

      const filename = `key-terms-analytics-${selectedBook}-${Date.now()}.html`;
      const downloadPath = await papi.commands.sendCommand(
        'paratextProjectManager.saveToDownloads',
        filename,
        htmlContent,
      );

      alert(`${tx('exportedHtml')}\n${downloadPath}`);
    } catch (e: any) {
      alert(handleCatch(e, `${tx('errorExportingHtml')}: `));
    }
  }, [store, projectId, selectedBook, scanMatches, bookStats, tx]);

  if (!projectId) {
    return (
      <div className="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:p-8 tw:text-center tw:gap-6 tw:text-sm tw:bg-slate-100 dark:tw:bg-slate-950 tw:text-slate-900 dark:tw:text-slate-100">
        <div className="tw:p-4 tw:bg-white dark:tw:bg-slate-900 tw:rounded-full tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:text-slate-500 dark:tw:text-slate-400 tw:animate-bounce">
          <FolderOpen size={48} />
        </div>
        <div className="tw:space-y-2">
          <p className="tw:text-lg tw:font-bold">{tx('noProject')}</p>
          <p className="tw:text-xs tw:text-slate-500 dark:tw:text-slate-400 tw:max-w-xs">
            {tx('noProjectDesc')}
          </p>
        </div>
        <button
          type="button"
          className="tw:inline-flex tw:items-center tw:gap-2 tw:px-5 tw:py-2.5 tw:bg-indigo-600 tw:text-white tw:rounded-xl hover:tw:bg-indigo-700 tw:cursor-pointer tw:font-semibold tw:shadow-sm tw:transition-colors tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30 tw:focus-visible:ring-offset-2 tw:focus-visible:ring-offset-white dark:tw:focus-visible:ring-offset-slate-900"
          onClick={() => selectProject()}
        >
          {tx('selectProject')}
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:bg-slate-100 dark:tw:bg-slate-950 tw:text-slate-900 dark:tw:text-slate-100 tw:gap-4">
        <RefreshCw
          size={36}
          className="tw:text-indigo-600 dark:tw:text-indigo-400 tw:animate-spin"
        />
        <span className="tw:text-xs tw:text-slate-500 dark:tw:text-slate-400 tw:font-medium">
          {tx('loadingMetrics')}
        </span>
      </div>
    );
  }

  return (
    <div className="tw:flex tw:flex-col tw:h-full tw:bg-slate-100 dark:tw:bg-slate-950 tw:text-slate-900 dark:tw:text-slate-100 tw:font-sans">
      {/* Top Header */}
      <div className="tw:px-6 tw:py-4 tw:bg-white dark:tw:bg-slate-900 tw:border-b tw:border-slate-200 dark:tw:border-slate-800 tw:flex tw:flex-col md:tw:flex-row tw:items-start md:tw:items-center tw:gap-4 tw:justify-between tw:flex-shrink-0">
        <div className="tw:flex tw:items-center tw:gap-3 tw:min-w-0">
          <div className="tw:bg-indigo-50 tw:p-2 tw:rounded-xl tw:ring-1 tw:ring-indigo-200 dark:tw:bg-indigo-900/30 dark:tw:ring-indigo-800 tw:flex-shrink-0">
            <PieChart size={20} className="tw:text-indigo-600 dark:tw:text-indigo-400" />
          </div>
          <div className="tw:flex tw:flex-col tw:min-w-0">
            <h1 className="tw:text-[20px] tw:font-semibold tw:tracking-tight tw:text-slate-900 dark:tw:text-slate-100 tw:truncate">
              {tx('title')}
            </h1>
            <span className="tw:text-xs tw:text-slate-500 dark:tw:text-slate-400 tw:font-medium">
              {tx('consistencyCheck')}
            </span>
          </div>
          {scanning && (
            <div
              role="status"
              aria-live="polite"
              className="tw:flex tw:items-center tw:gap-1.5 tw:ml-2 tw:bg-indigo-50 dark:tw:bg-indigo-900/30 tw:border tw:border-indigo-200 dark:tw:border-indigo-800 tw:rounded-full tw:py-0.5 tw:px-2.5 tw:flex-shrink-0"
            >
              <span className="tw:relative tw:flex tw:h-2 tw:w-2">
                <span className="tw:animate-ping tw:absolute tw:inline-flex tw:h-full tw:w-full tw:rounded-full tw:bg-indigo-600 tw:opacity-75" />
                <span className="tw:relative tw:inline-flex tw:rounded-full tw:h-2 tw:w-2 tw:bg-indigo-600" />
              </span>
              <span className="tw:text-[9px] tw:text-indigo-600 dark:tw:text-indigo-400 tw:font-bold tw:uppercase tw:tracking-wider">
                {tx('scanning')}
              </span>
            </div>
          )}
        </div>

        <div className="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
          {/* Book Dropdown Selector */}
          <label className="tw:flex tw:items-center tw:gap-2 tw:bg-white dark:tw:bg-slate-900 tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:rounded-xl tw:px-3 tw:py-1.5">
            <span className="tw:text-[10px] tw:text-slate-500 dark:tw:text-slate-400 tw:font-bold tw:uppercase tw:tracking-wide">
              {tx('book')}
            </span>
            <select
              value={selectedBook}
              onChange={(e) => {
                setSelectedBook(e.target.value as BibleBook);
                setSelectedChapter(1);
              }}
              className="tw:text-xs tw:font-bold tw:bg-transparent tw:text-indigo-600 dark:tw:text-indigo-400 tw:outline-none tw:border-none tw:cursor-pointer tw:pr-2"
            >
              {booksWithTerms.map((b) => (
                <option
                  key={b}
                  value={b}
                  className="tw:bg-white dark:tw:bg-slate-900 tw:text-slate-900 dark:tw:text-slate-100 tw:font-bold"
                >
                  {b}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={scanBook}
            disabled={scanning}
            className="tw:inline-flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:bg-white dark:tw:bg-slate-900 hover:tw:bg-slate-50 dark:tw:hover:tw:bg-slate-800 tw:border tw:border-slate-200 dark:tw:border-slate-800 disabled:tw:opacity-50 tw:rounded-xl tw:text-xs tw:font-bold tw:cursor-pointer tw:transition-colors tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30 tw:focus-visible:ring-offset-2 tw:focus-visible:ring-offset-white dark:tw:focus-visible:ring-offset-slate-900"
          >
            <RefreshCw size={14} className={scanning ? 'tw:animate-spin' : ''} />
            <span className="tw:hidden sm:tw:inline">{tx('refreshScan')}</span>
          </button>

          <button
            type="button"
            onClick={toggleLang}
            title={tx('toggleLanguage')}
            aria-label={tx('toggleLanguage')}
            className="tw:inline-flex tw:items-center tw:gap-1.5 tw:px-2.5 tw:py-2 tw:bg-white dark:tw:bg-slate-900 hover:tw:bg-slate-50 dark:tw:hover:tw:bg-slate-800 tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:rounded-xl tw:text-xs tw:font-bold tw:cursor-pointer tw:transition-colors tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30 tw:focus-visible:ring-offset-2 tw:focus-visible:ring-offset-white dark:tw:focus-visible:ring-offset-slate-900"
          >
            <Languages size={14} />
            <span className="tw:uppercase">{lang}</span>
          </button>

          <button
            type="button"
            onClick={() => selectProject()}
            className="tw:inline-flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:bg-indigo-50 dark:tw:bg-indigo-900/30 hover:tw:bg-indigo-100 dark:tw:hover:tw:bg-indigo-900/40 tw:text-indigo-600 dark:tw:text-indigo-400 tw:border tw:border-indigo-200 dark:tw:border-indigo-800 tw:rounded-xl tw:text-xs tw:font-bold tw:cursor-pointer tw:transition-colors tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30 tw:focus-visible:ring-offset-2 tw:focus-visible:ring-offset-white dark:tw:focus-visible:ring-offset-slate-900"
          >
            {tx('changeProject')}
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="tw:bg-rose-50 dark:tw:bg-rose-950/40 tw:border-b tw:border-rose-200 dark:tw:border-rose-900 tw:px-6 tw:py-2.5 tw:text-rose-600 dark:tw:text-rose-400 tw:text-xs tw:font-semibold tw:flex tw:justify-between tw:items-center"
        >
          <div className="tw:flex tw:items-center tw:gap-2">
            <AlertTriangle size={14} />
            <span>{error}</span>
          </div>
          {disconnected ? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="tw:bg-rose-600 hover:tw:bg-rose-700 tw:text-white tw:px-3 tw:py-1 tw:rounded tw:font-semibold tw:cursor-pointer tw:transition-colors"
              title="Recargar la vista para reestablecer la conexión con Paratext"
            >
              Reconectar
            </button>
          ) : (
            <button
              type="button"
              onClick={loadData}
              className="tw:text-rose-600 dark:tw:text-rose-400 tw:underline hover:tw:text-rose-700 tw:ml-2 tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30 tw:rounded"
            >
              {tx('retry')}
            </button>
          )}
        </div>
      )}

      {/* Main Workspace */}
      <div className="tw:flex-1 tw:flex tw:flex-col lg:tw:flex-row tw:overflow-y-auto lg:tw:overflow-hidden">
        {/* Left Side: Stats and problematic terms */}
        <div className="tw:w-full lg:tw:w-80 tw:border-b lg:tw:border-b-0 lg:tw:border-r tw:border-slate-200 dark:tw:border-slate-800 tw:bg-white dark:tw:bg-slate-900 tw:p-5 tw:flex tw:flex-col sm:tw:grid sm:tw:grid-cols-2 lg:tw:flex lg:tw:flex-col tw:gap-5 tw:overflow-y-auto lg:tw:max-h-full tw:flex-shrink-0">
          {/* Stats Card */}
          <div className="tw:relative tw:bg-white dark:tw:bg-slate-900 tw:p-5 tw:rounded-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:shadow-sm tw:space-y-4 tw:overflow-hidden">
            <div className="tw:flex tw:items-center tw:justify-between tw:relative">
              <h3 className="tw:text-[10px] tw:font-bold tw:uppercase tw:tracking-wider tw:text-slate-500 dark:tw:text-slate-400">
                {tx('progressIn', selectedBook)}
              </h3>
              <Trophy size={16} className="tw:text-amber-500" />
            </div>

            <div className="tw:flex tw:items-baseline tw:gap-1 tw:relative">
              <span className="tw:text-5xl tw:font-black tw:tracking-tighter">
                {bookStats.percent}%
              </span>
              <span className="tw:text-xs tw:text-slate-500 dark:tw:text-slate-400 tw:font-semibold">
                {tx('verified')}
              </span>
            </div>

            <div className="tw:w-full tw:h-2 tw:bg-slate-200 dark:tw:bg-slate-700 tw:rounded-full tw:overflow-hidden tw:relative">
              <div
                className="tw:h-full tw:bg-emerald-500 tw:transition-all tw:duration-500"
                style={{ width: `${bookStats.percent}%` }}
              />
            </div>

            <div className="tw:text-[11px] tw:text-slate-600 dark:tw:text-slate-400 tw:font-medium tw:leading-relaxed tw:relative">
              {tx('foundOf', bookStats.foundCount, bookStats.expectedCount)}
            </div>
          </div>

          {/* Export Action Card */}
          <div className="tw:bg-white dark:tw:bg-slate-900 tw:p-4 tw:rounded-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:space-y-3">
            <h4 className="tw:font-bold tw:text-[10px] tw:text-slate-500 dark:tw:text-slate-400 tw:uppercase tw:tracking-wider tw:flex tw:items-center tw:gap-1.5">
              <Download size={12} />
              {tx('exportReports')}
            </h4>
            <div className="tw:flex tw:gap-2">
              <button
                type="button"
                onClick={handleExportCSV}
                className="tw:flex-1 tw:inline-flex tw:items-center tw:justify-center tw:gap-1 tw:py-2 tw:bg-slate-100 dark:tw:bg-slate-800 hover:tw:bg-slate-50 dark:tw:hover:tw:bg-slate-800 tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:rounded-xl tw:text-[10px] tw:font-bold tw:shadow-sm tw:cursor-pointer tw:transition-colors tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30"
              >
                <FileSpreadsheet size={12} className="tw:text-slate-500 dark:tw:text-slate-400" />
                CSV
              </button>
              <button
                type="button"
                onClick={handleExportHTML}
                className="tw:flex-1 tw:inline-flex tw:items-center tw:justify-center tw:gap-1 tw:py-2 tw:bg-slate-100 dark:tw:bg-slate-800 hover:tw:bg-slate-50 dark:tw:hover:tw:bg-slate-800 tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:rounded-xl tw:text-[10px] tw:font-bold tw:shadow-sm tw:cursor-pointer tw:transition-colors tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30"
              >
                <FileText size={12} className="tw:text-slate-500 dark:tw:text-slate-400" />
                HTML
              </button>
            </div>
          </div>

          {/* Problematic terms list */}
          <div className="tw:space-y-3 sm:tw:col-span-2 lg:tw:col-span-1 tw:flex-1 tw:flex tw:flex-col tw:overflow-hidden tw:min-h-0">
            <h4 className="tw:font-bold tw:text-[10px] tw:text-slate-500 dark:tw:text-slate-400 tw:uppercase tw:tracking-wider tw:flex tw:items-center tw:gap-1.5">
              <AlertTriangle size={12} className="tw:text-rose-600 dark:tw:text-rose-400" />
              {tx('mostMissing')}
            </h4>
            <div className="tw:space-y-2 tw:overflow-y-auto tw:flex-1 tw:pr-1">
              {problematicTerms.map(({ term, missingCount }) => (
                <button
                  type="button"
                  key={term.id}
                  onClick={() => handleOpenKeyTerms(term.id)}
                  className="tw:w-full tw:text-left tw:p-3 tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:bg-white dark:tw:bg-slate-900 hover:tw:bg-slate-50 dark:tw:hover:tw:bg-slate-800 tw:rounded-xl tw:cursor-pointer tw:transition-colors tw:flex tw:items-center tw:justify-between tw:gap-3 group tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30"
                >
                  <div className="tw:space-y-1 tw:min-w-0">
                    <div className="tw:font-bold tw:text-xs tw:text-slate-900 dark:tw:text-slate-100 group-hover:tw:text-indigo-600 dark:tw:text-indigo-400 tw:transition-colors tw:truncate">
                      {term.gloss}
                    </div>
                    <div className="tw:text-[10px] tw:text-slate-500 dark:tw:text-slate-400 tw:font-serif tw:italic tw:truncate">
                      {term.lemma}
                    </div>
                  </div>
                  <span className="tw:px-2 tw:py-0.5 tw:bg-rose-50 dark:tw:bg-rose-950/40 tw:text-rose-600 dark:tw:text-rose-400 tw:border tw:border-rose-200 dark:tw:border-rose-900/50 tw:rounded-full tw:text-[9px] tw:font-bold tw:flex-shrink-0">
                    -{missingCount}
                  </span>
                </button>
              ))}
              {problematicTerms.length === 0 && (
                <div className="tw:text-xs tw:text-slate-500 dark:tw:text-slate-400 tw:text-center tw:py-8 tw:italic">
                  {tx('noMissingInBook')}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Heatmap and chapter details */}
        <div className="tw:flex-1 tw:p-4 sm:tw:p-6 tw:overflow-y-auto tw:space-y-6 tw:min-w-0">
          <div className="tw:space-y-3">
            <div className="tw:flex tw:items-center tw:justify-between tw:flex-wrap tw:gap-2">
              <h3 className="tw:font-bold tw:text-[10px] tw:text-slate-500 dark:tw:text-slate-400 tw:uppercase tw:tracking-wider tw:flex tw:items-center tw:gap-1.5">
                <Layers size={12} />
                {tx('chapterHeatmap')}
              </h3>
              {/* Heatmap Legend */}
              <div className="tw:flex tw:items-center tw:gap-3 tw:text-[9px] tw:text-slate-500 dark:tw:text-slate-400 tw:font-semibold tw:uppercase tw:tracking-wide">
                <span className="tw:flex tw:items-center tw:gap-1.5">
                  <span className="tw:w-2.5 tw:h-2.5 tw:rounded tw:bg-emerald-500" />
                  {tx('legendComplete')}
                </span>
                <span className="tw:flex tw:items-center tw:gap-1.5">
                  <span className="tw:w-2.5 tw:h-2.5 tw:rounded tw:bg-amber-500" />
                  {tx('legendPartial')}
                </span>
                <span className="tw:flex tw:items-center tw:gap-1.5">
                  <span className="tw:w-2.5 tw:h-2.5 tw:rounded tw:bg-rose-600" />
                  {tx('legendMissing')}
                </span>
              </div>
            </div>

            {/* Heatmap Grid */}
            <div className="tw:grid tw:grid-cols-4 sm:tw:grid-cols-6 md:tw:grid-cols-8 lg:tw:grid-cols-10 tw:gap-2 sm:tw:gap-3">
              {chaptersInBook.map((chap) => {
                const metrics = chapterMetrics[chap];
                const expected = metrics?.expected ?? 0;
                const found = metrics?.found ?? 0;
                const isSelected = selectedChapter === chap;

                let cardClass =
                  'tw:bg-white dark:tw:bg-slate-900 tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:text-slate-500 dark:tw:text-slate-400 hover:tw:bg-slate-50 dark:tw:hover:tw:bg-slate-800';
                if (expected > 0) {
                  if (found === expected) {
                    cardClass =
                      'tw:bg-emerald-500/15 tw:border-emerald-500/40 tw:text-emerald-700 dark:tw:text-emerald-400 hover:tw:bg-emerald-500/25';
                  } else if (found > 0) {
                    cardClass =
                      'tw:bg-amber-500/15 tw:border-amber-500/40 tw:text-amber-700 dark:tw:text-amber-400 hover:tw:bg-amber-500/25';
                  } else {
                    cardClass =
                      'tw:bg-rose-500/15 tw:border-rose-500/40 tw:text-rose-600 dark:tw:text-rose-400 hover:tw:bg-rose-500/25';
                  }
                }

                return (
                  <button
                    type="button"
                    key={chap}
                    onClick={() => setSelectedChapter(chap)}
                    aria-pressed={isSelected}
                    aria-label={tx('chapterLabel', chap, found, expected)}
                    className={`tw:p-3 sm:tw:p-3.5 tw:rounded-2xl tw:border tw:text-center tw:transition-all tw:cursor-pointer tw:flex tw:flex-col tw:items-center tw:gap-1 tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30 ${cardClass} ${
                      isSelected ? 'tw:ring-2 tw:ring-indigo-500 tw:border-indigo-500' : ''
                    }`}
                  >
                    <span className="tw:text-lg tw:font-black tw:tracking-tight">{chap}</span>
                    <span className="tw:text-[9px] tw:font-bold tw:opacity-80">
                      {expected > 0 ? `${found}/${expected}` : 'N/A'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chapter detail card */}
          {selectedChapter !== null && chapterMetrics[selectedChapter] && (
            <div className="tw:bg-white dark:tw:bg-slate-900 tw:p-4 sm:tw:p-6 tw:rounded-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:shadow-sm tw:space-y-4 tw:overflow-hidden">
              <div className="tw:flex tw:items-center tw:justify-between tw:flex-wrap tw:gap-2 tw:pb-3 tw:border-b tw:border-slate-200 dark:tw:border-slate-800">
                <div className="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
                  <h3 className="tw:font-extrabold tw:text-sm tw:text-slate-900 dark:tw:text-slate-100 tw:uppercase">
                    {tx('chapterDetails', selectedChapter)}
                  </h3>
                  <span className="tw:px-2 tw:py-0.5 tw:bg-slate-100 dark:tw:bg-slate-800 tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:rounded-full tw:text-[9px] tw:font-bold tw:text-slate-500 dark:tw:text-slate-400">
                    {selectedBook} {selectedChapter}
                  </span>
                </div>
                <span className="tw:text-xs tw:text-slate-500 dark:tw:text-slate-400 tw:font-medium">
                  {tx(
                    'termsFoundOf',
                    selectedChapterMatches.filter((m) => m.found).length,
                    selectedChapterMatches.length,
                  )}
                </span>
              </div>

              {/* Table of terms */}
              <div className="tw:overflow-x-auto">
                <table className="tw:w-full tw:text-left tw:border-collapse tw:min-w-[600px]">
                  <thead>
                    <tr className="tw:border-b tw:border-slate-200 dark:tw:border-slate-800 tw:text-[10px] tw:text-slate-500 dark:tw:text-slate-400 tw:uppercase tw:tracking-wider">
                      <th className="tw:pb-3 tw:font-bold">{tx('colGloss')}</th>
                      <th className="tw:pb-3 tw:font-bold">{tx('colLemma')}</th>
                      <th className="tw:pb-3 tw:font-bold">{tx('colRenderings')}</th>
                      <th className="tw:pb-3 tw:font-bold">{tx('colMatch')}</th>
                      <th className="tw:pb-3 tw:font-bold">{tx('colActions')}</th>
                    </tr>
                  </thead>
                  <tbody className="tw:divide-y tw:divide-slate-200 dark:tw:divide-slate-800 tw:text-xs">
                    {selectedChapterMatches.map((m) => (
                      <tr
                        key={m.termId}
                        className="hover:tw:bg-slate-50 dark:tw:hover:tw:bg-slate-800 tw:transition-colors"
                      >
                        <td className="tw:py-3.5 tw:font-bold tw:text-slate-900 dark:tw:text-slate-100">
                          {m.gloss}
                        </td>
                        <td className="tw:py-3.5 tw:font-serif tw:text-indigo-600 dark:tw:text-indigo-400 tw:text-xs">
                          {m.lemma}{' '}
                          {m.transliteration ? (
                            <span className="tw:text-slate-500 dark:tw:text-slate-400 tw:text-[10px] tw:font-sans">
                              ({m.transliteration})
                            </span>
                          ) : null}
                        </td>
                        <td className="tw:py-3.5 tw:text-slate-500 dark:tw:text-slate-400">
                          {m.expectedRenderings.join(', ') || (
                            <span className="tw:text-slate-500 dark:tw:text-slate-400 tw:italic">
                              {tx('noneApproved')}
                            </span>
                          )}
                        </td>
                        <td className="tw:py-3.5">
                          {m.found ? (
                            <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:bg-emerald-500/15 tw:text-emerald-700 dark:tw:text-emerald-400 tw:px-2.5 tw:py-1 tw:border tw:border-emerald-500/30 tw:rounded-xl tw:font-bold tw:text-[10px]">
                              <CheckCircle2 size={12} />
                              {m.matchedText}
                            </span>
                          ) : (
                            <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:bg-rose-500/15 tw:text-rose-600 dark:tw:text-rose-400 tw:px-2.5 tw:py-1 tw:border tw:border-rose-200 dark:tw:border-rose-900 tw:rounded-xl tw:font-bold tw:text-[10px]">
                              <XCircle size={12} />
                              {tx('missing')}
                            </span>
                          )}
                        </td>
                        <td className="tw:py-3.5">
                          <div className="tw:flex tw:items-center tw:gap-3">
                            <button
                              type="button"
                              onClick={() => handleNavigateToRef(m.ref)}
                              className="tw:inline-flex tw:items-center tw:gap-1 tw:text-indigo-600 dark:tw:text-indigo-400 hover:tw:underline tw:cursor-pointer tw:font-semibold tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30 tw:rounded"
                            >
                              <BookOpen size={12} />
                              {tx('viewVerse')}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenKeyTerms(m.termId)}
                              className="tw:inline-flex tw:items-center tw:gap-1 tw:text-slate-500 dark:tw:text-slate-400 hover:tw:text-slate-900 dark:tw:text-slate-100 tw:cursor-pointer tw:font-semibold tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30 tw:rounded"
                            >
                              <Edit3 size={12} />
                              {tx('edit')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {selectedChapterMatches.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          className="tw:text-center tw:py-8 tw:text-slate-500 dark:tw:text-slate-400 tw:italic"
                        >
                          {tx('noTermsInChapter', selectedChapter)}
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
