import { WebViewProps } from '@papi/core';
import papi from '@papi/frontend';
import { useDialogCallback } from '@papi/frontend/react';
import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
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
  Pencil,
} from 'lucide-react';
import { papiRetry, isPapiDisconnectedError } from './utils/papi-retry';
import { usePapiDisconnect } from './utils/use-papi-disconnect';
import { useLocalizedStrings } from './utils/i18n';
import { Avatar } from './components/avatar';
import { AvatarSettingsModal } from './components/avatar-settings-modal';
import type {
  KeyTermsStore,
  KeyTerm,
  Rendering,
  RenderingStatus,
  VerseMatchStatus,
  MorphologyConfig,
  AffixRule,
} from './types/key-terms.types';
import type { ParatextNoteThread, ParatextComment } from './types/note.types';
const BIBLE_BOOKS = [
  'GEN',
  'EXO',
  'LEV',
  'NUM',
  'DEU',
  'JOS',
  'JDG',
  'RUT',
  '1SA',
  '2SA',
  '1KI',
  '2KI',
  '1CH',
  '2CH',
  'EZR',
  'NEH',
  'EST',
  'JOB',
  'PSA',
  'PRO',
  'ECC',
  'SNG',
  'ISA',
  'JER',
  'LAM',
  'EZK',
  'DAN',
  'HOS',
  'JOL',
  'AMO',
  'OBA',
  'JON',
  'MIC',
  'NAM',
  'HAB',
  'ZEP',
  'HAG',
  'ZEC',
  'MAL',
  'MAT',
  'MRK',
  'LUK',
  'JHN',
  'ACT',
  'ROM',
  '1CO',
  '2CO',
  'GAL',
  'EPH',
  'PHP',
  'COL',
  '1TH',
  '2TH',
  '1TI',
  '2TI',
  'TIT',
  'PHM',
  'HEB',
  'JAS',
  '1PE',
  '2PE',
  '1JN',
  '2JN',
  '3JN',
  'JUD',
  'REV',
] as const;

interface ParsedRef {
  bookIdx: number;
  chapter: number;
  verse: number;
  original: string;
}

const parseReference = (ref?: string): ParsedRef => {
  if (!ref) {
    return { bookIdx: 999, chapter: 999, verse: 999, original: '' };
  }
  const trimmed = ref.trim();
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    const bookIdx = BIBLE_BOOKS.indexOf(trimmed as any);
    return {
      bookIdx: bookIdx !== -1 ? bookIdx : 999,
      chapter: 0,
      verse: 0,
      original: trimmed,
    };
  }
  const book = trimmed.slice(0, spaceIdx);
  const rest = trimmed.slice(spaceIdx + 1);
  const bookIdx = BIBLE_BOOKS.indexOf(book as any);

  let chapter = 0;
  let verse = 0;
  const colonIdx = rest.indexOf(':');
  if (colonIdx !== -1) {
    chapter = parseInt(rest.slice(0, colonIdx), 10) || 0;
    const verseStr = rest.slice(colonIdx + 1);
    verse = parseInt(verseStr.match(/^\d+/)?.[0] || '0', 10) || 0;
  } else {
    chapter = parseInt(rest, 10) || 0;
  }

  return {
    bookIdx: bookIdx !== -1 ? bookIdx : 999,
    chapter,
    verse,
    original: trimmed,
  };
};

const compareReferences = (refA?: string, refB?: string): number => {
  const a = parseReference(refA);
  const b = parseReference(refB);
  if (a.bookIdx !== b.bookIdx) {
    return a.bookIdx - b.bookIdx;
  }
  if (a.chapter !== b.chapter) {
    return a.chapter - b.chapter;
  }
  if (a.verse !== b.verse) {
    return a.verse - b.verse;
  }
  return a.original.localeCompare(b.original);
};

const isSameUser = (userA: string, userB: string) => {
  if (!userA || !userB) return false;
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  const normA = normalize(userA);
  const normB = normalize(userB);
  return normA.includes(normB) || normB.includes(normA);
};

interface CommentBoxProps {
  placeholder?: string;
  buttonText: string;
  icon?: React.ReactNode;
  onSubmit: (text: string) => Promise<boolean> | boolean;
  rows?: number;
  initialValue?: string;
}

const CommentBox: React.FC<CommentBoxProps> = ({
  placeholder = 'Write a comment...',
  buttonText,
  icon,
  onSubmit,
  rows = 1,
  initialValue = '',
}) => {
  const [text, setText] = useState(initialValue);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!text.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const success = await onSubmit(text);
      if (success) {
        setText('');
      }
    } catch (e) {
      console.error('CommentBox submit error:', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="tw:space-y-2">
      <textarea
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={isSubmitting}
        rows={rows}
        className="tw:w-full tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:rounded-xl tw:px-2.5 tw:py-1.5 tw:text-xs tw:bg-white dark:tw:bg-slate-900 tw:text-slate-900 dark:tw:text-slate-100 tw:placeholder:tw:text-slate-500 dark:tw:text-slate-400 tw:focus:outline-none tw:focus:ring-2 tw:focus:ring-indigo-500/30 tw:resize-y disabled:tw:opacity-50"
      />
      <div className="tw:flex tw:justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!text.trim() || isSubmitting}
          className="tw:inline-flex tw:items-center tw:gap-1.5 tw:px-2.5 tw:py-1 tw:bg-indigo-600 tw:text-white tw:rounded-lg tw:text-[11px] tw:font-medium hover:tw:bg-indigo-700 tw:cursor-pointer disabled:tw:opacity-50 disabled:tw:cursor-not-allowed"
        >
          {icon}
          {buttonText}
        </button>
      </div>
    </div>
  );
};

interface InlineEditCommentProps {
  initialText: string;
  onSave: (text: string) => Promise<void> | void;
  onCancel: () => void;
}

const InlineEditComment: React.FC<InlineEditCommentProps> = ({ initialText, onSave, onCancel }) => {
  const [text, setText] = useState(initialText);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!text.trim() || isSaving) return;
    setIsSaving(true);
    try {
      await onSave(text);
    } catch (e) {
      console.error('InlineEditComment save error:', e);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="tw:space-y-2 tw:mt-1">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={isSaving}
        rows={2}
        className="tw:w-full tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:rounded-xl tw:px-2.5 tw:py-1.5 tw:text-xs tw:bg-white dark:tw:bg-slate-900 tw:text-slate-900 dark:tw:text-slate-100 tw:focus:outline-none tw:focus:ring-2 tw:focus:ring-indigo-500/30 tw:resize-y disabled:tw:opacity-50"
      />
      <div className="tw:flex tw:justify-end tw:gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="tw:px-2 tw:py-1 tw:bg-slate-100 dark:tw:bg-slate-800 tw:text-slate-700 dark:tw:text-slate-300 tw:rounded tw:text-[11px] tw:font-medium hover:tw:opacity-90 tw:cursor-pointer disabled:tw:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!text.trim() || isSaving}
          className="tw:px-2.5 tw:py-1 tw:bg-indigo-600 tw:text-white tw:rounded tw:text-[11px] tw:font-medium hover:tw:bg-indigo-700 tw:cursor-pointer disabled:tw:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  );
};

interface CommentItemProps {
  comment: ParatextComment;
  threadId: string;
  currentUser: string;
  lang: string;
  editingCommentKey: string | null;
  setEditingCommentKey: (key: string | null) => void;
  handleSaveComment: (threadId: string, date: string, user: string, text: string) => Promise<void>;
  handleDeleteComment: (threadId: string, date: string, user: string) => Promise<void>;
  isCompact?: boolean;
}

const CommentItem: React.FC<CommentItemProps> = ({
  comment,
  threadId,
  currentUser,
  lang,
  editingCommentKey,
  setEditingCommentKey,
  handleSaveComment,
  handleDeleteComment,
  isCompact = false,
}) => {
  const commentKey = `${threadId}-${comment.date}`;
  const isEditing = editingCommentKey === commentKey;
  const isMyComment = isSameUser(comment.user, currentUser);

  return (
    <div
      className={`tw:p-2 tw:rounded-xl tw:border tw:space-y-1 ${isCompact ? 'tw:bg-slate-200/40 dark:tw:bg-slate-700/40 tw:border-slate-200/40 dark:tw:border-slate-800/40' : 'tw:bg-white dark:tw:bg-slate-900 tw:border-slate-200 dark:tw:border-slate-800'}`}
    >
      <div
        className={`tw:flex tw:items-center tw:justify-between tw:gap-2 tw:text-slate-500 dark:tw:text-slate-400 ${isCompact ? 'tw:text-[9px]' : 'tw:text-[10px]'}`}
      >
        <div className="tw:flex tw:items-center tw:gap-1.5">
          <span
            className={`tw:text-slate-900 dark:tw:text-slate-100 ${isCompact ? 'tw:font-bold' : 'tw:font-semibold'}`}
          >
            {comment.user}
          </span>
          {isMyComment && (
            <span
              className={`tw:bg-indigo-50 dark:tw:bg-indigo-900/30 tw:text-indigo-600 dark:tw:text-indigo-400 tw:px-1 tw:rounded tw:font-medium ${isCompact ? 'tw:text-[8px]' : 'tw:text-[9px]'}`}
            >
              {lang === 'en' ? 'You' : 'Tú'}
            </span>
          )}
        </div>
        <div className="tw:flex tw:items-center tw:gap-1.5">
          <span>{new Date(comment.date).toLocaleString(lang === 'en' ? 'en' : 'es')}</span>
          {isMyComment && !isEditing && (
            <div className="tw:flex tw:items-center tw:gap-1">
              <button
                type="button"
                onClick={() => setEditingCommentKey(commentKey)}
                className="tw:p-0.5 tw:text-slate-500 dark:tw:text-slate-400 hover:tw:text-indigo-600 dark:tw:text-indigo-400 tw:rounded hover:tw:bg-slate-50 dark:hover:tw:bg-slate-800 tw:transition-colors tw:cursor-pointer"
                title={lang === 'en' ? 'Edit comment' : 'Editar comentario'}
              >
                <Pencil size={isCompact ? 8 : 10} />
              </button>
              <button
                type="button"
                onClick={() => handleDeleteComment(threadId, comment.date, comment.user)}
                className="tw:p-0.5 tw:text-slate-500 dark:tw:text-slate-400 hover:tw:text-rose-600 dark:tw:text-rose-400 tw:rounded hover:tw:bg-slate-50 dark:hover:tw:bg-slate-800 tw:transition-colors tw:cursor-pointer"
                title={lang === 'en' ? 'Delete comment' : 'Eliminar comentario'}
              >
                <Trash2 size={isCompact ? 8 : 10} />
              </button>
            </div>
          )}
        </div>
      </div>
      {isEditing ? (
        <InlineEditComment
          initialText={comment.plainText || comment.contents}
          onSave={async (newText) => {
            await handleSaveComment(threadId, comment.date, comment.user, newText);
            setEditingCommentKey(null);
          }}
          onCancel={() => setEditingCommentKey(null)}
        />
      ) : (
        <p className="tw:text-xs tw:text-slate-900 dark:tw:text-slate-100 tw:whitespace-pre-wrap tw:break-words">
          {comment.plainText || comment.contents}
        </p>
      )}
    </div>
  );
};

