import { WebViewProps } from '@papi/core';
import papi from '@papi/frontend';
import { useDialogCallback } from '@papi/frontend/react';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Menu,
  X,
  Search,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  ChevronUp,
  ChevronDown,
  Plus,
  Trash2,
  AlertTriangle,
  Languages,
  Check,
  CircleX,
  BookOpen,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';
import { papiRetry } from './utils/papi-retry';
import { useLocalizedStrings } from './utils/i18n';
import type {
  KeyTermsStore,
  KeyTerm,
  Rendering,
  RenderingStatus,
  VerseMatchStatus,
  MorphologyConfig,
  AffixRule,
} from './types/key-terms.types';

globalThis.webViewComponent = function KeyTermsWebView({
  projectId,
  useWebViewState,
  updateWebViewDefinition,
}: WebViewProps) {
  const [lang, setLang] = useWebViewState<string>('lang', 'es');
  const { tx, toggleLang } = useLocalizedStrings(lang, setLang, 'verifier');

  // Key Terms Store state
  const [store, setStore] = useState<KeyTermsStore | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!error) return undefined;
    const timer = setTimeout(() => setError(''), 15000);
    return () => clearTimeout(timer);
  }, [error]);
  const [saving, setSaving] = useState(false);

  const [selectedTermId, setSelectedTermId] = useWebViewState<string>('selectedTermId', '');

  // UI states
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDomain, setFilterDomain] = useState('all');
  const [filterCompletion, setFilterCompletion] = useState<
    'all' | 'complete' | 'missing' | 'partial'
  >('all');
  const [newRenderingText, setNewRenderingText] = useState('');
  const [newContextTags, setNewContextTags] = useState<Record<string, string>>({});
  const [newNoteText, setNewNoteText] = useState('');
  const [currentUser, setCurrentUser] = useState('Traductor');

  const rightPanelRef = useRef<HTMLDivElement | null>(null);
  const isExternalSelectionRef = useRef(false);

  const selectTerm = useCallback(
    (id: string, isExternal = false) => {
      isExternalSelectionRef.current = isExternal;
      setSelectedTermId(id);
    },
    [setSelectedTermId],
  );

  // Sidebar resizable width & persistence
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const selectedButtonRef = useRef<HTMLButtonElement | null>(null);
  const sidebarListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (rightPanelRef.current) {
      rightPanelRef.current.scrollTop = 0;
    }
  }, [selectedTermId]);

  useEffect(() => {
    if (selectedTermId && selectedButtonRef.current && sidebarListRef.current) {
      if (isExternalSelectionRef.current) {
        isExternalSelectionRef.current = false;
        const container = sidebarListRef.current;
        const btn = selectedButtonRef.current;
        const containerTop = container.scrollTop;
        const containerBottom = containerTop + container.clientHeight;
        const btnTop = btn.offsetTop;
        const btnBottom = btnTop + btn.offsetHeight;
        if (btnTop < containerTop || btnBottom > containerBottom) {
          container.scrollTop = btnTop - container.clientHeight / 2 + btn.offsetHeight / 2;
        }
      }
    }
  }, [selectedTermId]);

  useEffect(() => {
    setNewContextTags({});
  }, [selectedTermId]);

  // External selection events
  useEffect(() => {
    if (!papi.network || !papi.network.getNetworkEvent) return undefined;
    const unsubscribe = papi.network.getNetworkEvent<any>('paratextProjectManager.onSelectKeyTerm')(
      (event) => {
        if (event && event.termId) {
          if (event.projectId && event.projectId !== projectId) {
            updateWebViewDefinition({ projectId: event.projectId });
          }
          selectTerm(event.termId, true);
        }
      },
    );
    return () => {
      unsubscribe();
    };
  }, [projectId, setSelectedTermId, updateWebViewDefinition, selectTerm]);

  // Collapsible panels
  const [morphPanelOpen, setMorphPanelOpen] = useState(false);
  const [collabPanelOpen, setCollabPanelOpen] = useState(false);

  // Morphology Rule Editor states
  const [newPrefix, setNewPrefix] = useState('');
  const [newPrefixLabel, setNewPrefixLabel] = useState('');
  const [newSuffix, setNewSuffix] = useState('');
  const [newSuffixLabel, setNewSuffixLabel] = useState('');
  const [newInfix, setNewInfix] = useState('');
  const [newInfixLabel, setNewInfixLabel] = useState('');

  // Scanning results
  const [verseMatches, setVerseMatches] = useState<Record<string, VerseMatchStatus>>({});
  const [scanning, setScanning] = useState(false);

  const selectProject = useDialogCallback(
    'platform.selectProject',
    useMemo(
      () => ({
        title: tx('selectProjectTitle'),
        prompt: tx('selectProjectPrompt'),
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
    try {
      const dataStr = await papiRetry(
        () => papi.commands.sendCommand('paratextProjectManager.getKeyTermsData', projectId),
        { isCancelled: () => !isCurrentRequest() },
      );
      if (!isCurrentRequest()) return;
      const parsed = JSON.parse(dataStr) as KeyTermsStore;
      setStore(parsed);

      const user = await papiRetry(
        () => papi.commands.sendCommand('paratextProjectManager.getCurrentUser'),
        { isCancelled: () => !isCurrentRequest() },
      );
      if (!isCurrentRequest()) return;
      if (user) setCurrentUser(user);
    } catch (e: any) {
      if (isCurrentRequest()) setError(tx('errorLoading', e.message || String(e)));
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [projectId, tx]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const persistStore = useCallback(
    async (updated: KeyTermsStore) => {
      if (!projectId) return;
      setSaving(true);
      setStore(updated);
      try {
        await papi.commands.sendCommand(
          'paratextProjectManager.saveKeyTermsData',
          projectId,
          JSON.stringify(updated, null, 2),
        );
      } catch (e: any) {
        setError(tx('errorSaving', e.message || String(e)));
      } finally {
        setSaving(false);
      }
    },
    [projectId, tx],
  );

  const scanChapterRequestRef = useRef(0);

  const scanChapter = useCallback(async () => {
    if (!projectId || !store || !selectedTermId) return;
    const requestId = ++scanChapterRequestRef.current;
    const isCurrentRequest = () => requestId === scanChapterRequestRef.current;
    const term = store.terms.find((t) => t.id === selectedTermId);
    if (!term || term.references.length === 0) return;

    setScanning(true);
    try {
      const chaptersToScan = new Set<string>();
      for (const ref of term.references) {
        const parts = ref.split(' ');
        if (parts.length >= 2) {
          const book = parts[0];
          const chap = parts[1].split(':')[0];
          chaptersToScan.add(`${book} ${chap}`);
        }
      }

      const newMatches: Record<string, VerseMatchStatus> = { ...verseMatches };

      const scanPromises = Array.from(chaptersToScan).map(async (bkChap) => {
        const [book, chapStr] = bkChap.split(' ');
        const chapter = parseInt(chapStr, 10);
        try {
          const res = (await papi.commands.sendCommand(
            'paratextProjectManager.scanChapterRenderings',
            projectId,
            book,
            chapter,
          )) as string;
          const parsed = JSON.parse(res) as { matches: VerseMatchStatus[] };
          if (parsed && parsed.matches) {
            for (const match of parsed.matches) {
              newMatches[`${match.termId}-${match.reference}`] = match;
            }
          }
        } catch (e) {
          console.warn('scanChapter failed for', bkChap, e);
        }
      });

      await Promise.all(scanPromises);
      if (isCurrentRequest()) setVerseMatches(newMatches);
    } catch (e) {
      console.warn('scanChapter error', e);
    } finally {
      if (isCurrentRequest()) setScanning(false);
    }
  }, [projectId, store, selectedTermId, verseMatches]);

  useEffect(() => {
    if (selectedTermId) {
      scanChapter();
    }
  }, [selectedTermId, scanChapter]);

  const handleVerseClick = useCallback(
    async (ref: string) => {
      if (!projectId) return;
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
          verse,
        );
      } catch (e) {
        console.error('Failed to navigate to verse:', e);
      }
    },
    [projectId],
  );

  const handleMorphologyChange = useCallback(
    async (updates: Partial<MorphologyConfig>) => {
      if (!store) return;
      const updatedStore = {
        ...store,
        morphologyConfig: {
          ...store.morphologyConfig,
          ...updates,
        },
      };
      await persistStore(updatedStore);
      setTimeout(scanChapter, 300);
    },
    [store, persistStore, scanChapter],
  );

  const addAffixRule = useCallback(
    async (
      type: 'prefix' | 'suffix' | 'infix',
      affix: string,
      label: string,
      defaultLabel: string,
      clearAffix: () => void,
      clearLabel: () => void,
    ) => {
      if (!store || !affix.trim()) return;
      const newRule: AffixRule = {
        id: `${type[0]}-${Date.now()}`,
        affix: affix.trim(),
        label: label.trim() || defaultLabel,
        enabled: true,
      };
      const key = type === 'prefix' ? 'prefixes' : type === 'suffix' ? 'suffixes' : 'infixes';
      const updatedStore = {
        ...store,
        morphologyConfig: {
          ...store.morphologyConfig,
          [key]: [...((store.morphologyConfig as any)[key] || []), newRule],
        },
      };
      clearAffix();
      clearLabel();
      await persistStore(updatedStore);
      setTimeout(scanChapter, 300);
    },
    [store, persistStore, scanChapter],
  );

  const addPrefixRule = useCallback(
    () => addAffixRule('prefix', newPrefix, newPrefixLabel, 'Prefijo', () => setNewPrefix(''), () => setNewPrefixLabel('')),
    [addAffixRule, newPrefix, newPrefixLabel],
  );
  const addSuffixRule = useCallback(
    () => addAffixRule('suffix', newSuffix, newSuffixLabel, 'Sufijo', () => setNewSuffix(''), () => setNewSuffixLabel('')),
    [addAffixRule, newSuffix, newSuffixLabel],
  );
  const addInfixRule = useCallback(
    () => addAffixRule('infix', newInfix, newInfixLabel, 'Infijo', () => setNewInfix(''), () => setNewInfixLabel('')),
    [addAffixRule, newInfix, newInfixLabel],
  );

  const toggleRule = useCallback(
    async (ruleId: string, type: 'prefix' | 'suffix' | 'infix') => {
      if (!store) return;
      const config = store.morphologyConfig;
      const key = type === 'prefix' ? 'prefixes' : type === 'suffix' ? 'suffixes' : 'infixes';
      const updated = ((config as any)[key] || []).map((r: AffixRule) =>
        r.id === ruleId ? { ...r, enabled: !r.enabled } : r,
      );
      await persistStore({ ...store, morphologyConfig: { ...config, [key]: updated } });
      setTimeout(scanChapter, 300);
    },
    [store, persistStore, scanChapter],
  );

  const deleteRule = useCallback(
    async (ruleId: string, type: 'prefix' | 'suffix' | 'infix') => {
      if (!store) return;
      const config = store.morphologyConfig;
      const key = type === 'prefix' ? 'prefixes' : type === 'suffix' ? 'suffixes' : 'infixes';
      const updated = ((config as any)[key] || []).filter((r: AffixRule) => r.id !== ruleId);
      await persistStore({ ...store, morphologyConfig: { ...config, [key]: updated } });
      setTimeout(scanChapter, 300);
    },
    [store, persistStore, scanChapter],
  );

  const selectedTerm = useMemo(() => {
    if (!store || !selectedTermId) return null;
    return store.terms.find((t) => t.id === selectedTermId) || null;
  }, [store, selectedTermId]);

  const addRendering = useCallback(async () => {
    if (!store || !selectedTermId || !newRenderingText.trim()) return;
    const now = new Date().toISOString();
    const newRend: Rendering = {
      id: `r-${Date.now()}`,
      text: newRenderingText.trim(),
      status: 'proposed',
      contextTags: [],
      votes: [],
      proposedBy: currentUser,
      createdAt: now,
      updatedAt: now,
    };

    const terms = store.terms.map((t) => {
      if (t.id === selectedTermId) {
        return {
          ...t,
          renderings: [...(t.renderings || []), newRend],
          updatedAt: now,
        };
      }
      return t;
    });

    setNewRenderingText('');
    await persistStore({ ...store, terms });
    setTimeout(scanChapter, 300);
  }, [store, selectedTermId, newRenderingText, currentUser, persistStore, scanChapter]);

  const updateRenderingStatus = useCallback(
    async (renderingId: string, status: RenderingStatus) => {
      if (!store || !selectedTermId) return;
      const now = new Date().toISOString();
      const terms = store.terms.map((t) => {
        if (t.id === selectedTermId) {
          const renderings = t.renderings.map((r) =>
            r.id === renderingId ? { ...r, status, updatedAt: now } : r,
          );
          return { ...t, renderings, updatedAt: now };
        }
        return t;
      });
      await persistStore({ ...store, terms });
      setTimeout(scanChapter, 300);
    },
    [store, selectedTermId, persistStore, scanChapter],
  );

  const voteRendering = useCallback(
    async (renderingId: string, value: 'up' | 'down') => {
      if (!store || !selectedTermId) return;
      const now = new Date().toISOString();
      const terms = store.terms.map((t) => {
        if (t.id === selectedTermId) {
          const renderings = t.renderings.map((r) => {
            if (r.id === renderingId) {
              const existingVote = (r.votes || []).find((v) => v.user === currentUser);
              const cleanVotes = (r.votes || []).filter((v) => v.user !== currentUser);
              const shouldRetract = existingVote && existingVote.value === value;
              const updatedVotes = shouldRetract
                ? cleanVotes
                : [...cleanVotes, { user: currentUser, value, timestamp: now }];
              return { ...r, votes: updatedVotes, updatedAt: now };
            }
            return r;
          });
          return { ...t, renderings, updatedAt: now };
        }
        return t;
      });
      await persistStore({ ...store, terms });
    },
    [store, selectedTermId, currentUser, persistStore],
  );

  const addContextTag = useCallback(
    async (renderingId: string) => {
      const rawTag = newContextTags[renderingId] || '';
      if (!store || !selectedTermId || !rawTag.trim()) return;
      const now = new Date().toISOString();
      const tag = rawTag.trim().toLowerCase();
      const terms = store.terms.map((t) => {
        if (t.id === selectedTermId) {
          const renderings = t.renderings.map((r) => {
            if (r.id === renderingId) {
              const contextTags = Array.from(new Set([...(r.contextTags || []), tag]));
              return { ...r, contextTags, updatedAt: now };
            }
            return r;
          });
          return { ...t, renderings, updatedAt: now };
        }
        return t;
      });
      setNewContextTags((prev) => ({ ...prev, [renderingId]: '' }));
      await persistStore({ ...store, terms });
    },
    [store, selectedTermId, newContextTags, persistStore],
  );

  const removeContextTag = useCallback(
    async (renderingId: string, tag: string) => {
      if (!store || !selectedTermId) return;
      const now = new Date().toISOString();
      const terms = store.terms.map((t) => {
        if (t.id === selectedTermId) {
          const renderings = t.renderings.map((r) => {
            if (r.id === renderingId) {
              const contextTags = (r.contextTags || []).filter((tt) => tt !== tag);
              return { ...r, contextTags, updatedAt: now };
            }
            return r;
          });
          return { ...t, renderings, updatedAt: now };
        }
        return t;
      });
      await persistStore({ ...store, terms });
    },
    [store, selectedTermId, persistStore],
  );

  const addNote = useCallback(async () => {
    if (!store || !selectedTermId || !newNoteText.trim()) return;
    const now = new Date().toISOString();
    const newNote = {
      id: `n-${Date.now()}`,
      author: currentUser,
      text: newNoteText.trim(),
      timestamp: now,
    };
    const terms = store.terms.map((t) => {
      if (t.id === selectedTermId) {
        return {
          ...t,
          notes: [...(t.notes || []), newNote],
          updatedAt: now,
        };
      }
      return t;
    });
    setNewNoteText('');
    await persistStore({ ...store, terms });
  }, [store, selectedTermId, newNoteText, currentUser, persistStore]);

  const allDomains = useMemo(() => {
    if (!store) return [];
    const domainsSet = new Set<string>();
    for (const term of store.terms) {
      if (term.domains) {
        for (const dom of term.domains) {
          domainsSet.add(dom);
        }
      }
    }
    return Array.from(domainsSet).sort();
  }, [store]);

  const getTermStatus = useCallback(
    (term: KeyTerm): 'complete' | 'missing' | 'partial' => {
      const approved = term.renderings
        ? term.renderings.filter((r) => r.status === 'approved')
        : [];
      if (approved.length === 0) return 'missing';

      let allFound = true;
      let hasScan = false;
      for (const ref of term.references) {
        const match = verseMatches[`${term.id}-${ref}`];
        if (match) {
          hasScan = true;
          if (!match.matchResult.found) {
            allFound = false;
          }
        }
      }
      if (hasScan && !allFound) return 'partial';
      return 'complete';
    },
    [verseMatches],
  );

  const filteredTerms = useMemo(() => {
    if (!store) return [];
    return store.terms
      .filter((t) => {
        const q = searchTerm.toLowerCase().trim();
        if (q) {
          const glossMatch = t.gloss.toLowerCase().includes(q);
          const lemmaMatch = t.lemma.toLowerCase().includes(q);
          const strongMatch = t.strongs && t.strongs.toLowerCase().includes(q);
          const translitMatch = t.transliteration && t.transliteration.toLowerCase().includes(q);
          if (!glossMatch && !lemmaMatch && !strongMatch && !translitMatch) return false;
        }
        if (filterDomain !== 'all' && (!t.domains || !t.domains.includes(filterDomain))) {
          return false;
        }
        const status = getTermStatus(t);
        if (filterCompletion !== 'all' && status !== filterCompletion) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.gloss.localeCompare(b.gloss));
  }, [store, searchTerm, filterDomain, filterCompletion, getTermStatus]);

  const completionStats = useMemo(() => {
    if (!store || store.terms.length === 0)
      return { percent: 0, missing: 0, partial: 0, complete: 0 };
    let missing = 0;
    let partial = 0;
    let complete = 0;
    for (const t of store.terms) {
      const s = getTermStatus(t);
      if (s === 'missing') missing += 1;
      else if (s === 'partial') partial += 1;
      else complete += 1;
    }
    const percent = Math.round((complete / store.terms.length) * 100);
    return { percent, missing, partial, complete };
  }, [store, getTermStatus]);

  // Render: empty / loading states
  if (!projectId) {
    return (
      <div className="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:p-8 tw:text-center tw:gap-4 tw:text-sm tw:bg-background tw:text-foreground">
        <div className="tw:p-4 tw:bg-card tw:rounded-full tw:border tw:border-border tw:text-muted-foreground">
          <BookOpen size={36} />
        </div>
        <p className="tw:text-muted-foreground">{tx('selectProjectEmpty')}</p>
        <button
          type="button"
          className="tw:inline-flex tw:items-center tw:gap-2 tw:px-4 tw:py-2 tw:bg-primary tw:text-primary-foreground tw:rounded-lg hover:tw:opacity-90 tw:cursor-pointer tw:font-semibold tw:shadow-sm tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:focus-visible:ring-offset-2 tw:focus-visible:ring-offset-background"
          onClick={() => selectProject()}
        >
          {tx('selectProject')}
        </button>
      </div>
    );
  }

  if (loading && !store) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:gap-4 tw:bg-background tw:text-foreground"
      >
        <div className="tw:flex tw:items-center tw:gap-3">
          <div className="tw:w-2 tw:h-2 tw:bg-primary tw:rounded-full tw:animate-ping" />
          <div className="tw:w-2 tw:h-2 tw:bg-primary tw:rounded-full tw:animate-pulse" />
          <div className="tw:w-2 tw:h-2 tw:bg-primary tw:rounded-full tw:animate-pulse tw:[animation-delay:0.2s]" />
        </div>
        <span className="tw:text-sm tw:text-muted-foreground tw:font-medium">
          {tx('loading')}
        </span>
      </div>
    );
  }

  // Filter tab config (localized)
  const filterTabs: { key: typeof filterCompletion; label: string }[] = [
    { key: 'all', label: tx('filterAll') },
    { key: 'complete', label: tx('filterComplete') },
    { key: 'partial', label: tx('filterPartial') },
    { key: 'missing', label: tx('filterMissing') },
  ];

  // Status badge styling (semantic colors that read well in both themes)
  const statusBadge = (status: 'complete' | 'missing' | 'partial') => {
    if (status === 'complete') {
      return {
        cls: 'tw:bg-emerald-500/15 tw:text-emerald-700 dark:tw:text-emerald-400 tw:border tw:border-emerald-500/30',
        text: tx('statusComplete'),
      };
    }
    if (status === 'partial') {
      return {
        cls: 'tw:bg-amber-500/15 tw:text-amber-700 dark:tw:text-amber-400 tw:border tw:border-amber-500/30',
        text: tx('statusPartial'),
      };
    }
    return {
      cls: 'tw:bg-destructive/15 tw:text-destructive tw:border tw:border-destructive/30',
      text: tx('statusMissing'),
    };
  };

  return (
    <div className="tw:flex tw:h-full tw:bg-background tw:text-foreground tw:font-sans">
      {/* Sidebar - Terms list */}
      {sidebarVisible && (
        <aside
          aria-label="Key terms list"
          style={{ width: `${sidebarWidth}px` }}
          className="tw:bg-card tw:border-r tw:border-border tw:flex tw:flex-col tw:h-full tw:flex-shrink-0"
        >
          <div className="tw:p-3 tw:border-b tw:border-border tw:space-y-2.5">
            <div className="tw:flex tw:items-center tw:justify-between tw:gap-2">
              <span className="tw:font-bold tw:text-sm tw:text-foreground tw:truncate">
                {tx('title')}
              </span>
              <button
                type="button"
                onClick={loadData}
                title={tx('refresh')}
                aria-label={tx('refresh')}
                className="tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-muted-foreground hover:tw:text-primary tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:rounded"
              >
                <RefreshCw size={12} />
              </button>
            </div>

            {/* Search Input */}
            <div className="tw:relative">
              <Search
                size={12}
                className="tw:absolute tw:left-2.5 tw:top-1/2 tw:-translate-y-1/2 tw:text-muted-foreground tw:pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                placeholder={tx('searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="tw:w-full tw:border tw:border-border tw:rounded-lg tw:pl-7 tw:pr-7 tw:py-1.5 tw:text-xs tw:bg-background tw:text-foreground tw:placeholder:tw:text-muted-foreground tw:focus:outline-none tw:focus:border-primary tw:focus:ring-1 tw:focus:ring-primary"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  aria-label="Clear search"
                  className="tw:absolute tw:right-2 tw:top-1/2 tw:-translate-y-1/2 tw:text-muted-foreground hover:tw:text-foreground tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:rounded"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Semantic Domain Filter */}
            <div className="tw:flex tw:flex-col tw:gap-1">
              <label className="tw:text-[10px] tw:text-muted-foreground tw:font-semibold tw:uppercase">
                {tx('semanticDomain')}
              </label>
              <select
                value={filterDomain}
                onChange={(e) => setFilterDomain(e.target.value)}
                className="tw:w-full tw:border tw:border-border tw:rounded-lg tw:px-2 tw:py-1 tw:text-xs tw:bg-background tw:text-foreground tw:focus:outline-none tw:focus:ring-1 tw:focus:ring-primary"
              >
                <option value="all">{tx('allDomains')}</option>
                {allDomains.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            {/* Completion Filter */}
            <div className="tw:flex tw:gap-1 tw:flex-wrap">
              {filterTabs.map((opt) => (
                <button
                  type="button"
                  key={opt.key}
                  onClick={() => setFilterCompletion(opt.key)}
                  aria-pressed={filterCompletion === opt.key}
                  className={`tw:flex-1 tw:min-w-[60px] tw:py-0.5 tw:px-1.5 tw:text-[10px] tw:rounded-md tw:border tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring ${
                    filterCompletion === opt.key
                      ? 'tw:bg-primary/15 tw:text-primary tw:border-primary/30 tw:font-medium'
                      : 'tw:bg-card tw:text-muted-foreground tw:border-border hover:tw:bg-accent'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Status legend (always visible) */}
            <div
              aria-label="Status legend"
              className="tw:flex tw:items-center tw:gap-2 tw:flex-wrap tw:pt-1 tw:text-[9px] tw:text-muted-foreground"
            >
              <span className="tw:inline-flex tw:items-center tw:gap-1">
                <span className="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-emerald-500" />
                {tx('statusComplete')}
              </span>
              <span className="tw:inline-flex tw:items-center tw:gap-1">
                <span className="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-amber-500" />
                {tx('statusPartial')}
              </span>
              <span className="tw:inline-flex tw:items-center tw:gap-1">
                <span className="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-destructive" />
                {tx('statusMissing')}
              </span>
            </div>

            {/* Micro stats bar */}
            <div className="tw:pt-1 tw:text-[10px] tw:text-muted-foreground tw:flex tw:justify-between tw:flex-wrap tw:gap-1">
              <span>{tx('completed', String(completionStats.percent))}</span>
              <span>
                {tx('termsCount', String(filteredTerms.length), String(store?.terms.length || 0))}
              </span>
            </div>
          </div>

          {/* List area */}
          <div
            ref={sidebarListRef}
            className="tw:flex-1 tw:overflow-y-auto tw:divide-y tw:divide-border"
          >
            {filteredTerms.map((term) => {
              const status = getTermStatus(term);
              const isSelected = term.id === selectedTermId;
              const badge = statusBadge(status);
              return (
                <button
                  type="button"
                  key={term.id}
                  ref={isSelected ? selectedButtonRef : null}
                  onClick={() => selectTerm(term.id, false)}
                  aria-current={isSelected ? 'true' : undefined}
                  className={`tw:w-full tw:text-left tw:p-3 tw:flex tw:flex-col tw:gap-1.5 tw:transition-colors tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring ${
                    isSelected ? 'tw:bg-primary/10' : 'hover:tw:bg-accent'
                  }`}
                >
                  <div className="tw:flex tw:items-start tw:justify-between tw:gap-2 tw:min-w-0">
                    <span className="tw:font-semibold tw:text-sm tw:text-foreground tw:truncate">
                      {term.gloss}
                    </span>
                    <span
                      className={`tw:flex-shrink-0 tw:text-[9px] tw:px-1.5 tw:py-0.5 tw:rounded-full tw:font-medium ${badge.cls}`}
                    >
                      {badge.text}
                    </span>
                  </div>
                  <div className="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:text-xs tw:text-muted-foreground tw:min-w-0">
                    <span className="tw:font-serif tw:truncate">{term.lemma}</span>
                    {term.strongs && (
                      <span className="tw:font-mono tw:text-[10px] tw:flex-shrink-0">
                        {term.strongs}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}

            {filteredTerms.length === 0 && (
              <div className="tw:p-4 tw:text-center tw:text-xs tw:text-muted-foreground">
                {tx('emptyList')}
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Resizer */}
      {sidebarVisible && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          tabIndex={0}
          className="tw:w-1 tw:cursor-col-resize tw:bg-border hover:tw:bg-primary/50 tw:transition-colors tw:h-full tw:flex-shrink-0 tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-primary"
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = sidebarWidth;
            const handleMouseMove = (moveEvent: MouseEvent) => {
              const currentWidth = startWidth + (moveEvent.clientX - startX);
              setSidebarWidth(Math.max(200, Math.min(600, currentWidth)));
            };
            const handleMouseUp = () => {
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);
            };
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              setSidebarWidth((w) => Math.max(200, w - 16));
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              setSidebarWidth((w) => Math.min(600, w + 16));
            }
          }}
        />
      )}

      {/* Main panel - Detail view */}
      <div className="tw:flex-1 tw:flex tw:flex-col tw:h-full tw:overflow-hidden tw:min-w-0">
        {/* Top toolbar */}
        <div className="tw:px-3 sm:tw:px-4 tw:py-3 tw:bg-card tw:border-b tw:border-border tw:flex tw:items-center tw:justify-between tw:gap-2 tw:flex-wrap">
          <div className="tw:flex tw:items-center tw:gap-2 sm:tw:gap-3 tw:min-w-0 tw:flex-1">
            <button
              type="button"
              onClick={() => setSidebarVisible((v) => !v)}
              title={sidebarVisible ? tx('toggleSidebarHide') : tx('toggleSidebarShow')}
              aria-label={sidebarVisible ? tx('toggleSidebarHide') : tx('toggleSidebarShow')}
              className="tw:p-1.5 tw:rounded-md tw:text-muted-foreground hover:tw:bg-accent tw:cursor-pointer tw:flex-shrink-0 tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
            >
              <Menu size={18} />
            </button>
            <span className="tw:font-bold tw:text-foreground tw:truncate tw:text-sm sm:tw:text-base">
              {tx('title')}
            </span>
          </div>

          <div className="tw:flex tw:items-center tw:gap-2 sm:tw:gap-3 tw:flex-wrap">
            {saving && (
              <span
                role="status"
                aria-live="polite"
                className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-muted-foreground"
              >
                <span className="tw:w-1.5 tw:h-1.5 tw:bg-primary tw:rounded-full tw:animate-pulse" />
                <span className="tw:hidden sm:tw:inline">{tx('saving')}</span>
              </span>
            )}
            <button
              type="button"
              onClick={toggleLang}
              title={tx('toggleLanguage')}
              aria-label={tx('toggleLanguage')}
              className="tw:inline-flex tw:items-center tw:gap-1 tw:px-2 tw:py-1.5 tw:bg-card tw:border tw:border-border tw:rounded-md tw:text-xs tw:font-semibold tw:text-muted-foreground hover:tw:bg-accent tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
            >
              <Languages size={12} />
              <span className="tw:uppercase">{lang}</span>
            </button>
            <button
              type="button"
              className="tw:inline-flex tw:items-center tw:gap-1.5 tw:px-2.5 sm:tw:px-3 tw:py-1.5 tw:bg-primary/10 tw:text-primary tw:border tw:border-primary/20 tw:rounded-lg tw:text-xs tw:font-medium hover:tw:bg-primary/20 tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
              onClick={() => selectProject()}
            >
              {tx('changeProject')}
            </button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="tw:bg-destructive/10 tw:border-b tw:border-destructive/30 tw:px-3 sm:tw:px-4 tw:py-2 tw:text-destructive tw:text-xs tw:font-medium tw:flex tw:justify-between tw:items-center tw:gap-2"
          >
            <span className="tw:flex tw:items-center tw:gap-2 tw:min-w-0 tw:truncate">
              <AlertTriangle size={14} className="tw:flex-shrink-0" />
              <span className="tw:truncate">{error}</span>
            </span>
            <button
              type="button"
              onClick={loadData}
              className="tw:text-destructive tw:underline hover:tw:opacity-80 tw:cursor-pointer tw:flex-shrink-0 tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:rounded"
            >
              ({tx('retry')})
            </button>
          </div>
        )}

        {/* Workspace area */}
        {selectedTerm ? (
          <div ref={rightPanelRef} className="tw:flex-1 tw:overflow-y-auto tw:p-3 sm:tw:p-4 tw:space-y-4 tw:min-w-0">
            {/* Term Summary Card */}
            <div className="tw:bg-card tw:p-4 tw:rounded-xl tw:border tw:border-border tw:shadow-sm tw:space-y-3">
              <div className="tw:flex tw:items-start tw:justify-between tw:gap-3 tw:min-w-0">
                <div className="tw:min-w-0 tw:flex-1">
                  <h2 className="tw:text-xl tw:font-bold tw:text-foreground tw:break-words">
                    {selectedTerm.gloss}
                  </h2>
                  <div className="tw:flex tw:items-center tw:gap-2 tw:mt-1 tw:flex-wrap">
                    <span className="tw:font-serif tw:text-lg tw:text-primary tw:break-all">
                      {selectedTerm.lemma}
                    </span>
                    {selectedTerm.transliteration && (
                      <span className="tw:text-sm tw:text-muted-foreground tw:italic tw:break-words">
                        ({selectedTerm.transliteration})
                      </span>
                    )}
                  </div>
                </div>
                {selectedTerm.strongs && (
                  <span className="tw:px-2.5 tw:py-1 tw:bg-secondary tw:text-secondary-foreground tw:rounded-md tw:text-xs tw:font-mono tw:flex-shrink-0">
                    {selectedTerm.strongs}
                  </span>
                )}
              </div>

              {selectedTerm.domains && selectedTerm.domains.length > 0 && (
                <div className="tw:flex tw:gap-1.5 tw:flex-wrap">
                  {selectedTerm.domains.map((dom) => (
                    <span
                      key={dom}
                      className="tw:text-[10px] tw:px-2 tw:py-0.5 tw:bg-primary/10 tw:text-primary tw:rounded-md tw:font-semibold tw:uppercase"
                    >
                      {dom}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Renderings Card */}
            <div className="tw:bg-card tw:p-4 tw:rounded-xl tw:border tw:border-border tw:shadow-sm tw:space-y-4">
              <h3 className="tw:font-bold tw:text-sm tw:text-foreground tw:uppercase tw:tracking-wider">
                {tx('renderingsTitle')}
              </h3>

              <div className="tw:flex tw:gap-2 tw:flex-wrap sm:tw:flex-nowrap">
                <input
                  type="text"
                  placeholder={tx('addRenderingPlaceholder')}
                  value={newRenderingText}
                  onChange={(e) => setNewRenderingText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addRendering()}
                  className="tw:flex-1 tw:min-w-0 tw:border tw:border-border tw:rounded-lg tw:px-3 tw:py-2 tw:text-xs tw:bg-background tw:text-foreground tw:placeholder:tw:text-muted-foreground tw:focus:outline-none tw:focus:ring-1 tw:focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={addRendering}
                  className="tw:inline-flex tw:items-center tw:gap-1 tw:px-4 tw:py-2 tw:bg-primary tw:text-primary-foreground tw:rounded-lg tw:text-xs tw:font-medium hover:tw:opacity-90 tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
                >
                  <Plus size={12} />
                  {tx('add')}
                </button>
              </div>

              <div className="tw:space-y-3">
                {selectedTerm.renderings &&
                  selectedTerm.renderings.map((rend, rendIdx) => {
                    const rendId =
                      rend.id || `rend-${selectedTermId}-${rendIdx}-${rend.text.slice(0, 8)}`;
                    const upVotes = rend.votes
                      ? rend.votes.filter((v) => v.value === 'up').length
                      : 0;
                    const downVotes = rend.votes
                      ? rend.votes.filter((v) => v.value === 'down').length
                      : 0;
                    const hasUpvoted =
                      rend.votes &&
                      rend.votes.some((v) => v.user === currentUser && v.value === 'up');
                    const hasDownvoted =
                      rend.votes &&
                      rend.votes.some((v) => v.user === currentUser && v.value === 'down');

                    return (
                      <div
                        key={rendId}
                        className="tw:p-3 tw:bg-secondary tw:rounded-lg tw:border tw:border-border tw:space-y-2"
                      >
                        <div className="tw:flex tw:items-start tw:justify-between tw:gap-3 tw:min-w-0">
                          <div className="tw:space-y-1 tw:min-w-0 tw:flex-1">
                            <span className="tw:font-bold tw:text-sm tw:text-foreground tw:break-words tw:block">
                              {rend.text}
                            </span>
                            <div className="tw:flex tw:items-center tw:gap-1.5 tw:flex-wrap">
                              <span className="tw:text-[10px] tw:text-muted-foreground">
                                {tx('proposedBy', rend.proposedBy)}
                              </span>
                            </div>
                          </div>

                          <select
                            value={rend.status}
                            onChange={(e) =>
                              updateRenderingStatus(rendId, e.target.value as RenderingStatus)
                            }
                            aria-label="Rendering status"
                            className={`tw:flex-shrink-0 tw:text-xs tw:px-2 tw:py-1 tw:rounded-md tw:border tw:font-medium tw:focus:outline-none tw:focus:ring-1 tw:focus:ring-primary ${
                              rend.status === 'approved'
                                ? 'tw:bg-emerald-500/15 tw:text-emerald-700 dark:tw:text-emerald-400 tw:border-emerald-500/30'
                                : rend.status === 'disputed'
                                  ? 'tw:bg-destructive/15 tw:text-destructive tw:border-destructive/30'
                                  : rend.status === 'proposed'
                                    ? 'tw:bg-amber-500/15 tw:text-amber-700 dark:tw:text-amber-400 tw:border-amber-500/30'
                                    : 'tw:bg-secondary tw:text-secondary-foreground tw:border-border'
                            }`}
                          >
                            <option value="draft">{tx('statusDraft')}</option>
                            <option value="proposed">{tx('statusProposed')}</option>
                            <option value="disputed">{tx('statusDisputed')}</option>
                            <option value="approved">{tx('statusApproved')}</option>
                          </select>
                        </div>

                        <div className="tw:flex tw:items-center tw:justify-between tw:pt-1 tw:gap-2 tw:flex-wrap">
                          <div className="tw:flex tw:items-center tw:gap-2">
                            <button
                              type="button"
                              onClick={() => voteRendering(rendId, 'up')}
                              aria-label="Up vote"
                              aria-pressed={hasUpvoted}
                              className={`tw:inline-flex tw:items-center tw:gap-1 tw:px-2 tw:py-1 tw:rounded-md tw:border tw:text-xs tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring ${
                                hasUpvoted
                                  ? 'tw:bg-primary/10 tw:text-primary tw:border-primary/30'
                                  : 'tw:bg-card tw:text-muted-foreground tw:border-border hover:tw:bg-accent'
                              }`}
                            >
                              <ThumbsUp size={12} />
                              <span className="tw:font-semibold">{upVotes}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => voteRendering(rendId, 'down')}
                              aria-label="Down vote"
                              aria-pressed={hasDownvoted}
                              className={`tw:inline-flex tw:items-center tw:gap-1 tw:px-2 tw:py-1 tw:rounded-md tw:border tw:text-xs tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring ${
                                hasDownvoted
                                  ? 'tw:bg-destructive/10 tw:text-destructive tw:border-destructive/30'
                                  : 'tw:bg-card tw:text-muted-foreground tw:border-border hover:tw:bg-accent'
                              }`}
                            >
                              <ThumbsDown size={12} />
                              <span className="tw:font-semibold">{downVotes}</span>
                            </button>
                          </div>

                          <div className="tw:flex tw:items-center tw:gap-1 tw:flex-wrap">
                            {rend.contextTags &&
                              rend.contextTags.map((tag) => (
                                <span
                                  key={tag}
                                  className="tw:inline-flex tw:items-center tw:gap-1 tw:text-[10px] tw:bg-secondary tw:text-secondary-foreground tw:rounded tw:px-1.5 tw:py-0.5 tw:font-medium"
                                >
                                  #{tag}
                                  <button
                                    type="button"
                                    onClick={() => removeContextTag(rendId, tag)}
                                    aria-label={`Remove tag ${tag}`}
                                    className="tw:text-muted-foreground hover:tw:text-foreground tw:font-bold tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-ring tw:rounded"
                                  >
                                    <X size={10} />
                                  </button>
                                </span>
                              ))}
                            <div className="tw:flex tw:gap-1">
                              <input
                                type="text"
                                placeholder={tx('tagPlaceholder')}
                                value={newContextTags[rendId] || ''}
                                onChange={(e) =>
                                  setNewContextTags((prev) => ({
                                    ...prev,
                                    [rendId]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => e.key === 'Enter' && addContextTag(rendId)}
                                aria-label="Add context tag"
                                className="tw:border tw:border-border tw:rounded tw:px-1 tw:py-0.5 tw:text-[10px] tw:w-16 tw:bg-background tw:text-foreground tw:focus:outline-none tw:focus:ring-1 tw:focus:ring-primary"
                              />
                              <button
                                type="button"
                                onClick={() => addContextTag(rendId)}
                                aria-label="Add tag"
                                className="tw:inline-flex tw:items-center tw:justify-center tw:px-1.5 tw:bg-secondary tw:rounded tw:text-[10px] tw:hover:tw:bg-accent tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-ring"
                              >
                                <Plus size={10} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                {(!selectedTerm.renderings || selectedTerm.renderings.length === 0) && (
                  <div className="tw:text-xs tw:text-muted-foreground tw:text-center tw:py-4 tw:italic">
                    {tx('noRenderings')}
                  </div>
                )}
              </div>
            </div>

            {/* Expected Verse References List */}
            <div className="tw:bg-card tw:p-4 tw:rounded-xl tw:border tw:border-border tw:shadow-sm tw:space-y-3">
              <div className="tw:flex tw:items-center tw:justify-between tw:flex-wrap tw:gap-2">
                <h3 className="tw:font-bold tw:text-sm tw:text-foreground tw:uppercase tw:tracking-wider">
                  {tx('expectedPassages')}
                </h3>
                {scanning && (
                  <span
                    role="status"
                    aria-live="polite"
                    className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-muted-foreground"
                  >
                    <RefreshCw size={12} className="tw:animate-spin" />
                    {tx('scanning')}
                  </span>
                )}
              </div>

              <div className="tw:divide-y tw:divide-border tw:max-h-72 tw:overflow-y-auto">
                {selectedTerm.references &&
                  selectedTerm.references.map((ref) => {
                    const match = verseMatches[`${selectedTerm.id}-${ref}`];
                    let badge: React.ReactElement;
                    if (match?.matchResult.found) {
                      badge = (
                        <span className="tw:inline-flex tw:items-center tw:gap-1 tw:px-2 tw:py-0.5 tw:bg-emerald-500/15 tw:text-emerald-700 dark:tw:text-emerald-400 tw:border tw:border-emerald-500/30 tw:rounded-md tw:text-[10px] tw:font-semibold">
                          <Check size={10} />
                          {tx('found', match.matchResult.matchedText || '')}
                        </span>
                      );
                    } else if (match) {
                      badge = (
                        <span className="tw:inline-flex tw:items-center tw:gap-1 tw:px-2 tw:py-0.5 tw:bg-destructive/15 tw:text-destructive tw:border tw:border-destructive/30 tw:rounded-md tw:text-[10px] tw:font-semibold">
                          <CircleX size={10} />
                          {tx('missing')}
                        </span>
                      );
                    } else {
                      badge = (
                        <span className="tw:px-2 tw:py-0.5 tw:bg-secondary tw:text-muted-foreground tw:rounded-md tw:text-[10px]">
                          {tx('notScanned')}
                        </span>
                      );
                    }
                    return (
                      <div
                        key={ref}
                        className="tw:py-2 tw:flex tw:items-center tw:justify-between tw:gap-3 tw:min-w-0"
                      >
                        <button
                          type="button"
                          onClick={() => handleVerseClick(ref)}
                          className="tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-primary tw:font-semibold hover:tw:underline tw:cursor-pointer tw:text-left tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-ring tw:rounded"
                        >
                          <ChevronRight size={12} />
                          {ref}
                        </button>
                        {badge}
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Morphology Configuration Panel */}
            <div className="tw:bg-card tw:rounded-xl tw:border tw:border-border tw:shadow-sm tw:overflow-hidden">
              <button
                type="button"
                onClick={() => setMorphPanelOpen((o) => !o)}
                aria-expanded={morphPanelOpen}
                className="tw:w-full tw:px-4 tw:py-3 tw:bg-secondary tw:flex tw:items-center tw:justify-between tw:cursor-pointer tw:border-b tw:border-border hover:tw:bg-accent tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
              >
                <span className="tw:font-bold tw:text-xs tw:text-muted-foreground tw:uppercase tw:tracking-wider">
                  {tx('morphologyTitle')}
                </span>
                {morphPanelOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {morphPanelOpen && store && (
                <div className="tw:p-4 tw:space-y-4">
                  <div className="tw:grid tw:grid-cols-1 md:tw:grid-cols-2 tw:gap-4">
                    <div className="tw:space-y-1">
                      <label className="tw:text-xs tw:font-semibold tw:text-muted-foreground">
                        {tx('languageName')}
                      </label>
                      <input
                        type="text"
                        value={store.morphologyConfig.languageName || ''}
                        onChange={(e) =>
                          handleMorphologyChange({ languageName: e.target.value })
                        }
                        className="tw:w-full tw:border tw:border-border tw:rounded-lg tw:px-2.5 tw:py-1.5 tw:text-xs tw:bg-background tw:text-foreground tw:focus:outline-none tw:focus:ring-1 tw:focus:ring-primary"
                      />
                    </div>

                    <div className="tw:space-y-2">
                      <label className="tw:flex tw:items-center tw:gap-2 tw:text-xs tw:font-semibold tw:text-muted-foreground tw:cursor-pointer">
                        <input
                          type="checkbox"
                          checked={store.morphologyConfig.enableFuzzyMatch}
                          onChange={(e) =>
                            handleMorphologyChange({ enableFuzzyMatch: e.target.checked })
                          }
                          className="tw:cursor-pointer"
                        />
                        {tx('fuzzyMatch')}
                      </label>

                      {store.morphologyConfig.enableFuzzyMatch && (
                        <div className="tw:flex tw:items-center tw:gap-3">
                          <span className="tw:text-xs tw:text-muted-foreground">
                            {tx('maxDistance')}
                          </span>
                          <input
                            type="range"
                            min="1"
                            max="4"
                            value={store.morphologyConfig.maxEditDistance || 2}
                            onChange={(e) =>
                              handleMorphologyChange({
                                maxEditDistance: parseInt(e.target.value, 10),
                              })
                            }
                            className="tw:w-20 tw:cursor-pointer"
                          />
                          <span className="tw:text-xs tw:font-bold tw:text-foreground tw:min-w-4">
                            {store.morphologyConfig.maxEditDistance || 2}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="tw:grid tw:grid-cols-1 md:tw:grid-cols-2 lg:tw:grid-cols-3 tw:gap-4 tw:pt-2">
                    {(
                      [
                        {
                          key: 'prefixes',
                          title: tx('prefixes'),
                          placeholder: tx('prefixPlaceholder'),
                          list: store.morphologyConfig.prefixes,
                          add: addPrefixRule,
                          type: 'prefix' as const,
                          value: newPrefix,
                          setValue: setNewPrefix,
                          labelValue: newPrefixLabel,
                          setLabelValue: setNewPrefixLabel,
                        },
                        {
                          key: 'suffixes',
                          title: tx('suffixes'),
                          placeholder: tx('suffixPlaceholder'),
                          list: store.morphologyConfig.suffixes,
                          add: addSuffixRule,
                          type: 'suffix' as const,
                          value: newSuffix,
                          setValue: setNewSuffix,
                          labelValue: newSuffixLabel,
                          setLabelValue: setNewSuffixLabel,
                        },
                        {
                          key: 'infixes',
                          title: tx('infixes'),
                          placeholder: tx('infixPlaceholder'),
                          list: store.morphologyConfig.infixes,
                          add: addInfixRule,
                          type: 'infix' as const,
                          value: newInfix,
                          setValue: setNewInfix,
                          labelValue: newInfixLabel,
                          setLabelValue: setNewInfixLabel,
                        },
                      ] as const
                    ).map((column) => (
                      <div key={column.key} className="tw:space-y-2 tw:min-w-0">
                        <span className="tw:font-bold tw:text-xs tw:text-foreground">
                          {column.title}
                        </span>

                        <div className="tw:flex tw:gap-1">
                          <input
                            type="text"
                            placeholder={column.placeholder}
                            value={column.value}
                            onChange={(e) => column.setValue(e.target.value)}
                            aria-label={column.title}
                            className="tw:w-16 tw:flex-shrink-0 tw:border tw:border-border tw:rounded-lg tw:px-2 tw:py-1 tw:text-xs tw:bg-background tw:text-foreground tw:focus:outline-none tw:focus:ring-1 tw:focus:ring-primary"
                          />
                          <input
                            type="text"
                            placeholder={tx('labelPlaceholder')}
                            value={column.labelValue}
                            onChange={(e) => column.setLabelValue(e.target.value)}
                            aria-label={`${column.title} label`}
                            className="tw:flex-1 tw:min-w-0 tw:border tw:border-border tw:rounded-lg tw:px-2 tw:py-1 tw:text-xs tw:bg-background tw:text-foreground tw:focus:outline-none tw:focus:ring-1 tw:focus:ring-primary"
                          />
                          <button
                            type="button"
                            onClick={column.add}
                            aria-label={`Add ${column.type}`}
                            className="tw:inline-flex tw:items-center tw:justify-center tw:px-2.5 tw:py-1 tw:bg-primary tw:text-primary-foreground tw:rounded-lg tw:text-xs hover:tw:opacity-90 tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
                          >
                            <Plus size={12} />
                          </button>
                        </div>

                        <div className="tw:space-y-1 tw:max-h-36 tw:overflow-y-auto">
                          {column.list &&
                            column.list.map((rule) => (
                              <div
                                key={rule.id}
                                className="tw:flex tw:items-center tw:justify-between tw:p-1.5 tw:bg-secondary tw:rounded tw:text-xs tw:gap-2"
                              >
                                <label className="tw:flex tw:items-center tw:gap-2 tw:cursor-pointer tw:min-w-0 tw:flex-1">
                                  <input
                                    type="checkbox"
                                    checked={rule.enabled}
                                    onChange={() => toggleRule(rule.id, column.type)}
                                  />
                                  <span className="tw:font-bold tw:text-foreground tw:truncate">
                                    {rule.affix}
                                  </span>
                                  <span className="tw:text-muted-foreground tw:truncate">
                                    ({rule.label})
                                  </span>
                                </label>
                                <button
                                  type="button"
                                  onClick={() => deleteRule(rule.id, column.type)}
                                  aria-label={`Delete ${column.type} rule`}
                                  className="tw:text-muted-foreground hover:tw:text-destructive tw:flex-shrink-0 tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-ring tw:rounded"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Collaborative notes panel */}
            <div className="tw:bg-card tw:rounded-xl tw:border tw:border-border tw:shadow-sm tw:overflow-hidden">
              <button
                type="button"
                onClick={() => setCollabPanelOpen((o) => !o)}
                aria-expanded={collabPanelOpen}
                className="tw:w-full tw:px-4 tw:py-3 tw:bg-secondary tw:flex tw:items-center tw:justify-between tw:cursor-pointer tw:border-b tw:border-border hover:tw:bg-accent tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
              >
                <span className="tw:font-bold tw:text-xs tw:text-muted-foreground tw:uppercase tw:tracking-wider">
                  {tx('collabNotesTitle')}
                </span>
                {collabPanelOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {collabPanelOpen && (
                <div className="tw:p-4 tw:space-y-4">
                  <div className="tw:space-y-2.5 tw:max-h-60 tw:overflow-y-auto">
                    {selectedTerm.notes &&
                      selectedTerm.notes.map((note) => (
                        <div
                          key={note.id}
                          className="tw:p-2.5 tw:bg-secondary tw:rounded-lg tw:border tw:border-border tw:space-y-1"
                        >
                          <div className="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:text-[10px] tw:text-muted-foreground">
                            <span className="tw:font-bold tw:text-foreground tw:truncate">
                              {note.author}
                            </span>
                            <span className="tw:flex-shrink-0">
                              {new Date(note.timestamp).toLocaleString(
                                lang === 'en' ? 'en' : 'es',
                              )}
                            </span>
                          </div>
                          <p className="tw:text-xs tw:text-foreground tw:whitespace-pre-wrap tw:break-words">
                            {note.text}
                          </p>
                        </div>
                      ))}
                    {(!selectedTerm.notes || selectedTerm.notes.length === 0) && (
                      <div className="tw:text-xs tw:text-muted-foreground tw:text-center tw:py-4 tw:italic">
                        {tx('noNotes')}
                      </div>
                    )}
                  </div>

                  <div className="tw:space-y-2">
                    <textarea
                      placeholder={tx('notesPlaceholder')}
                      value={newNoteText}
                      onChange={(e) => setNewNoteText(e.target.value)}
                      rows={2}
                      className="tw:w-full tw:border tw:border-border tw:rounded-lg tw:px-2.5 tw:py-1.5 tw:text-xs tw:bg-background tw:text-foreground tw:placeholder:tw:text-muted-foreground tw:focus:outline-none tw:focus:ring-1 tw:focus:ring-primary tw:resize-y"
                    />
                    <div className="tw:flex tw:justify-end">
                      <button
                        type="button"
                        onClick={addNote}
                        className="tw:inline-flex tw:items-center tw:gap-1 tw:px-3 tw:py-1.5 tw:bg-primary tw:text-primary-foreground tw:rounded-lg tw:text-xs tw:font-medium hover:tw:opacity-90 tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
                      >
                        <CheckCircle2 size={12} />
                        {tx('sendNote')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="tw:flex-1 tw:flex tw:flex-col tw:items-center tw:justify-center tw:text-muted-foreground tw:text-sm tw:gap-3 tw:p-8 tw:text-center">
            <div className="tw:p-4 tw:bg-card tw:rounded-full tw:border tw:border-border">
              <BookOpen size={32} />
            </div>
            <p className="tw:max-w-xs">{tx('selectTermPrompt')}</p>
          </div>
        )}
      </div>
    </div>
  );
};
