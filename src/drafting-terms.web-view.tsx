/* eslint-disable react/jsx-no-useless-fragment */
import { WebViewProps } from '@papi/core';
import papi from '@papi/frontend';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import type { VerseMatchStatus } from './types/key-terms.types';
import { papiRetry, isPapiDisconnectedError } from './utils/papi-retry';
import { usePapiDisconnect } from './utils/use-papi-disconnect';
import { ReconnectBanner } from './components/reconnect-banner';

function isVerseInRef(
  bookCode: string,
  chapterNum: number,
  verseNum: number,
  ref: string,
): boolean {
  if (!ref) return false;
  const parts = ref.split(' ');
  if (parts.length < 2) return false;
  const book = parts[0];
  if (book !== bookCode) return false;
  const chapVerse = parts[1].split(':');
  if (chapVerse.length < 2) return false;
  const chap = parseInt(chapVerse[0], 10);
  if (chap !== chapterNum) return false;

  const verseStr = chapVerse[1];
  const cleanVerseStr = verseStr.replace(/[a-zA-Z]/g, '');

  if (cleanVerseStr.includes('-')) {
    const [startStr, endStr] = cleanVerseStr.split('-');
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    return verseNum >= start && verseNum <= end;
  }

  const parsedVerse = parseInt(cleanVerseStr, 10);
  return parsedVerse === verseNum;
}

type Ref = { projectId: string; bookCode: string; chapter: number; verse: number };

function EmptyBody({ projectMissing }: { projectMissing: boolean }) {
  if (projectMissing) {
    return (
      <div className="tw:space-y-2">
        <div className="tw:text-2xl">📂</div>
        <p className="tw:text-slate-500 tw:text-sm tw:font-medium">Proyecto no disponible</p>
        <p className="tw:text-slate-400 tw:text-xs tw:max-w-xs">
          No se encontró un proyecto activo. Abre el Lector de Escritura para un proyecto y luego
          vuelve a esta ventana.
        </p>
      </div>
    );
  }
  return (
    <div className="tw:space-y-2">
      <div className="tw:text-2xl">🖱️</div>
      <p className="tw:text-slate-500 tw:text-sm tw:font-medium">
        Haz clic en un versículo en el Lector de Escritura
      </p>
      <p className="tw:text-slate-400 tw:text-xs tw:max-w-xs">
        Esta ventana mostrará los términos clave que debes usar en ese versículo.
      </p>
    </div>
  );
}

type SortOrder = 'missing-first' | 'found-first' | 'default';
type TextSize = 'compact' | 'normal' | 'large';

