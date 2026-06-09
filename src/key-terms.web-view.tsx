import { WebViewProps } from '@papi/core';
import papi from '@papi/frontend';
import { useDialogCallback } from '@papi/frontend/react';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type {
  KeyTermsStore,
  KeyTerm,
  Rendering,
  RenderingStatus,
  VerseMatchStatus,
  MorphologyConfig,
  AffixRule,
} from './types/key-terms.types';
import { BIBLE_BOOKS, type BibleBook } from './types/shared.constants';

globalThis.webViewComponent = function KeyTermsWebView({
  projectId,
  useWebViewState,
  updateWebViewDefinition,
}: WebViewProps) {
  // Key Terms Store state
  const [store, setStore] = useState<KeyTermsStore | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Selected Term ID
  const [selectedTermId, setSelectedTermId] = useWebViewState<string>('selectedTermId', '');
  
  // UI states
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDomain, setFilterDomain] = useState('all');
  const [filterCompletion, setFilterCompletion] = useState<'all' | 'complete' | 'missing' | 'partial'>('all');
  const [newRenderingText, setNewRenderingText] = useState('');
  const [newContextTags, setNewContextTags] = useState<Record<string, string>>({});
  const [newNoteText, setNewNoteText] = useState('');
  const [currentUser, setCurrentUser] = useState('Traductor');

  // Sidebar resizable width & selected button scroll tracking
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const selectedButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (selectedTermId && selectedButtonRef.current) {
      selectedButtonRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedTermId]);

  // Listen to external key term selection events
  useEffect(() => {
    if (!papi.network || !papi.network.getNetworkEvent) return undefined;
    const unsubscribe = papi.network.getNetworkEvent<any>('paratextProjectManager.onSelectKeyTerm')((event) => {
      if (event && event.projectId === projectId && event.termId) {
        setSelectedTermId(event.termId);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [projectId, setSelectedTermId]);

  // Sidebar visibility
  const [sidebarVisible, setSidebarVisible] = useState(true);

  // Collapsible panels
  const [morphPanelOpen, setMorphPanelOpen] = useState(false);
  const [collabPanelOpen, setCollabPanelOpen] = useState(false);

  // Morphology Rule Editor states
  const [newPrefix, setNewPrefix] = useState('');
  const [newPrefixLabel, setNewPrefixLabel] = useState('');
  const [newSuffix, setNewSuffix] = useState('');
  const [newSuffixLabel, setNewSuffixLabel] = useState('');

  // Scanning results
  const [verseMatches, setVerseMatches] = useState<Record<string, VerseMatchStatus>>({});
  const [scanning, setScanning] = useState(false);

  // Dialog to select project
  const selectProject = useDialogCallback(
    'platform.selectProject',
    useMemo(
      () => ({
        title: 'Seleccionar Proyecto',
        prompt: 'Elige un proyecto para verificar términos clave:',
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

  // Load key terms data from backend
  const loadData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    try {
      const dataStr = await papi.commands.sendCommand('paratextProjectManager.getKeyTermsData', projectId);
      const parsed = JSON.parse(dataStr) as KeyTermsStore;
      setStore(parsed);

      const user = await papi.commands.sendCommand('paratextProjectManager.getCurrentUser');
      if (user) setCurrentUser(user);
    } catch (e: any) {
      setError(`Error al cargar datos de términos clave: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Persist updated store to backend
  const persistStore = useCallback(async (updated: KeyTermsStore) => {
    if (!projectId) return;
    setSaving(true);
    setStore(updated); // Optimistic update
    try {
      await papi.commands.sendCommand(
        'paratextProjectManager.saveKeyTermsData',
        projectId,
        JSON.stringify(updated, null, 2)
      );
    } catch (e: any) {
      setError(`Error al guardar datos: ${e.message || e}`);
    } finally {
      setSaving(false);
    }
  }, [projectId]);

  // Periodic scan of the current book/chapter to update match status checkboxes
  const scanChapter = useCallback(async () => {
    if (!projectId || !store || !selectedTermId) return;
    const term = store.terms.find(t => t.id === selectedTermId);
    if (!term || term.references.length === 0) return;

    setScanning(true);
    try {
      // Find all chapters we need to scan for this term
      const chaptersToScan = new Set<string>(); // Format: "BOOK C"
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
          const res = await papi.commands.sendCommand(
            'paratextProjectManager.scanChapterRenderings',
            projectId,
            book,
            chapter
          ) as string;
          const parsed = JSON.parse(res) as { matches: VerseMatchStatus[] };
          if (parsed && parsed.matches) {
            for (const match of parsed.matches) {
              newMatches[`${match.termId}-${match.reference}`] = match;
            }
          }
        } catch (_) {}
      });

      await Promise.all(scanPromises);
      setVerseMatches(newMatches);
    } catch (_) {
    } finally {
      setScanning(false);
    }
  }, [projectId, store, selectedTermId, verseMatches]);

  useEffect(() => {
    if (selectedTermId) {
      scanChapter();
    }
  }, [selectedTermId]);

  // Navigate to specific verse reference
  const handleVerseClick = useCallback(async (ref: string) => {
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
        verse
      );
    } catch (e) {
      console.error('Failed to navigate to verse:', e);
    }
  }, [projectId]);

  // Modify morphology config
  const handleMorphologyChange = useCallback(async (updates: Partial<MorphologyConfig>) => {
    if (!store) return;
    const updatedStore = {
      ...store,
      morphologyConfig: {
        ...store.morphologyConfig,
        ...updates
      }
    };
    await persistStore(updatedStore);
  }, [store, persistStore]);

  // Add Prefix Affix Rule
  const addPrefixRule = useCallback(async () => {
    if (!store || !newPrefix.trim()) return;
    const newRule: AffixRule = {
      id: `p-${Date.now()}`,
      affix: newPrefix.trim(),
      label: newPrefixLabel.trim() || 'Prefijo',
      enabled: true
    };
    const updatedStore = {
      ...store,
      morphologyConfig: {
        ...store.morphologyConfig,
        prefixes: [...(store.morphologyConfig.prefixes || []), newRule]
      }
    };
    setNewPrefix('');
    setNewPrefixLabel('');
    await persistStore(updatedStore);
  }, [store, newPrefix, newPrefixLabel, persistStore]);

  // Add Suffix Affix Rule
  const addSuffixRule = useCallback(async () => {
    if (!store || !newSuffix.trim()) return;
    const newRule: AffixRule = {
      id: `s-${Date.now()}`,
      affix: newSuffix.trim(),
      label: newSuffixLabel.trim() || 'Sufijo',
      enabled: true
    };
    const updatedStore = {
      ...store,
      morphologyConfig: {
        ...store.morphologyConfig,
        suffixes: [...(store.morphologyConfig.suffixes || []), newRule]
      }
    };
    setNewSuffix('');
    setNewSuffixLabel('');
    await persistStore(updatedStore);
  }, [store, newSuffix, newSuffixLabel, persistStore]);

  // Toggle Affix Rule
  const toggleRule = useCallback(async (ruleId: string, type: 'prefix' | 'suffix') => {
    if (!store) return;
    const config = store.morphologyConfig;
    if (type === 'prefix') {
      const prefixes = (config.prefixes || []).map(r => r.id === ruleId ? { ...r, enabled: !r.enabled } : r);
      await persistStore({ ...store, morphologyConfig: { ...config, prefixes } });
    } else {
      const suffixes = (config.suffixes || []).map(r => r.id === ruleId ? { ...r, enabled: !r.enabled } : r);
      await persistStore({ ...store, morphologyConfig: { ...config, suffixes } });
    }
  }, [store, persistStore]);

  // Delete Affix Rule
  const deleteRule = useCallback(async (ruleId: string, type: 'prefix' | 'suffix') => {
    if (!store) return;
    const config = store.morphologyConfig;
    if (type === 'prefix') {
      const prefixes = (config.prefixes || []).filter(r => r.id !== ruleId);
      await persistStore({ ...store, morphologyConfig: { ...config, prefixes } });
    } else {
      const suffixes = (config.suffixes || []).filter(r => r.id !== ruleId);
      await persistStore({ ...store, morphologyConfig: { ...config, suffixes } });
    }
  }, [store, persistStore]);

  // Selected term details
  const selectedTerm = useMemo(() => {
    if (!store || !selectedTermId) return null;
    return store.terms.find(t => t.id === selectedTermId) || null;
  }, [store, selectedTermId]);

  // Add a rendering to selected term
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
      updatedAt: now
    };

    const terms = store.terms.map(t => {
      if (t.id === selectedTermId) {
        return {
          ...t,
          renderings: [...(t.renderings || []), newRend],
          updatedAt: now
        };
      }
      return t;
    });

    setNewRenderingText('');
    await persistStore({ ...store, terms });
    setTimeout(scanChapter, 300);
  }, [store, selectedTermId, newRenderingText, currentUser, persistStore, scanChapter]);

  // Change rendering status
  const updateRenderingStatus = useCallback(async (renderingId: string, status: RenderingStatus) => {
    if (!store || !selectedTermId) return;
    const now = new Date().toISOString();
    const terms = store.terms.map(t => {
      if (t.id === selectedTermId) {
        const renderings = t.renderings.map(r => 
          r.id === renderingId ? { ...r, status, updatedAt: now } : r
        );
        return { ...t, renderings, updatedAt: now };
      }
      return t;
    });
    await persistStore({ ...store, terms });
    setTimeout(scanChapter, 300);
  }, [store, selectedTermId, persistStore, scanChapter]);

  // Vote on rendering
  const voteRendering = useCallback(async (renderingId: string, value: 'up' | 'down') => {
    if (!store || !selectedTermId) return;
    const now = new Date().toISOString();
    const terms = store.terms.map(t => {
      if (t.id === selectedTermId) {
        const renderings = t.renderings.map(r => {
          if (r.id === renderingId) {
            // Remove existing vote by user if any
            const cleanVotes = (r.votes || []).filter(v => v.user !== currentUser);
            const newVote = { user: currentUser, value, timestamp: now };
            return {
              ...r,
              votes: [...cleanVotes, newVote],
              updatedAt: now
            };
          }
          return r;
        });
        return { ...t, renderings, updatedAt: now };
      }
      return t;
    });
    await persistStore({ ...store, terms });
  }, [store, selectedTermId, currentUser, persistStore]);

  // Add context tag to rendering
  const addContextTag = useCallback(async (renderingId: string) => {
    const rawTag = newContextTags[renderingId] || '';
    if (!store || !selectedTermId || !rawTag.trim()) return;
    const now = new Date().toISOString();
    const tag = rawTag.trim().toLowerCase();
    
    const terms = store.terms.map(t => {
      if (t.id === selectedTermId) {
        const renderings = t.renderings.map(r => {
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

    setNewContextTags(prev => ({ ...prev, [renderingId]: '' }));
    await persistStore({ ...store, terms });
  }, [store, selectedTermId, newContextTags, persistStore]);

  // Remove context tag from rendering
  const removeContextTag = useCallback(async (renderingId: string, tag: string) => {
    if (!store || !selectedTermId) return;
    const now = new Date().toISOString();
    const terms = store.terms.map(t => {
      if (t.id === selectedTermId) {
        const renderings = t.renderings.map(r => {
          if (r.id === renderingId) {
            const contextTags = (r.contextTags || []).filter(t => t !== tag);
            return { ...r, contextTags, updatedAt: now };
          }
          return r;
        });
        return { ...t, renderings, updatedAt: now };
      }
      return t;
    });
    await persistStore({ ...store, terms });
  }, [store, selectedTermId, persistStore]);

  // Add Note to key term
  const addNote = useCallback(async () => {
    if (!store || !selectedTermId || !newNoteText.trim()) return;
    const now = new Date().toISOString();
    const newNote = {
      id: `n-${Date.now()}`,
      author: currentUser,
      text: newNoteText.trim(),
      timestamp: now
    };

    const terms = store.terms.map(t => {
      if (t.id === selectedTermId) {
        return {
          ...t,
          notes: [...(t.notes || []), newNote],
          updatedAt: now
        };
      }
      return t;
    });

    setNewNoteText('');
    await persistStore({ ...store, terms });
  }, [store, selectedTermId, newNoteText, currentUser, persistStore]);

  // Get list of all unique semantic domains for filtering
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

  // Check term completion status:
  // - Complete: Has at least one approved rendering AND all references are matched
  // - Missing: Has no approved renderings
  // - Partial: Has approved renderings but some references are missing matches
  const getTermStatus = useCallback((term: KeyTerm): 'complete' | 'missing' | 'partial' => {
    const approved = term.renderings ? term.renderings.filter(r => r.status === 'approved') : [];
    if (approved.length === 0) return 'missing';
    
    // Check if we scanned references
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
  }, [verseMatches]);

  // Filtered terms list
  const filteredTerms = useMemo(() => {
    if (!store) return [];
    return store.terms
      .filter(t => {
        // Search filter
        const q = searchTerm.toLowerCase().trim();
        if (q) {
          const glossMatch = t.gloss.toLowerCase().includes(q);
          const lemmaMatch = t.lemma.toLowerCase().includes(q);
          const strongMatch = t.strongs && t.strongs.toLowerCase().includes(q);
          const translitMatch = t.transliteration && t.transliteration.toLowerCase().includes(q);
          if (!glossMatch && !lemmaMatch && !strongMatch && !translitMatch) return false;
        }
        
        // Domain filter
        if (filterDomain !== 'all' && (!t.domains || !t.domains.includes(filterDomain))) {
          return false;
        }
        
        // Completion filter
        const status = getTermStatus(t);
        if (filterCompletion !== 'all' && status !== filterCompletion) {
          return false;
        }

        return true;
      })
      .sort((a, b) => a.gloss.localeCompare(b.gloss));
  }, [store, searchTerm, filterDomain, filterCompletion, getTermStatus]);

  // Percentage complete overall
  const completionStats = useMemo(() => {
    if (!store || store.terms.length === 0) return { percent: 0, missing: 0, partial: 0, complete: 0 };
    let missing = 0;
    let partial = 0;
    let complete = 0;

    for (const t of store.terms) {
      const s = getTermStatus(t);
      if (s === 'missing') missing++;
      else if (s === 'partial') partial++;
      else complete++;
    }

    const percent = Math.round((complete / store.terms.length) * 100);
    return { percent, missing, partial, complete };
  }, [store, getTermStatus]);

  // Render loading / empty states
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

  if (loading && !store) {
    return (
      <div className="tw:flex tw:items-center tw:justify-center tw:h-full tw:text-sm tw:text-gray-500">
        Cargando términos clave de Paratext...
      </div>
    );
  }

  return (
    <div className="tw:flex tw:h-full tw:bg-slate-50 tw:text-slate-800 tw:font-sans">
      {/* Sidebar - Terms list */}
      {sidebarVisible && (
        <div
          style={{ width: `${sidebarWidth}px` }}
          className="tw:bg-white tw:border-r tw:border-slate-200 tw:flex tw:flex-col tw:h-full tw:flex-shrink-0"
        >
          {/* Header search & filters */}
          <div className="tw:p-3 tw:border-b tw:border-slate-100 tw:space-y-2.5">
            <div className="tw:flex tw:items-center tw:justify-between">
              <span className="tw:font-bold tw:text-sm tw:text-slate-700">Términos Clave</span>
              <button
                className="tw:text-xs tw:text-slate-500 tw:hover:text-indigo-600"
                onClick={loadData}
              >
                Actualizar
              </button>
            </div>
            
            {/* Search Input */}
            <div className="tw:relative">
              <input
                type="text"
                placeholder="Buscar término, glosa, strong..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="tw:w-full tw:border tw:border-slate-200 tw:rounded-lg tw:px-2.5 tw:py-1.5 tw:text-xs tw:pr-7 tw:focus:outline-none tw:focus:border-indigo-400"
              />
              {searchTerm && (
                <button
                  className="tw:absolute tw:right-2 tw:top-1/2 tw:-translate-y-1/2 tw:text-slate-400 tw:hover:text-slate-600"
                  onClick={() => setSearchTerm('')}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Semantic Domain Filter */}
            <div className="tw:flex tw:flex-col tw:gap-1">
              <label className="tw:text-[10px] tw:text-slate-400 tw:font-semibold uppercase">Dominio Semántico</label>
              <select
                value={filterDomain}
                onChange={(e) => setFilterDomain(e.target.value)}
                className="tw:w-full tw:border tw:border-slate-200 tw:rounded-lg tw:px-2 tw:py-1 tw:text-xs"
              >
                <option value="all">Todos los dominios</option>
                {allDomains.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>

            {/* Completion Filter */}
            <div className="tw:flex tw:gap-1">
              {[
                { key: 'all', label: 'Todos' },
                { key: 'complete', label: 'Completos' },
                { key: 'partial', label: 'Parciales' },
                { key: 'missing', label: 'Faltantes' }
              ].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setFilterCompletion(opt.key as any)}
                  className={`tw:flex-1 tw:py-0.5 tw:px-1.5 tw:text-[10px] tw:rounded-md tw:border ${
                    filterCompletion === opt.key
                      ? 'tw:bg-indigo-50 tw:text-indigo-700 tw:border-indigo-200 tw:font-medium'
                      : 'tw:bg-white tw:text-slate-600 tw:border-slate-200 tw:hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Micro stats bar */}
            <div className="tw:pt-1 tw:text-[10px] tw:text-slate-400 tw:flex tw:justify-between">
              <span>{completionStats.percent}% Completado</span>
              <span>{filteredTerms.length} / {store?.terms.length || 0} términos</span>
            </div>
          </div>

          {/* List area */}
          <div className="tw:flex-1 tw:overflow-y-auto tw:divide-y tw:divide-slate-100">
            {filteredTerms.map(term => {
              const status = getTermStatus(term);
              const isSelected = term.id === selectedTermId;
              
              let statusBg = 'tw:bg-red-100 tw:text-red-700';
              let statusText = 'Faltante';
              if (status === 'complete') {
                statusBg = 'tw:bg-green-100 tw:text-green-700';
                statusText = 'Completo';
              } else if (status === 'partial') {
                statusBg = 'tw:bg-yellow-100 tw:text-yellow-800';
                statusText = 'Parcial';
              }

              return (
                <button
                  key={term.id}
                  ref={isSelected ? selectedButtonRef : null}
                  onClick={() => setSelectedTermId(term.id)}
                  className={`tw:w-full tw:text-left tw:p-3 tw:flex tw:flex-col tw:gap-1.5 tw:transition-colors tw:cursor-pointer ${
                    isSelected ? 'tw:bg-indigo-50/70' : 'tw:hover:bg-slate-50'
                  }`}
                >
                  <div className="tw:flex tw:items-start tw:justify-between tw:gap-2">
                    <span className="tw:font-semibold tw:text-sm tw:text-slate-700 tw:truncate">{term.gloss}</span>
                    <span className={`tw:text-[9px] tw:px-1.5 tw:py-0.5 tw:rounded-full tw:font-medium ${statusBg}`}>
                      {statusText}
                    </span>
                  </div>
                  <div className="tw:flex tw:items-center tw:justify-between tw:text-xs tw:text-slate-400">
                    <span className="tw:font-serif">{term.lemma}</span>
                    {term.strongs && <span>{term.strongs}</span>}
                  </div>
                </button>
              );
            })}

            {filteredTerms.length === 0 && (
              <div className="tw:p-4 tw:text-center tw:text-xs tw:text-slate-400">
                Ningún término coincide con los filtros.
              </div>
            )}
          </div>
        </div>
      )}
      {sidebarVisible && (
        <div
          className="tw:w-1 tw:cursor-col-resize tw:bg-slate-200 hover:tw:bg-indigo-400 tw:transition-colors tw:h-full tw:flex-shrink-0"
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
        />
      )}

      {/* Main panel - Detail view */}
      <div className="tw:flex-1 tw:flex tw:flex-col tw:h-full tw:overflow-hidden">
        {/* Top toolbar */}
        <div className="tw:px-4 tw:py-3 tw:bg-white tw:border-b tw:border-slate-200 tw:flex tw:items-center tw:justify-between">
          <div className="tw:flex tw:items-center tw:gap-3">
            <button
              onClick={() => setSidebarVisible(v => !v)}
              className="tw:p-1.5 tw:rounded-md tw:text-slate-600 tw:hover:bg-slate-100"
              title={sidebarVisible ? "Ocultar panel lateral" : "Mostrar panel lateral"}
            >
              <svg className="tw:w-5 tw:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span className="tw:font-bold tw:text-slate-700">Verificador de Términos Clave</span>
          </div>

          <div className="tw:flex tw:items-center tw:gap-3">
            {saving && <span className="tw:text-xs tw:text-slate-400">Guardando...</span>}
            <button
              className="tw:px-3 tw:py-1.5 tw:bg-indigo-50 tw:text-indigo-700 tw:border tw:border-indigo-100 tw:rounded-lg tw:text-xs tw:font-medium tw:hover:bg-indigo-100 tw:cursor-pointer"
              onClick={selectProject}
            >
              Cambiar Proyecto
            </button>
          </div>
        </div>

        {/* Workspace area */}
        {selectedTerm ? (
          <div className="tw:flex-1 tw:overflow-y-auto tw:p-4 tw:space-y-4">
            {/* Term Summary Card */}
            <div className="tw:bg-white tw:p-4 tw:rounded-xl tw:border tw:border-slate-200 tw:shadow-sm tw:space-y-3">
              <div className="tw:flex tw:items-start tw:justify-between">
                <div>
                  <h2 className="tw:text-xl tw:font-bold tw:text-slate-700">{selectedTerm.gloss}</h2>
                  <div className="tw:flex tw:items-center tw:gap-2 tw:mt-1">
                    <span className="tw:font-serif tw:text-lg tw:text-indigo-600">{selectedTerm.lemma}</span>
                    {selectedTerm.transliteration && (
                      <span className="tw:text-sm tw:text-slate-400 tw:italic">({selectedTerm.transliteration})</span>
                    )}
                  </div>
                </div>
                {selectedTerm.strongs && (
                  <span className="tw:px-2.5 tw:py-1 tw:bg-slate-100 tw:text-slate-600 tw:rounded-md tw:text-xs tw:font-mono">
                    {selectedTerm.strongs}
                  </span>
                )}
              </div>

              {/* Domains tags */}
              {selectedTerm.domains && selectedTerm.domains.length > 0 && (
                <div className="tw:flex tw:gap-1.5 tw:flex-wrap">
                  {selectedTerm.domains.map(dom => (
                    <span key={dom} className="tw:text-[10px] tw:px-2 tw:py-0.5 tw:bg-indigo-50 tw:text-indigo-600 tw:rounded-md tw:font-semibold uppercase">
                      {dom}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Renderings Card (Feature 2 & 5) */}
            <div className="tw:bg-white tw:p-4 tw:rounded-xl tw:border tw:border-slate-200 tw:shadow-sm tw:space-y-4">
              <h3 className="tw:font-bold tw:text-sm tw:text-slate-700 uppercase tw:tracking-wider">Traducciones en el idioma meta</h3>
              
              {/* Add Rendering Input */}
              <div className="tw:flex tw:gap-2">
                <input
                  type="text"
                  placeholder="Agregar nueva traducción..."
                  value={newRenderingText}
                  onChange={(e) => setNewRenderingText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addRendering()}
                  className="tw:flex-1 tw:border tw:border-slate-200 tw:rounded-lg tw:px-3 tw:py-2 tw:text-xs tw:focus:outline-none tw:focus:border-indigo-400"
                />
                <button
                  onClick={addRendering}
                  className="tw:px-4 tw:py-2 tw:bg-indigo-600 tw:text-white tw:rounded-lg tw:text-xs tw:font-medium tw:hover:bg-indigo-700 tw:cursor-pointer"
                >
                  Agregar
                </button>
              </div>

              {/* Renderings List */}
              <div className="tw:space-y-3">
                {selectedTerm.renderings && selectedTerm.renderings.map(rend => {
                  const upVotes = rend.votes ? rend.votes.filter(v => v.value === 'up').length : 0;
                  const downVotes = rend.votes ? rend.votes.filter(v => v.value === 'down').length : 0;
                  
                  const hasUpvoted = rend.votes && rend.votes.some(v => v.user === currentUser && v.value === 'up');
                  const hasDownvoted = rend.votes && rend.votes.some(v => v.user === currentUser && v.value === 'down');

                  return (
                    <div key={rend.id} className="tw:p-3 tw:bg-slate-50 tw:rounded-lg tw:border tw:border-slate-100 tw:space-y-2">
                      <div className="tw:flex tw:items-start tw:justify-between tw:gap-4">
                        <div className="tw:space-y-1">
                          <span className="tw:font-bold tw:text-sm tw:text-slate-700">{rend.text}</span>
                          <div className="tw:flex tw:items-center tw:gap-1.5">
                            <span className="tw:text-[10px] tw:text-slate-400">Propuesto por: {rend.proposedBy}</span>
                          </div>
                        </div>

                        {/* Status select dropdown */}
                        <select
                          value={rend.status}
                          onChange={(e) => updateRenderingStatus(rend.id, e.target.value as any)}
                          className={`tw:text-xs tw:px-2 tw:py-1 tw:rounded-md tw:border tw:font-medium ${
                            rend.status === 'approved' ? 'tw:bg-green-50 tw:text-green-700 tw:border-green-200' :
                            rend.status === 'disputed' ? 'tw:bg-red-50 tw:text-red-700 tw:border-red-200' :
                            rend.status === 'proposed' ? 'tw:bg-yellow-50 tw:text-yellow-700 tw:border-yellow-200' :
                            'tw:bg-slate-100 tw:text-slate-600 tw:border-slate-300'
                          }`}
                        >
                          <option value="draft">Borrador</option>
                          <option value="proposed">Propuesto</option>
                          <option value="disputed">Discutido</option>
                          <option value="approved">Aprobado</option>
                        </select>
                      </div>

                      {/* Vote & tag widgets */}
                      <div className="tw:flex tw:items-center tw:justify-between tw:pt-1 tw:gap-2 tw:flex-wrap">
                        {/* Vote buttons */}
                        <div className="tw:flex tw:items-center tw:gap-2">
                          <button
                            onClick={() => voteRendering(rend.id, 'up')}
                            className={`tw:flex tw:items-center tw:gap-1 tw:px-2 tw:py-1 tw:rounded-md tw:border tw:text-xs tw:cursor-pointer ${
                              hasUpvoted
                                ? 'tw:bg-indigo-50 tw:text-indigo-600 tw:border-indigo-200'
                                : 'tw:bg-white tw:text-slate-500 tw:border-slate-200 hover:tw:bg-slate-100'
                            }`}
                          >
                            👍 <span className="tw:font-semibold">{upVotes}</span>
                          </button>
                          <button
                            onClick={() => voteRendering(rend.id, 'down')}
                            className={`tw:flex tw:items-center tw:gap-1 tw:px-2 tw:py-1 tw:rounded-md tw:border tw:text-xs tw:cursor-pointer ${
                              hasDownvoted
                                ? 'tw:bg-red-50 tw:text-red-600 tw:border-red-200'
                                : 'tw:bg-white tw:text-slate-500 tw:border-slate-200 hover:tw:bg-slate-100'
                            }`}
                          >
                            👎 <span className="tw:font-semibold">{downVotes}</span>
                          </button>
                        </div>

                        {/* Context Tags widget */}
                        <div className="tw:flex tw:items-center tw:gap-1 tw:flex-wrap">
                          {rend.contextTags && rend.contextTags.map(tag => (
                            <span key={tag} className="tw:inline-flex tw:items-center tw:gap-1 tw:text-[10px] tw:bg-slate-200 tw:text-slate-600 tw:rounded tw:px-1.5 tw:py-0.5 font-medium">
                              #{tag}
                              <button
                                onClick={() => removeContextTag(rend.id, tag)}
                                className="tw:text-slate-400 tw:hover:text-slate-600 font-bold"
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                          <div className="tw:flex tw:gap-1">
                            <input
                              type="text"
                              placeholder="+tag"
                              value={newContextTags[rend.id] || ''}
                              onChange={(e) => setNewContextTags(prev => ({ ...prev, [rend.id]: e.target.value }))}
                              onKeyDown={(e) => e.key === 'Enter' && addContextTag(rend.id)}
                              className="tw:border tw:border-slate-200 tw:rounded tw:px-1 tw:py-0.5 tw:text-[10px] tw:w-16"
                            />
                            <button
                              onClick={() => addContextTag(rend.id)}
                              className="tw:px-1.5 tw:bg-slate-200 tw:rounded tw:text-[10px] tw:hover:bg-slate-300"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {(!selectedTerm.renderings || selectedTerm.renderings.length === 0) && (
                  <div className="tw:text-xs tw:text-slate-400 tw:text-center tw:py-2">
                    No hay traducciones propuestas para este término.
                  </div>
                )}
              </div>
            </div>

            {/* Expected Verse References List */}
            <div className="tw:bg-white tw:p-4 tw:rounded-xl tw:border tw:border-slate-200 tw:shadow-sm tw:space-y-3">
              <div className="tw:flex tw:items-center tw:justify-between">
                <h3 className="tw:font-bold tw:text-sm tw:text-slate-700 uppercase tw:tracking-wider">Pasajes esperados</h3>
                {scanning && <span className="tw:text-xs tw:text-slate-400 tw:animate-pulse">Escaneando...</span>}
              </div>

              <div className="tw:divide-y tw:divide-slate-100 tw:max-h-72 tw:overflow-y-auto">
                {selectedTerm.references && selectedTerm.references.map(ref => {
                  const match = verseMatches[`${selectedTerm.id}-${ref}`];
                  
                  let badge = (
                    <span className="tw:px-2 tw:py-0.5 tw:bg-slate-100 tw:text-slate-500 tw:rounded-md tw:text-[10px]">
                      No escaneado
                    </span>
                  );

                  if (match) {
                    if (match.matchResult.found) {
                      badge = (
                        <span className="tw:px-2 tw:py-0.5 tw:bg-green-100 tw:text-green-700 tw:rounded-md tw:text-[10px] tw:font-semibold">
                          ✓ Encontrado ({match.matchResult.matchedText})
                        </span>
                      );
                    } else {
                      badge = (
                        <span className="tw:px-2 tw:py-0.5 tw:bg-red-100 tw:text-red-700 tw:rounded-md tw:text-[10px] tw:font-semibold">
                          ✗ Falta
                        </span>
                      );
                    }
                  }

                  return (
                    <div key={ref} className="tw:py-2 tw:flex tw:items-center tw:justify-between tw:gap-4">
                      <button
                        onClick={() => handleVerseClick(ref)}
                        className="tw:text-xs tw:text-indigo-600 tw:font-semibold tw:hover:underline tw:cursor-pointer text-left"
                      >
                        {ref}
                      </button>
                      {badge}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Morphology Configuration Panel (Feature 1) */}
            <div className="tw:bg-white tw:rounded-xl tw:border tw:border-slate-200 tw:shadow-sm tw:overflow-hidden">
              <button
                onClick={() => setMorphPanelOpen(o => !o)}
                className="tw:w-full tw:px-4 tw:py-3 tw:bg-slate-50 tw:flex tw:items-center tw:justify-between tw:cursor-pointer tw:border-b tw:border-slate-100"
              >
                <span className="tw:font-bold tw:text-xs tw:text-slate-500 uppercase tw:tracking-wider">Configuración Morfológica</span>
                <span>{morphPanelOpen ? '▲' : '▼'}</span>
              </button>

              {morphPanelOpen && store && (
                <div className="tw:p-4 tw:space-y-4">
                  {/* Language and Fuzzy match settings */}
                  <div className="tw:grid tw:grid-cols-1 md:tw:grid-cols-2 tw:gap-4">
                    <div className="tw:space-y-1">
                      <label className="tw:text-xs tw:font-semibold tw:text-slate-500">Nombre del idioma</label>
                      <input
                        type="text"
                        value={store.morphologyConfig.languageName || ''}
                        onChange={(e) => handleMorphologyChange({ languageName: e.target.value })}
                        className="tw:w-full tw:border tw:border-slate-200 tw:rounded-lg tw:px-2.5 tw:py-1.5 tw:text-xs"
                      />
                    </div>

                    <div className="tw:space-y-2">
                      <label className="tw:flex tw:items-center tw:gap-2 tw:text-xs tw:font-semibold tw:text-slate-500 tw:cursor-pointer">
                        <input
                          type="checkbox"
                          checked={store.morphologyConfig.enableFuzzyMatch}
                          onChange={(e) => handleMorphologyChange({ enableFuzzyMatch: e.target.checked })}
                        />
                        Búsqueda Difusa (Levenshtein)
                      </label>
                      
                      {store.morphologyConfig.enableFuzzyMatch && (
                        <div className="tw:flex tw:items-center tw:gap-3">
                          <span className="tw:text-xs tw:text-slate-400">Distancia máx (1-4):</span>
                          <input
                            type="range"
                            min="1"
                            max="4"
                            value={store.morphologyConfig.maxEditDistance || 2}
                            onChange={(e) => handleMorphologyChange({ maxEditDistance: parseInt(e.target.value, 10) })}
                            className="tw:w-20"
                          />
                          <span className="tw:text-xs tw:font-bold">{store.morphologyConfig.maxEditDistance || 2}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Affix rules builders */}
                  <div className="tw:grid tw:grid-cols-1 md:tw:grid-cols-2 tw:gap-6 tw:pt-2">
                    {/* Prefixes list */}
                    <div className="tw:space-y-2">
                      <span className="tw:font-bold tw:text-xs tw:text-slate-700">Prefijos comunes a ignorar</span>
                      
                      {/* Input form */}
                      <div className="tw:flex tw:gap-1">
                        <input
                          type="text"
                          placeholder="ni-"
                          value={newPrefix}
                          onChange={(e) => setNewPrefix(e.target.value)}
                          className="tw:border tw:border-slate-200 tw:rounded-lg tw:px-2 tw:py-1 tw:text-xs tw:w-16"
                        />
                        <input
                          type="text"
                          placeholder="Etiqueta..."
                          value={newPrefixLabel}
                          onChange={(e) => setNewPrefixLabel(e.target.value)}
                          className="tw:flex-1 tw:border tw:border-slate-200 tw:rounded-lg tw:px-2 tw:py-1 tw:text-xs"
                        />
                        <button
                          onClick={addPrefixRule}
                          className="tw:px-3 tw:py-1 tw:bg-indigo-600 tw:text-white tw:rounded-lg tw:text-xs tw:hover:bg-indigo-700"
                        >
                          +
                        </button>
                      </div>

                      {/* Prefixes List */}
                      <div className="tw:space-y-1 tw:max-h-36 tw:overflow-y-auto">
                        {store.morphologyConfig.prefixes && store.morphologyConfig.prefixes.map(rule => (
                          <div key={rule.id} className="tw:flex tw:items-center tw:justify-between tw:p-1.5 tw:bg-slate-50 tw:rounded tw:text-xs">
                            <label className="tw:flex tw:items-center tw:gap-2 tw:cursor-pointer">
                              <input
                                type="checkbox"
                                checked={rule.enabled}
                                onChange={() => toggleRule(rule.id, 'prefix')}
                              />
                              <span className="tw:font-bold">{rule.affix}</span>
                              <span className="tw:text-slate-400">({rule.label})</span>
                            </label>
                            <button
                              onClick={() => deleteRule(rule.id, 'prefix')}
                              className="tw:text-slate-400 hover:tw:text-red-500 font-bold"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Suffixes list */}
                    <div className="tw:space-y-2">
                      <span className="tw:font-bold tw:text-xs tw:text-slate-700">Sufijos comunes a ignorar</span>
                      
                      {/* Input form */}
                      <div className="tw:flex tw:gap-1">
                        <input
                          type="text"
                          placeholder="-ini"
                          value={newSuffix}
                          onChange={(e) => setNewSuffix(e.target.value)}
                          className="tw:border tw:border-slate-200 tw:rounded-lg tw:px-2 tw:py-1 tw:text-xs tw:w-16"
                        />
                        <input
                          type="text"
                          placeholder="Etiqueta..."
                          value={newSuffixLabel}
                          onChange={(e) => setNewSuffixLabel(e.target.value)}
                          className="tw:flex-1 tw:border tw:border-slate-200 tw:rounded-lg tw:px-2 tw:py-1 tw:text-xs"
                        />
                        <button
                          onClick={addSuffixRule}
                          className="tw:px-3 tw:py-1 tw:bg-indigo-600 tw:text-white tw:rounded-lg tw:text-xs tw:hover:bg-indigo-700"
                        >
                          +
                        </button>
                      </div>

                      {/* Suffixes List */}
                      <div className="tw:space-y-1 tw:max-h-36 tw:overflow-y-auto">
                        {store.morphologyConfig.suffixes && store.morphologyConfig.suffixes.map(rule => (
                          <div key={rule.id} className="tw:flex tw:items-center tw:justify-between tw:p-1.5 tw:bg-slate-50 tw:rounded tw:text-xs">
                            <label className="tw:flex tw:items-center tw:gap-2 tw:cursor-pointer">
                              <input
                                type="checkbox"
                                checked={rule.enabled}
                                onChange={() => toggleRule(rule.id, 'suffix')}
                              />
                              <span className="tw:font-bold">{rule.affix}</span>
                              <span className="tw:text-slate-400">({rule.label})</span>
                            </label>
                            <button
                              onClick={() => deleteRule(rule.id, 'suffix')}
                              className="tw:text-slate-400 hover:tw:text-red-500 font-bold"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Collaborative notes panel (Feature 5) */}
            <div className="tw:bg-white tw:rounded-xl tw:border tw:border-slate-200 tw:shadow-sm overflow-hidden">
              <button
                onClick={() => setCollabPanelOpen(o => !o)}
                className="tw:w-full tw:px-4 tw:py-3 tw:bg-slate-50 tw:flex tw:items-center tw:justify-between tw:cursor-pointer tw:border-b tw:border-slate-100"
              >
                <span className="tw:font-bold tw:text-xs tw:text-slate-500 uppercase tw:tracking-wider">Notas de Discusión del Equipo</span>
                <span>{collabPanelOpen ? '▲' : '▼'}</span>
              </button>

              {collabPanelOpen && (
                <div className="tw:p-4 tw:space-y-4">
                  {/* Notes Feed */}
                  <div className="tw:space-y-2.5 tw:max-h-60 tw:overflow-y-auto">
                    {selectedTerm.notes && selectedTerm.notes.map(note => (
                      <div key={note.id} className="tw:p-2.5 tw:bg-slate-50 tw:rounded-lg tw:border tw:border-slate-100 tw:space-y-1">
                        <div className="tw:flex tw:items-center tw:justify-between tw:text-[10px] tw:text-slate-400">
                          <span className="tw:font-bold">{note.author}</span>
                          <span>{new Date(note.timestamp).toLocaleString('es')}</span>
                        </div>
                        <p className="tw:text-xs tw:text-slate-600 tw:whitespace-pre-wrap">{note.text}</p>
                      </div>
                    ))}

                    {(!selectedTerm.notes || selectedTerm.notes.length === 0) && (
                      <div className="tw:text-xs tw:text-slate-400 tw:text-center tw:py-4">
                        No hay comentarios sobre la traducción de este término.
                      </div>
                    )}
                  </div>

                  {/* Add Note form */}
                  <div className="tw:space-y-2">
                    <textarea
                      placeholder="Escribe una nota para el equipo..."
                      value={newNoteText}
                      onChange={(e) => setNewNoteText(e.target.value)}
                      rows={2}
                      className="tw:w-full tw:border tw:border-slate-200 tw:rounded-lg tw:px-2.5 tw:py-1.5 tw:text-xs tw:focus:outline-none tw:focus:border-indigo-400"
                    />
                    <div className="tw:flex tw:justify-end">
                      <button
                        onClick={addNote}
                        className="tw:px-3 tw:py-1.5 tw:bg-indigo-600 tw:text-white tw:rounded-lg tw:text-xs tw:font-medium tw:hover:bg-indigo-700 tw:cursor-pointer"
                      >
                        Enviar nota
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="tw:flex-1 tw:flex tw:items-center tw:justify-center tw:text-slate-400 tw:text-sm">
            Selecciona un término de la lista lateral para empezar a verificar.
          </div>
        )}
      </div>
    </div>
  );
};
