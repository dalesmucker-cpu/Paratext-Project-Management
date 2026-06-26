import { WebViewProps } from '@papi/core';
import papi from '@papi/frontend';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Search,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Reply,
  AtSign,
  GitPullRequest,
  GitMerge,
  CircleX,
  Cloud,
  AlertTriangle,
  Plus,
  Settings,
  X,
  Edit3,
  Trash2,
} from 'lucide-react';
import { papiRetry, isPapiDisconnectedError } from './utils/papi-retry';
import { usePapiDisconnect } from './utils/use-papi-disconnect';
import { useLocalizedStrings } from './utils/i18n';
import { diffUsfm, summarizeUsfmDiff, type UsfmDiffSegment } from './utils/usfm-diff';
import type {
  PullRequest,
  PullRequestsStore,
  PrComment,
  AlternativeRendering,
  QuorumConfig,
  ReviewerRole,
} from './types/pull-requests.types';
import { BIBLE_BOOKS, generateId } from './types/shared.constants';

type StatusFilter = 'all' | 'Open' | 'Needs Review' | 'Approved';
type Tab = 'details' | 'checks' | 'history';

const STATUS_FILTERS: StatusFilter[] = ['all', 'Open', 'Needs Review', 'Approved'];
const TABS: Tab[] = ['details', 'checks', 'history'];
const FILTER_LABEL_KEYS: Record<StatusFilter, string> = {
  all: 'filterAll',
  Open: 'filterOpen',
  'Needs Review': 'filterReview',
  Approved: 'filterApproved',
};
const TAB_LABEL_KEYS: Record<Tab, string> = {
  details: 'tabDetails',
  checks: 'tabChecks',
  history: 'tabHistory',
};

interface ChapterVerseText {
  number: number;
  text: string;
}

interface EmailDraft {
  prId: number;
  recipients: string;
  subject: string;
  body: string;
}

interface OfflineQueueAction {
  type: 'vote' | 'comment' | 'status';
  projectId: string;
  prId: number;
  user: string;
  value?: 'up' | 'down';
  reason?: string;
  text?: string;
  parentId?: string;
  newStatus?: string;
}

async function processQueueAction(action: OfflineQueueAction): Promise<boolean> {
  try {
    if (action.type === 'vote') {
      await papi.commands.sendCommand(
        'paratextProjectManager.castPrVote',
        action.projectId,
        action.prId,
        action.user,
        action.value ?? 'up',
        action.reason ?? '',
      );
    } else if (action.type === 'comment') {
      const dataStr = await papi.commands.sendCommand(
        'paratextProjectManager.getPullRequests',
        action.projectId,
      );
      const s: PullRequestsStore = JSON.parse(dataStr);
      const pr = s.prs.find((p) => p.id === action.prId);
      if (pr) {
        pr.comments.push({
          id: generateId(),
          author: action.user,
          text: action.text ?? '',
          timestamp: new Date().toISOString(),
          parentId: action.parentId,
          mentions: extractMentions(action.text ?? ''),
        });
        pr.updatedAt = new Date().toISOString();
        await papi.commands.sendCommand(
          'paratextProjectManager.savePullRequests',
          action.projectId,
          JSON.stringify(s, undefined, 2),
        );
      }
    } else if (action.type === 'status') {
      await papi.commands.sendCommand(
        'paratextProjectManager.setPrStatus',
        action.projectId,
        action.prId,
        action.newStatus ?? 'open',
        action.user,
      );
    }
    return true;
  } catch {
    return false;
  }
}

function initials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function relativeTime(iso: string, lang: 'en' | 'es'): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);
  const ago = lang === 'en' ? 'ago' : 'atrás';
  if (sec < 60) return lang === 'en' ? 'just now' : 'ahora';
  if (min < 60) return `${min}m ${ago}`;
  if (hr < 24) return `${hr}h ${ago}`;
  if (day < 30) return `${day}d ${ago}`;
  return new Date(iso).toLocaleDateString(lang === 'en' ? 'en' : 'es');
}