globalThis.webViewComponent = function DraftingTermsWebView({ projectId }: WebViewProps) {
  const [currentRef, setCurrentRef] = useState<Ref | null>(null);
  const [matches, setMatches] = useState<VerseMatchStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [projectMissing, setProjectMissing] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const { ready, disconnected, handleCatch } = usePapiDisconnect();

  // Settings (persisted to localStorage so they survive across sessions)
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(
    () => (localStorage.getItem('drafting_terms_sort') as SortOrder) || 'missing-first',
  );
  const [textSize, setTextSize] = useState<TextSize>(
    () => (localStorage.getItem('drafting_terms_text_size') as TextSize) || 'normal',
  );

  // Current user (for proposedBy when adding renderings) and drag-and-drop / inline
  // add-rendering affordances.
  const [currentUser, setCurrentUser] = useState('Traductor');
  const [dropActiveTermId, setDropActiveTermId] = useState<string | null>(null);
  const [addingRenderingFor, setAddingRenderingFor] = useState<string | null>(null);
  const [newRenderingText, setNewRenderingText] = useState('');

  // Click-outside handler for the hamburger dropdown
  useEffect(() => {
    if (!menuOpen) return undefined;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!error) return undefined;
    const timer = setTimeout(() => setError(''), 15000);
    return () => clearTimeout(timer);
  }, [error]);

  const loadKeyTermsMatchesRequestRef = useRef(0);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const currentRefRef = useRef<Ref | null>(null);
  currentRefRef.current = currentRef;

  const loadMatches = useCallback(
    async (bookCode: string, chapterNum: number) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const requestId = ++loadKeyTermsMatchesRequestRef.current;
      const isCurrentRequest = () => requestId === loadKeyTermsMatchesRequestRef.current;
      setLoading(true);
      try {
        const res = await papiRetry(
          () =>
            papi.commands.sendCommand(
              'paratextProjectManager.scanChapterRenderings',
              pid,
              bookCode,
              chapterNum,
            ),
          { isCancelled: () => !isCurrentRequest() },
        );
        if (!isCurrentRequest()) return;
        const parsed = JSON.parse(res) as { matches: VerseMatchStatus[] };
        if (parsed && parsed.matches) {
          setMatches(parsed.matches);
        } else {
          setMatches([]);
        }
      } catch (e) {
        if (isPapiDisconnectedError(e)) setError(handleCatch(e));
        else if (isCurrentRequest()) console.error('Failed to load key terms matches:', e);
      } finally {
        if (isCurrentRequest()) setLoading(false);
      }
    },
    [handleCatch],
  );

  // Boot: read the last navigated verse for this project so the window opens
  // with content already loaded (instead of an empty hint).
  useEffect(() => {
    if (!projectId || !ready) return;
    let cancelled = false;
    (async () => {
      try {
        const last = await papi.commands.sendCommand(
          'paratextProjectManager.getLastNavigatedVerse',
          projectId,
        );
        if (cancelled) return;
        if (last && last.projectId === projectId) {
          const ref: Ref = {
            projectId: last.projectId,
            bookCode: last.bookCode,
            chapter: last.chapter,
            verse: last.verse,
          };
          setCurrentRef(ref);
          await loadMatches(last.bookCode, last.chapter);
        }
        setProjectMissing(false);
      } catch (e) {
        if (isPapiDisconnectedError(e)) setError(handleCatch(e));
        else if (!cancelled) {
          console.error('Failed to read last navigated verse:', e);
          setProjectMissing(true);
        }
      } finally {
        if (!cancelled) setBootstrapped(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, ready, loadMatches, handleCatch]);

  // Listen to verse-selection events from the Scripture Viewer.
  useEffect(() => {
    const unsubscribe = papi.network.getNetworkEvent<Ref>('paratextProjectManager.onVerseSelected')(
      (eventData) => {
        if (!eventData || eventData.projectId !== projectId) return;
        const ref: Ref = {
          projectId: eventData.projectId,
          bookCode: eventData.bookCode,
          chapter: eventData.chapter,
          verse: eventData.verse,
        };
        const cur = currentRefRef.current;
        if (
          cur &&
          cur.bookCode === ref.bookCode &&
          cur.chapter === ref.chapter &&
          cur.verse === ref.verse
        ) {
          return;
        }
        setCurrentRef(ref);
        loadMatches(ref.bookCode, ref.chapter).catch((err) => {
          if (isPapiDisconnectedError(err)) handleCatch(err);
        });
      },
    );
    return () => {
      unsubscribe();
    };
  }, [projectId, loadMatches, handleCatch]);

  const openKeyTermsFor = useCallback(
    async (termId: string) => {
      if (!projectId) return;
      try {
        await papi.commands.sendCommand('paratextProjectManager.openKeyTerms', projectId);
        await new Promise((r) => setTimeout(r, 400));
        await papi.commands.sendCommand('paratextProjectManager.selectKeyTerm', projectId, termId);
      } catch (e) {
        if (isPapiDisconnectedError(e)) handleCatch(e);
        else console.error('Failed to open/select key term:', e);
      }
    },
    [projectId, handleCatch],
  );

  // Resolve the current translator user (used as `proposedBy` for new renderings).
  useEffect(() => {
    if (!projectId || !ready) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const user = await papi.commands.sendCommand('paratextProjectManager.getCurrentUser');
        if (!cancelled && user) setCurrentUser(user);
      } catch (e) {
        if (isPapiDisconnectedError(e)) setError(handleCatch(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, ready, handleCatch]);

  // Persist a rendering for a specific key term via the backend command, then refresh
  // the verse scan so the Usado/Faltante badge updates immediately.
  const addRenderingToTerm = useCallback(
    async (termId: string, text: string, verseRef: string) => {
      const clean = (text || '').trim();
      if (!clean) return;
      try {
        const res = await papi.commands.sendCommand(
          'paratextProjectManager.addRenderingToTerm',
          projectId,
          termId,
          clean,
          verseRef,
          currentUser,
        );
        if (typeof res === 'string' && res.startsWith('error')) {
          setError(`No se pudo guardar la traducción: ${res}`);
          return;
        }
        if (currentRef) await loadMatches(currentRef.bookCode, currentRef.chapter);
      } catch (e) {
        if (isPapiDisconnectedError(e)) setError(handleCatch(e));
        else console.error('Failed to add rendering to term:', e);
      }
    },
    [projectId, currentRef, currentUser, loadMatches, handleCatch],
  );

  // Drop handler for a term card — accepts a word dragged from the Scripture Viewer.
  const handleDropOnTerm = useCallback(
    (termId: string, e: ReactDragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropActiveTermId(null);
      const dt = e.dataTransfer;
      let text = '';
      let verseRef = '';
      try {
        const raw = dt.getData('application/x-paratext-rendering');
        if (raw) {
          const parsed = JSON.parse(raw);
          text = (parsed?.text || '').trim();
          if (parsed?.bookCode) {
            verseRef = `${parsed.bookCode} ${parsed.chapter}:${parsed.verse}`;
          }
        }
      } catch (_) {
        /* ignore parse errors, fall back to text/plain */
      }
      if (!text) text = (dt.getData('text/plain') || '').trim();
      if (!text) return;
      void addRenderingToTerm(termId, text, verseRef);
    },
    [addRenderingToTerm],
  );

  const submitInlineRendering = useCallback(
    async (termId: string) => {
      const text = newRenderingText.trim();
      setAddingRenderingFor(null);
      setNewRenderingText('');
      if (!text) return;
      const verseRef = currentRef
        ? `${currentRef.bookCode} ${currentRef.chapter}:${currentRef.verse}`
        : '';
      await addRenderingToTerm(termId, text, verseRef);
    },
    [newRenderingText, currentRef, addRenderingToTerm],
  );

  const openDictionary = useCallback(
    (term: string) => {
      papi.commands
        .sendCommand('paratextProjectManager.openHebrewGreekDictionary', term)
        .catch((err) => {
          if (isPapiDisconnectedError(err)) handleCatch(err);
          else console.error(err);
        });
    },
    [handleCatch],
  );

  const navigateToVerse = useCallback(async () => {
    if (!currentRef) return;
    try {
      await papi.commands.sendCommand(
        'paratextProjectManager.navigateToVerse',
        currentRef.projectId,
        currentRef.bookCode,
        currentRef.chapter,
        currentRef.verse,
      );
    } catch (e) {
      if (isPapiDisconnectedError(e)) handleCatch(e);
      else console.error('Failed to jump to verse:', e);
    }
  }, [currentRef, handleCatch]);

  const verseMatchesRaw = currentRef
    ? matches.filter((m) =>
        isVerseInRef(currentRef.bookCode, currentRef.chapter, currentRef.verse, m.reference),
      )
    : [];

  // Apply sort order from settings
  const verseMatches = (() => {
    if (sortOrder === 'default') return verseMatchesRaw;
    const sorted = [...verseMatchesRaw];
    sorted.sort((a, b) => {
      const aFound = a.matchResult?.found ? 1 : 0;
      const bFound = b.matchResult?.found ? 1 : 0;
      if (aFound !== bFound) {
        return sortOrder === 'missing-first' ? aFound - bFound : bFound - aFound;
      }
      // Stable fallback: alphabetical by gloss
      return (a.gloss || '').localeCompare(b.gloss || '');
    });
    return sorted;
  })();

  const foundCount = verseMatchesRaw.filter((m) => m.matchResult?.found).length;
  const missingCount = verseMatchesRaw.length - foundCount;
  const completionPct =
    verseMatchesRaw.length === 0 ? 0 : Math.round((foundCount / verseMatchesRaw.length) * 100);
  const isComplete = completionPct === 100;
  const progressBarColor = isComplete
    ? 'tw:bg-emerald-500'
    : completionPct >= 50
      ? 'tw:bg-amber-500'
      : 'tw:bg-rose-500';
  const statusTextColor = isComplete ? 'tw:text-emerald-600' : 'tw:text-amber-600';
  const statusText = isComplete ? 'Completo' : `${completionPct}% completo`;

  // Text size scale: applies to lemma, gloss, and the suggested-translation chips
  const fontScale = {
    compact: {
      lemma: 'tw:text-sm',
      gloss: 'tw:text-[11px]',
      rend: 'tw:text-[9px]',
      body: 'tw:text-[10px]',
    },
    normal: {
      lemma: 'tw:text-lg',
      gloss: 'tw:text-xs',
      rend: 'tw:text-[10px]',
      body: 'tw:text-[11px]',
    },
    large: { lemma: 'tw:text-xl', gloss: 'tw:text-sm', rend: 'tw:text-xs', body: 'tw:text-sm' },
  }[textSize];

  return (
    <div className="tw:h-full tw:w-full tw:flex tw:flex-col tw:bg-slate-50 tw:text-slate-800">
      {error && <ReconnectBanner error={error} disconnected={disconnected} variant="bar" />}

      {/* Header */}
      <header className="tw:px-5 tw:py-4 tw:bg-white tw:border-b tw:border-slate-200 tw:shrink-0 tw:relative">
        <div
          aria-hidden="true"
          className="tw:absolute tw:left-0 tw:right-0 tw:top-0 tw:h-1 tw:bg-gradient-to-r tw:from-indigo-500 tw:via-violet-500 tw:to-fuchsia-500"
        />
        <div className="tw:flex tw:items-center tw:justify-between tw:gap-3">
          <div className="tw:min-w-0">
            <div className="tw:flex tw:items-center tw:gap-2">
              <span className="tw:text-lg tw:leading-none">✍️</span>
              <h1 className="tw:font-bold tw:text-sm tw:text-slate-800 tw:uppercase tw:tracking-wider tw:truncate">
                Términos para Redactar
              </h1>
            </div>
            {currentRef ? (
              <button
                type="button"
                onClick={navigateToVerse}
                className="tw:mt-1.5 tw:inline-flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-slate-500 tw:hover:text-indigo-600 tw:cursor-pointer tw:bg-transparent tw:border-none tw:p-0"
                title="Ir a este versículo en el Lector de Escritura"
              >
                <span className="tw:font-semibold tw:text-slate-600">
                  {currentRef.bookCode} {currentRef.chapter}:{currentRef.verse}
                </span>
                <span className="tw:text-slate-300">→</span>
                <span className="tw:italic tw:text-slate-400">Lector de Escritura</span>
              </button>
            ) : (
              <p className="tw:mt-1.5 tw:text-xs tw:text-slate-400 tw:italic">
                Esperando selección de versículo…
              </p>
            )}
          </div>

          {currentRef && verseMatches.length > 0 && (
            <div className="tw:text-right tw:shrink-0">
              <div
                className={`tw:text-[10px] tw:font-bold tw:uppercase tw:tracking-wider ${statusTextColor}`}
              >
                {statusText}
              </div>
              <div className="tw:mt-1 tw:w-28 tw:h-1.5 tw:bg-slate-200 tw:rounded-full tw:overflow-hidden">
                <div
                  className={`tw:h-full tw:rounded-full tw:transition-all tw:duration-500 ${progressBarColor}`}
                  style={{ width: `${completionPct}%` }}
                />
              </div>
              <div className="tw:mt-1 tw:text-[10px] tw:text-slate-400">
                <span className="tw:text-emerald-600 tw:font-semibold">{foundCount}</span>
                <span className="tw:mx-1 tw:text-slate-300">·</span>
                <span className="tw:text-rose-600 tw:font-semibold">{missingCount}</span>
              </div>
            </div>
          )}

          {/* Hamburger menu with filter / display settings */}
          <div className="tw:relative tw:shrink-0" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className={`tw:p-1.5 tw:rounded-md tw:transition-colors tw:cursor-pointer tw:flex tw:items-center tw:justify-center tw:border ${
                menuOpen
                  ? 'tw:bg-indigo-50 tw:text-indigo-600 tw:border-indigo-100'
                  : 'tw:text-slate-600 hover:tw:bg-slate-100 hover:tw:text-slate-800 tw:border-transparent'
              }`}
              title="Ajustes de visualización"
              aria-label="Ajustes de visualización"
              aria-expanded={menuOpen}
            >
              <svg
                className="tw:w-5 tw:h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>

            {menuOpen && (
              <div
                className="tw:absolute tw:right-0 tw:top-full tw:mt-1.5 tw:w-72 tw:bg-white tw:border tw:border-slate-200 tw:rounded-xl tw:shadow-2xl tw:overflow-hidden tw:text-sm"
                style={{ zIndex: 10000 }}
              >
                {/* Sort section */}
                <div className="tw:px-4 tw:pt-3.5 tw:pb-2">
                  <div className="tw:text-[10px] tw:font-bold tw:uppercase tw:tracking-wider tw:text-slate-400 tw:mb-1.5">
                    Orden de los términos
                  </div>
                  {(
                    [
                      { id: 'missing-first', label: 'Faltantes primero' },
                      { id: 'found-first', label: 'Usados primero' },
                      { id: 'default', label: 'Orden original' },
                    ] as { id: SortOrder; label: string }[]
                  ).map((opt) => (
                    <button
                      type="button"
                      key={opt.id}
                      onClick={() => {
                        setSortOrder(opt.id);
                        localStorage.setItem('drafting_terms_sort', opt.id);
                      }}
                      className={`tw:w-full tw:flex tw:items-center tw:gap-2 tw:px-2.5 tw:py-1.5 tw:rounded-lg tw:text-left tw:cursor-pointer tw:transition-colors tw:border-none ${
                        sortOrder === opt.id
                          ? 'tw:bg-indigo-50 tw:text-indigo-700 tw:font-semibold'
                          : 'tw:bg-transparent tw:text-slate-700 hover:tw:bg-slate-50'
                      }`}
                    >
                      <span className="tw:w-4 tw:h-4 tw:inline-flex tw:items-center tw:justify-center tw:text-indigo-600">
                        {sortOrder === opt.id ? '●' : ''}
                      </span>
                      <span className="tw:flex-1">{opt.label}</span>
                    </button>
                  ))}
                </div>

                <div className="tw:h-px tw:bg-slate-100" />

                {/* Text size section */}
                <div className="tw:px-4 tw:pt-3.5 tw:pb-3.5">
                  <div className="tw:text-[10px] tw:font-bold tw:uppercase tw:tracking-wider tw:text-slate-400 tw:mb-1.5">
                    Tamaño del texto
                  </div>
                  <div className="tw:flex tw:items-center tw:justify-between tw:px-2.5 tw:py-1.5">
                    <span className="tw:font-medium tw:text-slate-700">Tamaño</span>
                    <div className="tw:flex tw:items-center tw:gap-1">
                      {(
                        [
                          { id: 'compact', label: 'A-' },
                          { id: 'normal', label: 'A' },
                          { id: 'large', label: 'A+' },
                        ] as { id: TextSize; label: string }[]
                      ).map((opt, i) => (
                        <button
                          type="button"
                          key={opt.id}
                          onClick={() => {
                            setTextSize(opt.id);
                            localStorage.setItem('drafting_terms_text_size', opt.id);
                          }}
                          className={`tw:w-7 tw:h-7 tw:flex tw:items-center tw:justify-center tw:rounded-md tw:cursor-pointer tw:transition-colors tw:border ${
                            textSize === opt.id
                              ? 'tw:bg-indigo-100 tw:text-indigo-700 tw:border-indigo-200 tw:font-bold'
                              : 'tw:bg-slate-100 hover:tw:bg-slate-200 tw:text-slate-700 tw:border-transparent'
                          } ${i === 0 ? 'tw:text-[10px]' : i === 1 ? 'tw:text-xs' : 'tw:text-sm'}`}
                          title={
                            opt.id === 'compact'
                              ? 'Compacto'
                              : opt.id === 'normal'
                                ? 'Normal'
                                : 'Grande'
                          }
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="tw:flex-grow tw:overflow-y-auto scrollbar-thin tw:bg-slate-50">
        {!currentRef ? (
          <div className="tw:h-full tw:flex tw:flex-col tw:items-center tw:justify-center tw:px-6 tw:text-center">
            {!bootstrapped ? (
              <div className="tw:text-slate-400 tw:text-xs dt-pulse-soft">Cargando…</div>
            ) : (
              <EmptyBody projectMissing={projectMissing} />
            )}
          </div>
        ) : loading && verseMatches.length === 0 ? (
          <div className="tw:h-full tw:flex tw:items-center tw:justify-center tw:text-slate-400 tw:text-xs dt-pulse-soft">
            Escaneando capítulo…
          </div>
        ) : verseMatches.length === 0 ? (
          <div className="tw:px-6 tw:py-12 tw:text-center tw:text-slate-400 tw:text-xs tw:italic">
            No hay términos clave registrados para{' '}
            <span className="tw:font-semibold tw:text-slate-500 tw:not-italic">
              {currentRef.bookCode} {currentRef.chapter}:{currentRef.verse}
            </span>
            .
          </div>
        ) : (
          <div className="tw:p-4 tw:space-y-4">
            <div className="tw:px-1 tw:text-[10.5px] tw:font-bold tw:text-slate-500 tw:uppercase tw:tracking-wider">
              Términos requeridos en {currentRef.bookCode} {currentRef.chapter}:{currentRef.verse}
            </div>
            <div className="tw:px-1 tw:-mt-2 tw:text-[10px] tw:text-slate-400 tw:italic">
              Arrastra una palabra del Lector de Escritura sobre un término, o usa “＋ Agregar
              traducción”.
            </div>

            <div className="tw:space-y-2.5">
              {verseMatches.map((m) => {
                const found = m.matchResult?.found;
                return (
                  <article
                    key={m.termId}
                    onDragOver={(e) => {
                      if (
                        e.dataTransfer?.types?.includes('application/x-paratext-rendering') ||
                        e.dataTransfer?.types?.includes('text/plain')
                      ) {
                        e.preventDefault();
                        setDropActiveTermId(m.termId);
                      }
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      setDropActiveTermId((cur) => (cur === m.termId ? null : cur));
                    }}
                    onDrop={(e) => handleDropOnTerm(m.termId, e)}
                    className={`tw:relative tw:bg-white tw:p-3.5 tw:pl-4 tw:rounded-xl tw:border tw:shadow-sm tw:transition-all hover:tw:shadow-md ${
                      found ? 'tw:border-emerald-200' : 'tw:border-rose-200'
                    } ${dropActiveTermId === m.termId ? 'tw:ring-2 tw:ring-indigo-400 tw:bg-indigo-50/40' : ''}`}
                  >
                    <div
                      aria-hidden="true"
                      className={`tw:absolute tw:left-0 tw:top-2 tw:bottom-2 tw:w-1 tw:rounded-r-full ${
                        found ? 'tw:bg-emerald-500' : 'tw:bg-rose-500'
                      }`}
                    />

                    <div className="tw:flex tw:items-start tw:justify-between tw:gap-2">
                      <div className="tw:min-w-0 tw:flex-1">
                        {/* Lemma (Hebrew/Greek) — shown FIRST and prominently */}
                        <button
                          type="button"
                          onClick={() => openDictionary(m.lemma)}
                          className={`tw:text-left tw:font-bold ${fontScale.lemma} tw:text-slate-800 hover:tw:text-indigo-600 hover:tw:underline tw:cursor-pointer tw:bg-transparent tw:border-none tw:p-0 tw:font-serif tw:tracking-wide tw:block tw:w-full tw:break-words`}
                          title={`Buscar definición: ${m.lemma}`}
                          dir="rtl"
                        >
                          {m.lemma}
                        </button>
                        {/* Gloss — secondary, italic, indigo accent */}
                        <div
                          className={`${fontScale.gloss} tw:text-indigo-600 tw:italic tw:mt-1 tw:font-medium`}
                        >
                          {m.gloss}
                        </div>
                      </div>

                      {found ? (
                        <span className="tw:text-[10px] tw:bg-emerald-50 tw:text-emerald-700 tw:px-2 tw:py-0.5 tw:border tw:border-emerald-200 tw:rounded-full tw:font-semibold tw:whitespace-nowrap tw:shrink-0">
                          ✓ Usado
                        </span>
                      ) : (
                        <span className="tw:text-[10px] tw:bg-rose-50 tw:text-rose-700 tw:px-2 tw:py-0.5 tw:border tw:border-rose-200 tw:rounded-full tw:font-semibold tw:whitespace-nowrap tw:shrink-0">
                          ✗ Faltante
                        </span>
                      )}
                    </div>

                    <div className={`tw:mt-2.5 ${fontScale.body} tw:text-slate-500`}>
                      <div className="tw:font-semibold">Traducciones sugeridas:</div>
                      {m.expectedRenderings && m.expectedRenderings.length > 0 ? (
                        <div className="tw:flex tw:flex-wrap tw:gap-1 tw:mt-1">
                          {m.expectedRenderings.map((r) => (
                            <span
                              key={`${m.termId}-${r}`}
                              className={`${fontScale.rend} tw:bg-indigo-50 tw:text-indigo-700 tw:px-1.5 tw:py-0.5 tw:rounded tw:border tw:border-indigo-100`}
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="tw:italic tw:text-slate-400">Ninguna registrada</span>
                      )}
                    </div>

                    <div className="tw:mt-2.5 tw:pt-2.5 tw:border-t tw:border-slate-100 tw:flex tw:items-center tw:justify-between tw:gap-2 tw:flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          setAddingRenderingFor(addingRenderingFor === m.termId ? null : m.termId);
                          setNewRenderingText('');
                        }}
                        className={`${fontScale.body} tw:font-semibold tw:text-emerald-600 hover:tw:text-emerald-800 hover:tw:underline tw:cursor-pointer tw:bg-transparent tw:border-none tw:inline-flex tw:items-center tw:gap-1`}
                      >
                        ＋ Agregar traducción
                      </button>
                      <button
                        type="button"
                        onClick={() => openKeyTermsFor(m.termId)}
                        className={`${fontScale.body} tw:font-semibold tw:text-indigo-600 hover:tw:text-indigo-800 hover:tw:underline tw:cursor-pointer tw:bg-transparent tw:border-none tw:inline-flex tw:items-center tw:gap-1`}
                      >
                        Editar en Términos Clave
                        <span aria-hidden="true">→</span>
                      </button>
                    </div>

                    {addingRenderingFor === m.termId && (
                      <div className="tw:mt-2 tw:flex tw:items-center tw:gap-1.5">
                        <input
                          autoFocus
                          type="text"
                          value={newRenderingText}
                          onChange={(e) => setNewRenderingText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void submitInlineRendering(m.termId);
                            } else if (e.key === 'Escape') {
                              setAddingRenderingFor(null);
                              setNewRenderingText('');
                            }
                          }}
                          placeholder="Escribe o pega la traducción usada…"
                          className="tw:flex-1 tw:min-w-0 tw:px-2 tw:py-1 tw:text-xs tw:bg-white tw:text-slate-800 tw:border tw:border-slate-300 tw:rounded-lg tw:focus:outline-none tw:focus:ring-2 tw:focus:ring-indigo-500/40 tw:focus:border-indigo-400"
                        />
                        <button
                          type="button"
                          onClick={() => void submitInlineRendering(m.termId)}
                          className="tw:px-2.5 tw:py-1 tw:text-xs tw:font-semibold tw:bg-indigo-600 tw:text-white tw:rounded-lg hover:tw:bg-indigo-700 tw:cursor-pointer tw:border-none"
                        >
                          Guardar
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="tw:px-4 tw:py-2 tw:bg-white tw:border-t tw:border-slate-200 tw:text-[10px] tw:text-slate-400 tw:flex tw:items-center tw:justify-between tw:shrink-0">
        <span>
          {currentRef
            ? `Sincronizado con ${currentRef.bookCode} ${currentRef.chapter}:${currentRef.verse}`
            : 'En espera de selección…'}
        </span>
        {currentRef && (
          <button
            type="button"
            onClick={navigateToVerse}
            className="tw:text-indigo-600 hover:tw:underline tw:font-semibold tw:cursor-pointer tw:bg-transparent tw:border-none"
          >
            Ir al versículo
          </button>
        )}
      </footer>
    </div>
  );
};