globalThis.webViewComponent = function KeyTermsWebView({
  projectId,
  useWebViewState,
  updateWebViewDefinition,
}: WebViewProps) {
  const [lang, setLang] = useWebViewState<string>('lang', 'es');
  const [sortBy, setSortBy] = useWebViewState<'gloss' | 'reference' | 'notes'>('sortBy', 'gloss');
  const { tx, toggleLang } = useLocalizedStrings(lang, setLang, 'verifier');

  // Key Terms Store state
  const [store, setStore] = useState<KeyTermsStore | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { ready, disconnected, clearDisconnected, handleCatch } = usePapiDisconnect();

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
  const [newNoteVerseRef, setNewNoteVerseRef] = useState('GEN 1:1');
  const [expandedRendDiscussions, setExpandedRendDiscussions] = useState<Record<string, boolean>>(
    {},
  );
  const [renderingsDropActive, setRenderingsDropActive] = useState(false);
  const [currentUser, setCurrentUser] = useState('Traductor');
  const [showAvatarSettings, setShowAvatarSettings] = useState(false);
  const [projectThreads, setProjectThreads] = useState<ParatextNoteThread[]>([]);
  const [editingCommentKey, setEditingCommentKey] = useState<string | null>(null);

  const getTermNotesCount = useCallback(
    (termId: string) => {
      const threads = projectThreads.filter((t) => t.biblicalTermId === termId);
      return threads.reduce((sum, t) => {
        const activeComments = t.comments ? t.comments.filter((c) => c.status !== 'deleted') : [];
        return sum + activeComments.length;
      }, 0);
    },
    [projectThreads],
  );

  const loadProjectNotes = useCallback(
    async (userOverride?: string) => {
      const activeUser = userOverride || currentUser;
      if (!projectId || !activeUser) return;
      try {
        const notesStr = await papi.commands.sendCommand(
          'paratextProjectManager.getProjectNotes',
          projectId,
          activeUser,
        );
        const parsed = JSON.parse(notesStr) as { threads: ParatextNoteThread[] };
        setProjectThreads(parsed.threads || []);
      } catch (err) {
        console.error('Failed to load project notes:', err);
      }
    },
    [projectId, currentUser],
  );

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

  useLayoutEffect(() => {
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
  const [collabPanelOpen, setCollabPanelOpen] = useState(true);

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

  const loadData = useCallback(
    async (activeLang?: string) => {
      if (!projectId) return;
      const langToUse = typeof activeLang === 'string' ? activeLang : lang;
      const requestId = ++loadDataRequestRef.current;
      const isCurrentRequest = () => requestId === loadDataRequestRef.current;
      setLoading(true);
      setError('');
      clearDisconnected();
      try {
        const dataStr = await papiRetry(
          () =>
            papi.commands.sendCommand(
              'paratextProjectManager.getKeyTermsData',
              projectId,
              langToUse,
            ),
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
        if (user) {
          setCurrentUser(user);
          await loadProjectNotes(user);
        } else {
          await loadProjectNotes();
        }
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
    },
    [projectId, tx, clearDisconnected, handleCatch, loadProjectNotes],
  );

  useEffect(() => {
    if (ready) loadData(lang);
  }, [ready, loadData, lang]);

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
        if (isPapiDisconnectedError(e)) {
          setError(handleCatch(e));
        } else {
          setError(tx('errorSaving', e.message || String(e)));
        }
      } finally {
        setSaving(false);
      }
    },
    [projectId, tx, handleCatch],
  );

  const scanChapterRequestRef = useRef(0);
  // Tracks chapters that have already been scanned in this session, keyed `${book} ${chapter}`,
  // so re-selecting a term (or switching to a term sharing the same chapters) doesn't re-scan.
  const scannedChaptersRef = useRef<Set<string>>(new Set());

  const termChapterKeys = useCallback(
    (termId: string): Set<string> => {
      if (!store) return new Set();
      const term = store.terms.find((t) => t.id === termId);
      if (!term) return new Set();
      const keys = new Set<string>();
      for (const ref of term.references) {
        const parts = ref.split(' ');
        if (parts.length >= 2) {
          const book = parts[0];
          const chap = parts[1].split(':')[0];
          keys.add(`${book} ${chap}`);
        }
      }
      return keys;
    },
    [store],
  );

  // Drop cached scan results for one term's chapters (or all when `keys` is undefined)
  // and remove the matching verseMatches entries so the UI shows them as "Not scanned" again.
  const invalidateScanCache = useCallback((keys?: Set<string>) => {
    if (keys) {
      for (const k of keys) scannedChaptersRef.current.delete(k);
    } else {
      scannedChaptersRef.current.clear();
    }
    const keysToDelete = keys ? Array.from(keys) : null;
    setVerseMatches((prev) => {
      if (!keysToDelete) return {}; // clear all
      const next: Record<string, VerseMatchStatus> = {};
      for (const [mk, v] of Object.entries(prev)) {
        const ref = v.reference || '';
        const parts = ref.split(' ');
        const chapKey = parts.length >= 2 ? `${parts[0]} ${parts[1].split(':')[0]}` : '';
        if (keysToDelete.includes(chapKey)) continue;
        next[mk] = v;
      }
      return next;
    });
  }, []);

  const scanChapter = useCallback(
    async (opts?: { forceRescan?: boolean }) => {
      if (!projectId || !store || !selectedTermId) return;
      const requestId = ++scanChapterRequestRef.current;
      const isCurrentRequest = () => requestId === scanChapterRequestRef.current;
      const term = store.terms.find((t) => t.id === selectedTermId);
      if (!term || term.references.length === 0) return;

      const allChapters = new Set<string>();
      for (const ref of term.references) {
        const parts = ref.split(' ');
        if (parts.length >= 2) {
          const book = parts[0];
          const chap = parts[1].split(':')[0];
          allChapters.add(`${book} ${chap}`);
        }
      }

      if (opts?.forceRescan) {
        for (const k of allChapters) scannedChaptersRef.current.delete(k);
        // Drop existing matches for this term so the UI refreshes cleanly.
        setVerseMatches((prev) => {
          const next = { ...prev };
          for (const ref of term.references) {
            if (next[`${term.id}-${ref}`]) delete next[`${term.id}-${ref}`];
          }
          return next;
        });
      } else {
        for (const k of allChapters) {
          if (scannedChaptersRef.current.has(k)) allChapters.delete(k);
        }
        if (allChapters.size === 0) return; // everything cached; nothing to do
      }

      setScanning(true);
      try {
        const chaptersToScan = allChapters;
        const newMatches: Record<string, VerseMatchStatus> = {};
        const scannedNow: string[] = [];

        const scanPromises = Array.from(chaptersToScan).map(async (bkChap) => {
          const [book, chapStr] = bkChap.split(' ');
          const chapter = parseInt(chapStr, 10);
          try {
            const res = await papi.commands.sendCommand(
              'paratextProjectManager.scanChapterRenderings',
              projectId,
              book,
              chapter,
            );
            const parsed = JSON.parse(res) as { matches: VerseMatchStatus[] };
            if (parsed && parsed.matches) {
              for (const match of parsed.matches) {
                newMatches[`${match.termId}-${match.reference}`] = match;
              }
              scannedNow.push(bkChap);
            }
          } catch (e) {
            if (isPapiDisconnectedError(e)) handleCatch(e);
            else console.warn('scanChapter failed for', bkChap, e);
          }
        });

        await Promise.all(scanPromises);
        for (const k of scannedNow) scannedChaptersRef.current.add(k);
        if (isCurrentRequest()) {
          setVerseMatches((prev) => ({ ...prev, ...newMatches }));
        }
      } catch (e) {
        if (isPapiDisconnectedError(e)) handleCatch(e);
        else console.warn('scanChapter error', e);
      } finally {
        if (isCurrentRequest()) setScanning(false);
      }
    },
    [projectId, store, selectedTermId, handleCatch],
  );

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
        if (isPapiDisconnectedError(e)) handleCatch(e);
        else console.error('Failed to navigate to verse:', e);
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
      invalidateScanCache(); // morpho config affects every chapter
      setTimeout(() => scanChapter({ forceRescan: true }), 300);
    },
    [store, persistStore, scanChapter, invalidateScanCache],
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
      invalidateScanCache(); // affix rules affect every chapter
      setTimeout(() => scanChapter({ forceRescan: true }), 300);
    },
    [store, persistStore, scanChapter, invalidateScanCache],
  );

  const addPrefixRule = useCallback(
    () =>
      addAffixRule(
        'prefix',
        newPrefix,
        newPrefixLabel,
        'Prefijo',
        () => setNewPrefix(''),
        () => setNewPrefixLabel(''),
      ),
    [addAffixRule, newPrefix, newPrefixLabel],
  );
  const addSuffixRule = useCallback(
    () =>
      addAffixRule(
        'suffix',
        newSuffix,
        newSuffixLabel,
        'Sufijo',
        () => setNewSuffix(''),
        () => setNewSuffixLabel(''),
      ),
    [addAffixRule, newSuffix, newSuffixLabel],
  );
  const addInfixRule = useCallback(
    () =>
      addAffixRule(
        'infix',
        newInfix,
        newInfixLabel,
        'Infijo',
        () => setNewInfix(''),
        () => setNewInfixLabel(''),
      ),
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
      invalidateScanCache();
      setTimeout(() => scanChapter({ forceRescan: true }), 300);
    },
    [store, persistStore, scanChapter, invalidateScanCache],
  );

  const deleteRule = useCallback(
    async (ruleId: string, type: 'prefix' | 'suffix' | 'infix') => {
      if (!store) return;
      const config = store.morphologyConfig;
      const key = type === 'prefix' ? 'prefixes' : type === 'suffix' ? 'suffixes' : 'infixes';
      const updated = ((config as any)[key] || []).filter((r: AffixRule) => r.id !== ruleId);
      await persistStore({ ...store, morphologyConfig: { ...config, [key]: updated } });
      invalidateScanCache();
      setTimeout(() => scanChapter({ forceRescan: true }), 300);
    },
    [store, persistStore, scanChapter, invalidateScanCache],
  );

  const selectedTerm = useMemo(() => {
    if (!store || !selectedTermId) return null;
    return store.terms.find((t) => t.id === selectedTermId) || null;
  }, [store, selectedTermId]);

  const termThreads = useMemo(() => {
    if (!selectedTermId) return [];
    return projectThreads.filter((t) => t.biblicalTermId === selectedTermId && !t.renderingId);
  }, [projectThreads, selectedTermId]);

  const getRenderingThreads = useCallback(
    (rendId: string) => {
      return projectThreads.filter(
        (t) => t.biblicalTermId === selectedTermId && t.renderingId === rendId,
      );
    },
    [projectThreads, selectedTermId],
  );

  useEffect(() => {
    if (selectedTerm && selectedTerm.references && selectedTerm.references.length > 0) {
      setNewNoteVerseRef(selectedTerm.references[0]);
    } else {
      setNewNoteVerseRef('GEN 1:1');
    }
  }, [selectedTermId, selectedTerm]);

  // True when every reference for the currently selected term already has a scan result
  // (used to toggle the Scan vs Re-scan label on the pasajes section).
  const allReferencesScanned = useMemo(() => {
    if (!selectedTerm || selectedTerm.references.length === 0) return false;
    return selectedTerm.references.every((ref) => !!verseMatches[`${selectedTerm.id}-${ref}`]);
  }, [selectedTerm, verseMatches]);

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
    invalidateScanCache(termChapterKeys(selectedTermId));
    setTimeout(() => scanChapter({ forceRescan: true }), 300);
  }, [
    store,
    selectedTermId,
    newRenderingText,
    currentUser,
    persistStore,
    scanChapter,
    invalidateScanCache,
    termChapterKeys,
  ]);

  // Add a rendering that was sent from the Scripture Viewer (right-click "Agregar como traducción"
  // or DnD). The verse ref is recorded as a context tag so the source is traceable.
  const addRenderingFromScripture = useCallback(
    async (text: string, verseRef: string) => {
      if (!store || !selectedTermId) return false;
      const cleanText = text.trim();
      if (!cleanText) return false;
      const now = new Date().toISOString();
      const fromTag = verseRef ? `from:${verseRef}` : '';
      const newRend: Rendering = {
        id: `r-${Date.now()}`,
        text: cleanText,
        status: 'proposed',
        contextTags: fromTag ? [fromTag] : [],
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
      await persistStore({ ...store, terms });
      invalidateScanCache(termChapterKeys(selectedTermId));
      setTimeout(() => scanChapter({ forceRescan: true }), 300);
      return true;
    },
    [
      store,
      selectedTermId,
      currentUser,
      persistStore,
      scanChapter,
      invalidateScanCache,
      termChapterKeys,
    ],
  );

  // Mark a verse reference as "found" manually, even if the rendering isn't
  // literally present in the verse text. Recorded with author + timestamp for audit.
  const markRefAsFound = useCallback(
    async (ref: string) => {
      if (!store || !selectedTermId) return;
      const now = new Date().toISOString();
      const terms = store.terms.map((t) => {
        if (t.id !== selectedTermId) return t;
        const existing = t.manualFoundRefs || [];
        if (existing.some((o) => o.reference === ref)) return t;
        return {
          ...t,
          manualFoundRefs: [...existing, { reference: ref, markedBy: currentUser, timestamp: now }],
          updatedAt: now,
        };
      });
      await persistStore({ ...store, terms });
      invalidateScanCache(termChapterKeys(selectedTermId));
      setTimeout(() => scanChapter({ forceRescan: true }), 300);
    },
    [
      store,
      selectedTermId,
      currentUser,
      persistStore,
      scanChapter,
      invalidateScanCache,
      termChapterKeys,
    ],
  );

  // Remove a manual "found" override.
  const unmarkRefAsFound = useCallback(
    async (ref: string) => {
      if (!store || !selectedTermId) return;
      const now = new Date().toISOString();
      const terms = store.terms.map((t) => {
        if (t.id !== selectedTermId) return t;
        const existing = t.manualFoundRefs || [];
        return {
          ...t,
          manualFoundRefs: existing.filter((o) => o.reference !== ref),
          updatedAt: now,
        };
      });
      await persistStore({ ...store, terms });
      invalidateScanCache(termChapterKeys(selectedTermId));
      setTimeout(() => scanChapter({ forceRescan: true }), 300);
    },
    [store, selectedTermId, persistStore, scanChapter, invalidateScanCache, termChapterKeys],
  );

  // Listen for "add rendering to selected term" events from the Scripture Viewer
  // (triggered by right-click → "Agregar como traducción" or native drag-and-drop).
  useEffect(() => {
    if (!papi.network || !papi.network.getNetworkEvent) return undefined;
    const unsubscribe = papi.network.getNetworkEvent<{
      projectId: string;
      renderingText: string;
      verseRef: string;
    }>('paratextProjectManager.onAddRenderingToSelectedTerm')((event) => {
      if (!event) return;
      if (event.projectId && event.projectId !== projectId) return;
      (async () => {
        if (!selectedTermId) {
          setError(tx('noTermSelectedForRendering'));
          return;
        }
        const ok = await addRenderingFromScripture(event.renderingText, event.verseRef);
        if (ok) {
          setError(tx('renderingAdded', event.renderingText));
        }
      })().catch((e) => {
        if (isPapiDisconnectedError(e)) setError(handleCatch(e));
        else console.error('Failed to add rendering from Scripture event:', e);
      });
    });
    return () => {
      unsubscribe();
    };
  }, [projectId, selectedTermId, addRenderingFromScripture, tx, handleCatch]);

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
      invalidateScanCache(termChapterKeys(selectedTermId));
      setTimeout(() => scanChapter({ forceRescan: true }), 300);
    },
    [store, selectedTermId, persistStore, scanChapter, invalidateScanCache, termChapterKeys],
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

  const handleReplyToThread = useCallback(
    async (threadId: string, text: string, verseRef: string, renderingId?: string) => {
      if (!projectId || !currentUser || !text.trim() || !selectedTermId) return false;
      try {
        const replyData = {
          threadId,
          verseRef,
          contents: text.trim(),
          biblicalTermId: selectedTermId,
          renderingId,
        };
        const res = await papi.commands.sendCommand(
          'paratextProjectManager.addNoteReply',
          projectId,
          currentUser,
          JSON.stringify(replyData),
        );
        if (res === 'ok' || (res && (res as any).status === 'ok')) {
          await loadProjectNotes();
          return true;
        } else {
          console.error('Failed to post reply:', res);
        }
      } catch (err) {
        console.error('Error posting reply:', err);
      }
      return false;
    },
    [projectId, currentUser, selectedTermId, loadProjectNotes],
  );

  const handleStartThread = useCallback(
    async (text: string, verseRef: string, renderingId?: string) => {
      if (!projectId || !currentUser || !text.trim() || !selectedTermId) return false;
      try {
        const threadId = `th_bt_${Date.now()}`;
        const replyData = {
          threadId,
          verseRef,
          contents: text.trim(),
          biblicalTermId: selectedTermId,
          renderingId,
        };
        const res = await papi.commands.sendCommand(
          'paratextProjectManager.addNoteReply',
          projectId,
          currentUser,
          JSON.stringify(replyData),
        );
        if (res === 'ok' || (res && (res as any).status === 'ok')) {
          await loadProjectNotes();
          return true;
        } else {
          console.error('Failed to start thread:', res);
        }
      } catch (err) {
        console.error('Error starting thread:', err);
      }
      return false;
    },
    [projectId, currentUser, selectedTermId, loadProjectNotes],
  );

  const handleSaveComment = useCallback(
    async (threadId: string, commentDate: string, commentUser: string, newContents: string) => {
      if (!projectId) return;
      try {
        const res = await papi.commands.sendCommand(
          'paratextProjectManager.saveProjectNote',
          projectId,
          commentUser,
          threadId,
          commentDate,
          newContents,
        );
        if (res === 'ok' || (res && (res as any).status === 'ok')) {
          await loadProjectNotes();
        } else {
          console.error('Failed to save comment:', res);
        }
      } catch (err) {
        console.error('Error saving comment:', err);
      }
    },
    [projectId, loadProjectNotes],
  );

  const handleDeleteComment = useCallback(
    async (threadId: string, commentDate: string, commentUser: string) => {
      if (!projectId) return;
      const confirmDelete = window.confirm(
        lang === 'en'
          ? 'Are you sure you want to delete this comment?'
          : '¿Está seguro de que desea eliminar este comentario?',
      );
      if (!confirmDelete) return;

      try {
        const res = await papi.commands.sendCommand(
          'paratextProjectManager.deleteProjectNote',
          projectId,
          commentUser,
          threadId,
          commentDate,
        );
        if (res === 'ok' || (res && (res as any).status === 'ok')) {
          await loadProjectNotes();
        } else {
          console.error('Failed to delete comment:', res);
        }
      } catch (err) {
        console.error('Error deleting comment:', err);
      }
    },
    [projectId, loadProjectNotes, lang],
  );

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
      .sort((a, b) => {
        if (sortBy === 'reference') {
          const refCompare = compareReferences(a.references?.[0], b.references?.[0]);
          if (refCompare !== 0) return refCompare;
          return a.gloss.localeCompare(b.gloss);
        }
        if (sortBy === 'notes') {
          const notesA = getTermNotesCount(a.id);
          const notesB = getTermNotesCount(b.id);
          if (notesB !== notesA) return notesB - notesA;
          return a.gloss.localeCompare(b.gloss);
        }
        // Default: gloss
        return a.gloss.localeCompare(b.gloss);
      });
  }, [store, searchTerm, filterDomain, filterCompletion, getTermStatus, sortBy, getTermNotesCount]);

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
      <div className="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:p-8 tw:text-center tw:gap-4 tw:text-sm tw:bg-slate-100 dark:tw:bg-slate-950 tw:text-slate-900 dark:tw:text-slate-100">
        <div className="tw:p-4 tw:bg-white dark:tw:bg-slate-900 tw:rounded-full tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:text-slate-500 dark:tw:text-slate-400">
          <BookOpen size={36} />
        </div>
        <p className="tw:text-slate-500 dark:tw:text-slate-400">{tx('selectProjectEmpty')}</p>
        <button
          type="button"
          className="tw:inline-flex tw:items-center tw:gap-2 tw:px-4 tw:py-2 tw:bg-indigo-600 tw:text-white tw:rounded-xl hover:tw:bg-indigo-700 tw:cursor-pointer tw:font-semibold tw:shadow-sm tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30 tw:focus-visible:ring-offset-2 tw:focus-visible:ring-offset-white dark:tw:focus-visible:ring-offset-slate-900"
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
        className="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:gap-4 tw:bg-slate-100 dark:tw:bg-slate-950 tw:text-slate-900 dark:tw:text-slate-100"
      >
        <div className="tw:flex tw:items-center tw:gap-3">
          <div className="tw:w-2 tw:h-2 tw:bg-indigo-600 tw:rounded-full tw:animate-ping" />
          <div className="tw:w-2 tw:h-2 tw:bg-indigo-600 tw:rounded-full tw:animate-pulse" />
          <div className="tw:w-2 tw:h-2 tw:bg-indigo-600 tw:rounded-full tw:animate-pulse tw:[animation-delay:0.2s]" />
        </div>
        <span className="tw:text-sm tw:text-slate-500 dark:tw:text-slate-400 tw:font-medium">
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
      cls: 'tw:bg-rose-500/15 tw:text-rose-600 dark:tw:text-rose-400 tw:border tw:border-rose-200 dark:tw:border-rose-900',
      text: tx('statusMissing'),
    };
  };

  return (
    <div className="tw:flex tw:h-full tw:overflow-hidden tw:bg-slate-100 dark:tw:bg-slate-950 tw:text-slate-900 dark:tw:text-slate-100 tw:font-sans">
      {/* Sidebar - Terms list */}
      {sidebarVisible && (
        <aside
          aria-label="Key terms list"
          style={{ width: `${sidebarWidth}px` }}
          className="tw:bg-slate-950 tw:text-slate-100 tw:border-r tw:border-slate-900 tw:flex tw:flex-col tw:h-full tw:flex-shrink-0"
        >
          <div className="tw:p-3 tw:border-b tw:border-slate-800/80 tw:space-y-2.5">
            <div className="tw:flex tw:items-center tw:justify-between tw:gap-2">
              <span className="tw:font-bold tw:text-sm tw:text-white tw:truncate">
                {tx('title')}
              </span>
              <button
                type="button"
                onClick={() => loadData()}
                title={tx('refresh')}
                aria-label={tx('refresh')}
                className="tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-slate-400 hover:tw:text-white tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30 tw:rounded"
              >
                <RefreshCw size={12} />
              </button>
            </div>

            {/* Search Input */}
            <div className="tw:relative">
              <Search
                size={12}
                className="tw:absolute tw:left-2.5 tw:top-1/2 tw:-translate-y-1/2 tw:text-slate-500 tw:pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                placeholder={tx('searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="tw:w-full tw:border tw:border-slate-800 tw:rounded-xl tw:pl-7 tw:pr-7 tw:py-1.5 tw:text-xs tw:bg-slate-900 tw:text-slate-100 tw:placeholder:tw:text-slate-500 tw:focus:outline-none tw:focus:ring-2 tw:focus:ring-indigo-500/50 tw:focus:border-indigo-500"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  aria-label="Clear search"
                  className="tw:absolute tw:right-2 tw:top-1/2 tw:-translate-y-1/2 tw:text-slate-500 hover:tw:text-white tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30 tw:rounded"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Semantic Domain Filter */}
            <div className="tw:flex tw:flex-col tw:gap-1">
              <label className="tw:text-[10px] tw:text-slate-400 tw:font-semibold tw:uppercase">
                {tx('semanticDomain')}
              </label>
              <select
                value={filterDomain}
                onChange={(e) => setFilterDomain(e.target.value)}
                className="tw:w-full tw:border tw:border-slate-800 tw:rounded-xl tw:px-2 tw:py-1 tw:text-xs tw:bg-slate-900 tw:text-slate-100 tw:focus:outline-none tw:focus:ring-2 tw:focus:ring-indigo-500/50 tw:focus:border-indigo-500"
              >
                <option value="all">{tx('allDomains')}</option>
                {allDomains.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            {/* Sort By Filter */}
            <div className="tw:flex tw:flex-col tw:gap-1">
              <label className="tw:text-[10px] tw:text-slate-400 tw:font-semibold tw:uppercase">
                {tx('sortByLabel')}
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="tw:w-full tw:border tw:border-slate-800 tw:rounded-xl tw:px-2 tw:py-1 tw:text-xs tw:bg-slate-900 tw:text-slate-100 tw:focus:outline-none tw:focus:ring-2 tw:focus:ring-indigo-500/50 tw:focus:border-indigo-500"
              >
                <option value="gloss">{tx('sortGloss')}</option>
                <option value="reference">{tx('sortReference')}</option>
                <option value="notes">{tx('sortNotes')}</option>
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
                  className={`tw:flex-1 tw:min-w-[60px] tw:py-0.5 tw:px-1.5 tw:text-[10px] tw:rounded-lg tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30 ${filterCompletion === opt.key ? 'tw:bg-slate-800 tw:text-white tw:font-medium' : 'tw:text-slate-400 tw:border-transparent hover:tw:bg-slate-800/70'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Status legend (always visible) */}
            <div
              aria-label="Status legend"
              className="tw:flex tw:items-center tw:gap-2 tw:flex-wrap tw:pt-1 tw:text-[9px] tw:text-slate-400"
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
                <span className="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-rose-600" />
                {tx('statusMissing')}
              </span>
            </div>

            {/* Micro stats bar */}
            <div className="tw:pt-1 tw:text-[10px] tw:text-slate-400 tw:flex tw:justify-between tw:flex-wrap tw:gap-1">
              <span>{tx('completed', String(completionStats.percent))}</span>
              <span>
                {tx('termsCount', String(filteredTerms.length), String(store?.terms.length || 0))}
              </span>
            </div>
          </div>

          {/* List area */}
          <div
            ref={sidebarListRef}
            className="tw:flex-1 tw:overflow-y-auto tw:divide-y tw:divide-slate-800 scrollbar-thin tw:p-2 tw:space-y-1.5"
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
                  className={`tw:w-full tw:text-left tw:p-3 tw:rounded-xl tw:border tw:flex tw:flex-col tw:gap-1.5 tw:transition-colors tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30 ${isSelected ? 'tw:bg-slate-800 tw:border-slate-700 tw:shadow-inner' : 'tw:border-transparent hover:tw:bg-slate-800/60'}`}
                >
                  <div className="tw:flex tw:items-start tw:justify-between tw:gap-2 tw:min-w-0">
                    <span
                      className={`tw:font-semibold tw:text-sm tw:truncate ${isSelected ? 'tw:text-white' : 'tw:text-slate-200 group-hover:tw:text-white'}`}
                    >
                      {term.gloss}
                    </span>
                    <span
                      className={`tw:flex-shrink-0 tw:text-[9px] tw:px-1.5 tw:py-0.5 tw:rounded-full tw:font-medium ${badge.cls}`}
                    >
                      {badge.text}
                    </span>
                  </div>
                  <div
                    className={`tw:flex tw:items-center tw:justify-between tw:gap-2 tw:text-xs tw:min-w-0 ${isSelected ? 'tw:text-slate-400' : 'tw:text-slate-500'}`}
                  >
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
              <div className="tw:p-4 tw:text-center tw:text-xs tw:text-slate-500">
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
          className="tw:w-1 tw:cursor-col-resize tw:bg-slate-950 tw:border-r tw:border-slate-900 hover:tw:bg-indigo-500/30 tw:transition-colors tw:h-full tw:flex-shrink-0 tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30"
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
      <div className="tw:flex-1 tw:flex tw:flex-col tw:h-full tw:overflow-hidden tw:min-w-0 tw:bg-[#f8fafc] dark:tw:bg-slate-900">
        {/* Top toolbar */}
        <div className="tw:px-3 sm:tw:px-4 tw:py-3 tw:bg-white dark:tw:bg-slate-900 tw:border-b tw:border-slate-200 dark:tw:border-slate-800 tw:flex tw:items-center tw:justify-between tw:gap-2 tw:flex-wrap">
          <div className="tw:flex tw:items-center tw:gap-2 sm:tw:gap-3 tw:min-w-0 tw:flex-1">
            <button
              type="button"
              onClick={() => setSidebarVisible((v) => !v)}
              title={sidebarVisible ? tx('toggleSidebarHide') : tx('toggleSidebarShow')}
              aria-label={sidebarVisible ? tx('toggleSidebarHide') : tx('toggleSidebarShow')}
              className="tw:p-1.5 tw:rounded-lg tw:text-slate-500 dark:tw:text-slate-400 hover:tw:bg-slate-50 dark:hover:tw:bg-slate-800 tw:cursor-pointer tw:flex-shrink-0 tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30"
            >
              <Menu size={18} />
            </button>
            <span className="tw:font-bold tw:text-slate-900 dark:tw:text-slate-100 tw:truncate tw:text-sm sm:tw:text-base">
              {tx('title')}
            </span>
          </div>

          <div className="tw:flex tw:items-center tw:gap-2 sm:tw:gap-3 tw:flex-wrap">
            {saving && (
              <span
                role="status"
                aria-live="polite"
                className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-slate-500 dark:tw:text-slate-400"
              >
                <span className="tw:w-1.5 tw:h-1.5 tw:bg-indigo-600 tw:rounded-full tw:animate-pulse" />
                <span className="tw:hidden sm:tw:inline">{tx('saving')}</span>
              </span>
            )}
            <button
              type="button"
              onClick={toggleLang}
              title={tx('toggleLanguage')}
              aria-label={tx('toggleLanguage')}
              className="tw:inline-flex tw:items-center tw:gap-1 tw:px-2 tw:py-1.5 tw:bg-white dark:tw:bg-slate-900 tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:rounded-lg tw:text-xs tw:font-semibold tw:text-slate-500 dark:tw:text-slate-400 hover:tw:bg-slate-50 dark:hover:tw:bg-slate-800 tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30"
            >
              <Languages size={12} />
              <span className="tw:uppercase">{lang}</span>
            </button>
            <button
              type="button"
              className="tw:inline-flex tw:items-center tw:gap-1.5 tw:px-2.5 sm:tw:px-3 tw:py-1.5 tw:bg-indigo-50 dark:tw:bg-indigo-900/30 tw:text-indigo-600 dark:tw:text-indigo-400 tw:border tw:border-indigo-200 dark:tw:border-indigo-800 tw:rounded-xl tw:text-xs tw:font-medium hover:tw:bg-indigo-100 dark:tw:bg-indigo-900/40 tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30"
              onClick={() => selectProject()}
            >
              {tx('changeProject')}
            </button>

            <Avatar
              name={currentUser}
              onClick={() => setShowAvatarSettings(true)}
              className="tw:ml-1"
            />
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="tw:bg-rose-50 dark:tw:bg-rose-950/40 tw:border-b tw:border-rose-200 dark:tw:border-rose-900 tw:px-3 sm:tw:px-4 tw:py-2 tw:text-rose-600 dark:tw:text-rose-400 tw:text-xs tw:font-medium tw:flex tw:justify-between tw:items-center tw:gap-2"
          >
            <span className="tw:flex tw:items-center tw:gap-2 tw:min-w-0 tw:truncate">
              <AlertTriangle size={14} className="tw:flex-shrink-0" />
              <span className="tw:truncate">{error}</span>
            </span>
            {disconnected ? (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="tw:bg-rose-600 hover:tw:bg-rose-700 tw:text-white tw:px-3 tw:py-1 tw:rounded tw:font-semibold tw:cursor-pointer tw:transition-opacity tw:flex-shrink-0"
                title="Recargar la vista para reestablecer la conexión con Paratext"
              >
                Reconectar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => loadData()}
                className="tw:text-rose-600 dark:tw:text-rose-400 tw:underline hover:tw:opacity-80 tw:cursor-pointer tw:flex-shrink-0 tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30 tw:rounded"
              >
                ({tx('retry')})
              </button>
            )}
          </div>
        )}

        {/* Workspace area */}
        {selectedTerm ? (
          <div
            ref={rightPanelRef}
            className="tw:flex-1 tw:overflow-y-auto tw:p-3 sm:tw:p-4 tw:space-y-4 tw:min-w-0"
          >
            {/* Term Summary Card */}
            <div className="tw:bg-white dark:tw:bg-slate-900 tw:p-4 tw:rounded-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:shadow-sm tw:space-y-3">
              <div className="tw:flex tw:items-start tw:justify-between tw:gap-3 tw:min-w-0">
                <div className="tw:min-w-0 tw:flex-1">
                  <h2 className="tw:text-xl tw:font-bold tw:text-slate-900 dark:tw:text-slate-100 tw:break-words">
                    {selectedTerm.gloss}
                  </h2>
                  <div className="tw:flex tw:items-center tw:gap-2 tw:mt-1 tw:flex-wrap">
                    <span className="tw:font-serif tw:text-lg tw:text-indigo-600 dark:tw:text-indigo-400 tw:break-all">
                      {selectedTerm.lemma}
                    </span>
                    {selectedTerm.transliteration && (
                      <span className="tw:text-sm tw:text-slate-500 dark:tw:text-slate-400 tw:italic tw:break-words">
                        ({selectedTerm.transliteration})
                      </span>
                    )}
                  </div>
                </div>
                {selectedTerm.strongs && (
                  <span className="tw:px-2.5 tw:py-1 tw:bg-slate-100 dark:tw:bg-slate-800 tw:text-slate-700 dark:tw:text-slate-300 tw:rounded-lg tw:text-xs tw:font-mono tw:flex-shrink-0">
                    {selectedTerm.strongs}
                  </span>
                )}
              </div>

              {selectedTerm.domains && selectedTerm.domains.length > 0 && (
                <div className="tw:flex tw:gap-1.5 tw:flex-wrap">
                  {selectedTerm.domains.map((dom) => (
                    <span
                      key={dom}
                      className="tw:text-[10px] tw:px-2 tw:py-0.5 tw:bg-indigo-50 dark:tw:bg-indigo-900/30 tw:text-indigo-600 dark:tw:text-indigo-400 tw:rounded-lg tw:font-semibold tw:uppercase"
                    >
                      {dom}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Renderings Card */}
            <div
              className={`tw:bg-white dark:tw:bg-slate-900 tw:p-4 tw:rounded-2xl tw:border tw:shadow-sm tw:space-y-4 tw:transition-colors ${
                renderingsDropActive
                  ? 'tw:border-indigo-400 tw:ring-2 tw:ring-indigo-300/50'
                  : 'tw:border-slate-200 dark:tw:border-slate-800'
              }`}
              onDragOver={(e) => {
                if (!selectedTermId) return;
                if (
                  e.dataTransfer.types.includes('application/x-paratext-rendering') ||
                  e.dataTransfer.types.includes('text/plain')
                ) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                  if (!renderingsDropActive) setRenderingsDropActive(true);
                }
              }}
              onDragLeave={(e) => {
                // Only deactivate when the cursor leaves the card entirely
                if (
                  e.currentTarget instanceof Element &&
                  !e.currentTarget.contains(e.relatedTarget as Node)
                ) {
                  setRenderingsDropActive(false);
                }
              }}
              onDrop={async (e) => {
                e.preventDefault();
                setRenderingsDropActive(false);
                if (!selectedTermId) {
                  setError(tx('noTermSelectedForRendering'));
                  return;
                }
                let text = '';
                let verseRef = '';
                const custom = e.dataTransfer.getData('application/x-paratext-rendering');
                if (custom) {
                  try {
                    const parsed = JSON.parse(custom);
                    text = String(parsed.text || '').trim();
                    if (parsed.bookCode && parsed.chapter && parsed.verse) {
                      verseRef = `${parsed.bookCode} ${parsed.chapter}:${parsed.verse}`;
                    }
                  } catch {
                    /* fall through to text/plain */
                  }
                }
                if (!text) {
                  text = e.dataTransfer.getData('text/plain').trim();
                }
                if (!text) return;
                const ok = await addRenderingFromScripture(text, verseRef);
                if (ok) {
                  setError(tx('renderingAdded', text));
                }
              }}
            >
              <div className="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:flex-wrap">
                <h3 className="tw:font-bold tw:text-sm tw:text-slate-900 dark:tw:text-slate-100 tw:uppercase tw:tracking-wider">
                  {tx('renderingsTitle')}
                </h3>
                {renderingsDropActive && (
                  <span
                    className="tw:inline-flex tw:items-center tw:gap-1 tw:text-[10px] tw:font-semibold tw:text-indigo-600 dark:tw:text-indigo-400 tw:uppercase tw:tracking-wider tw:animate-pulse"
                    aria-live="polite"
                  >
                    {tx('dropRenderingHere')}
                  </span>
                )}
              </div>

              <div className="tw:flex tw:gap-2 tw:flex-wrap sm:tw:flex-nowrap">
                <input
                  type="text"
                  placeholder={tx('addRenderingPlaceholder')}
                  value={newRenderingText}
                  onChange={(e) => setNewRenderingText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addRendering()}
                  className="tw:flex-1 tw:min-w-0 tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:rounded-xl tw:px-3 tw:py-2 tw:text-xs tw:bg-white dark:tw:bg-slate-900 tw:text-slate-900 dark:tw:text-slate-100 tw:placeholder:tw:text-slate-500 dark:tw:text-slate-400 tw:focus:outline-none tw:focus:ring-2 tw:focus:ring-indigo-500/30"
                />
                <button
                  type="button"
                  onClick={addRendering}
                  className="tw:inline-flex tw:items-center tw:gap-1 tw:px-4 tw:py-2 tw:bg-indigo-600 tw:text-white tw:rounded-xl tw:text-xs tw:font-medium hover:tw:bg-indigo-700 tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30"
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
                    const rendThreads = getRenderingThreads(rendId);
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
                        className="tw:p-3 tw:bg-slate-100 dark:tw:bg-slate-800 tw:rounded-xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:space-y-2"
                      >
                        <div className="tw:flex tw:items-start tw:justify-between tw:gap-3 tw:min-w-0">
                          <div className="tw:space-y-1 tw:min-w-0 tw:flex-1">
                            <span className="tw:font-bold tw:text-sm tw:text-slate-900 dark:tw:text-slate-100 tw:break-words tw:block">
                              {rend.text}
                            </span>
                            <div className="tw:flex tw:items-center tw:gap-1.5 tw:flex-wrap">
                              <span className="tw:text-[10px] tw:text-slate-500 dark:tw:text-slate-400">
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
                            className={`tw:flex-shrink-0 tw:text-xs tw:px-2 tw:py-1 tw:rounded-lg tw:border tw:font-medium tw:focus:outline-none tw:focus:ring-2 tw:focus:ring-indigo-500/30 ${rend.status === 'approved' ? 'tw:bg-emerald-500/15 tw:text-emerald-700 dark:tw:text-emerald-400 tw:border-emerald-500/30' : rend.status === 'disputed' ? 'tw:bg-rose-500/15 tw:text-rose-600 dark:tw:text-rose-400 tw:border-rose-200 dark:tw:border-rose-900' : rend.status === 'proposed' ? 'tw:bg-amber-500/15 tw:text-amber-700 dark:tw:text-amber-400 tw:border-amber-500/30' : 'tw:bg-slate-100 dark:tw:bg-slate-800 tw:text-slate-700 dark:tw:text-slate-300 tw:border-slate-200 dark:tw:border-slate-800'}`}
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
                              className={`tw:inline-flex tw:items-center tw:gap-1 tw:px-2 tw:py-1 tw:rounded-lg tw:border tw:text-xs tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30 ${hasUpvoted ? 'tw:bg-indigo-50 dark:tw:bg-indigo-900/30 tw:text-indigo-600 dark:tw:text-indigo-400 tw:border-indigo-200 dark:tw:border-indigo-800' : 'tw:bg-white dark:tw:bg-slate-900 tw:text-slate-500 dark:tw:text-slate-400 tw:border-slate-200 dark:tw:border-slate-800 hover:tw:bg-slate-50 dark:hover:tw:bg-slate-800'}`}
                            >
                              <ThumbsUp size={12} />
                              <span className="tw:font-semibold">{upVotes}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => voteRendering(rendId, 'down')}
                              aria-label="Down vote"
                              aria-pressed={hasDownvoted}
                              className={`tw:inline-flex tw:items-center tw:gap-1 tw:px-2 tw:py-1 tw:rounded-lg tw:border tw:text-xs tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30 ${hasDownvoted ? 'tw:bg-rose-50 dark:tw:bg-rose-950/40 tw:text-rose-600 dark:tw:text-rose-400 tw:border-rose-200 dark:tw:border-rose-900' : 'tw:bg-white dark:tw:bg-slate-900 tw:text-slate-500 dark:tw:text-slate-400 tw:border-slate-200 dark:tw:border-slate-800 hover:tw:bg-slate-50 dark:hover:tw:bg-slate-800'}`}
                            >
                              <ThumbsDown size={12} />
                              <span className="tw:font-semibold">{downVotes}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedRendDiscussions((prev) => ({
                                  ...prev,
                                  [rendId]: !prev[rendId],
                                }))
                              }
                              aria-pressed={expandedRendDiscussions[rendId]}
                              className={`tw:inline-flex tw:items-center tw:gap-1.5 tw:px-2 tw:py-1 tw:rounded-lg tw:border tw:text-xs tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30 ${expandedRendDiscussions[rendId] ? 'tw:bg-indigo-100/40 tw:text-indigo-600 tw:border-indigo-200' : 'tw:bg-white dark:tw:bg-slate-900 tw:text-slate-500 dark:tw:text-slate-400 tw:border-slate-200 dark:tw:border-slate-800 hover:tw:bg-slate-50 dark:hover:tw:bg-slate-800'}`}
                              title="Discuss this rendering"
                            >
                              <span>💬 Discuss</span>
                              {rendThreads.length > 0 && (
                                <span className="tw:font-semibold tw:bg-indigo-100 tw:text-indigo-700 tw:px-1.5 tw:py-0.2 tw:rounded-full tw:text-[9px]">
                                  {rendThreads.reduce((sum, t) => sum + t.comments.length, 0)}
                                </span>
                              )}
                            </button>
                          </div>

                          <div className="tw:flex tw:items-center tw:gap-1 tw:flex-wrap">
                            {rend.contextTags &&
                              rend.contextTags.map((tag) => (
                                <span
                                  key={tag}
                                  className="tw:inline-flex tw:items-center tw:gap-1 tw:text-[10px] tw:bg-slate-100 dark:tw:bg-slate-800 tw:text-slate-700 dark:tw:text-slate-300 tw:rounded tw:px-1.5 tw:py-0.5 tw:font-medium"
                                >
                                  #{tag}
                                  <button
                                    type="button"
                                    onClick={() => removeContextTag(rendId, tag)}
                                    aria-label={`Remove tag ${tag}`}
                                    className="tw:text-slate-500 dark:tw:text-slate-400 hover:tw:text-slate-900 dark:tw:text-slate-100 tw:font-bold tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-indigo-500/30 tw:rounded"
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
                                className="tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:rounded tw:px-1 tw:py-0.5 tw:text-[10px] tw:w-16 tw:bg-white dark:tw:bg-slate-900 tw:text-slate-900 dark:tw:text-slate-100 tw:focus:outline-none tw:focus:ring-2 tw:focus:ring-indigo-500/30"
                              />
                              <button
                                type="button"
                                onClick={() => addContextTag(rendId)}
                                aria-label="Add tag"
                                className="tw:inline-flex tw:items-center tw:justify-center tw:px-1.5 tw:bg-slate-100 dark:tw:bg-slate-800 tw:rounded tw:text-[10px] hover:tw:bg-slate-50 dark:hover:tw:bg-slate-800 tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-indigo-500/30"
                              >
                                <Plus size={10} />
                              </button>
                            </div>
                          </div>
                        </div>

                        {expandedRendDiscussions[rendId] && (
                          <div className="tw:mt-3 tw:pt-3 tw:border-t tw:border-slate-200 dark:tw:border-slate-800/60 tw:space-y-3">
                            <div className="tw:text-[11px] tw:font-semibold tw:text-slate-500 dark:tw:text-slate-400 tw:uppercase">
                              Discussion on "{rend.text}"
                            </div>

                            {/* Render active comments for this rendering */}
                            {rendThreads.length > 0 ? (
                              <div className="tw:space-y-2.5 tw:max-h-48 tw:overflow-y-auto">
                                {rendThreads.map((thread) =>
                                  thread.comments.map((comment) => (
                                    <CommentItem
                                      key={`${thread.threadId}-${comment.date}`}
                                      comment={comment}
                                      threadId={thread.threadId}
                                      currentUser={currentUser}
                                      lang={lang}
                                      editingCommentKey={editingCommentKey}
                                      setEditingCommentKey={setEditingCommentKey}
                                      handleSaveComment={handleSaveComment}
                                      handleDeleteComment={handleDeleteComment}
                                      isCompact={true}
                                    />
                                  )),
                                )}
                              </div>
                            ) : (
                              <div className="tw:text-xs tw:text-slate-500 dark:tw:text-slate-400 tw:italic tw:py-1">
                                No discussion on this rendering yet. Start one below.
                              </div>
                            )}

                            {/* Post a comment for this rendering */}
                            <CommentBox
                              placeholder="Start discussion or reply..."
                              buttonText="Comment"
                              onSubmit={async (txt) => {
                                const existingThread = rendThreads[0];
                                const verseRef = selectedTerm.references[0] || 'GEN 1:1';
                                if (existingThread) {
                                  return await handleReplyToThread(
                                    existingThread.threadId,
                                    txt,
                                    existingThread.verseRef,
                                    rendId,
                                  );
                                } else {
                                  return await handleStartThread(txt, verseRef, rendId);
                                }
                              }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}

                {(!selectedTerm.renderings || selectedTerm.renderings.length === 0) && (
                  <div className="tw:text-xs tw:text-slate-500 dark:tw:text-slate-400 tw:text-center tw:py-4 tw:italic">
                    {tx('noRenderings')}
                  </div>
                )}
              </div>
            </div>

            {/* Collaborative notes panel */}
            <div className="tw:bg-white dark:tw:bg-slate-900 tw:rounded-xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:shadow-sm tw:overflow-hidden">
              <button
                type="button"
                onClick={() => setCollabPanelOpen((o) => !o)}
                aria-expanded={collabPanelOpen}
                className="tw:w-full tw:px-4 tw:py-3 tw:bg-slate-100 dark:tw:bg-slate-800 tw:flex tw:items-center tw:justify-between tw:cursor-pointer tw:border-b tw:border-slate-200 dark:tw:border-slate-800 hover:tw:bg-slate-50 dark:hover:tw:bg-slate-800 tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30"
              >
                <span className="tw:font-bold tw:text-xs tw:text-slate-500 dark:tw:text-slate-400 tw:uppercase tw:tracking-wider">
                  {tx('collabNotesTitle')}
                </span>
                <span className="tw:flex tw:items-center tw:gap-2">
                  {termThreads.length > 0 && (
                    <span className="tw:px-1.5 tw:py-0.5 tw:bg-indigo-50 dark:tw:bg-indigo-900/30 tw:text-indigo-600 dark:tw:text-indigo-400 tw:rounded tw:text-[10px] tw:font-semibold">
                      {termThreads.length} {termThreads.length === 1 ? 'thread' : 'threads'}
                    </span>
                  )}
                  {collabPanelOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </span>
              </button>

              {collabPanelOpen && (
                <div className="tw:p-4 tw:space-y-6">
                  {/* List of active threads */}
                  {termThreads.length > 0 && (
                    <div className="tw:space-y-4">
                      {termThreads.map((thread) => (
                        <div
                          key={thread.threadId}
                          className="tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:rounded-xl tw:overflow-hidden tw:bg-slate-100 dark:tw:bg-slate-800/20"
                        >
                          {/* Thread Header */}
                          <div className="tw:px-3 tw:py-2 tw:bg-slate-100 dark:tw:bg-slate-800/60 tw:border-b tw:border-slate-200 dark:tw:border-slate-800 tw:flex tw:items-center tw:justify-between tw:gap-2">
                            <span className="tw:text-xs tw:font-bold tw:text-slate-900 dark:tw:text-slate-100">
                              Reference: {thread.verseRef}
                            </span>
                            <span className="tw:text-[10px] tw:text-slate-500 dark:tw:text-slate-400">
                              {thread.comments.length}{' '}
                              {thread.comments.length === 1 ? 'comment' : 'comments'}
                            </span>
                          </div>

                          {/* Comments list */}
                          <div className="tw:p-3 tw:space-y-2.5 tw:max-h-60 tw:overflow-y-auto">
                            {thread.comments.map((comment) => (
                              <CommentItem
                                key={`${thread.threadId}-${comment.date}`}
                                comment={comment}
                                threadId={thread.threadId}
                                currentUser={currentUser}
                                lang={lang}
                                editingCommentKey={editingCommentKey}
                                setEditingCommentKey={setEditingCommentKey}
                                handleSaveComment={handleSaveComment}
                                handleDeleteComment={handleDeleteComment}
                                isCompact={false}
                              />
                            ))}
                          </div>

                          {/* Reply box for this thread */}
                          <div className="tw:p-3 tw:bg-slate-100 dark:tw:bg-slate-800/10 tw:border-t tw:border-slate-200 dark:tw:border-slate-800">
                            <CommentBox
                              placeholder="Write a reply..."
                              buttonText="Reply"
                              onSubmit={async (txt) => {
                                return await handleReplyToThread(
                                  thread.threadId,
                                  txt,
                                  thread.verseRef,
                                );
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {termThreads.length === 0 && (
                    <div className="tw:text-xs tw:text-slate-500 dark:tw:text-slate-400 tw:text-center tw:py-4 tw:italic">
                      {tx('noNotes')}
                    </div>
                  )}

                  {/* Start new thread section */}
                  <div className="tw:border-t tw:border-slate-200 dark:tw:border-slate-800 tw:pt-4 tw:space-y-3">
                    <h4 className="tw:text-xs tw:font-bold tw:text-slate-900 dark:tw:text-slate-100">
                      Start a New Discussion Thread
                    </h4>
                    <div className="tw:flex tw:items-center tw:gap-2">
                      <label className="tw:text-xs tw:text-slate-500 dark:tw:text-slate-400">
                        Associate with reference:
                      </label>
                      <select
                        value={newNoteVerseRef}
                        onChange={(e) => setNewNoteVerseRef(e.target.value)}
                        className="tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:rounded-lg tw:px-2 tw:py-1 tw:text-xs tw:bg-white dark:tw:bg-slate-900 tw:text-slate-900 dark:tw:text-slate-100"
                      >
                        {selectedTerm.references && selectedTerm.references.length > 0 ? (
                          selectedTerm.references.map((ref) => (
                            <option key={ref} value={ref}>
                              {ref}
                            </option>
                          ))
                        ) : (
                          <option value="GEN 1:1">GEN 1:1</option>
                        )}
                      </select>
                    </div>

                    <CommentBox
                      placeholder={tx('notesPlaceholder')}
                      buttonText={tx('sendNote')}
                      icon={<CheckCircle2 size={12} />}
                      rows={2}
                      onSubmit={async (txt) => {
                        return await handleStartThread(txt, newNoteVerseRef);
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Expected Verse References List */}
            <div className="tw:bg-white dark:tw:bg-slate-900 tw:p-4 tw:rounded-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:shadow-sm tw:space-y-3">
              <div className="tw:flex tw:items-center tw:justify-between tw:flex-wrap tw:gap-2">
                <h3 className="tw:font-bold tw:text-sm tw:text-slate-900 dark:tw:text-slate-100 tw:uppercase tw:tracking-wider">
                  {tx('expectedPassages')}
                </h3>
                <div className="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
                  {scanning && (
                    <span
                      role="status"
                      aria-live="polite"
                      className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-slate-500 dark:tw:text-slate-400"
                    >
                      <RefreshCw size={12} className="tw:animate-spin" />
                      {tx('scanning')}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => scanChapter({ forceRescan: true })}
                    disabled={scanning}
                    className="tw:inline-flex tw:items-center tw:gap-1 tw:px-2.5 tw:py-1 tw:bg-indigo-50 dark:tw:bg-indigo-900/30 tw:text-indigo-600 dark:tw:text-indigo-400 tw:border tw:border-indigo-200 dark:tw:border-indigo-800 tw:rounded-xl tw:text-xs tw:font-medium hover:tw:bg-indigo-100 dark:tw:bg-indigo-900/40 tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30 disabled:tw:opacity-50 disabled:tw:cursor-not-allowed"
                  >
                    <RefreshCw size={12} className={scanning ? 'tw:animate-spin' : ''} />
                    {allReferencesScanned ? tx('rescanPassages') : tx('scanPassages')}
                  </button>
                </div>
              </div>

              {!allReferencesScanned && !scanning && (
                <p className="tw:text-[11px] tw:text-slate-500 dark:tw:text-slate-400 tw:italic">
                  {tx('scanPrompt')}
                </p>
              )}

              <div className="tw:divide-y tw:divide-slate-200 dark:tw:divide-slate-800 tw:max-h-72 tw:overflow-y-auto">
                {selectedTerm.references &&
                  selectedTerm.references.map((ref) => {
                    const match = verseMatches[`${selectedTerm.id}-${ref}`];
                    const manualOverride = (selectedTerm.manualFoundRefs || []).find(
                      (o) => o.reference === ref,
                    );
                    const isManualFound = !!manualOverride;
                    let badge: React.ReactElement;
                    if (isManualFound) {
                      badge = (
                        <span
                          className="tw:inline-flex tw:items-center tw:gap-1 tw:px-2 tw:py-0.5 tw:bg-sky-500/15 tw:text-sky-700 dark:tw:text-sky-400 tw:border tw:border-sky-500/30 tw:rounded-lg tw:text-[10px] tw:font-semibold"
                          title={
                            manualOverride?.markedBy
                              ? `Marked by ${manualOverride.markedBy} on ${new Date(
                                  manualOverride.timestamp,
                                ).toLocaleString()}`
                              : ''
                          }
                        >
                          <Check size={10} />
                          {tx('foundManual')}
                        </span>
                      );
                    } else if (match?.matchResult.found) {
                      badge = (
                        <span className="tw:inline-flex tw:items-center tw:gap-1 tw:px-2 tw:py-0.5 tw:bg-emerald-500/15 tw:text-emerald-700 dark:tw:text-emerald-400 tw:border tw:border-emerald-500/30 tw:rounded-lg tw:text-[10px] tw:font-semibold">
                          <Check size={10} />
                          {tx('found', match.matchResult.matchedText || '')}
                        </span>
                      );
                    } else if (match) {
                      badge = (
                        <span className="tw:inline-flex tw:items-center tw:gap-1 tw:px-2 tw:py-0.5 tw:bg-rose-500/15 tw:text-rose-600 dark:tw:text-rose-400 tw:border tw:border-rose-200 dark:tw:border-rose-900 tw:rounded-lg tw:text-[10px] tw:font-semibold">
                          <CircleX size={10} />
                          {tx('missing')}
                        </span>
                      );
                    } else {
                      badge = (
                        <span className="tw:px-2 tw:py-0.5 tw:bg-slate-100 dark:tw:bg-slate-800 tw:text-slate-500 dark:tw:text-slate-400 tw:rounded-lg tw:text-[10px]">
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
                          className="tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-indigo-600 dark:tw:text-indigo-400 tw:font-semibold hover:tw:underline tw:cursor-pointer tw:text-left tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-indigo-500/30 tw:rounded"
                        >
                          <ChevronRight size={12} />
                          {ref}
                        </button>
                        <div className="tw:flex tw:items-center tw:gap-1.5 tw:flex-shrink-0">
                          {badge}
                          {isManualFound ? (
                            <button
                              type="button"
                              onClick={() => unmarkRefAsFound(ref)}
                              aria-label={tx('removeManualMark')}
                              title={tx('removeManualMarkTitle')}
                              className="tw:inline-flex tw:items-center tw:justify-center tw:w-5 tw:h-5 tw:rounded-md tw:text-slate-500 dark:tw:text-slate-400 hover:tw:bg-rose-50 dark:hover:tw:bg-rose-950/40 hover:tw:text-rose-600 dark:hover:tw:text-rose-400 tw:transition-colors tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-indigo-500/30"
                            >
                              <X size={10} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => markRefAsFound(ref)}
                              aria-label={tx('markAsFound')}
                              title={tx('markAsFoundTitle')}
                              className="tw:inline-flex tw:items-center tw:justify-center tw:gap-1 tw:px-1.5 tw:py-0.5 tw:rounded-md tw:text-sky-700 dark:tw:text-sky-400 tw:border tw:border-sky-200 dark:tw:border-sky-900 hover:tw:bg-sky-50 dark:hover:tw:bg-sky-950/40 tw:transition-colors tw:cursor-pointer tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-indigo-500/30 tw:text-[10px] tw:font-semibold"
                            >
                              <Check size={10} />
                              {tx('markAsFound')}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Morphology Configuration Panel */}
            <div className="tw:bg-white dark:tw:bg-slate-900 tw:rounded-xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:shadow-sm tw:overflow-hidden">
              <button
                type="button"
                onClick={() => setMorphPanelOpen((o) => !o)}
                aria-expanded={morphPanelOpen}
                className="tw:w-full tw:px-4 tw:py-3 tw:bg-slate-100 dark:tw:bg-slate-800 tw:flex tw:items-center tw:justify-between tw:cursor-pointer tw:border-b tw:border-slate-200 dark:tw:border-slate-800 hover:tw:bg-slate-50 dark:hover:tw:bg-slate-800 tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30"
              >
                <span className="tw:font-bold tw:text-xs tw:text-slate-500 dark:tw:text-slate-400 tw:uppercase tw:tracking-wider">
                  {tx('morphologyTitle')}
                </span>
                {morphPanelOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {morphPanelOpen && store && (
                <div className="tw:p-4 tw:space-y-4">
                  <div className="tw:grid tw:grid-cols-1 md:tw:grid-cols-2 tw:gap-4">
                    <div className="tw:space-y-1">
                      <label className="tw:text-xs tw:font-semibold tw:text-slate-500 dark:tw:text-slate-400">
                        {tx('languageName')}
                      </label>
                      <input
                        type="text"
                        value={store.morphologyConfig.languageName || ''}
                        onChange={(e) => handleMorphologyChange({ languageName: e.target.value })}
                        className="tw:w-full tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:rounded-xl tw:px-2.5 tw:py-1.5 tw:text-xs tw:bg-white dark:tw:bg-slate-900 tw:text-slate-900 dark:tw:text-slate-100 tw:focus:outline-none tw:focus:ring-2 tw:focus:ring-indigo-500/30"
                      />
                    </div>

                    <div className="tw:space-y-2">
                      <label className="tw:flex tw:items-center tw:gap-2 tw:text-xs tw:font-semibold tw:text-slate-500 dark:tw:text-slate-400 tw:cursor-pointer">
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
                          <span className="tw:text-xs tw:text-slate-500 dark:tw:text-slate-400">
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
                          <span className="tw:text-xs tw:font-bold tw:text-slate-900 dark:tw:text-slate-100 tw:min-w-4">
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
                        <span className="tw:font-bold tw:text-xs tw:text-slate-900 dark:tw:text-slate-100">
                          {column.title}
                        </span>

                        <div className="tw:flex tw:gap-1">
                          <input
                            type="text"
                            placeholder={column.placeholder}
                            value={column.value}
                            onChange={(e) => column.setValue(e.target.value)}
                            aria-label={column.title}
                            className="tw:w-16 tw:flex-shrink-0 tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:rounded-xl tw:px-2 tw:py-1 tw:text-xs tw:bg-white dark:tw:bg-slate-900 tw:text-slate-900 dark:tw:text-slate-100 tw:focus:outline-none tw:focus:ring-2 tw:focus:ring-indigo-500/30"
                          />
                          <input
                            type="text"
                            placeholder={tx('labelPlaceholder')}
                            value={column.labelValue}
                            onChange={(e) => column.setLabelValue(e.target.value)}
                            aria-label={`${column.title} label`}
                            className="tw:flex-1 tw:min-w-0 tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:rounded-xl tw:px-2 tw:py-1 tw:text-xs tw:bg-white dark:tw:bg-slate-900 tw:text-slate-900 dark:tw:text-slate-100 tw:focus:outline-none tw:focus:ring-2 tw:focus:ring-indigo-500/30"
                          />
                          <button
                            type="button"
                            onClick={column.add}
                            aria-label={`Add ${column.type}`}
                            className="tw:inline-flex tw:items-center tw:justify-center tw:px-2.5 tw:py-1 tw:bg-indigo-600 tw:text-white tw:rounded-xl tw:text-xs hover:tw:bg-indigo-700 tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-indigo-500/30"
                          >
                            <Plus size={12} />
                          </button>
                        </div>

                        <div className="tw:space-y-1 tw:max-h-36 tw:overflow-y-auto">
                          {column.list &&
                            column.list.map((rule) => (
                              <div
                                key={rule.id}
                                className="tw:flex tw:items-center tw:justify-between tw:p-1.5 tw:bg-slate-100 dark:tw:bg-slate-800 tw:rounded tw:text-xs tw:gap-2"
                              >
                                <label className="tw:flex tw:items-center tw:gap-2 tw:cursor-pointer tw:min-w-0 tw:flex-1">
                                  <input
                                    type="checkbox"
                                    checked={rule.enabled}
                                    onChange={() => toggleRule(rule.id, column.type)}
                                  />
                                  <span className="tw:font-bold tw:text-slate-900 dark:tw:text-slate-100 tw:truncate">
                                    {rule.affix}
                                  </span>
                                  <span className="tw:text-slate-500 dark:tw:text-slate-400 tw:truncate">
                                    ({rule.label})
                                  </span>
                                </label>
                                <button
                                  type="button"
                                  onClick={() => deleteRule(rule.id, column.type)}
                                  aria-label={`Delete ${column.type} rule`}
                                  className="tw:text-slate-500 dark:tw:text-slate-400 hover:tw:text-rose-600 dark:tw:text-rose-400 tw:flex-shrink-0 tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-indigo-500/30 tw:rounded"
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
          </div>
        ) : (
          <div className="tw:flex-1 tw:flex tw:flex-col tw:items-center tw:justify-center tw:text-slate-500 dark:tw:text-slate-400 tw:text-sm tw:gap-3 tw:p-8 tw:text-center">
            <div className="tw:p-4 tw:bg-white dark:tw:bg-slate-900 tw:rounded-full tw:border tw:border-slate-200 dark:tw:border-slate-800">
              <BookOpen size={32} />
            </div>
            <p className="tw:max-w-xs">{tx('selectTermPrompt')}</p>
          </div>
        )}
      </div>

      {showAvatarSettings && (
        <AvatarSettingsModal
          currentUser={currentUser}
          onClose={() => setShowAvatarSettings(false)}
        />
      )}
    </div>
  );
};