function extractMentions(text: string): string[] {
  const matches = text.match(/@([\p{L}\p{M}\s]+?)(?=[\s.,;:!?'"]|$)/gu);
  if (!matches) return [];
  return matches.map((m) => m.slice(1).trim()).filter(Boolean);
}

function renderTextWithMentions(text: string): React.ReactNode[] {
  const re = /(@[\p{L}\p{M}\s]+?)(?=[\s.,;:!?'"]|$)/gu;
  const matches = Array.from(text.matchAll(re));
  const parts: React.ReactNode[] = [];
  let last = 0;
  matches.forEach((match) => {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <span
        key={`m-${match.index}`}
        className="tw:font-medium tw:text-indigo-700 dark:tw:text-indigo-300 tw:bg-indigo-50 dark:tw:bg-indigo-950/40 tw:px-1 tw:rounded"
      >
        {match[0]}
      </span>,
    );
    last = match.index + match[0].length;
  });
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

const STATUS_BADGE_DARK: Record<string, string> = {
  Open: 'tw:bg-blue-500/15 tw:text-blue-300 tw:ring-1 tw:ring-inset tw:ring-blue-500/25',
  'Needs Review':
    'tw:bg-amber-500/15 tw:text-amber-300 tw:ring-1 tw:ring-inset tw:ring-amber-500/25',
  Approved:
    'tw:bg-emerald-500/15 tw:text-emerald-300 tw:ring-1 tw:ring-inset tw:ring-emerald-500/25',
  Merged: 'tw:bg-violet-500/15 tw:text-violet-300 tw:ring-1 tw:ring-inset tw:ring-violet-500/25',
  Closed: 'tw:bg-slate-500/15 tw:text-slate-300 tw:ring-1 tw:ring-inset tw:ring-slate-500/25',
  Expired: 'tw:bg-slate-500/15 tw:text-slate-400 tw:ring-1 tw:ring-inset tw:ring-slate-500/25',
  Draft: 'tw:bg-slate-500/15 tw:text-slate-300 tw:ring-1 tw:ring-inset tw:ring-slate-500/25',
};

const STATUS_PILL: Record<string, string> = {
  Open: 'tw:bg-blue-50 tw:text-blue-700 tw:ring-blue-200',
  'Needs Review': 'tw:bg-amber-50 tw:text-amber-700 tw:ring-amber-200',
  Approved: 'tw:bg-emerald-50 tw:text-emerald-700 tw:ring-emerald-200',
  Merged: 'tw:bg-violet-50 tw:text-violet-700 tw:ring-violet-200',
  Closed: 'tw:bg-slate-100 tw:text-slate-600 tw:ring-slate-200',
  Expired: 'tw:bg-slate-100 tw:text-slate-500 tw:ring-slate-200',
  Draft: 'tw:bg-slate-100 tw:text-slate-600 tw:ring-slate-200',
};

/** Display label for a PR's status (the sidebar filter uses the capitalized form). */
function statusDisplay(pr: PullRequest): string {
  if (pr.status === 'needs-review') return 'Needs Review';
  return pr.status.charAt(0).toUpperCase() + pr.status.slice(1);
}

function diffMarkerColor(marker?: string): string {
  if (marker === 'w') return 'tw:text-amber-700 dark:tw:text-amber-300';
  if (marker === 'f') return 'tw:text-sky-700 dark:tw:text-sky-300';
  if (marker === 'nd') return 'tw:text-violet-700 dark:tw:text-violet-300';
  return '';
}

function DiffSegments({ segments }: { segments: UsfmDiffSegment[] }) {
  let n = 0;
  return (
    <>
      {segments.map((seg) => {
        const key = `seg-${seg.op}-${n}`;
        n += 1;
        if (seg.op === 'equal') {
          if (seg.kind === 'marker') {
            return (
              <span key={key} className="tw:text-slate-400">
                {seg.text}
              </span>
            );
          }
          return (
            <span
              key={key}
              className={seg.kind === 'space' ? '' : 'tw:text-slate-700 dark:tw:text-slate-200'}
            >
              {seg.text}
            </span>
          );
        }
        if (seg.op === 'delete') {
          return (
            <span
              key={key}
              className={`tw:bg-rose-100 dark:tw:bg-rose-950/50 tw:text-rose-700 dark:tw:text-rose-300 tw:line-through tw:decoration-rose-400 tw:px-0.5 tw:rounded ${diffMarkerColor(
                seg.marker,
              )}`}
            >
              {seg.text}
            </span>
          );
        }
        return (
          <span
            key={key}
            className={`tw:bg-emerald-100 dark:tw:bg-emerald-950/50 tw:text-emerald-700 dark:tw:text-emerald-300 tw:px-0.5 tw:rounded tw:ml-0.5 ${diffMarkerColor(
              seg.marker,
            )}`}
          >
            {seg.text}
          </span>
        );
      })}
    </>
  );
}

interface VerseContextStripProps {
  projectId: string | undefined;
  book: string;
  chapter: number;
  verse: number;
  lang: 'en' | 'es';
}

function VerseContextStrip({ projectId, book, chapter, verse, lang }: VerseContextStripProps) {
  const [verses, setVerses] = useState<ChapterVerseText[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!projectId || !book || !chapter) return;
      setLoading(true);
      try {
        const res = await papiRetry(() =>
          papi.commands.sendCommand(
            'paratextProjectManager.getChapterText',
            projectId,
            book,
            chapter,
          ),
        );
        if (cancelled) return;
        const parsed: {
          blocks: {
            type: string;
            children?: { type: string; number?: number; text?: string }[];
          }[];
        } = JSON.parse(res);
        const out: ChapterVerseText[] = [];
        parsed.blocks.forEach((block) => {
          (block.children || []).forEach((child) => {
            if (child.type === 'verse' && typeof child.number === 'number') {
              out.push({ number: child.number, text: child.text || '' });
            }
          });
        });
        setVerses(out);
      } catch {
        if (!cancelled) setVerses([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [projectId, book, chapter]);

  const lo = Math.max(1, verse - 2);
  const hi = verse + 2;
  const shown = verses.filter((v) => v.number >= lo && v.number <= hi);
  if (loading && shown.length === 0) {
    return (
      <div className="tw:px-4 tw:py-2 tw:text-[12px] tw:text-slate-400">
        {lang === 'en' ? 'Loading verse context…' : 'Cargando contexto…'}
      </div>
    );
  }
  if (shown.length === 0) return false;
  return (
    <div className="tw:px-4 tw:py-3 tw:border-b tw:border-slate-100 tw:bg-slate-50/50">
      <div className="tw:text-[11px] tw:font-semibold tw:uppercase tw:tracking-wider tw:text-slate-500 tw:mb-1.5">
        {lang === 'en' ? 'Verse context' : 'Contexto del versículo'}
      </div>
      <div className="tw:space-y-1">
        {shown.map((v) => (
          <div
            key={v.number}
            className={`tw:flex tw:gap-2 tw:text-[12.5px] tw:leading-snug ${
              v.number === verse ? 'tw:text-slate-900 tw:font-medium' : 'tw:text-slate-400'
            }`}
          >
            <span className="tw:font-mono tw:text-[11px] tw:shrink-0 tw:w-10 tw:text-slate-400">
              {v.number}
            </span>
            <span className="tw:whitespace-pre-wrap tw:break-words">{v.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface CommentThreadProps {
  comment: PrComment;
  replies: PrComment[];
  allComments: PrComment[];
  currentUser: string;
  lang: 'en' | 'es';
  onReply: (parentId: string, text: string) => Promise<boolean> | boolean;
  replyingTo: string | undefined;
  setReplyingTo: (id: string | undefined) => void;
  onEditComment: (commentId: string, newText: string) => void;
  onDeleteComment: (commentId: string) => void;
}

function CommentNode({
  comment,
  replies,
  allComments,
  currentUser,
  lang,
  onReply,
  replyingTo,
  setReplyingTo,
  onEditComment,
  onDeleteComment,
}: CommentThreadProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isReplying = replyingTo === comment.id;
  const isMe = comment.author === currentUser;

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(comment.text);

  useEffect(() => {
    setEditText(comment.text);
  }, [comment.text]);

  const submit = async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      const ok = await onReply(comment.id, text);
      if (ok) {
        setText('');
        setReplyingTo(undefined);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEdit = () => {
    if (!editText.trim() || editText.trim() === comment.text) return;
    onEditComment(comment.id, editText.trim());
    setIsEditing(false);
  };

  return (
    <div className="tw:flex tw:gap-3">
      <div className="tw:w-8 tw:h-8 tw:rounded-full tw:bg-slate-800 tw:text-white tw:grid tw:place-items-center tw:text-[11px] tw:font-medium tw:shrink-0">
        {initials(comment.author)}
      </div>
      <div className="tw:flex-1 tw:min-w-0">
        <div className="tw:flex tw:items-baseline tw:gap-2 tw:flex-wrap">
          <span className="tw:text-[14px] tw:font-medium tw:text-slate-900 dark:tw:text-slate-100">
            {comment.author}
          </span>
          {isMe && (
            <span className="tw:text-[10px] tw:px-1.5 tw:py-0.5 tw:rounded-full tw:bg-indigo-50 tw:text-indigo-700 tw:font-medium tw:ring-1 tw:ring-inset tw:ring-indigo-200">
              {lang === 'en' ? 'You' : 'Tú'}
            </span>
          )}
          <span className="tw:text-[12px] tw:text-slate-500">
            {relativeTime(comment.timestamp, lang)}
          </span>
          {comment.mentions.length > 0 && (
            <span className="tw:inline-flex tw:items-center tw:gap-0.5 tw:text-[10px] tw:px-1.5 tw:py-0.5 tw:rounded-full tw:bg-slate-100 tw:text-slate-600">
              <AtSign size={9} /> {comment.mentions.join(', ')}
            </span>
          )}
        </div>
        {isEditing ? (
          <div className="tw:mt-1.5 tw:space-y-2">
            <textarea
              rows={2}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="tw:w-full tw:resize-none tw:rounded-xl tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-3 tw:py-2 tw:text-[13px] focus:tw:outline-none focus:tw:ring-2 focus:tw:ring-indigo-500/30 focus:tw:border-indigo-500"
            />
            <div className="tw:flex tw:justify-end tw:gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setEditText(comment.text);
                }}
                className="tw:px-3 tw:py-1 tw:rounded-lg tw:text-[12px] tw:font-medium tw:text-slate-600 hover:tw:bg-slate-200/70"
              >
                {lang === 'en' ? 'Cancel' : 'Cancelar'}
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={!editText.trim() || editText.trim() === comment.text}
                className="tw:px-3 tw:py-1 tw:rounded-lg tw:bg-indigo-600 tw:text-white tw:text-[12px] tw:font-semibold hover:tw:bg-indigo-700 disabled:tw:opacity-50"
              >
                {lang === 'en' ? 'Save' : 'Guardar'}
              </button>
            </div>
          </div>
        ) : (
          <p className="tw:text-[14px] tw:leading-snug tw:text-slate-700 dark:tw:text-slate-300 tw:mt-1 tw:break-words">
            {renderTextWithMentions(comment.text)}
          </p>
        )}
        <div className="tw:flex tw:items-center tw:gap-4 tw:mt-2">
          <button
            type="button"
            onClick={() => setReplyingTo(isReplying ? undefined : comment.id)}
            className="tw:inline-flex tw:items-center tw:gap-1 tw:text-[12px] tw:text-slate-500 hover:tw:text-slate-800 dark:hover:tw:text-slate-200"
          >
            <Reply size={12} /> {lang === 'en' ? 'Reply' : 'Responder'}
          </button>
          {isMe && !isEditing && (
            <>
              <button
                type="button"
                onClick={() => {
                  setIsEditing(true);
                  setEditText(comment.text);
                }}
                className="tw:inline-flex tw:items-center tw:gap-1 tw:text-[12px] tw:text-slate-500 hover:tw:text-slate-800 dark:hover:tw:text-slate-200"
              >
                <Edit3 size={12} /> {lang === 'en' ? 'Edit' : 'Editar'}
              </button>
              <button
                type="button"
                onClick={() => onDeleteComment(comment.id)}
                className="tw:inline-flex tw:items-center tw:gap-1 tw:text-[12px] tw:text-rose-500 hover:tw:text-rose-700"
              >
                <Trash2 size={12} /> {lang === 'en' ? 'Delete' : 'Eliminar'}
              </button>
            </>
          )}
        </div>
        {isReplying && (
          <div className="tw:mt-2 tw:space-y-2">
            <textarea
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                lang === 'en' ? 'Reply… use @ to mention' : 'Responder… usa @ para mencionar'
              }
              className="tw:w-full tw:resize-none tw:rounded-xl tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-3 tw:py-2 tw:text-[13px] tw:placeholder-slate-400 focus:tw:outline-none focus:tw:ring-2 focus:tw:ring-indigo-500/30 focus:tw:border-indigo-500"
            />
            <div className="tw:flex tw:justify-end tw:gap-2">
              <button
                type="button"
                onClick={() => {
                  setReplyingTo(undefined);
                  setText('');
                }}
                className="tw:px-3 tw:py-1 tw:rounded-lg tw:text-[12px] tw:font-medium tw:text-slate-600 hover:tw:bg-slate-200/70"
              >
                {lang === 'en' ? 'Cancel' : 'Cancelar'}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!text.trim() || submitting}
                className="tw:px-3 tw:py-1 tw:rounded-lg tw:bg-indigo-600 tw:text-white tw:text-[12px] tw:font-semibold hover:tw:bg-indigo-700 disabled:tw:opacity-50"
              >
                {lang === 'en' ? 'Reply' : 'Responder'}
              </button>
            </div>
          </div>
        )}
        {replies.length > 0 && (
          <div className="tw:mt-3 tw:space-y-3 tw:border-l-2 tw:border-slate-100 dark:tw:border-slate-800 tw:pl-4">
            {replies.map((reply) => (
              <CommentNode
                key={reply.id}
                comment={reply}
                replies={allComments.filter((c) => c.parentId === reply.id)}
                allComments={allComments}
                currentUser={currentUser}
                lang={lang}
                onReply={onReply}
                replyingTo={replyingTo}
                setReplyingTo={setReplyingTo}
                onEditComment={onEditComment}
                onDeleteComment={onDeleteComment}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

globalThis.webViewComponent = function PullRequestsWebView({
  projectId,
  useWebViewState,
  prefillBook,
  prefillChapter,
  prefillVerse,
  prefillOriginalText,
  prefillProposedText,
  prefillTimestamp,
}: WebViewProps & {
  prefillBook?: string;
  prefillChapter?: number;
  prefillVerse?: number;
  prefillOriginalText?: string;
  prefillProposedText?: string;
  prefillTimestamp?: number;
}) {
  const [lang, setLang] = useWebViewState<string>('lang', 'es');
  const { tx, toggleLang } = useLocalizedStrings(lang, setLang, 'pr');
  const currentLang: 'en' | 'es' = lang === 'en' ? 'en' : 'es';

  const [store, setStore] = useState<PullRequestsStore | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { ready, disconnected, clearDisconnected, handleCatch } = usePapiDisconnect();

  const [currentUser, setCurrentUser] = useState('Translator');
  const [selectedId, setSelectedId] = useState<number | undefined>(undefined);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editForm, setEditForm] = useState({
    title: '',
    proposedText: '',
    rationale: '',
    originalBackTranslation: '',
    proposedBackTranslation: '',
  });
  const [commentToDeleteId, setCommentToDeleteId] = useState<string | undefined>(undefined);
  const [emailDraftModal, setEmailDraftModal] = useState<EmailDraft | undefined>(undefined);

  useEffect(() => {
    setShowDeleteModal(false);
    setShowRevertModal(false);
    setShowEditForm(false);
    setCommentToDeleteId(undefined);
    setEmailDraftModal(undefined);
  }, [selectedId]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('details');
  const [sidebarVisible, setSidebarVisible] = useWebViewState<boolean>('sidebarVisible', true);
  const [sidebarWidth, setSidebarWidth] = useWebViewState<number>('sidebarWidth', 300);

  const [prKind, setPrKind] = useState<'verse' | 'general'>('verse');

  const [createForm, setCreateForm] = useState({
    book: 'MAT',
    chapter: '1',
    verse: '1',
    title: '',
    originalText: '',
    proposedText: '',
    rationale: '',
    originalBackTranslation: '',
    proposedBackTranslation: '',
  });

  useEffect(() => {
    if (prefillBook !== undefined || prefillChapter !== undefined || prefillVerse !== undefined) {
      setCreateForm({
        book: prefillBook || 'MAT',
        chapter: prefillChapter !== undefined ? String(prefillChapter) : '1',
        verse: prefillVerse !== undefined ? String(prefillVerse) : '1',
        title: `Change to ${prefillBook} ${prefillChapter}:${prefillVerse}`,
        originalText: prefillOriginalText || '',
        proposedText: prefillProposedText || '',
        rationale: '',
        originalBackTranslation: '',
        proposedBackTranslation: '',
      });
      setPrKind('verse');
      setShowCreateForm(true);
    }
  }, [
    prefillBook,
    prefillChapter,
    prefillVerse,
    prefillOriginalText,
    prefillProposedText,
    prefillTimestamp,
  ]);

  const containerRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);
  const sidebarWidthRef = useRef(sidebarWidth);
  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMoveGlobal = (moveEvent: PointerEvent) => {
      if (!isResizingRef.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = moveEvent.clientX - containerRect.left;
      const minW = 240;
      const maxW = Math.max(minW, containerRect.width - 320);
      const boundedWidth = Math.max(minW, Math.min(maxW, newWidth));
      setSidebarWidth(boundedWidth);
    };

    const handlePointerUpGlobal = () => {
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      window.removeEventListener('pointermove', handlePointerMoveGlobal);
      window.removeEventListener('pointerup', handlePointerUpGlobal);
    };

    window.addEventListener('pointermove', handlePointerMoveGlobal);
    window.addEventListener('pointerup', handlePointerUpGlobal);
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const containerWidth = entry.contentRect.width;
        const maxW = Math.max(240, containerWidth - 320);
        if (sidebarWidthRef.current > maxW) {
          setSidebarWidth(Math.max(240, maxW));
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [setSidebarWidth]);

  const [toast, setToast] = useState<string | undefined>(undefined);
  const [replyingTo, setReplyingTo] = useState<string | undefined>(undefined);
  const [commentInput, setCommentInput] = useState('');
  const [altInput, setAltInput] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Phase 2 state
  const [teamMembers, setTeamMembers] = useState<string[]>([]);
  const [teamRoles, setTeamRoles] = useState<Record<string, string>>({});
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [downvoteModal, setDownvoteModal] = useState<
    | {
        prId: number;
        reason: string;
      }
    | undefined
  >(undefined);
  const [createFetching, setCreateFetching] = useState(false);

  // Phase 3: offline queue + revert
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueueAction[]>([]);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const offlineQueueRef = useRef(offlineQueue);
  offlineQueueRef.current = offlineQueue;
  const disconnectedRef = useRef(false);
  disconnectedRef.current = disconnected;

  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(() => setError(''), 15000);
    return () => clearTimeout(t);
  }, [error]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), 2400);
  }, []);

  const loadData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    clearDisconnected();
    try {
      const dataStr = await papiRetry(() =>
        papi.commands.sendCommand('paratextProjectManager.getPullRequests', projectId),
      );
      const parsed: PullRequestsStore = JSON.parse(dataStr);
      setStore(parsed);
      setSelectedId((prev) =>
        prev !== undefined && parsed.prs.some((p) => p.id === prev) ? prev : parsed.prs[0]?.id,
      );
      const user = await papiRetry(() =>
        papi.commands.sendCommand('paratextProjectManager.getCurrentUser'),
      );
      if (user) setCurrentUser(user);
      const membersStr = await papiRetry(() =>
        papi.commands.sendCommand('paratextProjectManager.getTeamMembers'),
      );
      const members: string[] = JSON.parse(membersStr);
      setTeamMembers(members);
      const rolesStr = await papiRetry(() =>
        papi.commands.sendCommand('paratextProjectManager.getTeamRoles'),
      );
      setTeamRoles(JSON.parse(rolesStr));
    } catch (e: unknown) {
      if (isPapiDisconnectedError(e)) setError(handleCatch(e));
      else setError(handleCatch(e, tx('errorLoading', '')));
    } finally {
      setLoading(false);
    }
  }, [projectId, tx, clearDisconnected, handleCatch]);

  useEffect(() => {
    if (ready) loadData();
  }, [ready, loadData]);

  const persist = useCallback(
    async (updated: PullRequestsStore) => {
      if (!projectId) return;
      setSaving(true);
      setStore(updated);
      try {
        await papi.commands.sendCommand(
          'paratextProjectManager.savePullRequests',
          projectId,
          JSON.stringify(updated, undefined, 2),
        );
      } catch (e: unknown) {
        if (isPapiDisconnectedError(e)) setError(handleCatch(e));
        else setError(handleCatch(e, tx('errorSaving', '')));
      } finally {
        setSaving(false);
      }
    },
    [projectId, tx, handleCatch],
  );

  const selected = useMemo(
    () => store?.prs.find((p) => p.id === selectedId) ?? undefined,
    [store, selectedId],
  );

  const filteredPrs = useMemo(() => {
    if (!store) return [];
    let list = filter === 'all' ? store.prs : store.prs.filter((p) => statusDisplay(p) === filter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((p) =>
        `${p.id} ${p.refLabel} ${p.title} ${p.author}`.toLowerCase().includes(q),
      );
    }
    return list;
  }, [store, filter, search]);

  const upCount = (pr: PullRequest) => pr.votes.filter((v) => v.value === 'up').length;
  const downCount = (pr: PullRequest) => pr.votes.filter((v) => v.value === 'down').length;
  const userVote = (pr: PullRequest) =>
    pr.votes.find((v) => v.user === currentUser)?.value ?? undefined;

  const weightedUpCount = (pr: PullRequest) =>
    pr.votes.filter((v) => v.value === 'up').reduce((sum, v) => sum + v.weight, 0);
  const weightedDownCount = (pr: PullRequest) =>
    pr.votes.filter((v) => v.value === 'down').reduce((sum, v) => sum + v.weight, 0);

  const quorumMet = (pr: PullRequest) => {
    const minUpvotes = store?.quorum.minUpvotes ?? 2;
    return weightedUpCount(pr) >= minUpvotes;
  };

  const canMerge = (pr: PullRequest): { ok: boolean; reason?: string } => {
    if (pr.status === 'draft') return { ok: false, reason: tx('cannotMergeDraft') };
    if (pr.status === 'needs-review') return { ok: false, reason: tx('cannotMergeReview') };
    if (pr.status === 'merged' || pr.status === 'closed' || pr.status === 'expired') {
      return { ok: false };
    }
    if (!quorumMet(pr)) {
      const needed = (store?.quorum.minUpvotes ?? 2) - weightedUpCount(pr);
      return { ok: false, reason: tx('cannotMergeQuorum', needed) };
    }
    if (store?.quorum.requireNoConsultantDownvotes) {
      const consultantDown = pr.votes.filter(
        (v) => v.value === 'down' && v.role === 'consultant',
      ).length;
      if (consultantDown > 0) return { ok: false, reason: tx('cannotMergeReview') };
    }
    return { ok: true };
  };

  const castVote = useCallback(
    async (pr: PullRequest, value: 'up' | 'down') => {
      if (!projectId) return;
      // Queue offline if disconnected
      if (disconnectedRef.current) {
        setOfflineQueue((q) => [
          ...q,
          { type: 'vote', projectId, prId: pr.id, user: currentUser, value },
        ]);
        showToast(tx('offlineQueued'));
        return;
      }
      // For downvotes, show the reason modal instead of voting immediately
      if (value === 'down') {
        const existing = pr.votes.find((v) => v.user === currentUser);
        if (existing?.value === 'down') {
          // Toggling off the downvote — no reason needed
          try {
            await papi.commands.sendCommand(
              'paratextProjectManager.castPrVote',
              projectId,
              pr.id,
              currentUser,
              'down',
              '',
            );
            await loadData();
            showToast(tx('votedDown'));
          } catch (e: unknown) {
            setError(handleCatch(e, tx('errorSaving', '')));
          }
          return;
        }
        setDownvoteModal({ prId: pr.id, reason: '' });
        return;
      }
      try {
        await papi.commands.sendCommand(
          'paratextProjectManager.castPrVote',
          projectId,
          pr.id,
          currentUser,
          'up',
          '',
        );
        await loadData();
        showToast(tx('votedUp'));
      } catch (e: unknown) {
        // If it was a disconnect error, queue it
        if (isPapiDisconnectedError(e)) {
          setOfflineQueue((q) => [
            ...q,
            { type: 'vote', projectId, prId: pr.id, user: currentUser, value },
          ]);
          showToast(tx('offlineQueued'));
        } else {
          setError(handleCatch(e, tx('errorSaving', '')));
        }
      }
    },
    [projectId, currentUser, loadData, showToast, tx, handleCatch],
  );

  const submitDownvote = useCallback(async () => {
    if (!downvoteModal || !projectId) return;
    const reason = downvoteModal.reason.trim();
    if (!reason) return;
    if (disconnectedRef.current) {
      setOfflineQueue((q) => [
        ...q,
        {
          type: 'vote',
          projectId,
          prId: downvoteModal.prId,
          user: currentUser,
          value: 'down',
          reason,
        },
      ]);
      setDownvoteModal(undefined);
      showToast(tx('offlineQueued'));
      return;
    }
    try {
      await papi.commands.sendCommand(
        'paratextProjectManager.castPrVote',
        projectId,
        downvoteModal.prId,
        currentUser,
        'down',
        reason,
      );
      await loadData();
      setDownvoteModal(undefined);
      showToast(tx('votedDown'));
    } catch (e: unknown) {
      if (isPapiDisconnectedError(e)) {
        setOfflineQueue((q) => [
          ...q,
          {
            type: 'vote',
            projectId,
            prId: downvoteModal.prId,
            user: currentUser,
            value: 'down',
            reason,
          },
        ]);
        setDownvoteModal(undefined);
        showToast(tx('offlineQueued'));
      } else {
        setError(handleCatch(e, tx('errorSaving', '')));
      }
    }
  }, [downvoteModal, projectId, currentUser, loadData, showToast, tx, handleCatch]);

  const submitForReview = useCallback(
    async (pr: PullRequest) => {
      if (!projectId) return;
      try {
        await papi.commands.sendCommand(
          'paratextProjectManager.setPrStatus',
          projectId,
          pr.id,
          'open',
          currentUser,
        );
        await loadData();
        showToast(tx('submitForReview'));
      } catch (e: unknown) {
        setError(handleCatch(e, tx('errorSaving', '')));
      }
    },
    [projectId, currentUser, loadData, showToast, tx, handleCatch],
  );

  const createPr = useCallback(async () => {
    if (!projectId) return;
    const isGen = prKind === 'general';
    const chapter = isGen ? 0 : parseInt(createForm.chapter, 10);
    const verse = isGen ? 0 : parseInt(createForm.verse, 10);
    if (!isGen && (Number.isNaN(chapter) || Number.isNaN(verse))) return;
    if (!createForm.title.trim() || !createForm.proposedText.trim()) return;
    try {
      const result = await papi.commands.sendCommand(
        'paratextProjectManager.createPullRequest',
        projectId,
        isGen ? '' : createForm.book,
        chapter,
        verse,
        createForm.title.trim(),
        isGen ? '' : createForm.originalText,
        createForm.proposedText.trim(),
        createForm.rationale.trim(),
        currentUser,
        'open',
        createForm.originalBackTranslation.trim(),
        createForm.proposedBackTranslation.trim(),
      );
      if (typeof result === 'string' && result.startsWith('error')) {
        setError(tx('createError', result));
        return;
      }
      const parsed: { id: number } = JSON.parse(result);
      await loadData();
      setSelectedId(parsed.id);
      setShowCreateForm(false);
      setCreateForm({
        book: 'MAT',
        chapter: '1',
        verse: '1',
        title: '',
        originalText: '',
        proposedText: '',
        rationale: '',
        originalBackTranslation: '',
        proposedBackTranslation: '',
      });
      setPrKind('verse');
      showToast(tx('createSuccess', parsed.id));
    } catch (e: unknown) {
      setError(handleCatch(e, tx('createError', '')));
    }
  }, [projectId, createForm, prKind, currentUser, loadData, tx, handleCatch, showToast]);

  const fetchVerseText = useCallback(
    async (book: string, chapter: number, verse: number) => {
      if (!projectId) return;
      setCreateFetching(true);
      try {
        const res = await papiRetry(() =>
          papi.commands.sendCommand(
            'paratextProjectManager.getChapterText',
            projectId,
            book,
            chapter,
          ),
        );
        const parsed: {
          blocks: {
            type: string;
            children?: { type: string; number?: number; text?: string }[];
          }[];
        } = JSON.parse(res);
        let found = '';
        parsed.blocks.forEach((block) => {
          (block.children || []).forEach((child) => {
            if (child.type === 'verse' && child.number === verse) {
              found = child.text || '';
            }
          });
        });
        setCreateForm((prev) => ({ ...prev, originalText: found }));
      } catch {
        setCreateForm((prev) => ({ ...prev, originalText: '' }));
      } finally {
        setCreateFetching(false);
      }
    },
    [projectId],
  );

  const updateTeamRole = useCallback(
    async (member: string, role: ReviewerRole) => {
      const updated = { ...teamRoles, [member]: role };
      setTeamRoles(updated);
      try {
        await papi.commands.sendCommand(
          'paratextProjectManager.setTeamRoles',
          JSON.stringify(updated),
        );
        showToast(`${tx('settings')} ✓`);
      } catch (e: unknown) {
        setError(handleCatch(e, tx('errorSaving', '')));
      }
    },
    [teamRoles, showToast, tx, handleCatch],
  );

  const updateQuorum = useCallback(
    async (quorum: QuorumConfig) => {
      if (!projectId || !store) return;
      const updated = { ...store, quorum };
      setStore(updated);
      try {
        await papi.commands.sendCommand(
          'paratextProjectManager.setPrQuorumConfig',
          projectId,
          JSON.stringify(quorum),
        );
      } catch (e: unknown) {
        setError(handleCatch(e, tx('errorSaving', '')));
      }
    },
    [projectId, store, tx, handleCatch],
  );

  const revertPr = useCallback(
    async (pr: PullRequest) => {
      if (!projectId) return;
      try {
        const result = await papi.commands.sendCommand(
          'paratextProjectManager.revertPullRequest',
          projectId,
          pr.id,
          currentUser,
        );
        if (typeof result === 'string' && result.startsWith('error')) {
          setError(tx('revertError', result));
          return;
        }
        const parsed: { id: number } = JSON.parse(result);
        await loadData();
        setSelectedId(parsed.id);
        showToast(tx('reverted', parsed.id));
      } catch (e: unknown) {
        setError(handleCatch(e, tx('revertError', '')));
      }
    },
    [projectId, currentUser, loadData, tx, handleCatch, showToast],
  );

  const deletePr = useCallback(
    async (pr: PullRequest) => {
      if (!projectId) return;
      try {
        const result = await papi.commands.sendCommand(
          'paratextProjectManager.deletePullRequest',
          projectId,
          pr.id,
        );
        if (typeof result === 'string' && result.startsWith('error')) {
          setError(tx('deleteError', result));
          return;
        }
        await loadData();
        setSelectedId(undefined);
        showToast(tx('deleteSuccess', pr.id));
      } catch (e: unknown) {
        setError(handleCatch(e, tx('deleteError', '')));
      }
    },
    [projectId, loadData, tx, handleCatch, showToast],
  );

  const emailReviewers = useCallback(
    (pr: PullRequest) => {
      if (!store) return;
      const consultant = store.quorum.consultantEmail || '';
      const org = store.quorum.orgEmail || '';

      if (!consultant && !org) {
        showToast(tx('emailConfigRequired'));
        setShowSettings(true);
        return;
      }

      const recipients = [consultant, org].filter(Boolean).join(', ');
      const subject = `[Review Request] PR #${pr.id} (${pr.refLabel}): ${pr.title}`;

      let bodyText = `Please review this Translation Proposal:\n\n`;
      bodyText += `PR ID: #${pr.id}\n`;
      bodyText += `Title: ${pr.title}\n`;
      bodyText += `Reference: ${pr.refLabel}\n`;
      bodyText += `Author: ${pr.author}\n`;
      bodyText += `Status: ${pr.status}\n\n`;

      if (pr.kind === 'general') {
        bodyText += `--- Proposed Decision ---\n`;
        bodyText += `${pr.proposedText}\n\n`;
      } else {
        bodyText += `--- Original USFM ---\n`;
        bodyText += `${pr.originalText}\n\n`;
        bodyText += `--- Proposed USFM ---\n`;
        bodyText += `${pr.proposedText}\n\n`;
      }

      if (pr.originalBackTranslation || pr.proposedBackTranslation) {
        bodyText += `--- Back-Translation ---\n`;
        if (pr.originalBackTranslation) {
          bodyText += `Before: ${pr.originalBackTranslation}\n`;
        }
        if (pr.proposedBackTranslation) {
          bodyText += `After: ${pr.proposedBackTranslation}\n`;
        }
        bodyText += `\n`;
      }

      if (pr.rationale) {
        bodyText += `--- Rationale ---\n`;
        bodyText += `${pr.rationale}\n\n`;
      }

      bodyText += `To vote or comment, please open this PR in Paratext 10.`;

      setEmailDraftModal({
        prId: pr.id,
        recipients,
        subject,
        body: bodyText,
      });
    },
    [store, tx, showToast],
  );

  const handleCopyDraft = useCallback(() => {
    if (!emailDraftModal) return;
    const textToCopy = `Subject: ${emailDraftModal.subject}\n\n${emailDraftModal.body}`;
    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        showToast(tx('emailCopied'));
      })
      .catch((err) => {
        console.error('Failed to copy text: ', err);
        showToast('Failed to copy to clipboard.');
      });
  }, [emailDraftModal, tx, showToast]);

  const handleSendEmail = useCallback(async () => {
    if (!emailDraftModal) return;
    const { recipients, subject, body } = emailDraftModal;
    const mailtoUrl = `mailto:${recipients.trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    try {
      await papi.commands.sendCommand('paratextProjectManager.openExternal', mailtoUrl);
      setEmailDraftModal(undefined);
    } catch (e) {
      console.error('Failed to open mail app:', e);
      showToast('Failed to open mail application.');
    }
  }, [emailDraftModal, showToast]);

  const savePrEdit = useCallback(async () => {
    if (!store || !selected || !editForm.title.trim() || !editForm.proposedText.trim()) return;
    const updated: PullRequestsStore = {
      ...store,
      prs: store.prs.map((p) =>
        p.id === selected.id
          ? {
              ...p,
              title: editForm.title.trim(),
              proposedText: editForm.proposedText.trim(),
              rationale: editForm.rationale.trim(),
              originalBackTranslation: editForm.originalBackTranslation.trim() || undefined,
              proposedBackTranslation: editForm.proposedBackTranslation.trim() || undefined,
              updatedAt: new Date().toISOString(),
              history: [
                ...p.history,
                {
                  id: generateId(),
                  actor: currentUser,
                  action: 'edited',
                  timestamp: new Date().toISOString(),
                },
              ],
            }
          : p,
      ),
    };
    await persist(updated);
    setShowEditForm(false);
    showToast(tx('prUpdated'));
  }, [store, selected, editForm, currentUser, persist, tx, showToast]);

  const editComment = useCallback(
    (commentId: string, newText: string) => {
      if (!store || !selected || !newText.trim()) return;
      const updated: PullRequestsStore = {
        ...store,
        prs: store.prs.map((p) =>
          p.id === selected.id
            ? {
                ...p,
                comments: p.comments.map((c) =>
                  c.id === commentId
                    ? {
                        ...c,
                        text: newText.trim(),
                        mentions: extractMentions(newText),
                      }
                    : c,
                ),
              }
            : p,
        ),
      };
      persist(updated);
    },
    [store, selected, persist],
  );

  const deleteComment = useCallback(
    (commentId: string) => {
      if (!store || !selected) return;
      const idsToDelete = new Set([commentId]);

      let checkLength = 0;
      while (idsToDelete.size !== checkLength) {
        checkLength = idsToDelete.size;
        selected.comments.forEach((c) => {
          if (c.parentId && idsToDelete.has(c.parentId)) {
            idsToDelete.add(c.id);
          }
        });
      }

      const updated: PullRequestsStore = {
        ...store,
        prs: store.prs.map((p) =>
          p.id === selected.id
            ? {
                ...p,
                comments: p.comments.filter((c) => !idsToDelete.has(c.id)),
                updatedAt: new Date().toISOString(),
              }
            : p,
        ),
      };
      persist(updated);
      showToast(lang === 'en' ? 'Comment deleted' : 'Comentario eliminado');
    },
    [store, selected, persist, lang, showToast],
  );

  // --- Offline queue: sync queued actions when reconnecting ---

  const flushOfflineQueue = useCallback(async () => {
    const queue = offlineQueueRef.current;
    if (queue.length === 0) return;
    setSyncingQueue(true);
    // Process sequentially — order matters (vote then status change, etc.)
    const results = await queue.reduce<Promise<boolean[]>>(async (accPromise, action) => {
      const acc = await accPromise;
      const ok = await processQueueAction(action);
      return [...acc, ok];
    }, Promise.resolve([]));
    const synced = results.filter(Boolean).length;
    const remaining = queue.filter((_, i) => !results[i]);
    setOfflineQueue(remaining);
    setSyncingQueue(false);
    if (synced > 0) {
      showToast(tx('offlineQueueSynced', synced));
      await loadData();
    }
  }, [loadData, showToast, tx]);

  // When disconnect state changes from true -> false, flush the queue
  const prevDisconnectedRef = useRef(false);
  useEffect(() => {
    if (prevDisconnectedRef.current && !disconnected) {
      flushOfflineQueue();
    }
    prevDisconnectedRef.current = disconnected;
  }, [disconnected, flushOfflineQueue]);

  // Listen for collab broadcast pull_requests_update (cross-machine sync)
  useEffect(() => {
    if (!papi.network || !papi.network.getNetworkEvent) return undefined;
    const unsubscribe = papi.network.getNetworkEvent('paratextProjectManager.onPullRequestsUpdate')(
      () => {
        loadData();
      },
    );
    return () => {
      unsubscribe();
    };
  }, [loadData]);

  // Listen for requestPrPrefill command event
  useEffect(() => {
    if (!papi.network || !papi.network.getNetworkEvent) return undefined;
    const unsubscribe = papi.network.getNetworkEvent('paratextProjectManager.onRequestPrPrefill')(
      (e: {
        projectId: string;
        book: string;
        chapter: number;
        verse: number;
        originalText: string;
        proposedText: string;
        timestamp: number;
      }) => {
        if (e.projectId === projectId) {
          setCreateForm({
            book: e.book || 'MAT',
            chapter: String(e.chapter),
            verse: String(e.verse),
            title: `Change to ${e.book} ${e.chapter}:${e.verse}`,
            originalText: e.originalText || '',
            proposedText: e.proposedText || '',
            rationale: '',
          });
          setPrKind('verse');
          setShowCreateForm(true);
        }
      },
    );
    return () => {
      unsubscribe();
    };
  }, [projectId]);

  const voteAlternative = useCallback(
    (pr: PullRequest, altId: string) => {
      if (!store) return;
      const updated: PullRequestsStore = {
        ...store,
        prs: store.prs.map((p) => {
          if (p.id !== pr.id) return p;
          return {
            ...p,
            alternatives: p.alternatives.map((a) => {
              if (a.id !== altId) return a;
              const has = a.votes.some((v) => v.user === currentUser);
              const votes = has
                ? a.votes.filter((v) => v.user !== currentUser)
                : a.votes.concat([
                    {
                      user: currentUser,
                      value: 'up',
                      role: store.teamRoles[currentUser] ?? 'translator',
                      weight: 1,
                      timestamp: new Date().toISOString(),
                    },
                  ]);
              return { ...a, votes };
            }),
            updatedAt: new Date().toISOString(),
          };
        }),
      };
      persist(updated);
      showToast(tx('votedAlt'));
    },
    [store, currentUser, persist, showToast, tx],
  );

  const addAlternative = useCallback(
    (text: string) => {
      if (!store || !selected || !text.trim()) return;
      const cleanText = text.trim();
      const newAlt: AlternativeRendering = {
        id: String.fromCharCode(65 + selected.alternatives.length),
        text: cleanText,
        proposedBy: currentUser,
        votes: [],
        createdAt: new Date().toISOString(),
      };
      const updated: PullRequestsStore = {
        ...store,
        prs: store.prs.map((p) =>
          p.id === selected.id
            ? {
                ...p,
                alternatives: [...p.alternatives, newAlt],
                updatedAt: new Date().toISOString(),
                history: [
                  ...p.history,
                  {
                    id: generateId(),
                    actor: currentUser,
                    action: 'suggested alternative',
                    detail: `Option ${newAlt.id}: "${newAlt.text}"`,
                    timestamp: new Date().toISOString(),
                  },
                ],
              }
            : p,
        ),
      };
      persist(updated);
      showToast(tx('altSuggested'));
      setAltInput('');
    },
    [store, selected, currentUser, persist, showToast, tx],
  );

  const addComment = useCallback(
    (parentId: string | undefined, text: string): boolean => {
      if (!store || !selected || !text.trim()) return false;
      // Queue offline if disconnected — still update local store optimistically
      if (disconnectedRef.current && projectId) {
        setOfflineQueue((q) => [
          ...q,
          {
            type: 'comment',
            projectId,
            prId: selected.id,
            user: currentUser,
            text: text.trim(),
            parentId,
          },
        ]);
      }
      const comment: PrComment = {
        id: generateId(),
        author: currentUser,
        text: text.trim(),
        timestamp: new Date().toISOString(),
        parentId,
        mentions: extractMentions(text),
      };
      const updated: PullRequestsStore = {
        ...store,
        prs: store.prs.map((p) =>
          p.id === selected.id
            ? {
                ...p,
                comments: [...p.comments, comment],
                updatedAt: new Date().toISOString(),
                history: [
                  ...p.history,
                  {
                    id: generateId(),
                    actor: currentUser,
                    action: parentId ? 'replied' : 'commented',
                    timestamp: new Date().toISOString(),
                  },
                ],
              }
            : p,
        ),
      };
      persist(updated);
      if (disconnectedRef.current) {
        showToast(tx('offlineQueued'));
      }
      return true;
    },
    [store, selected, currentUser, persist, projectId, showToast, tx],
  );

  const handleReply = useCallback(
    (parentId: string, text: string): boolean => addComment(parentId, text),
    [addComment],
  );

  const postTopLevel = () => {
    if (!commentInput.trim()) return;
    if (addComment(undefined, commentInput)) {
      setCommentInput('');
      showToast(tx('commentPosted'));
    }
  };

  const requestChanges = async () => {
    if (!projectId || !selected) return;
    try {
      await papi.commands.sendCommand(
        'paratextProjectManager.setPrStatus',
        projectId,
        selected.id,
        'needs-review',
        currentUser,
      );
      await loadData();
      showToast(tx('changesRequested'));
    } catch (e: unknown) {
      setError(handleCatch(e, tx('errorSaving', '')));
    }
  };

  const closePr = async () => {
    if (!projectId || !selected) return;
    try {
      await papi.commands.sendCommand(
        'paratextProjectManager.setPrStatus',
        projectId,
        selected.id,
        'closed',
        currentUser,
      );
      await loadData();
      showToast(tx('prClosed'));
    } catch (e: unknown) {
      setError(handleCatch(e, tx('errorSaving', '')));
    }
  };

  const approveAndMerge = async () => {
    if (!projectId || !selected) return;
    const mergeCheck = canMerge(selected);
    if (!mergeCheck.ok) {
      if (mergeCheck.reason) setError(mergeCheck.reason);
      return;
    }
    setSaving(true);
    try {
      const result = await papi.commands.sendCommand(
        'paratextProjectManager.approveAndMergePullRequest',
        projectId,
        selected.id,
        currentUser,
      );
      if (typeof result === 'string' && result.startsWith('error')) {
        setError(handleCatch(new Error(result), tx('errorMerging', '')));
        return;
      }
      const dataStr = await papiRetry(() =>
        papi.commands.sendCommand('paratextProjectManager.getPullRequests', projectId),
      );
      const merged: PullRequestsStore = JSON.parse(dataStr);
      setStore(merged);
      showToast(tx('merged'));
    } catch (e: unknown) {
      setError(handleCatch(e, tx('errorMerging', '')));
    } finally {
      setSaving(false);
    }
  };

  const diffs = useMemo(() => {
    if (!selected || selected.kind === 'general') {
      const empty: UsfmDiffSegment[] = [];
      return { proposed: empty, summary: undefined };
    }
    const segments = diffUsfm(selected.originalText ?? '', selected.proposedText ?? '');
    return { proposed: segments, summary: summarizeUsfmDiff(segments) };
  }, [selected]);

  const topComments = useMemo(
    () => (selected ? selected.comments.filter((c) => c.parentId === undefined) : []),
    [selected],
  );

  return (
    <div className="tw:flex tw:flex-col tw:h-full tw:bg-slate-100 dark:tw:bg-slate-950 tw:text-slate-900 dark:tw:text-slate-100 tw:overflow-hidden">
      {error && (
        <div className="tw:px-4 tw:py-2 tw:bg-rose-50 dark:tw:bg-rose-950/40 tw:text-rose-700 dark:tw:text-rose-300 tw:text-[13px] tw:border-b tw:border-rose-200 dark:tw:border-rose-900">
          {error}
        </div>
      )}
      {disconnected && (
        <div className="tw:px-4 tw:py-2 tw:bg-amber-50 dark:tw:bg-amber-950/40 tw:text-amber-800 dark:tw:text-amber-300 tw:text-[13px] tw:border-b tw:border-amber-200">
          {tx('disconnected')}
        </div>
      )}

      <div ref={containerRef} className="tw:flex tw:flex-1 tw:min-h-0 tw:relative">
        {/* Sidebar */}
        <aside
          style={{ width: sidebarVisible ? `${sidebarWidth}px` : undefined }}
          className={`tw:w-[300px] tw:max-w-[88vw] tw:bg-slate-950 tw:text-slate-100 tw:flex tw:flex-col tw:border-r tw:border-slate-900 tw:shrink-0 ${
            sidebarVisible ? 'tw:flex' : 'tw:hidden'
          }`}
        >
          <div className="tw:p-3 tw:border-b tw:border-slate-800/80">
            <div className="tw:relative">
              <Search
                size={16}
                className="tw:absolute tw:left-2.5 tw:top-1/2 -tw:translate-y-1/2 tw:text-slate-500"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tx('searchPlaceholder')}
                className="tw:w-full tw:h-9 tw:pl-8 tw:pr-3 tw:rounded-xl tw:bg-slate-900 tw:border tw:border-slate-800 tw:text-[13px] tw:placeholder-slate-500 focus:tw:outline-none focus:tw:ring-2 focus:tw:ring-indigo-500/50 focus:tw:border-indigo-500"
              />
            </div>
            <div className="tw:flex tw:items-center tw:gap-1.5 tw:mt-2.5">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`tw:px-2.5 tw:py-1 tw:rounded-lg tw:text-[12px] tw:font-medium ${
                    filter === f
                      ? 'tw:bg-slate-800 tw:text-white'
                      : 'tw:text-slate-400 hover:tw:bg-slate-800/70'
                  }`}
                >
                  {tx(FILTER_LABEL_KEYS[f])}
                </button>
              ))}
            </div>
          </div>
          <div className="tw:flex-1 tw:overflow-y-auto scrollbar-thin tw:p-2 tw:space-y-1.5">
            {loading && (
              <div className="tw:text-[13px] tw:text-slate-500 tw:p-3">{tx('loading')}</div>
            )}
            {!loading && filteredPrs.length === 0 && (
              <div className="tw:text-[13px] tw:text-slate-500 tw:p-3 tw:text-center">
                {tx('empty')}
              </div>
            )}
            {filteredPrs.map((pr) => {
              const sd = statusDisplay(pr);
              return (
                <button
                  key={pr.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(pr.id);
                    setTab('details');
                  }}
                  className={`group tw:w-full tw:text-left tw:p-3 tw:rounded-xl tw:border tw:transition ${
                    pr.id === selectedId
                      ? 'tw:bg-slate-800 tw:border-slate-700 tw:shadow-inner'
                      : 'tw:border-transparent hover:tw:bg-slate-800/60'
                  }`}
                >
                  <div className="tw:flex tw:items-start tw:justify-between tw:gap-2">
                    <div className="tw:flex tw:items-center tw:gap-1.5 tw:min-w-0">
                      <span className="tw:text-[11px] tw:font-mono tw:text-slate-500">
                        #{pr.id}
                      </span>
                      <span
                        className={`tw:inline-flex tw:items-center tw:px-1.5 tw:py-0.5 tw:rounded-md tw:text-[10px] tw:font-medium tw:tracking-wide ${STATUS_BADGE_DARK[sd] ?? STATUS_BADGE_DARK.Open}`}
                      >
                        {sd}
                      </span>
                      {pr.createdOffline && <Cloud size={11} className="tw:text-sky-400" />}
                    </div>
                    <div
                      className={`tw:flex tw:items-center tw:gap-2 tw:text-[11px] ${
                        pr.id === selectedId ? 'tw:text-slate-300' : 'tw:text-slate-500'
                      }`}
                    >
                      <span className="tw:inline-flex tw:items-center tw:gap-0.5">
                        <ChevronUp size={10} /> {upCount(pr)}
                      </span>
                      <span className="tw:inline-flex tw:items-center tw:gap-0.5">
                        <ChevronDown size={10} /> {downCount(pr)}
                      </span>
                    </div>
                  </div>
                  <div
                    className={`tw:mt-1.5 tw:font-medium tw:text-[13.5px] tw:leading-snug tw:truncate ${
                      pr.id === selectedId
                        ? 'tw:text-white'
                        : 'tw:text-slate-200 group-hover:tw:text-white'
                    }`}
                  >
                    {pr.kind === 'general' ? (
                      <span className="tw:inline-flex tw:items-center tw:gap-1">
                        <span className="tw:text-xs">📋</span>
                        <span>{tx('generalLabel')}</span>
                      </span>
                    ) : (
                      pr.refLabel
                    )}{' '}
                    • {pr.title}
                  </div>
                  <div
                    className={`tw:mt-1.5 tw:flex tw:items-center tw:gap-2 tw:text-[12px] ${
                      pr.id === selectedId ? 'tw:text-slate-400' : 'tw:text-slate-500'
                    }`}
                  >
                    <span className="tw:w-5 tw:h-5 tw:rounded-full tw:bg-slate-800 tw:grid tw:place-items-center tw:text-[10px] tw:font-medium tw:ring-1 tw:ring-slate-700">
                      {pr.avatar}
                    </span>
                    <span className="tw:truncate">{pr.author}</span>
                    <span>•</span>
                    <span className="tw:shrink-0">{relativeTime(pr.createdAt, currentLang)}</span>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="tw:p-2.5 tw:border-t tw:border-slate-800/80 tw:text-[11px] tw:text-slate-500 tw:flex tw:items-center tw:justify-between">
            <span>
              {store?.prs.length ?? 0} {tx('activePrs')}
            </span>
            <span className="tw:flex tw:items-center tw:gap-2">
              {offlineQueue.length > 0 && (
                <span className="tw:inline-flex tw:items-center tw:gap-1 tw:text-amber-400">
                  <Cloud size={11} /> {tx('pendingActions', offlineQueue.length)}
                </span>
              )}
              {syncingQueue && <span>{tx('offlineQueueSyncing')}</span>}
              {!syncingQueue && saving && <span>{tx('saving')}…</span>}
            </span>
          </div>
        </aside>

        {/* Resize Handler & Toggle Button */}
        <div
          className={`tw:flex tw:relative hover:tw:bg-indigo-600/30 active:tw:bg-indigo-600/50 tw:cursor-col-resize tw:shrink-0 tw:z-20 tw:h-full tw:items-center tw:justify-center tw:select-none ${
            sidebarVisible
              ? 'tw:w-1.5 tw:bg-slate-950 tw:border-r tw:border-slate-900'
              : 'tw:w-0 tw:border-0 tw:bg-transparent'
          }`}
          onPointerDown={sidebarVisible ? handlePointerDown : undefined}
        >
          {/* Toggle Button Tab */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSidebarVisible(!sidebarVisible);
            }}
            title={sidebarVisible ? tx('toggleSidebarHide') : tx('toggleSidebarShow')}
            aria-label={sidebarVisible ? tx('toggleSidebarHide') : tx('toggleSidebarShow')}
            className="tw:absolute tw:left-1/2 tw:-translate-x-1/2 tw:top-1/2 tw:-translate-y-1/2 tw:z-30 tw:w-6 tw:h-6 tw:bg-slate-900 tw:border tw:border-slate-800 hover:tw:bg-indigo-600 hover:tw:text-white tw:text-slate-400 tw:flex tw:items-center tw:justify-center tw:cursor-pointer tw:transition-colors tw:rounded-full"
          >
            {sidebarVisible ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
          </button>
        </div>

        {/* Main */}
        <main className="tw:flex-1 tw:min-w-0 tw:bg-[#f8fafc] dark:tw:bg-slate-900 tw:flex tw:flex-col tw:min-h-0">
          {/* Main Area Header */}
          <div className="tw:bg-white dark:tw:bg-slate-900 tw:border-b tw:border-slate-200 dark:tw:border-slate-800 tw:shrink-0">
            <div className="tw:px-4 lg:tw:px-6 tw:py-3.5">
              <div className="tw:flex tw:items-center tw:justify-between tw:gap-3">
                {/* Left side: Title */}
                <div className="tw:flex-1 tw:min-w-0">
                  {selected ? (
                    <div className="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
                      <h1 className="tw:text-[20px] tw:leading-7 tw:font-semibold tw:tracking-tight font-sans">
                        PR #{selected.id} -{' '}
                        {selected.kind === 'general' ? tx('generalLabel') : selected.refLabel}{' '}
                        {selected.title}
                      </h1>
                      <span
                        className={`tw:inline-flex tw:items-center tw:gap-1 tw:px-2 tw:py-0.5 tw:rounded-full tw:text-[11px] tw:font-medium tw:ring-1 tw:ring-inset ${STATUS_PILL[statusDisplay(selected)] ?? STATUS_PILL.Open}`}
                      >
                        {statusDisplay(selected)}
                      </span>
                      {selected.kind === 'general' && (
                        <span className="tw:inline-flex tw:items-center tw:gap-1 tw:px-2 tw:py-0.5 tw:rounded-md tw:bg-indigo-50 dark:tw:bg-indigo-900/30 tw:text-indigo-700 dark:tw:text-indigo-400 tw:text-[11px] tw:font-semibold tw:ring-1 tw:ring-indigo-200 dark:tw:ring-indigo-800">
                          {tx('generalDecision')}
                        </span>
                      )}
                      {selected.createdOffline && (
                        <span className="tw:inline-flex tw:items-center tw:gap-1 tw:text-[11px] tw:text-sky-600">
                          <Cloud size={12} /> {tx('offline')}
                        </span>
                      )}
                    </div>
                  ) : (
                    <h1 className="tw:text-[20px] tw:leading-7 tw:font-semibold tw:tracking-tight font-sans">
                      {tx('title')}
                    </h1>
                  )}
                </div>

                {/* Right side: Controls */}
                <div className="tw:flex tw:items-center tw:gap-3 tw:shrink-0">
                  {/* Vote controls (only when PR is selected) */}
                  {selected && (
                    <div className="tw:hidden sm:tw:flex tw:items-center tw:gap-1 tw:bg-slate-50 dark:tw:bg-slate-800 tw:border tw:border-slate-200 dark:tw:border-slate-700 tw:rounded-xl tw:p-1 tw:shadow-sm">
                      <button
                        type="button"
                        onClick={() => castVote(selected, 'up')}
                        className={`group tw:flex tw:items-center tw:gap-1 tw:pl-2 tw:pr-2.5 tw:py-1 tw:rounded-lg tw:text-[13px] tw:font-medium tw:transition ${
                          userVote(selected) === 'up'
                            ? 'tw:bg-emerald-50 tw:text-emerald-700 tw:ring-1 tw:ring-emerald-200'
                            : 'tw:text-slate-600 dark:tw:text-slate-300 hover:tw:bg-white dark:hover:tw:bg-slate-700 hover:tw:text-emerald-700'
                        }`}
                      >
                        <ChevronUp size={14} className="group-active:scale-110 tw:transition" />
                        {weightedUpCount(selected)}
                      </button>
                      <div className="tw:w-px tw:h-5 tw:bg-slate-200 dark:tw:bg-slate-600" />
                      <button
                        type="button"
                        onClick={() => castVote(selected, 'down')}
                        className={`group tw:flex tw:items-center tw:gap-1 tw:pl-2 tw:pr-2.5 tw:py-1 tw:rounded-lg tw:text-[13px] tw:font-medium tw:transition ${
                          userVote(selected) === 'down'
                            ? 'tw:bg-rose-50 tw:text-rose-700 tw:ring-1 tw:ring-rose-200'
                            : 'tw:text-slate-600 dark:tw:text-slate-300 hover:tw:bg-white dark:hover:tw:bg-slate-700 hover:tw:text-rose-700'
                        }`}
                      >
                        <ChevronDown size={14} className="group-active:scale-110 tw:transition" />
                        {weightedDownCount(selected)}
                      </button>
                    </div>
                  )}

                  {/* Standard Right-side controls (always visible) */}
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(true)}
                    className="tw:inline-flex tw:items-center tw:gap-1 tw:px-2.5 tw:py-1.5 tw:rounded-lg tw:bg-indigo-600 tw:text-white tw:text-[12px] tw:font-semibold hover:tw:bg-indigo-700 tw:shadow-sm tw:transition-colors"
                  >
                    <Plus size={14} />
                    <span className="tw:hidden sm:tw:inline">{tx('newPr')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSettings(true)}
                    className="tw:p-1.5 tw:rounded-lg hover:tw:bg-slate-100 dark:hover:tw:bg-slate-800"
                    title={tx('settings')}
                  >
                    <Settings size={16} className="tw:text-slate-600 dark:tw:text-slate-400" />
                  </button>
                  <button
                    type="button"
                    onClick={toggleLang}
                    className="tw:text-[11px] tw:font-medium tw:px-2.5 tw:py-1 tw:rounded-full tw:bg-slate-100 dark:tw:bg-slate-800 hover:tw:bg-slate-200"
                  >
                    {currentLang === 'en' ? 'ES' : 'EN'}
                  </button>
                  <div className="tw:w-8 tw:h-8 tw:rounded-full tw:bg-slate-900 dark:tw:bg-slate-700 tw:text-white tw:grid tw:place-items-center tw:text-xs tw:font-medium">
                    {initials(currentUser)}
                  </div>
                </div>
              </div>

              {/* PR Header Subtitle (only when PR is selected) */}
              {selected && (
                <div className="tw:flex tw:items-center tw:gap-2.5 tw:mt-2.5 tw:text-[13px] tw:text-slate-500 tw:flex-wrap">
                  <span className="tw:inline-flex tw:items-center tw:gap-1.5">
                    <span className="tw:w-5 tw:h-5 tw:rounded-full tw:bg-slate-800 tw:text-white tw:grid tw:place-items-center tw:text-[10px] tw:font-medium">
                      {selected.avatar}
                    </span>
                    <span className="tw:text-slate-700 dark:tw:text-slate-300">
                      {selected.author}
                    </span>
                  </span>
                  <span className="tw:hidden sm:tw:block">•</span>
                  <span>
                    {tx('opened')} {relativeTime(selected.createdAt, currentLang)}
                  </span>
                  <span className="tw:hidden sm:tw:block">•</span>
                  <span className="tw:inline-flex tw:items-center tw:gap-1">
                    <span
                      className={`tw:w-1.5 tw:h-1.5 tw:rounded-full tw:animate-pulse ${selected.kind === 'general' ? 'tw:bg-indigo-500' : 'tw:bg-emerald-500'}`}
                    />
                    <span className="tw:font-medium tw:text-slate-700 dark:tw:text-slate-300">
                      {selected.kind === 'general' ? tx('generalLabel') : selected.refLabel}
                    </span>
                  </span>
                </div>
              )}

              {/* Tabs (only when PR is selected) */}
              {selected && (
                <div className="tw:flex tw:items-center tw:gap-5 tw:mt-4 -tw:mb-px tw:overflow-x-auto scrollbar-thin">
                  {TABS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      className={`tw:relative tw:whitespace-nowrap tw:pb-3 tw:pt-1 tw:text-[14px] tw:font-medium tw:border-b-2 tw:transition ${
                        tab === t
                          ? 'tw:border-indigo-600 tw:text-slate-900 dark:tw:text-slate-100'
                          : 'tw:border-transparent tw:text-slate-500 hover:tw:text-slate-800 dark:hover:tw:text-slate-200'
                      }`}
                    >
                      {tx(TAB_LABEL_KEYS[t])}
                      {t === 'checks' && (
                        <span className="tw:ml-1 tw:text-[11px] tw:px-1.5 tw:py-0.5 tw:rounded-md tw:bg-amber-100 tw:text-amber-800 tw:font-medium">
                          2
                        </span>
                      )}
                      {t === 'history' && (
                        <span className="tw:ml-1 tw:text-[11px] tw:px-1.5 tw:py-0.5 tw:rounded-md tw:bg-slate-100 tw:text-slate-700 tw:font-medium">
                          {selected.history.length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {selected ? (
            <>
              <div className="tw:flex-1 tw:min-h-0 tw:overflow-y-auto">
                {tab === 'details' && (
                  <div className="tw:max-w-[1200px] tw:mx-auto tw:p-4 lg:tw:p-6">
                    {selected.kind !== 'general' && selected.ref && (
                      <div className="tw:bg-white dark:tw:bg-slate-900 tw:rounded-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:shadow-sm tw:overflow-hidden tw:mb-4">
                        <VerseContextStrip
                          projectId={projectId}
                          book={selected.ref.book}
                          chapter={selected.ref.chapter}
                          verse={selected.ref.verse}
                          lang={currentLang}
                        />
                      </div>
                    )}

                    {/* Diff or Description */}
                    {selected.kind === 'general' ? (
                      <div className="tw:bg-white dark:tw:bg-slate-900 tw:rounded-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:shadow-sm tw:overflow-hidden">
                        <div className="tw:px-4 tw:py-2.5 tw:border-b tw:border-indigo-100 dark:tw:border-indigo-900/50 tw:bg-indigo-50/80 dark:tw:bg-indigo-950/30 tw:flex tw:items-center tw:justify-between">
                          <span className="tw:text-[12px] tw:font-semibold tw:uppercase tw:tracking-wider tw:text-indigo-800 dark:tw:text-indigo-400">
                            {tx('createDescription')}
                          </span>
                        </div>
                        <div className="tw:p-4 tw:text-[14px] tw:leading-relaxed tw:text-slate-800 dark:tw:text-slate-200 tw:whitespace-pre-wrap tw:break-words font-sans">
                          {selected.proposedText}
                        </div>
                        {selected.rationale && (
                          <div className="tw:px-4 tw:pb-4">
                            <div className="tw:text-[12.5px] tw:text-slate-600 dark:tw:text-slate-400 tw:bg-slate-50 dark:tw:bg-slate-800/50 tw:border tw:border-slate-200 dark:tw:border-slate-700 tw:rounded-lg tw:px-3 tw:py-2">
                              <span className="tw:font-semibold">{tx('rationale')}:</span>{' '}
                              {selected.rationale}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Diff */
                      <div className="tw:grid lg:tw:grid-cols-2 tw:gap-4">
                        <div className="tw:bg-white dark:tw:bg-slate-900 tw:rounded-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:shadow-sm tw:overflow-hidden">
                          <div className="tw:px-4 tw:py-2.5 tw:border-b tw:border-slate-100 dark:tw:border-slate-800 tw:bg-slate-50/70 dark:tw:bg-slate-800/50 tw:flex tw:items-center tw:justify-between">
                            <span className="tw:text-[12px] tw:font-semibold tw:uppercase tw:tracking-wider tw:text-slate-600 dark:tw:text-slate-400">
                              {tx('original')}
                            </span>
                            <span className="tw:text-[11px] tw:font-mono tw:text-slate-500">
                              USFM
                            </span>
                          </div>
                          <pre className="tw:font-mono tw:text-[13px] tw:leading-6 tw:p-4 tw:whitespace-pre-wrap tw:break-words tw:text-slate-700 dark:tw:text-slate-300">
                            {selected.originalText}
                          </pre>
                        </div>
                        <div className="tw:bg-white dark:tw:bg-slate-900 tw:rounded-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:shadow-sm tw:overflow-hidden tw:ring-1 tw:ring-emerald-500/10">
                          <div className="tw:px-4 tw:py-2.5 tw:border-b tw:border-emerald-100 dark:tw:border-emerald-900/50 tw:bg-emerald-50/80 dark:tw:bg-emerald-950/30 tw:flex tw:items-center tw:justify-between">
                            <span className="tw:text-[12px] tw:font-semibold tw:uppercase tw:tracking-wider tw:text-emerald-800 dark:tw:text-emerald-400">
                              {tx('proposed')}
                            </span>
                            {diffs.summary && (
                              <span className="tw:text-[11px] tw:font-medium tw:px-1.5 tw:py-0.5 tw:rounded-md tw:bg-emerald-100 tw:text-emerald-800">
                                {diffs.summary.label}
                              </span>
                            )}
                          </div>
                          <pre className="tw:font-mono tw:text-[13px] tw:leading-6 tw:p-4 tw:whitespace-pre-wrap tw:break-words tw:text-slate-900 dark:tw:text-slate-100">
                            <DiffSegments segments={diffs.proposed} />
                          </pre>
                          {selected.rationale && (
                            <div className="tw:px-4 tw:pb-3 -tw:mt-1">
                              <div className="tw:text-[12px] tw:text-slate-600 dark:tw:text-slate-400 tw:bg-slate-50 dark:tw:bg-slate-800/50 tw:border tw:border-slate-200 dark:tw:border-slate-700 tw:rounded-lg tw:px-3 tw:py-2">
                                {tx('rationale')}: {selected.rationale}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Back-Translation Comparison Card */}
                    {(selected.originalBackTranslation || selected.proposedBackTranslation) && (
                      <div className="tw:mt-4">
                        <div className="tw:mb-2 tw:text-[13px] tw:font-semibold tw:text-slate-700 dark:tw:text-slate-300 tw:flex tw:items-center tw:gap-1.5">
                          <span>{tx('backTranslationTitle')}</span>
                        </div>
                        <div className="tw:grid lg:tw:grid-cols-2 tw:gap-4">
                          <div className="tw:bg-white dark:tw:bg-slate-900 tw:rounded-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:shadow-sm tw:overflow-hidden">
                            <div className="tw:px-4 tw:py-2.5 tw:border-b tw:border-slate-100 dark:tw:border-slate-800 tw:bg-slate-50/70 dark:tw:bg-slate-800/50">
                              <span className="tw:text-[11px] tw:font-semibold tw:uppercase tw:tracking-wider tw:text-slate-500">
                                {tx('originalBackTranslationLabel')}
                              </span>
                            </div>
                            <div className="tw:p-4 tw:text-[13.5px] tw:leading-relaxed tw:text-slate-700 dark:tw:text-slate-300 tw:whitespace-pre-wrap tw:break-words">
                              {selected.originalBackTranslation || (
                                <span className="tw:text-slate-400 dark:tw:text-slate-550 tw:italic">
                                  —
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="tw:bg-white dark:tw:bg-slate-900 tw:rounded-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:shadow-sm tw:overflow-hidden">
                            <div className="tw:px-4 tw:py-2.5 tw:border-b tw:border-slate-100 dark:tw:border-slate-800 tw:bg-slate-50/70 dark:tw:bg-slate-800/50">
                              <span className="tw:text-[11px] tw:font-semibold tw:uppercase tw:tracking-wider tw:text-slate-500">
                                {tx('proposedBackTranslationLabel')}
                              </span>
                            </div>
                            <div className="tw:p-4 tw:text-[13.5px] tw:leading-relaxed tw:text-slate-900 dark:tw:text-slate-100 tw:whitespace-pre-wrap tw:break-words">
                              {selected.proposedBackTranslation || (
                                <span className="tw:text-slate-400 dark:tw:text-slate-550 tw:italic">
                                  —
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Mobile vote */}
                    <div className="sm:tw:hidden tw:flex tw:items-center tw:justify-center tw:gap-2 tw:mt-4">
                      <button
                        type="button"
                        onClick={() => castVote(selected, 'up')}
                        className="tw:flex tw:items-center tw:gap-1.5 tw:px-3 tw:py-1.5 tw:rounded-xl tw:border tw:border-slate-300 tw:bg-white tw:text-[13px] tw:font-medium"
                      >
                        <ChevronUp size={14} /> {upCount(selected)}
                      </button>
                      <button
                        type="button"
                        onClick={() => castVote(selected, 'down')}
                        className="tw:flex tw:items-center tw:gap-1.5 tw:px-3 tw:py-1.5 tw:rounded-xl tw:border tw:border-slate-300 tw:bg-white tw:text-[13px] tw:font-medium"
                      >
                        <ChevronDown size={14} /> {downCount(selected)}
                      </button>
                    </div>

                    {/* Alternatives */}
                    <div className="tw:mt-6 tw:bg-white dark:tw:bg-slate-900 tw:rounded-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:shadow-sm">
                      <div className="tw:px-4 sm:tw:px-5 tw:py-3.5 tw:border-b tw:border-slate-100 dark:tw:border-slate-800 tw:flex tw:items-center tw:justify-between">
                        <h2 className="tw:font-semibold tw:tracking-tight">{tx('alternatives')}</h2>
                        <span className="tw:text-[12px] tw:text-slate-500">{tx('altHint')}</span>
                      </div>
                      <div className="tw:divide-y tw:divide-slate-100 dark:tw:divide-slate-800">
                        {selected.alternatives.length === 0 ? (
                          <div className="tw:p-5 tw:text-[13px] tw:text-slate-500 tw:text-center">
                            {tx('noAlternatives')}
                          </div>
                        ) : (
                          selected.alternatives.map((alt) => (
                            <AlternativeRow
                              key={alt.id}
                              alt={alt}
                              currentUser={currentUser}
                              onVote={() => voteAlternative(selected, alt.id)}
                              tx={tx}
                            />
                          ))
                        )}
                      </div>
                      <div className="tw:p-3 sm:tw:p-4 tw:border-t tw:border-slate-100 dark:tw:border-slate-800 tw:bg-slate-50/70 dark:tw:bg-slate-800/30 tw:rounded-b-2xl">
                        <div className="tw:flex tw:gap-2.5">
                          <div className="tw:w-8 tw:h-8 tw:rounded-full tw:bg-slate-900 dark:tw:bg-slate-700 tw:text-white tw:grid tw:place-items-center tw:text-[11px] tw:font-medium tw:shrink-0 tw:mt-0.5">
                            {initials(currentUser)}
                          </div>
                          <div className="tw:flex-1 tw:min-w-0">
                            <textarea
                              rows={2}
                              value={altInput}
                              onChange={(e) => setAltInput(e.target.value)}
                              placeholder={tx('altInputPlaceholder')}
                              className="tw:w-full tw:resize-none tw:rounded-xl tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-3.5 tw:py-2.5 tw:text-[14px] tw:leading-snug tw:placeholder-slate-400 focus:tw:outline-none focus:tw:ring-2 focus:tw:ring-indigo-500/30 focus:tw:border-indigo-500"
                            />
                            <div className="tw:flex tw:justify-end tw:mt-2.5 tw:gap-2">
                              <button
                                type="button"
                                onClick={() => addAlternative(altInput)}
                                disabled={!altInput.trim() || saving}
                                className="tw:px-4 tw:py-1.5 tw:rounded-lg tw:bg-indigo-600 tw:text-white tw:text-[13px] tw:font-semibold hover:tw:bg-indigo-700 active:tw:bg-indigo-800 tw:shadow-sm disabled:tw:opacity-50 disabled:tw:cursor-not-allowed"
                              >
                                {tx('suggest')}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Discussion */}
                    <div className="tw:mt-6 tw:bg-white dark:tw:bg-slate-900 tw:rounded-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:shadow-sm">
                      <div className="tw:px-4 sm:tw:px-5 tw:py-3.5 tw:border-b tw:border-slate-100 dark:tw:border-slate-800 tw:flex tw:items-center tw:justify-between">
                        <h2 className="tw:font-semibold tw:tracking-tight">{tx('discussion')}</h2>
                        <span className="tw:text-[12px] tw:text-slate-500">
                          {selected.comments.length} {tx('comments')}
                        </span>
                      </div>
                      <div className="tw:p-4 sm:tw:p-5 tw:space-y-5 tw:max-h-[380px] tw:overflow-y-auto scrollbar-thin">
                        {topComments.length === 0 ? (
                          <div className="tw:text-center tw:py-8 tw:text-[13px] tw:text-slate-500">
                            {tx('noComments')}
                          </div>
                        ) : (
                          topComments.map((c) => (
                            <CommentNode
                              key={c.id}
                              comment={c}
                              replies={selected.comments.filter((r) => r.parentId === c.id)}
                              allComments={selected.comments}
                              currentUser={currentUser}
                              lang={currentLang}
                              onReply={handleReply}
                              replyingTo={replyingTo}
                              setReplyingTo={setReplyingTo}
                              onEditComment={editComment}
                              onDeleteComment={setCommentToDeleteId}
                            />
                          ))
                        )}
                      </div>
                      <div className="tw:p-3 sm:tw:p-4 tw:border-t tw:border-slate-100 dark:tw:border-slate-800 tw:bg-slate-50/70 dark:tw:bg-slate-800/30 tw:rounded-b-2xl">
                        <div className="tw:flex tw:gap-2.5">
                          <div className="tw:w-8 tw:h-8 tw:rounded-full tw:bg-slate-900 dark:tw:bg-slate-700 tw:text-white tw:grid tw:place-items-center tw:text-[11px] tw:font-medium tw:shrink-0 tw:mt-0.5">
                            {initials(currentUser)}
                          </div>
                          <div className="tw:flex-1 tw:min-w-0">
                            <textarea
                              rows={2}
                              value={commentInput}
                              onChange={(e) => setCommentInput(e.target.value)}
                              placeholder={tx('commentPlaceholder')}
                              className="tw:w-full tw:resize-none tw:rounded-xl tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-3.5 tw:py-2.5 tw:text-[14px] tw:leading-snug tw:placeholder-slate-400 focus:tw:outline-none focus:tw:ring-2 focus:tw:ring-indigo-500/30 focus:tw:border-indigo-500"
                            />
                            <div className="tw:flex tw:justify-end tw:mt-2.5 tw:gap-2">
                              <button
                                type="button"
                                onClick={postTopLevel}
                                disabled={!commentInput.trim() || saving}
                                className="tw:px-4 tw:py-1.5 tw:rounded-lg tw:bg-indigo-600 tw:text-white tw:text-[13px] tw:font-semibold hover:tw:bg-indigo-700 active:tw:bg-indigo-800 tw:shadow-sm disabled:tw:opacity-50 disabled:tw:cursor-not-allowed"
                              >
                                {tx('comment')}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {tab === 'checks' && <ChecksPanel tx={tx} />}
                {tab === 'history' && <HistoryPanel pr={selected} lang={currentLang} />}
              </div>

              {/* Sticky Actions */}
              <div className="tw:sticky tw:bottom-0 tw:bg-white/90 dark:tw:bg-slate-900/90 tw:backdrop-blur-xl tw:border-t tw:border-slate-200 dark:tw:border-slate-800 tw:px-4 lg:tw:px-6 tw:py-3 tw:z-10">
                <div className="tw:max-w-[1200px] tw:mx-auto tw:flex tw:items-center tw:justify-between tw:gap-3 tw:flex-wrap">
                  <div className="tw:flex tw:items-center tw:gap-3 tw:text-[12px] tw:text-slate-600 dark:tw:text-slate-400">
                    {(() => {
                      if (selected.status === 'draft') {
                        return (
                          <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-amber-600">
                            <AlertTriangle size={12} /> {tx('cannotMergeDraft')}
                          </span>
                        );
                      }
                      if (selected.status === 'needs-review') {
                        return (
                          <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-amber-600">
                            <AlertTriangle size={12} /> {tx('cannotMergeReview')}
                          </span>
                        );
                      }
                      if (
                        selected.status === 'merged' ||
                        selected.status === 'closed' ||
                        selected.status === 'expired'
                      ) {
                        return <span className="tw:capitalize">{selected.status}</span>;
                      }
                      if (quorumMet(selected)) {
                        return (
                          <span className="tw:inline-flex tw:items-center tw:gap-1.5">
                            <span className="tw:w-2 tw:h-2 tw:rounded-full tw:bg-emerald-500" />{' '}
                            {tx('quorumMet')}
                          </span>
                        );
                      }
                      return (
                        <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-amber-600">
                          <AlertTriangle size={12} />{' '}
                          {tx(
                            'quorumNotMet',
                            (store?.quorum.minUpvotes ?? 2) - weightedUpCount(selected),
                          )}
                        </span>
                      );
                    })()}
                    <span className="tw:hidden md:tw:inline">
                      • {tx('requires', String(store?.quorum.minUpvotes ?? 2))}
                    </span>
                    <span className="tw:inline-flex tw:items-center tw:gap-1 tw:px-2 tw:py-0.5 tw:rounded-full tw:bg-slate-100 dark:tw:bg-slate-800 tw:font-medium">
                      {tx('weightedVotes', weightedUpCount(selected), weightedDownCount(selected))}
                    </span>
                  </div>
                  <div className="tw:flex tw:items-center tw:gap-2 tw:ml-auto">
                    <button
                      type="button"
                      onClick={() => emailReviewers(selected)}
                      className="tw:px-3.5 tw:py-2 tw:rounded-xl tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:text-[13px] tw:font-medium hover:tw:bg-slate-50 dark:hover:tw:bg-slate-800 tw:mr-2 tw:inline-flex tw:items-center tw:gap-1.5"
                    >
                      <Reply size={14} className="tw:-rotate-90" />
                      {tx('emailReviewers')}
                    </button>
                    {selected.status !== 'merged' && selected.status !== 'closed' && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditForm({
                            title: selected.title,
                            proposedText: selected.proposedText ?? '',
                            rationale: selected.rationale ?? '',
                            originalBackTranslation: selected.originalBackTranslation ?? '',
                            proposedBackTranslation: selected.proposedBackTranslation ?? '',
                          });
                          setShowEditForm(true);
                        }}
                        className="tw:px-3.5 tw:py-2 tw:rounded-xl tw:border tw:border-indigo-200 dark:tw:border-indigo-900/50 tw:text-indigo-600 dark:tw:text-indigo-400 tw:text-[13px] tw:font-medium hover:tw:bg-indigo-50 dark:hover:tw:bg-indigo-950/20 tw:mr-2 tw:inline-flex tw:items-center tw:gap-1.5"
                      >
                        <Edit3 size={14} />
                        {tx('editPr')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowDeleteModal(true)}
                      className="tw:px-3.5 tw:py-2 tw:rounded-xl tw:border tw:border-rose-200 dark:tw:border-rose-900/50 tw:text-rose-600 dark:tw:text-rose-400 tw:text-[13px] tw:font-medium hover:tw:bg-rose-50 dark:hover:tw:bg-rose-950/20 tw:mr-2"
                    >
                      {tx('deletePr')}
                    </button>
                    {selected.status === 'draft' && (
                      <button
                        type="button"
                        onClick={() => submitForReview(selected)}
                        className="tw:px-3.5 tw:py-2 tw:rounded-xl tw:bg-indigo-600 tw:text-white tw:text-[13px] tw:font-semibold hover:tw:bg-indigo-700"
                      >
                        {tx('submitForReview')}
                      </button>
                    )}
                    {selected.status !== 'draft' && selected.status !== 'merged' && (
                      <>
                        <button
                          type="button"
                          onClick={requestChanges}
                          className="tw:px-3.5 tw:py-2 tw:rounded-xl tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:text-[13px] tw:font-medium hover:tw:bg-slate-50 dark:hover:tw:bg-slate-800"
                        >
                          {tx('requestChanges')}
                        </button>
                        <button
                          type="button"
                          onClick={closePr}
                          className="tw:px-3.5 tw:py-2 tw:rounded-xl tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:text-[13px] tw:font-medium hover:tw:bg-slate-50 dark:hover:tw:bg-slate-800 tw:hidden sm:tw:block"
                        >
                          {tx('closePr')}
                        </button>
                      </>
                    )}
                    {selected.status === 'merged' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowRevertModal(true)}
                          className="tw:px-3.5 tw:py-2 tw:rounded-xl tw:border tw:border-amber-300 tw:text-amber-700 tw:text-[13px] tw:font-medium hover:tw:bg-amber-50 dark:tw:border-amber-700 dark:hover:tw:bg-amber-950/30 tw:inline-flex tw:items-center tw:gap-1.5 tw:mr-2"
                        >
                          <AlertTriangle size={14} /> {tx('revert')}
                        </button>
                        <button
                          type="button"
                          disabled
                          className="tw:px-4 tw:py-2 tw:rounded-xl tw:bg-slate-200 dark:tw:bg-slate-800 tw:text-slate-500 tw:text-[13px] tw:font-semibold tw:inline-flex tw:items-center tw:gap-1.5 tw:cursor-not-allowed"
                        >
                          <Check size={16} /> {tx('merged')}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={approveAndMerge}
                        disabled={saving || !canMerge(selected).ok}
                        className="tw:px-4 tw:py-2 tw:rounded-xl tw:bg-emerald-600 tw:text-white tw:text-[13px] tw:font-semibold hover:tw:bg-emerald-700 active:tw:bg-emerald-800 tw:shadow-sm tw:inline-flex tw:items-center tw:gap-1.5 disabled:tw:opacity-50 disabled:tw:cursor-not-allowed"
                      >
                        <GitMerge size={16} />{' '}
                        {selected.kind === 'general' ? tx('approveAndRecord') : tx('approveMerge')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="tw:flex-1 tw:grid tw:place-items-center tw-text-slate-500">
              <div className="tw-text-center">
                <GitPullRequest size={40} className="tw:mx-auto tw:mb-3 tw:opacity-40" />
                <p className="tw:text-[15px]">{loading ? tx('loading') : tx('selectPr')}</p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Downvote reason modal */}
      {downvoteModal && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          className="tw:fixed tw:inset-0 tw:z-[10000] tw:flex tw:items-center tw:justify-center tw:bg-slate-900/40 tw:backdrop-blur-sm"
          onClick={() => setDownvoteModal(undefined)}
        >
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            className="tw:bg-white dark:tw:bg-slate-900 tw:rounded-xl tw:shadow-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:w-[440px] tw:max-w-[90vw] tw:p-5 tw:space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tw:flex tw:items-center tw:justify-between">
              <h3 className="tw:font-semibold tw:text-slate-900 dark:tw:text-slate-100">
                {tx('downvoteTitle')}
              </h3>
              <button
                type="button"
                onClick={() => setDownvoteModal(undefined)}
                className="tw:text-slate-400 hover:tw:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>
            <p className="tw:text-[13px] tw:text-slate-600 dark:tw:text-slate-400">
              {tx('downvotePrompt')}
            </p>
            <textarea
              rows={3}
              value={downvoteModal.reason}
              onChange={(e) => setDownvoteModal({ ...downvoteModal, reason: e.target.value })}
              placeholder={tx('downvotePlaceholder')}
              className="tw:w-full tw:resize-none tw:rounded-xl tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-3 tw:py-2 tw:text-[14px] tw:placeholder-slate-400 focus:tw:outline-none focus:tw:ring-2 focus:tw:ring-rose-500/30 focus:tw:border-rose-500"
            />
            <div className="tw:flex tw:justify-end tw:gap-2">
              <button
                type="button"
                onClick={() => setDownvoteModal(undefined)}
                className="tw:px-3 tw:py-1.5 tw:rounded-lg tw:text-[13px] tw:font-medium tw:text-slate-600 hover:tw:bg-slate-200/70"
              >
                {tx('downvoteCancel')}
              </button>
              <button
                type="button"
                onClick={submitDownvote}
                disabled={!downvoteModal.reason.trim()}
                className="tw:px-4 tw:py-1.5 tw:rounded-lg tw:bg-rose-600 tw:text-white tw:text-[13px] tw:font-semibold hover:tw:bg-rose-700 disabled:tw:opacity-50"
              >
                {tx('downvoteSubmit')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create PR modal */}
      {showCreateForm && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          className="tw:fixed tw:inset-0 tw:z-[10000] tw:flex tw:items-center tw:justify-center tw:bg-slate-900/40 tw:backdrop-blur-sm"
          onClick={() => setShowCreateForm(false)}
        >
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            className="tw:bg-white dark:tw:bg-slate-900 tw:rounded-xl tw:shadow-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:w-[560px] tw:max-w-[90vw] tw:max-h-[85vh] tw:overflow-y-auto scrollbar-thin tw:p-5 tw:space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tw:flex tw:items-center tw:justify-between">
              <h3 className="tw:font-semibold tw:text-slate-900 dark:tw:text-slate-100">
                {tx('createTitle')}
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="tw:text-slate-400 hover:tw:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>

            {/* Kind Selector */}
            <div className="tw:flex tw:items-center tw:gap-4 tw:pb-2 tw:border-b tw:border-slate-100 dark:tw:border-slate-800">
              <label className="tw:text-[13px] tw:font-medium tw:text-slate-700 dark:tw:text-slate-300">
                {currentLang === 'en' ? 'PR Type:' : 'Tipo de PR:'}
              </label>
              <div className="tw:flex tw:gap-2">
                <button
                  type="button"
                  onClick={() => setPrKind('verse')}
                  className={`tw:px-3 tw:py-1 tw:rounded-lg tw:text-[12px] tw:font-semibold tw:border tw:cursor-pointer ${
                    prKind === 'verse'
                      ? 'tw:bg-indigo-50 tw:text-indigo-700 tw:border-indigo-200 dark:tw:bg-indigo-900/30 dark:tw:text-indigo-400 dark:tw:border-indigo-800'
                      : 'tw:bg-white tw:text-slate-600 tw:border-slate-200 dark:tw:bg-slate-900 dark:tw:text-slate-400 dark:tw:border-slate-800'
                  }`}
                >
                  {tx('kindVerse')}
                </button>
                <button
                  type="button"
                  onClick={() => setPrKind('general')}
                  className={`tw:px-3 tw:py-1 tw:rounded-lg tw:text-[12px] tw:font-semibold tw:border tw:cursor-pointer ${
                    prKind === 'general'
                      ? 'tw:bg-indigo-50 tw:text-indigo-700 tw:border-indigo-200 dark:tw:bg-indigo-900/30 dark:tw:text-indigo-400 dark:tw:border-indigo-800'
                      : 'tw:bg-white tw:text-slate-600 tw:border-slate-200 dark:tw:bg-slate-900 dark:tw:text-slate-400 dark:tw:border-slate-800'
                  }`}
                >
                  {tx('kindGeneral')}
                </button>
              </div>
            </div>

            {prKind === 'verse' && (
              <div className="tw:grid tw:grid-cols-3 tw:gap-3">
                <div>
                  <label className="tw:text-[12px] tw:font-medium tw:text-slate-600 dark:tw:text-slate-400 tw:block tw:mb-1">
                    {tx('createBook')}
                  </label>
                  <select
                    value={createForm.book}
                    onChange={(e) => setCreateForm({ ...createForm, book: e.target.value })}
                    className="tw:w-full tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-2 tw:py-1.5 tw:text-[13px]"
                  >
                    {BIBLE_BOOKS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="tw:text-[12px] tw:font-medium tw:text-slate-600 dark:tw:text-slate-400 tw:block tw:mb-1">
                    {tx('createChapter')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={createForm.chapter}
                    onChange={(e) => setCreateForm({ ...createForm, chapter: e.target.value })}
                    className="tw:w-full tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-2 tw:py-1.5 tw:text-[13px]"
                  />
                </div>
                <div>
                  <label className="tw:text-[12px] tw:font-medium tw:text-slate-600 dark:tw:text-slate-400 tw:block tw:mb-1">
                    {tx('createVerse')}
                  </label>
                  <div className="tw:flex tw:gap-1">
                    <input
                      type="number"
                      min={1}
                      value={createForm.verse}
                      onChange={(e) => setCreateForm({ ...createForm, verse: e.target.value })}
                      className="tw:flex-1 tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-2 tw:py-1.5 tw:text-[13px]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const ch = parseInt(createForm.chapter, 10);
                        const vs = parseInt(createForm.verse, 10);
                        if (!Number.isNaN(ch) && !Number.isNaN(vs)) {
                          fetchVerseText(createForm.book, ch, vs);
                        }
                      }}
                      className="tw:px-2 tw:py-1 tw:rounded-lg tw:bg-slate-100 dark:tw:bg-slate-800 tw:text-[11px] tw:font-medium hover:tw:bg-slate-200"
                    >
                      {createFetching ? tx('createFetching') : '↻'}
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div>
              <label className="tw:text-[12px] tw:font-medium tw:text-slate-600 dark:tw:text-slate-400 tw:block tw:mb-1">
                {tx('createTitleLabel')}
              </label>
              <input
                value={createForm.title}
                onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                placeholder={tx('createTitlePlaceholder')}
                className="tw:w-full tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-3 tw:py-1.5 tw:text-[14px] tw:placeholder-slate-400"
              />
            </div>
            {prKind === 'verse' && (
              <div>
                <label className="tw:text-[12px] tw:font-medium tw:text-slate-600 dark:tw:text-slate-400 tw:block tw:mb-1">
                  {tx('createOriginal')}{' '}
                  <span className="tw:font-normal tw:text-slate-400">
                    ({tx('createOriginalHint')})
                  </span>
                </label>
                <textarea
                  rows={2}
                  readOnly
                  value={createForm.originalText}
                  placeholder={tx('createFetching')}
                  className="tw:w-full tw:resize-none tw:rounded-lg tw:border tw:border-slate-200 dark:tw:border-slate-700 tw:bg-slate-50 dark:tw:bg-slate-800/50 tw:px-3 tw:py-2 tw:text-[13px] tw:font-mono tw:text-slate-600"
                />
              </div>
            )}
            <div>
              <label className="tw:text-[12px] tw:font-medium tw:text-slate-600 dark:tw:text-slate-400 tw:block tw:mb-1">
                {prKind === 'verse' ? tx('createProposed') : tx('createDescription')}
              </label>
              <textarea
                rows={prKind === 'verse' ? 3 : 6}
                value={createForm.proposedText}
                onChange={(e) => setCreateForm({ ...createForm, proposedText: e.target.value })}
                placeholder={prKind === 'verse' ? '' : tx('createDescriptionPlaceholder')}
                className="tw:w-full tw:resize-none tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-3 tw:py-2 tw:text-[13px] tw:font-mono focus:tw:outline-none focus:tw:ring-2 focus:tw:ring-indigo-500/30"
              />
            </div>
            {prKind === 'verse' && (
              <div className="tw:grid tw:grid-cols-1 md:tw:grid-cols-2 tw:gap-3">
                <div>
                  <label className="tw:text-[12px] tw:font-medium tw:text-slate-600 dark:tw:text-slate-400 tw:block tw:mb-1">
                    {tx('originalBackTranslationLabel')}
                  </label>
                  <textarea
                    rows={2}
                    value={createForm.originalBackTranslation}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, originalBackTranslation: e.target.value })
                    }
                    placeholder={tx('backTranslationPlaceholder')}
                    className="tw:w-full tw:resize-none tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-3 tw:py-2 tw:text-[13px] focus:tw:outline-none focus:tw:ring-2 focus:tw:ring-indigo-500/30"
                  />
                </div>
                <div>
                  <label className="tw:text-[12px] tw:font-medium tw:text-slate-600 dark:tw:text-slate-400 tw:block tw:mb-1">
                    {tx('proposedBackTranslationLabel')}
                  </label>
                  <textarea
                    rows={2}
                    value={createForm.proposedBackTranslation}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, proposedBackTranslation: e.target.value })
                    }
                    placeholder={tx('backTranslationPlaceholder')}
                    className="tw:w-full tw:resize-none tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-3 tw:py-2 tw:text-[13px] focus:tw:outline-none focus:tw:ring-2 focus:tw:ring-indigo-500/30"
                  />
                </div>
              </div>
            )}
            <div>
              <label className="tw:text-[12px] tw:font-medium tw:text-slate-600 dark:tw:text-slate-400 tw:block tw:mb-1">
                {tx('createRationale')}
              </label>
              <textarea
                rows={2}
                value={createForm.rationale}
                onChange={(e) => setCreateForm({ ...createForm, rationale: e.target.value })}
                placeholder={tx('createRationalePlaceholder')}
                className="tw:w-full tw:resize-none tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-3 tw:py-2 tw:text-[13px] tw:placeholder-slate-400"
              />
            </div>
            <div className="tw:flex tw:justify-end tw:gap-2 tw:pt-1">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="tw:px-3 tw:py-1.5 tw:rounded-lg tw:text-[13px] tw:font-medium tw:text-slate-600 hover:tw:bg-slate-200/70"
              >
                {tx('createCancel')}
              </button>
              <button
                type="button"
                onClick={createPr}
                disabled={!createForm.title.trim() || !createForm.proposedText.trim()}
                className="tw:px-4 tw:py-1.5 tw:rounded-lg tw:bg-indigo-600 tw:text-white tw:text-[13px] tw:font-semibold hover:tw:bg-indigo-700 disabled:tw:opacity-50"
              >
                {tx('createSubmit')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings modal (roles + quorum) */}
      {showSettings && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          className="tw:fixed tw:inset-0 tw:z-[10000] tw:flex tw:items-center tw:justify-center tw:bg-slate-900/40 tw:backdrop-blur-sm"
          onClick={() => setShowSettings(false)}
        >
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            className="tw:bg-white dark:tw:bg-slate-900 tw:rounded-xl tw:shadow-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:w-[480px] tw:max-w-[90vw] tw:max-h-[80vh] tw:overflow-y-auto scrollbar-thin tw:p-5 tw:space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tw:flex tw:items-center tw:justify-between">
              <h3 className="tw:font-semibold tw:text-slate-900 dark:tw:text-slate-100">
                {tx('settings')}
              </h3>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="tw:text-slate-400 hover:tw:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>

            {/* Roles */}
            <div>
              <h4 className="tw:text-[14px] tw:font-semibold tw:mb-1">{tx('rolesTitle')}</h4>
              <p className="tw:text-[12px] tw:text-slate-500 tw:mb-2">{tx('rolesHint')}</p>
              <div className="tw:space-y-1.5">
                {teamMembers.map((m) => (
                  <div key={m} className="tw:flex tw:items-center tw:justify-between tw:gap-2">
                    <span className="tw:text-[13px] tw:text-slate-700 dark:tw:text-slate-300">
                      {m}
                    </span>
                    <select
                      value={teamRoles[m] ?? 'translator'}
                      onChange={(e) => {
                        const v = e.target.value;
                        let role: ReviewerRole = 'translator';
                        if (v === 'consultant') role = 'consultant';
                        else if (v === 'admin') role = 'admin';
                        updateTeamRole(m, role);
                      }}
                      className="tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-2 tw:py-1 tw:text-[12px]"
                    >
                      <option value="translator">{tx('roleTranslator')}</option>
                      <option value="consultant">{tx('roleConsultant')}</option>
                      <option value="admin">{tx('roleAdmin')}</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Quorum */}
            {store && (
              <div className="tw:border-t tw:border-slate-100 dark:tw:border-slate-800 tw:pt-4">
                <h4 className="tw:text-[14px] tw:font-semibold tw:mb-2">{tx('quorumTitle')}</h4>
                <div className="tw:space-y-2.5">
                  <div className="tw:flex tw:items-center tw:justify-between">
                    <span className="tw:text-[13px]">{tx('quorumMinUpvotes')}</span>
                    <input
                      type="number"
                      min={1}
                      value={store.quorum.minUpvotes}
                      onChange={(e) =>
                        updateQuorum({
                          ...store.quorum,
                          minUpvotes: parseInt(e.target.value, 10) || 1,
                        })
                      }
                      className="tw:w-16 tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-2 tw:py-1 tw:text-[13px] tw:text-center"
                    />
                  </div>
                  <label className="tw:flex tw:items-center tw:justify-between">
                    <span className="tw:text-[13px]">{tx('quorumNoConsultDown')}</span>
                    <input
                      type="checkbox"
                      checked={store.quorum.requireNoConsultantDownvotes}
                      onChange={(e) =>
                        updateQuorum({
                          ...store.quorum,
                          requireNoConsultantDownvotes: e.target.checked,
                        })
                      }
                      className="tw:h-4 tw:w-4"
                    />
                  </label>
                  <label className="tw:flex tw:items-center tw:justify-between">
                    <span className="tw:text-[13px]">{tx('quorumAdminVeto')}</span>
                    <input
                      type="checkbox"
                      checked={store.quorum.adminVeto}
                      onChange={(e) =>
                        updateQuorum({ ...store.quorum, adminVeto: e.target.checked })
                      }
                      className="tw:h-4 tw:w-4"
                    />
                  </label>
                  <div className="tw:flex tw:items-center tw:justify-between">
                    <span className="tw:text-[13px]">{tx('quorumExpiry')}</span>
                    <input
                      type="number"
                      min={0}
                      value={store.quorum.expiryDays}
                      onChange={(e) =>
                        updateQuorum({
                          ...store.quorum,
                          expiryDays: parseInt(e.target.value, 10) || 0,
                        })
                      }
                      className="tw:w-16 tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-2 tw:py-1 tw:text-[13px] tw:text-center"
                    />
                  </div>
                  {/* Email Notifications Configuration */}
                  <div className="tw:border-t tw:border-slate-100 dark:tw:border-slate-800 tw:pt-3 tw:mt-3">
                    <h5 className="tw:text-[13px] tw:font-semibold tw:mb-2">
                      {tx('emailConfigTitle')}
                    </h5>
                    <div className="tw:space-y-2">
                      <div className="tw:flex tw:flex-col tw:gap-1">
                        <span className="tw:text-[12px] tw:text-slate-600 dark:tw:text-slate-400">
                          {tx('consultantEmailLabel')}
                        </span>
                        <input
                          type="email"
                          value={store.quorum.consultantEmail ?? ''}
                          onChange={(e) =>
                            updateQuorum({
                              ...store.quorum,
                              consultantEmail: e.target.value.trim(),
                            })
                          }
                          placeholder="consultant@example.com"
                          className="tw:w-full tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-2.5 tw:py-1 tw:text-[13px]"
                        />
                      </div>
                      <div className="tw:flex tw:flex-col tw:gap-1">
                        <span className="tw:text-[12px] tw:text-slate-600 dark:tw:text-slate-400">
                          {tx('orgEmailLabel')}
                        </span>
                        <input
                          type="email"
                          value={store.quorum.orgEmail ?? ''}
                          onChange={(e) =>
                            updateQuorum({
                              ...store.quorum,
                              orgEmail: e.target.value.trim(),
                            })
                          }
                          placeholder="review@organization.org"
                          className="tw:w-full tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-2.5 tw:py-1 tw:text-[13px]"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete PR Confirmation Modal */}
      {showDeleteModal && selected && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          className="tw:fixed tw:inset-0 tw:z-[10000] tw:flex tw:items-center tw:justify-center tw:bg-slate-900/40 tw:backdrop-blur-sm"
          onClick={() => setShowDeleteModal(false)}
        >
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            className="tw:bg-white dark:tw:bg-slate-900 tw:rounded-xl tw:shadow-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:w-[440px] tw:max-w-[90vw] tw:p-6 tw:space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tw:flex tw:items-center tw:gap-3 tw:text-rose-600 dark:tw:text-rose-400">
              <AlertTriangle size={24} />
              <h3 className="tw:text-[16px] tw:font-semibold tw:text-slate-900 dark:tw:text-slate-100">
                {tx('deletePr')}
              </h3>
            </div>
            <p className="tw:text-[14px] tw:leading-relaxed tw:text-slate-600 dark:tw:text-slate-400">
              {tx('deleteConfirm')}
            </p>
            <div className="tw:flex tw:justify-end tw:gap-2 tw:pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="tw:px-3.5 tw:py-2 tw:rounded-xl tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:text-[13px] tw:font-medium hover:tw:bg-slate-50 dark:hover:tw:bg-slate-800"
              >
                {tx('cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  deletePr(selected);
                  setShowDeleteModal(false);
                }}
                className="tw:px-3.5 tw:py-2 tw:rounded-xl tw:bg-rose-600 tw:text-white tw:text-[13px] tw:font-semibold hover:tw:bg-rose-700"
              >
                {tx('yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revert PR Confirmation Modal */}
      {showRevertModal && selected && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          className="tw:fixed tw:inset-0 tw:z-[10000] tw:flex tw:items-center tw:justify-center tw:bg-slate-900/40 tw:backdrop-blur-sm"
          onClick={() => setShowRevertModal(false)}
        >
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            className="tw:bg-white dark:tw:bg-slate-900 tw:rounded-xl tw:shadow-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:w-[440px] tw:max-w-[90vw] tw:p-6 tw:space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tw:flex tw:items-center tw:gap-3 tw:text-amber-600 dark:tw:text-amber-400">
              <AlertTriangle size={24} />
              <h3 className="tw:text-[16px] tw:font-semibold tw:text-slate-900 dark:tw:text-slate-100">
                {tx('revert')}
              </h3>
            </div>
            <p className="tw:text-[14px] tw:leading-relaxed tw:text-slate-600 dark:tw:text-slate-400">
              {tx('revertConfirm')}
            </p>
            <div className="tw:flex tw:justify-end tw:gap-2 tw:pt-2">
              <button
                type="button"
                onClick={() => setShowRevertModal(false)}
                className="tw:px-3.5 tw:py-2 tw:rounded-xl tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:text-[13px] tw:font-medium hover:tw:bg-slate-50 dark:hover:tw:bg-slate-800"
              >
                {tx('cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  revertPr(selected);
                  setShowRevertModal(false);
                }}
                className="tw:px-3.5 tw:py-2 tw:rounded-xl tw:bg-amber-600 tw:text-white tw:text-[13px] tw:font-semibold hover:tw:bg-amber-700"
              >
                {tx('yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Comment Confirmation Modal */}
      {commentToDeleteId && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          className="tw:fixed tw:inset-0 tw:z-[10000] tw:flex tw:items-center tw:justify-center tw:bg-slate-900/40 tw:backdrop-blur-sm"
          onClick={() => setCommentToDeleteId(undefined)}
        >
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            className="tw:bg-white dark:tw:bg-slate-900 tw:rounded-xl tw:shadow-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:w-[400px] tw:max-w-[90vw] tw:p-5 tw:space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tw:flex tw:items-center tw:gap-3 tw:text-rose-600 dark:tw:text-rose-400">
              <Trash2 size={20} />
              <h3 className="tw:font-semibold tw:text-slate-900 dark:tw:text-slate-100">
                {tx('deleteCommentTitle')}
              </h3>
            </div>
            <p className="tw:text-[13.5px] tw:text-slate-600 dark:tw:text-slate-400">
              {tx('deleteCommentConfirm')}
            </p>
            <div className="tw:flex tw:justify-end tw:gap-2 tw:pt-1">
              <button
                type="button"
                onClick={() => setCommentToDeleteId(undefined)}
                className="tw:px-3 tw:py-1.5 tw:rounded-lg tw:text-[13px] tw:font-medium tw:text-slate-600 hover:tw:bg-slate-100 dark:hover:tw:bg-slate-800"
              >
                {tx('cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  deleteComment(commentToDeleteId);
                  setCommentToDeleteId(undefined);
                }}
                className="tw:px-4 tw:py-1.5 tw:rounded-lg tw:bg-rose-600 tw:text-white tw:text-[13px] tw:font-semibold hover:tw:bg-rose-700"
              >
                {tx('yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit PR Proposal Modal */}
      {showEditForm && selected && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          className="tw:fixed tw:inset-0 tw:z-[10000] tw:flex tw:items-center tw:justify-center tw:bg-slate-900/40 tw:backdrop-blur-sm"
          onClick={() => setShowEditForm(false)}
        >
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            className="tw:bg-white dark:tw:bg-slate-900 tw:rounded-xl tw:shadow-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:w-[560px] tw:max-w-[90vw] tw:max-h-[85vh] tw:overflow-y-auto scrollbar-thin tw:p-5 tw:space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tw:flex tw:items-center tw:justify-between">
              <h3 className="tw:font-semibold tw:text-slate-900 dark:tw:text-slate-100">
                {tx('editTitle')}
              </h3>
              <button
                type="button"
                onClick={() => setShowEditForm(false)}
                className="tw:text-slate-400 hover:tw:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>

            <div>
              <label className="tw:text-[12px] tw:font-medium tw:text-slate-600 dark:tw:text-slate-400 tw:block tw:mb-1">
                {tx('createTitleLabel')}
              </label>
              <input
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                placeholder={tx('createTitlePlaceholder')}
                className="tw:w-full tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-3 tw:py-1.5 tw:text-[14px] tw:placeholder-slate-400"
              />
            </div>

            <div>
              <label className="tw:text-[12px] tw:font-medium tw:text-slate-600 dark:tw:text-slate-400 tw:block tw:mb-1">
                {selected.kind === 'general' ? tx('createDescription') : tx('createProposed')}
              </label>
              <textarea
                rows={selected.kind === 'general' ? 6 : 3}
                value={editForm.proposedText}
                onChange={(e) => setEditForm({ ...editForm, proposedText: e.target.value })}
                placeholder={selected.kind === 'general' ? tx('createDescriptionPlaceholder') : ''}
                className="tw:w-full tw:resize-none tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-3 tw:py-2 tw:text-[13px] tw:font-mono focus:tw:outline-none focus:tw:ring-2 focus:tw:ring-indigo-500/30"
              />
            </div>
            {selected.kind === 'verse' && (
              <div className="tw:grid tw:grid-cols-1 md:tw:grid-cols-2 tw:gap-3">
                <div>
                  <label className="tw:text-[12px] tw:font-medium tw:text-slate-600 dark:tw:text-slate-400 tw:block tw:mb-1">
                    {tx('originalBackTranslationLabel')}
                  </label>
                  <textarea
                    rows={2}
                    value={editForm.originalBackTranslation}
                    onChange={(e) =>
                      setEditForm({ ...editForm, originalBackTranslation: e.target.value })
                    }
                    placeholder={tx('backTranslationPlaceholder')}
                    className="tw:w-full tw:resize-none tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-3 tw:py-2 tw:text-[13px] focus:tw:outline-none focus:tw:ring-2 focus:tw:ring-indigo-500/30"
                  />
                </div>
                <div>
                  <label className="tw:text-[12px] tw:font-medium tw:text-slate-600 dark:tw:text-slate-400 tw:block tw:mb-1">
                    {tx('proposedBackTranslationLabel')}
                  </label>
                  <textarea
                    rows={2}
                    value={editForm.proposedBackTranslation}
                    onChange={(e) =>
                      setEditForm({ ...editForm, proposedBackTranslation: e.target.value })
                    }
                    placeholder={tx('backTranslationPlaceholder')}
                    className="tw:w-full tw:resize-none tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-3 tw:py-2 tw:text-[13px] focus:tw:outline-none focus:tw:ring-2 focus:tw:ring-indigo-500/30"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="tw:text-[12px] tw:font-medium tw:text-slate-600 dark:tw:text-slate-400 tw:block tw:mb-1">
                {tx('createRationale')}
              </label>
              <textarea
                rows={2}
                value={editForm.rationale}
                onChange={(e) => setEditForm({ ...editForm, rationale: e.target.value })}
                placeholder={tx('createRationalePlaceholder')}
                className="tw:w-full tw:resize-none tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-3 tw:py-2 tw:text-[13px] tw:placeholder-slate-400"
              />
            </div>

            <div className="tw:flex tw:justify-end tw:gap-2 tw:pt-1">
              <button
                type="button"
                onClick={() => setShowEditForm(false)}
                className="tw:px-3 tw:py-1.5 tw:rounded-lg tw:text-[13px] tw:font-medium tw:text-slate-600 hover:tw:bg-slate-200/70"
              >
                {tx('createCancel')}
              </button>
              <button
                type="button"
                onClick={savePrEdit}
                disabled={!editForm.title.trim() || !editForm.proposedText.trim()}
                className="tw:px-4 tw:py-1.5 tw:rounded-lg tw:bg-indigo-600 tw:text-white tw:text-[13px] tw:font-semibold hover:tw:bg-indigo-700 disabled:tw:opacity-50"
              >
                {tx('saveChanges')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email Draft Preview Modal */}
      {emailDraftModal && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          className="tw:fixed tw:inset-0 tw:z-[10000] tw:flex tw:items-center tw:justify-center tw:bg-slate-900/40 tw:backdrop-blur-sm"
          onClick={() => setEmailDraftModal(undefined)}
        >
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            className="tw:bg-white dark:tw:bg-slate-900 tw:rounded-xl tw:shadow-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:w-[560px] tw:max-w-[90vw] tw:max-h-[85vh] tw:overflow-y-auto scrollbar-thin tw:p-5 tw:space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tw:flex tw:items-center tw:justify-between">
              <h3 className="tw:font-semibold tw:text-slate-900 dark:tw:text-slate-100 tw:text-[15px]">
                {tx('emailDraftTitle')} (PR #{emailDraftModal.prId})
              </h3>
              <button
                type="button"
                onClick={() => setEmailDraftModal(undefined)}
                className="tw:text-slate-400 hover:tw:text-slate-600 dark:hover:tw:text-slate-300"
              >
                <X size={16} />
              </button>
            </div>

            <div className="tw:space-y-3.5">
              <div>
                <label className="tw:text-[11px] tw:font-semibold tw:text-slate-500 dark:tw:text-slate-400 tw:block tw:mb-1">
                  {tx('emailDraftRecipients')}
                </label>
                <input
                  type="text"
                  value={emailDraftModal.recipients}
                  onChange={(e) =>
                    setEmailDraftModal({ ...emailDraftModal, recipients: e.target.value })
                  }
                  className="tw:w-full tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-3 tw:py-1.5 tw:text-[13px]"
                />
              </div>

              <div>
                <label className="tw:text-[11px] tw:font-semibold tw:text-slate-500 dark:tw:text-slate-400 tw:block tw:mb-1">
                  {tx('emailDraftSubject')}
                </label>
                <input
                  type="text"
                  value={emailDraftModal.subject}
                  onChange={(e) =>
                    setEmailDraftModal({ ...emailDraftModal, subject: e.target.value })
                  }
                  className="tw:w-full tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-3 tw:py-1.5 tw:text-[13px]"
                />
              </div>

              <div>
                <label className="tw:text-[11px] tw:font-semibold tw:text-slate-500 dark:tw:text-slate-400 tw:block tw:mb-1">
                  {tx('emailDraftBody')}
                </label>
                <textarea
                  rows={10}
                  value={emailDraftModal.body}
                  onChange={(e) => setEmailDraftModal({ ...emailDraftModal, body: e.target.value })}
                  className="tw:w-full tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:bg-white dark:tw:bg-slate-900 tw:px-3 tw:py-2 tw:text-[13px] tw:font-mono"
                />
              </div>

              {/* Warning Notice if URL length > 2000 */}
              {(() => {
                const mailtoUrl = `mailto:${emailDraftModal.recipients.trim()}?subject=${encodeURIComponent(emailDraftModal.subject)}&body=${encodeURIComponent(emailDraftModal.body)}`;
                if (mailtoUrl.length > 2000) {
                  return (
                    <div className="tw:flex tw:items-start tw:gap-2.5 tw:p-3 tw:rounded-lg tw:bg-amber-50 dark:tw:bg-amber-950/40 tw:border tw:border-amber-200 dark:tw:border-amber-900/60 tw:text-[12px] tw:text-amber-800 dark:tw:text-amber-300">
                      <AlertTriangle className="tw:shrink-0 tw:mt-0.5" size={15} />
                      <span>{tx('emailDraftNotice')}</span>
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            <div className="tw:flex tw:justify-end tw:gap-2 tw:pt-1">
              <button
                type="button"
                onClick={() => setEmailDraftModal(undefined)}
                className="tw:px-3 tw:py-1.5 tw:rounded-lg tw:text-[13px] tw:font-medium tw:text-slate-600 hover:tw:bg-slate-100 dark:hover:tw:bg-slate-800"
              >
                {tx('cancel')}
              </button>
              <button
                type="button"
                onClick={handleCopyDraft}
                className="tw:px-4 tw:py-1.5 tw:rounded-lg tw:border tw:border-slate-300 dark:tw:border-slate-700 tw:text-slate-700 dark:tw:text-slate-200 tw:text-[13px] tw:font-medium hover:tw:bg-slate-50 dark:hover:tw:bg-slate-800"
              >
                {tx('emailCopyDraft')}
              </button>
              <button
                type="button"
                onClick={handleSendEmail}
                className="tw:px-4 tw:py-1.5 tw:rounded-lg tw:bg-indigo-600 tw:text-white tw:text-[13px] tw:font-semibold hover:tw:bg-indigo-700"
              >
                {tx('emailOpenMailApp')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="tw:fixed tw:bottom-24 tw:left-1/2 -tw:translate-x-1/2 tw:z-50 tw:px-4 tw:py-2.5 tw:rounded-xl tw:bg-slate-900 tw:text-white tw:text-[13px] tw:font-medium tw:shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
};

interface AlternativeRowProps {
  alt: AlternativeRendering;
  currentUser: string;
  onVote: () => void;
  tx: (key: string, ...args: (string | number)[]) => string;
}

function AlternativeRow({ alt, currentUser, onVote, tx }: AlternativeRowProps) {
  const voted = alt.votes.some((v) => v.user === currentUser);
  return (
    <label className="group tw:flex tw:items-start tw:gap-3 tw:p-4 hover:tw:bg-slate-50 dark:hover:tw:bg-slate-800/50 tw:cursor-pointer tw:transition">
      <div className="tw:flex-1 tw:min-w-0">
        <div className="tw:flex tw:items-baseline tw:gap-2 tw:flex-wrap">
          <span className="tw:font-mono tw:text-[12px] tw:bg-slate-100 group-hover:tw:bg-slate-200 dark:tw:bg-slate-800 tw:px-1.5 tw:py-0.5 tw:rounded-md tw:transition">
            {tx('option')} {alt.id}
          </span>
          <span className="tw:text-[14px] tw:text-slate-900 dark:tw:text-slate-100">
            &ldquo;{alt.text}&rdquo;
          </span>
          {alt.isSelectedWinner && (
            <span className="tw:text-[10px] tw:px-1.5 tw:py-0.5 tw:rounded-full tw:bg-emerald-100 tw:text-emerald-700 tw:font-medium">
              {tx('winner')}
            </span>
          )}
        </div>
        <div className="tw:text-[12px] tw:text-slate-500 tw:mt-1">
          {tx('proposedBy', alt.proposedBy)} • {alt.votes.length} {tx('votes')}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          onVote();
        }}
        className={`tw:shrink-0 tw:px-2.5 tw:py-1.5 tw:rounded-lg tw:border tw:text-[12px] tw:font-medium tw:transition ${
          voted
            ? 'tw:bg-slate-900 tw:text-white tw:border-slate-900'
            : 'tw:border-slate-200 dark:tw:border-slate-700 hover:tw:bg-slate-900 hover:tw:text-white hover:tw:border-slate-900'
        }`}
      >
        {voted ? tx('voted') : tx('vote')}
      </button>
    </label>
  );
}

type CheckStatus = 'pass' | 'warn' | 'fail';

const CHECK_BADGE_CLASS: Record<CheckStatus, string> = {
  pass: 'tw:bg-emerald-50 tw:text-emerald-700',
  warn: 'tw:bg-amber-50 tw:text-amber-700',
  fail: 'tw:bg-rose-50 tw:text-rose-700',
};

function ChecksPanel({ tx }: { tx: (key: string, ...args: (string | number)[]) => string }) {
  const checks: { name: string; status: CheckStatus; detail: string }[] = [
    { name: tx('checkUsfm'), status: 'pass', detail: tx('checkUsfmDetail') },
    { name: tx('checkRef'), status: 'pass', detail: tx('checkRefDetail') },
    { name: tx('checkSpelling'), status: 'pass', detail: tx('checkSpellingDetail') },
    { name: tx('checkConsistency'), status: 'warn', detail: tx('checkConsistencyDetail') },
    { name: tx('checkBackTrans'), status: 'fail', detail: tx('checkBackTransDetail') },
  ];
  return (
    <div className="tw:max-w-[1200px] tw:mx-auto tw:p-4 lg:tw:p-6">
      <div className="tw:bg-white dark:tw:bg-slate-900 tw:rounded-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:shadow-sm tw:overflow-hidden">
        <div className="tw:px-5 tw:py-3.5 tw:border-b tw:border-slate-100 dark:tw:border-slate-800">
          <h2 className="tw:font-semibold">{tx('checksTitle')}</h2>
          <p className="tw:text-[13px] tw:text-slate-500 tw:mt-0.5">{tx('checksSubtitle')}</p>
        </div>
        <div className="tw:divide-y tw:divide-slate-100 dark:tw:divide-slate-800">
          {checks.map((c) => (
            <div key={c.name} className="tw:flex tw:items-start tw:gap-3 tw:p-4">
              <div className="tw:mt-0.5">
                {c.status === 'pass' && (
                  <span className="tw:w-5 tw:h-5 tw:rounded-full tw:bg-emerald-100 tw:grid tw:place-items-center">
                    <Check size={12} className="tw:text-emerald-700" />
                  </span>
                )}
                {c.status === 'warn' && (
                  <span className="tw:w-5 tw:h-5 tw:rounded-full tw:bg-amber-100 tw:grid tw:place-items-center">
                    <AlertTriangle size={12} className="tw:text-amber-700" />
                  </span>
                )}
                {c.status === 'fail' && (
                  <span className="tw:w-5 tw:h-5 tw:rounded-full tw:bg-rose-100 tw:grid tw:place-items-center">
                    <CircleX size={12} className="tw:text-rose-700" />
                  </span>
                )}
              </div>
              <div className="tw:flex-1 tw:min-w-0">
                <div className="tw:flex tw:items-baseline tw:justify-between tw:gap-2 tw:flex-wrap">
                  <span className="tw:text-[14px] tw:font-medium">{c.name}</span>
                  <span
                    className={`tw:text-[11px] tw:font-medium tw:px-1.5 tw:py-0.5 tw:rounded ${CHECK_BADGE_CLASS[c.status]}`}
                  >
                    {c.status.toUpperCase()}
                  </span>
                </div>
                <p className="tw:text-[13px] tw:text-slate-600 dark:tw:text-slate-400 tw:mt-0.5">
                  {c.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HistoryPanel({ pr, lang }: { pr: PullRequest; lang: 'en' | 'es' }) {
  const sorted = [...pr.history].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return (
    <div className="tw:max-w-[1200px] tw:mx-auto tw:p-4 lg:tw:p-6">
      <div className="tw:bg-white dark:tw:bg-slate-900 tw:rounded-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:shadow-sm tw:overflow-hidden">
        <div className="tw:px-5 tw:py-3.5 tw:border-b tw:border-slate-100 dark:tw:border-slate-800">
          <h2 className="tw:font-semibold">History</h2>
        </div>
        <div className="tw:p-5">
          {sorted.length === 0 ? (
            <p className="tw:text-[13px] tw:text-slate-500 tw:text-center tw:py-4">—</p>
          ) : (
            <ol className="tw:relative tw:border-l tw:border-slate-200 dark:tw:border-slate-700 tw:ml-3 tw:space-y-6">
              {sorted.map((h) => (
                <li key={h.id} className="tw:ml-6">
                  <span className="tw:absolute -tw:left-3 tw:w-6 tw:h-6 tw:rounded-full tw:bg-white dark:tw:bg-slate-900 tw:border-2 tw:border-slate-200 dark:tw:border-slate-700 tw:grid tw:place-items-center tw:text-[10px] tw:font-medium tw:text-slate-700 dark:tw:text-slate-300">
                    {initials(h.actor)}
                  </span>
                  <div className="tw:flex tw:items-baseline tw:gap-2 tw:flex-wrap">
                    <span className="tw:text-[13px] tw:font-medium">{h.action}</span>
                    <span className="tw:text-[12px] tw:text-slate-500">
                      {relativeTime(h.timestamp, lang)}
                    </span>
                  </div>
                  {h.detail && (
                    <p className="tw:text-[13px] tw:text-slate-600 dark:tw:text-slate-400 tw:mt-0.5">
                      {h.detail}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
