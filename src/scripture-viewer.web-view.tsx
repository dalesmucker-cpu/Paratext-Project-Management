import { WebViewProps } from '@papi/core';
import papi from '@papi/frontend';
import { useDialogCallback } from '@papi/frontend/react';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { ParatextNoteThread } from './types/note.types';
import { ScrollGroupSelector } from 'platform-bible-react';

import { AudioPlayer, AttachmentViewer } from './components/note-media-components';

function renderTextWithLinks(text: string, baseKey: string): React.ReactNode[] | string {
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = urlRegex.exec(text)) !== null) {
    const url = match[0];
    const matchIndex = match.index;

    if (matchIndex > lastIndex) {
      parts.push(text.substring(lastIndex, matchIndex));
    }

    const href = url.startsWith('www.') ? `http://${url}` : url;
    const handleLinkClick = (e: React.MouseEvent) => {
      e.preventDefault();
      papi.commands.sendCommand('paratextProjectManager.openExternal', href).catch((err) => {
        console.error('Failed to open external link:', err);
      });
    };

    parts.push(
      <a
        key={`${baseKey}-link-${matchIndex}`}
        href={href}
        onClick={handleLinkClick}
        className="tw:text-indigo-600 tw:hover:text-indigo-800 tw:underline tw:break-all tw:cursor-pointer tw:font-medium"
      >
        {url}
      </a>,
    );

    lastIndex = matchIndex + url.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

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

  const verseStr = chapVerse[1]; // e.g. "1" or "1-2" or "1a"
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

function CommentText({ text, projectId }: { text: string; projectId: string }) {
  let cleanText = text.replace(
    /\s*Escuchar audio:\s*(https:\/\/drive\.google\.com\/\S*|http:\/\/localhost:\d+\/play\S*)/g,
    '',
  );
  cleanText = cleanText.replace(
    /\s*Ver archivo:\s*(https:\/\/drive\.google\.com\/\S*|http:\/\/localhost:\d+\/attachment\S*)/g,
    '',
  );

  const audioRegex = /\[Audio:\s*([^\]]+)\]/g;
  const attachmentRegex = /\[Attachment:\s*([^\]]+)\]/g;

  const elements: { index: number; length: number; node: React.ReactNode }[] = [];
  let match;

  while ((match = audioRegex.exec(cleanText)) !== null) {
    const filename = match[1].trim();
    elements.push({
      index: match.index,
      length: match[0].length,
      node: <AudioPlayer key={`audio-${match.index}`} projectId={projectId} filename={filename} />,
    });
  }

  while ((match = attachmentRegex.exec(cleanText)) !== null) {
    const filename = match[1].trim();
    elements.push({
      index: match.index,
      length: match[0].length,
      node: (
        <AttachmentViewer key={`att-${match.index}`} projectId={projectId} filename={filename} />
      ),
    });
  }

  elements.sort((a, b) => a.index - b.index);

  const parts = [];
  let lastIndex = 0;

  for (const el of elements) {
    if (el.index > lastIndex) {
      const textBlock = cleanText.substring(lastIndex, el.index);
      parts.push(
        <span key={`text-${lastIndex}`}>
          {renderTextWithLinks(textBlock, `text-${lastIndex}`)}
        </span>,
      );
    }
    parts.push(el.node);
    lastIndex = el.index + el.length;
  }

  if (lastIndex < cleanText.length) {
    const textBlock = cleanText.substring(lastIndex);
    parts.push(
      <span key={`text-${lastIndex}`}>{renderTextWithLinks(textBlock, `text-${lastIndex}`)}</span>,
    );
  }

  return (
    <div className="tw:text-slate-800 tw:leading-relaxed tw:whitespace-pre-wrap tw:break-words tw:text-xs">
      {parts.length > 0 ? parts : renderTextWithLinks(cleanText, 'root')}
    </div>
  );
}

interface BookInfo {
  code: string;
  name: string;
  fileName: string;
}

interface VerseItem {
  type: 'verse';
  number: number;
  numberStr?: string;
  text: string;
}

interface TextItem {
  type: 'text';
  text: string;
}

type ParagraphChild = VerseItem | TextItem;

interface HeadingBlock {
  type: 'heading';
  text: string;
}

interface ParagraphBlock {
  type: 'paragraph';
  children: ParagraphChild[];
}

interface PoetryBlock {
  type: 'poetry';
  indent: number;
  children: ParagraphChild[];
}

type ChapterBlock = HeadingBlock | ParagraphBlock | PoetryBlock;

interface EditableVerseProps {
  initialText: string;
  initialOffset: number;
  onSave: (newText: string) => Promise<void>;
  onCancel: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onCursorChange?: (offset: number) => void;
  onUndoStateChange?: (canUndo: boolean) => void;
  onEditBroadcast?: (newText: string) => void;
}

// Module-level handle to the currently active EditableVerse, so the parent
// scripture viewer can render an "↶ Deshacer" button next to it.
let activeEditableVerseHandle: {
  undo: () => void;
  canUndo: () => boolean;
  cancel: () => void;
} | null = null;

export const triggerVerseUndo = () => {
  if (activeEditableVerseHandle && activeEditableVerseHandle.canUndo()) {
    activeEditableVerseHandle.undo();
    return true;
  }
  return false;
};

export const triggerVerseCancel = () => {
  if (activeEditableVerseHandle) {
    activeEditableVerseHandle.cancel();
    return true;
  }
  return false;
};

const EditableVerse: React.FC<EditableVerseProps> = ({
  initialText,
  initialOffset,
  onSave,
  onCancel,
  onContextMenu,
  onCursorChange,
  onUndoStateChange,
  onEditBroadcast,
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [hasSaved, setHasSaved] = useState(false);
  const undoStackRef = useRef<string[]>([]);
  const displayInitialText = initialText || '\u200B';
  const lastInputValueRef = useRef<string>(displayInitialText);
  const [canUndo, setCanUndo] = useState(false);

  // Register this EditableVerse as the active one for the global undo/cancel buttons.
  useEffect(() => {
    activeEditableVerseHandle = {
      undo: () => handleUndo(),
      canUndo: () => undoStackRef.current.length > 0,
      cancel: () => {
        setHasSaved(true);
        if (ref.current) {
          ref.current.textContent = displayInitialText;
        }
        onCancel();
      },
    };
    return () => {
      if (activeEditableVerseHandle) activeEditableVerseHandle = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (onUndoStateChange) onUndoStateChange(canUndo);
  }, [canUndo, onUndoStateChange]);

  const getCaretOffset = (element: HTMLElement) => {
    let caretOffset = 0;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      try {
        const range = sel.getRangeAt(0);
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(element);
        preCaretRange.setEnd(range.endContainer, range.endOffset);
        caretOffset = preCaretRange.toString().length;
      } catch (e) {
        console.error('Failed to compute caret offset:', e);
      }
    }
    return caretOffset;
  };

  const handleCursorActivity = () => {
    if (ref.current && onCursorChange) {
      onCursorChange(getCaretOffset(ref.current));
    }
  };

  // Push current DOM text onto undo stack when it changes
  const pushUndoSnapshot = (newValue: string) => {
    const prev = lastInputValueRef.current;
    if (prev === newValue) return;
    undoStackRef.current.push(prev);
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    lastInputValueRef.current = newValue;
    setCanUndo(undoStackRef.current.length > 0);
  };

  const handleUndo = (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const prev = undoStackRef.current.pop();
    if (prev === undefined || !ref.current) return;
    // Restore text without re-rendering (avoid React overwriting)
    ref.current.textContent = prev;
    lastInputValueRef.current = prev;
    setCanUndo(undoStackRef.current.length > 0);
    // Restore caret to end of restored text
    try {
      const range = document.createRange();
      const sel = window.getSelection();
      const textNode = ref.current.firstChild || ref.current;
      const length = textNode.textContent?.length || 0;
      range.setStart(textNode, length);
      range.setEnd(textNode, length);
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch (_) {}
  };

  useEffect(() => {
    if (ref.current) {
      ref.current.focus();

      // Attempt to position caret at the clicked character offset
      try {
        const textNode = ref.current.firstChild || ref.current;
        const range = document.createRange();
        const sel = window.getSelection();
        const length = textNode.textContent?.length || 0;
        const targetOffset = Math.min(Math.max(0, initialOffset), length);

        range.setStart(textNode, targetOffset);
        range.setEnd(textNode, targetOffset);
        sel?.removeAllRanges();
        sel?.addRange(range);

        if (onCursorChange) onCursorChange(targetOffset);
      } catch (err) {
        // Fallback: collapse caret to the end
        try {
          const range = document.createRange();
          const sel = window.getSelection();
          range.selectNodeContents(ref.current);
          range.collapse(false);
          sel?.removeAllRanges();
          sel?.addRange(range);

          if (onCursorChange) onCursorChange(ref.current.textContent?.length || 0);
        } catch (e) {
          console.error('Failed to restore cursor position:', e);
        }
      }
    }
  }, [initialOffset]);

  const handleBlur = async (e: React.FocusEvent<HTMLSpanElement>) => {
    if (hasSaved) return;
    const text = e.currentTarget.textContent || '';
    const cleanText = text.replace(/\u200B/g, '');
    setHasSaved(true);
    await onSave(cleanText);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    // Ctrl+Z / Cmd+Z to undo typing within this verse
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      if (undoStackRef.current.length > 0) {
        handleUndo(e);
        return;
      }
    }
    // Ctrl+Y or Ctrl+Shift+Z for redo: re-apply popped value (simple)
    if (
      (e.ctrlKey || e.metaKey) &&
      ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y')
    ) {
      // No redo stack in this simple implementation
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setHasSaved(true);
      if (ref.current) {
        ref.current.textContent = displayInitialText;
      }
      onCancel();
    }
  };

  const handleInput = (e: React.FormEvent<HTMLSpanElement>) => {
    const text = e.currentTarget.textContent || '';
    pushUndoSnapshot(text);
    handleCursorActivity();
    if (onEditBroadcast) onEditBroadcast(text);
  };

  return (
    <span
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onInput={handleInput}
      onKeyUp={handleCursorActivity}
      onMouseUp={handleCursorActivity}
      onClick={(e) => {
        e.stopPropagation();
        handleCursorActivity();
      }}
      onContextMenu={onContextMenu}
      className="tw:outline-none tw:bg-transparent tw:p-0 tw:m-0 tw:border-none"
      style={{
        outline: 'none',
        textDecoration: 'none',
        // Use inline display for normal verses so we don't shift surrounding text.
        // For empty verses, use inline-block so the cursor has a visible target area.
        display: (initialText || '').trim() === '' ? 'inline-block' : 'inline',
        ...((initialText || '').trim() === ''
          ? {
              minWidth: '80px',
              minHeight: '1.1em',
              verticalAlign: 'baseline',
              borderBottom: '2px solid #6366f1',
            }
          : {}),
      }}
    >
      {displayInitialText}
    </span>
  );
};

const renderFootnotes = (node: React.ReactNode): React.ReactNode => {
  if (typeof node === 'string') {
    const parts = node.split(/(\[FN:[\s\S]*?\])/g);
    if (parts.length === 1) return node;
    return (
      <>
        {parts.map((part, idx) => {
          if (part.startsWith('[FN:') && part.endsWith(']')) {
            const footnoteText = part.slice(4, -1);
            return (
              <span
                key={idx}
                className="tw:text-xs tw:font-semibold tw:text-indigo-600 tw:align-super tw:mx-0.5 tw:cursor-pointer tw:select-none tw:hover:text-indigo-800 tw:transition-colors"
                title={footnoteText}
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                *
              </span>
            );
          }
          return part;
        })}
      </>
    );
  }

  if (React.isValidElement(node)) {
    const element = node as React.ReactElement<{ children?: React.ReactNode }>;
    if (!element.props?.children) return node;
    const children = React.Children.map(element.props.children, (child) => renderFootnotes(child));
    return React.cloneElement(element, { ...element.props, key: element.key }, children);
  }

  if (Array.isArray(node)) {
    return node.map((child, idx) => (
      <React.Fragment key={idx}>{renderFootnotes(child)}</React.Fragment>
    ));
  }

  return node;
};

globalThis.webViewComponent = function ScriptureViewerWebView({
  projectId,
  updateWebViewDefinition,
  useWebViewScrollGroupScrRef,
}: WebViewProps) {
  const selectProject = useDialogCallback(
    'platform.selectProject',
    useMemo(
      () => ({
        title: 'Seleccionar Proyecto o Recurso',
        prompt: 'Elige un proyecto o recurso de lectura:',
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
  const [books, setBooks] = useState<BookInfo[]>([]);
  const [selectedBook, setSelectedBook] = useState<string>('');
  const [selectedChapter, setSelectedChapter] = useState<number>(1);
  const [totalChapters, setTotalChapters] = useState<number>(1);

  const [controlsVisible, setControlsVisible] = useState(() => {
    const saved = localStorage.getItem('scripture_viewer_controls_visible');
    return saved !== 'false';
  });

  const toggleControls = () => {
    setControlsVisible((v) => {
      const next = !v;
      localStorage.setItem('scripture_viewer_controls_visible', String(next));
      return next;
    });
  };

  // Scroll group integration
  const [scrRef, setScrRef, scrollGroupId, setScrollGroupId] = useWebViewScrollGroupScrRef
    ? useWebViewScrollGroupScrRef()
    : [undefined, undefined, undefined, undefined];

  // Keep a ref to the latest scrRef so initData can read it without scrRef
  // being in its dependency array (scrRef changes on every navigation event,
  // which would cause initData to re-run and could momentarily show the
  // "No Scripture books found" error while the helper is re-fetching).
  const scrRefRef = useRef(scrRef);
  scrRefRef.current = scrRef;

  // Content states
  const [chapterBlocks, setChapterBlocks] = useState<ChapterBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const errorTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showErrorMessage = useCallback((msg: string) => {
    console.error(msg);
    setError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(''), 6000);
  }, []);

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  // Note integration states
  const [allNotes, setAllNotes] = useState<ParatextNoteThread[]>([]);
  const [selectedVerseNum, setSelectedVerseNum] = useState<number | null>(null);
  const [notesPopupVerseNum, setNotesPopupVerseNum] = useState<number | null>(null);
  const [currentUser, setCurrentUser] = useState('');
  const [collabCursors, setCollabCursors] = useState<
    Record<
      string,
      {
        projectId: string;
        book: string;
        chapter: number;
        verse: number | null;
        offset?: number | null;
        timestamp?: number;
      }
    >
  >({});
  const [teamMembers, setTeamMembers] = useState<string[]>([]);

  // Key Terms integration states
  const [keyTermsOverlayEnabled, setKeyTermsOverlayEnabled] = useState(
    () => localStorage.getItem('key_terms_overlay_enabled') === 'true',
  );
  const [chapterKeyTermsMatches, setChapterKeyTermsMatches] = useState<Record<string, any>>({});
  const [activeVersePopup, setActiveVersePopup] = useState<{
    verseNum: number;
    reference: string;
    expected: any[];
  } | null>(null);

  // Reader Settings States
  const [versesOnOwnLine, setVersesOnOwnLine] = useState(() => {
    return localStorage.getItem('scripture_viewer_verses_own_line') === 'true';
  });
  const [fontFamily, setFontFamily] = useState(() => {
    return localStorage.getItem('scripture_viewer_font_family') || 'sans-serif';
  });
  const [notesDisplayStyle, setNotesDisplayStyle] = useState(() => {
    return localStorage.getItem('scripture_viewer_notes_display_style') || 'highlight';
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showDraftingSidebar, setShowDraftingSidebar] = useState(() => {
    return localStorage.getItem('scripture_viewer_drafting_sidebar') !== 'false';
  });

  // Dynamically load Inter and Outfit fonts from Google Fonts
  useEffect(() => {
    if (!document.getElementById('google-fonts-link')) {
      const link = document.createElement('link');
      link.id = 'google-fonts-link';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Outfit:wght@400;600;700&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  const getCursorColors = (user: string) => {
    const userHash = user.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const palette = [
      { bar: '#f43f5e', label: '#f43f5e', highlight: 'rgba(244, 63, 94, 0.15)' },
      { bar: '#6366f1', label: '#6366f1', highlight: 'rgba(99, 102, 241, 0.15)' },
      { bar: '#10b981', label: '#10b981', highlight: 'rgba(16, 185, 129, 0.15)' },
      { bar: '#f59e0b', label: '#f59e0b', highlight: 'rgba(245, 158, 11, 0.15)' },
      { bar: '#06b6d4', label: '#06b6d4', highlight: 'rgba(6, 182, 212, 0.15)' },
    ];
    return palette[userHash % palette.length];
  };

  const renderCursorBar = (user: string, idx: number | string) => {
    const c = getCursorColors(user);
    return (
      <span
        key={`cursor-${user}-${idx}`}
        className="tw:relative tw:inline-block tw:align-baseline tw:text-[0]"
        style={{ width: '0px', height: '1.2em', lineHeight: '1.2em', marginLeft: '-1px' }}
      >
        <span
          className="tw:absolute tw:animate-[cursorBlink_1.1s_ease-in-out_infinite]"
          style={{
            left: 0,
            bottom: 0,
            width: '2px',
            height: '1.15em',
            backgroundColor: c.bar,
            borderRadius: '1px',
            display: 'inline-block',
          }}
        />
        <span
          className="tw:absolute tw:whitespace-nowrap tw:rounded tw:text-white tw:text-[10px] tw:font-semibold tw:pointer-events-none"
          style={{
            left: '-2px',
            bottom: 'calc(1.15em + 2px)',
            backgroundColor: c.label,
            padding: '1px 4px',
            lineHeight: '1.2',
            letterSpacing: '0.02em',
            boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
            zIndex: 10,
          }}
        >
          {user}
        </span>
      </span>
    );
  };



  const injectCursorsIntoElements = (
    nodes: React.ReactNode,
    editors: { user: string; offset: number }[],
  ): React.ReactNode => {
    if (editors.length === 0) return nodes;
    const sortedEditors = [...editors].sort((a, b) => a.offset - b.offset);
    let currentGlobalCharOffset = 0;
    let editorIdx = 0;

    const processString = (text: string): React.ReactNode => {
      const elements: React.ReactNode[] = [];
      let lastIndex = 0;
      while (editorIdx < sortedEditors.length) {
        const ed = sortedEditors[editorIdx];
        const localOffset = ed.offset - currentGlobalCharOffset;
        if (localOffset >= 0 && localOffset <= text.length) {
          if (localOffset > lastIndex) {
            elements.push(text.substring(lastIndex, localOffset));
          }
          elements.push(renderCursorBar(ed.user, editorIdx));
          lastIndex = localOffset;
          editorIdx++;
        } else {
          break;
        }
      }
      if (lastIndex < text.length) {
        elements.push(text.substring(lastIndex));
      }
      currentGlobalCharOffset += text.length;
      return elements.length > 1 ? <>{elements}</> : (elements[0] ?? '');
    };

    const traverse = (node: React.ReactNode): React.ReactNode => {
      if (editorIdx >= sortedEditors.length) return node;
      if (typeof node === 'string') {
        return processString(node);
      }
      if (React.isValidElement(node)) {
        const element = node as React.ReactElement<any>;
        if (element.props && element.props.children) {
          const processedChildren = traverse(element.props.children);
          return React.cloneElement(
            element,
            { ...element.props, key: element.key },
            processedChildren,
          );
        }
        return node;
      }
      if (Array.isArray(node)) {
        return node.map((child) => traverse(child));
      }
      return node;
    };

    return traverse(nodes);
  };

  // Focus and Selection Navigation
  const [selectedThreadIdInSidebar, setSelectedThreadIdInSidebar] = useState<string | null>(null);
  const pendingVerseRef = useRef<number | null>(null);

  // Flash highlight state for navigated-to verse
  const [flashVerseNum, setFlashVerseNum] = useState<number | null>(null);
  const flashTimerRef = useRef<NodeJS.Timeout | null>(null);

  const triggerVerseFlash = useCallback((verseNum: number) => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlashVerseNum(verseNum);
    flashTimerRef.current = setTimeout(() => {
      setFlashVerseNum(null);
      flashTimerRef.current = null;
    }, 1800);
    // Scroll the verse into view after a short delay for render
    setTimeout(() => {
      const element = document.getElementById(`verse-${verseNum}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }, []);

  const loadNotesRequestRef = useRef(0);

  const loadNotes = useCallback(async () => {
    if (!projectId) return;
    const requestId = ++loadNotesRequestRef.current;
    const isCurrentRequest = () => requestId === loadNotesRequestRef.current;
    try {
      const notesRes = await papi.commands.sendCommand(
        'paratextProjectManager.getProjectNotes',
        projectId,
        currentUser,
      );
      if (!isCurrentRequest()) return;
      const parsedNotes = JSON.parse(notesRes) as { threads: ParatextNoteThread[] };
      setAllNotes(parsedNotes.threads || []);
    } catch (err) {
      console.error('Failed to load notes', err);
    }
  }, [projectId, currentUser]);

  const loadKeyTermsMatchesRequestRef = useRef(0);

  const loadKeyTermsMatches = useCallback(
    async (bookCode: string, chapterNum: number) => {
      if (!projectId || !keyTermsOverlayEnabled) return;
      const requestId = ++loadKeyTermsMatchesRequestRef.current;
      const isCurrentRequest = () => requestId === loadKeyTermsMatchesRequestRef.current;
      try {
        const res = (await papi.commands.sendCommand(
          'paratextProjectManager.scanChapterRenderings',
          projectId,
          bookCode,
          chapterNum,
        )) as string;
        if (!isCurrentRequest()) return;
        const parsed = JSON.parse(res) as { matches: any[] };
        if (parsed && parsed.matches) {
          const matchesMap: Record<string, any> = {};
          for (const m of parsed.matches) {
            matchesMap[`${m.termId}-${m.reference}`] = m;
          }
          setChapterKeyTermsMatches(matchesMap);
        }
      } catch (e) {
        console.error('Failed to load key terms matches:', e);
      }
    },
    [projectId, keyTermsOverlayEnabled],
  );

  const highlightKeyTermsInNode = useCallback(
    (node: React.ReactNode, verseNum: number, bookCode: string): React.ReactNode => {
      if (!keyTermsOverlayEnabled) return node;

      const matches = Object.values(chapterKeyTermsMatches).filter(
        (m: any) =>
          isVerseInRef(bookCode, selectedChapter, verseNum, m.reference) && m.matchResult?.found,
      );

      if (matches.length === 0) return node;

      if (typeof node === 'string') {
        const matchRenderings = matches
          .map((m: any) => m.matchResult?.matchedText || '')
          .filter(Boolean);

        // Split multi-word matches so each word is matched and underlined separately
        const individualWords: string[] = [];
        for (const rend of matchRenderings) {
          const words = rend.split(/\s+/).filter(Boolean);
          individualWords.push(...words);
        }
        const uniqueRends = Array.from(new Set(individualWords));
        if (uniqueRends.length === 0) return node;

        const sortedRends = uniqueRends.sort((a, b) => b.length - a.length);
        const escaped = sortedRends.map((r: string) => r.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));

        // Try Unicode-aware split; fall back to simple \b if not supported
        let parts: string[];
        try {
          const uniPattern = `(?<![\\p{L}\\p{N}_])(${escaped.join('|')})(?![\\p{L}\\p{N}_])`;
          const regex = new RegExp(uniPattern, 'giu');
          parts = node.split(regex);
        } catch (_) {
          const regex = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
          parts = node.split(regex);
        }

        return parts.map((part, index) => {
          const match: any = matches.find((m: any) => {
            if (!m.matchResult?.matchedText) return false;
            const words = m.matchResult.matchedText.toLowerCase().split(/\s+/);
            return words.includes(part.toLowerCase());
          });

          if (match) {
            const isExact = match.matchResult?.matchType === 'exact';
            const underlineClass = isExact
              ? 'tw:border-b-2 tw:border-dashed tw:border-emerald-500 tw:bg-emerald-50/20'
              : 'tw:border-b-2 tw:border-dashed tw:border-amber-500 tw:bg-amber-50/20';

            return (
              <span
                key={index}
                className={`key-term-hover-container tw:relative tw:inline-block tw:cursor-pointer ${underlineClass}`}
                onClick={async (e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (!projectId) return;
                  try {
                    await papi.commands.sendCommand(
                      'paratextProjectManager.openKeyTerms',
                      projectId,
                    );
                    // Small delay to allow the webview to finish opening/focusing before emitting the select event
                    await new Promise((r) => setTimeout(r, 400));
                    await papi.commands.sendCommand(
                      'paratextProjectManager.selectKeyTerm',
                      projectId,
                      match.termId,
                    );
                  } catch (err) {
                     console.error('Failed to open/select key term on word click:', err);
                  }
                }}
              >
                {part}
                <span className="key-term-tooltip-content tw:invisible tw:absolute tw:bottom-full tw:left-1/2 tw:-translate-x-1/2 tw:mb-1 tw:bg-slate-800 tw:text-white tw:text-[10px] tw:p-2 tw:rounded-lg tw:shadow-md tw:w-48 tw:whitespace-normal tw:z-50 tw:opacity-0 tw:transition-opacity tw:duration-200 pointer-events-none">
                  <div className="tw:font-bold tw:text-indigo-300 tw:font-serif tw:text-xs">
                    {match.lemma}
                  </div>
                  <div className="tw:text-[9px] tw:text-slate-400 tw:italic">({match.gloss})</div>
                  <div className="tw:mt-1 tw:border-t tw:border-slate-700 tw:pt-1">
                    <strong>Aprobados:</strong> {match.expectedRenderings.join(', ') || 'Ninguno'}
                  </div>
                </span>
              </span>
            );
          }
          return part;
        });
      }

      if (React.isValidElement(node)) {
        const element = node as React.ReactElement<any>;
        if (element.props && element.props.children) {
          const children = React.Children.map(element.props.children, (child) =>
            highlightKeyTermsInNode(child, verseNum, bookCode),
          );
          return React.cloneElement(element, { ...element.props, key: element.key }, children);
        }
        return node;
      }

      if (Array.isArray(node)) {
        return node.map((child, idx) => (
          <React.Fragment key={idx}>
            {highlightKeyTermsInNode(child, verseNum, bookCode)}
          </React.Fragment>
        ));
      }

      return node;
    },
    [keyTermsOverlayEnabled, chapterKeyTermsMatches, selectedChapter, projectId],
  );

  // Load key terms matches automatically when overlay is enabled or book/chapter changes
  useEffect(() => {
    if (keyTermsOverlayEnabled && selectedBook && selectedChapter && projectId) {
      loadKeyTermsMatches(selectedBook, selectedChapter).catch((err) => {
        console.error('Failed to load key terms matches in useEffect:', err);
      });
    }
  }, [keyTermsOverlayEnabled, selectedBook, selectedChapter, projectId, loadKeyTermsMatches]);

  const loadChapterRequestRef = useRef(0);

  const loadChapter = useCallback(
    async (bookCode: string, chapterNum: number) => {
      if (!bookCode || !projectId) return;
      const requestId = ++loadChapterRequestRef.current;
      const isCurrentRequest = () => requestId === loadChapterRequestRef.current;
      setLoading(true);
      try {
        const textRes = await papi.commands.sendCommand(
          'paratextProjectManager.getChapterText',
          projectId,
          bookCode,
          chapterNum,
        );
        if (!isCurrentRequest()) return;
        const parsedText = JSON.parse(textRes) as {
          blocks: ChapterBlock[];
          totalChapters: number;
          error?: string;
        };
        if (parsedText.error) {
          setError(`Error del archivo USFM: ${parsedText.error}`);
          setChapterBlocks([]);
        } else {
          setChapterBlocks(parsedText.blocks);
          setTotalChapters(parsedText.totalChapters || 1);
          setError('');
        }

        // Load notes and key terms matches asynchronously to speed up chapter switching
        loadNotes().catch((err) => {
          console.error('Failed to load notes in background:', err);
        });
        loadKeyTermsMatches(bookCode, chapterNum).catch((err) => {
          console.error('Failed to load key terms matches in background:', err);
        });
      } catch (err) {
        // Auto-retry once after 3s — handles papi timeouts after long idle
        try {
          await new Promise((r) => setTimeout(r, 3000));
          if (!isCurrentRequest()) return;
          const textRes = await papi.commands.sendCommand(
            'paratextProjectManager.getChapterText',
            projectId,
            bookCode,
            chapterNum,
          );
          if (!isCurrentRequest()) return;
          const parsedText = JSON.parse(textRes) as {
            blocks: ChapterBlock[];
            totalChapters: number;
            error?: string;
          };
          if (parsedText.error) {
            setError(`Error del archivo USFM: ${parsedText.error}`);
            setChapterBlocks([]);
          } else {
            setChapterBlocks(parsedText.blocks);
            setTotalChapters(parsedText.totalChapters || 1);
            setError('');
          }
          loadNotes().catch((nErr) => {
            console.error('Failed to load notes in background on retry:', nErr);
          });
          loadKeyTermsMatches(bookCode, chapterNum).catch((ktErr) => {
            console.error('Failed to load key terms matches in background on retry:', ktErr);
          });
        } catch (retryErr) {
          console.error(retryErr);
          if (isCurrentRequest()) setError('Error al cargar texto o notas.');
        }
      } finally {
        if (isCurrentRequest()) setLoading(false);
      }
    },
    [projectId, loadNotes, loadKeyTermsMatches],
  );

  const lastBroadcastTimeRef = useRef<number>(0);
  const pendingBroadcastRef = useRef<NodeJS.Timeout | null>(null);
  const lastEditBroadcastTimeRef = useRef<number>(0);
  const pendingEditBroadcastRef = useRef<{ verse: number; text: string; ts: number } | null>(null);
  const editBroadcastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isEditingVerseRef = useRef<boolean>(false);
  const editingVerseNumRef = useRef<number | null>(null);
  // Tracks verse updates triggered by the LOCAL user so the verse_update listener
  // doesn't trigger a redundant loadChapter that could overwrite the edit.
  const selfVerseUpdateRef = useRef<{
    book: string;
    chapter: number;
    verse: number;
    ts: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (pendingBroadcastRef.current) clearTimeout(pendingBroadcastRef.current);
      if (editBroadcastTimerRef.current) clearTimeout(editBroadcastTimerRef.current);
    };
  }, []);

  const handleCursorChange = useCallback(
    (verseNum: number, offset: number) => {
      if (!currentUser || !projectId) return;
      const now = Date.now();
      const throttleMs = 200;

      const performBroadcast = () => {
        lastBroadcastTimeRef.current = Date.now();
        if (pendingBroadcastRef.current) {
          clearTimeout(pendingBroadcastRef.current);
          pendingBroadcastRef.current = null;
        }
        papi.commands
          .sendCommand(
            'paratextProjectManager.broadcastCursor',
            currentUser,
            projectId,
            selectedBook,
            selectedChapter,
            verseNum,
            offset,
          )
          .catch((e) => {
            console.error('Failed to broadcast cursor:', e);
          });
      };

      if (now - lastBroadcastTimeRef.current >= throttleMs) {
        performBroadcast();
      } else {
        if (pendingBroadcastRef.current) clearTimeout(pendingBroadcastRef.current);
        pendingBroadcastRef.current = setTimeout(performBroadcast, throttleMs);
      }
    },
    [currentUser, projectId, selectedBook, selectedChapter],
  );

  // Throttled broadcast of in-progress verse text (keystrokes).
  // Replaces the previous "save-only" workflow: collaborators see the text
  // appearing live as the local user types.
  const handleVerseEditBroadcast = useCallback(
    (verseNum: number, newText: string) => {
      if (!currentUser || !selectedBook || !projectId) return;
      const cleanText = newText.replace(/\u200B/g, '');
      const throttleMs = 150;
      const now = Date.now();

      const performEditBroadcast = () => {
        lastEditBroadcastTimeRef.current = Date.now();
        pendingEditBroadcastRef.current = null;
        if (editBroadcastTimerRef.current) {
          clearTimeout(editBroadcastTimerRef.current);
          editBroadcastTimerRef.current = null;
        }
        papi.commands
          .sendCommand(
            'paratextProjectManager.broadcastVerseEdit',
            currentUser,
            projectId,
            selectedBook,
            selectedChapter,
            verseNum,
            cleanText,
          )
          .catch((e) => {
            console.error('Failed to broadcast verse edit:', e);
          });
      };

      pendingEditBroadcastRef.current = { verse: verseNum, text: cleanText, ts: now };
      const elapsed = now - lastEditBroadcastTimeRef.current;
      if (elapsed >= throttleMs) {
        performEditBroadcast();
      } else if (!editBroadcastTimerRef.current) {
        editBroadcastTimerRef.current = setTimeout(performEditBroadcast, throttleMs - elapsed);
      }
    },
    [currentUser, projectId, selectedBook, selectedChapter],
  );



  // Verse editing states
  const [isEditingVerse, setIsEditingVerse] = useState(false);
  const [fontSize, setFontSize] = useState(16);
  const [verseEditorCanUndo, setVerseEditorCanUndo] = useState(false);

  useEffect(() => {
    isEditingVerseRef.current = isEditingVerse;
    editingVerseNumRef.current = selectedVerseNum;
    if (isEditingVerse) {
      setVerseHighlight(null);
    }
  }, [isEditingVerse, selectedVerseNum]);

  // Text selection states for new notes
  const [selectedText, setSelectedText] = useState('');
  const [startPosition, setStartPosition] = useState(0);
  const [contextBefore, setContextBefore] = useState('');
  const [contextAfter, setContextAfter] = useState('');
  const [initialOffset, setInitialOffset] = useState(0);

  // Per-verse selection highlight: tracks the current text range the user has
  // selected inside a verse, so we can render it with a background color.
  const [verseHighlight, setVerseHighlight] = useState<{
    verseNum: number;
    start: number;
    end: number;
    text: string;
  } | null>(null);

  const captureVerseHighlight = (verseNum: number, _verseText: string) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setVerseHighlight(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const verseEl = document.getElementById(`verse-${verseNum}`);
    if (!verseEl || !verseEl.contains(range.commonAncestorContainer)) {
      return;
    }
    // Compute character offsets within the verse text using a clone of the range
    // that is collapsed to its start/end and compared to the verse text length.
    const pre = range.cloneRange();
    pre.selectNodeContents(verseEl);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    const length = range.toString().length;
    const end = start + length;
    const selected = range.toString();
    if (!selected.trim()) {
      setVerseHighlight(null);
      return;
    }
    setVerseHighlight({ verseNum, start, end, text: selected });
  };

  // Note creation form states
  const [showNewNoteForm, setShowNewNoteForm] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');
  const [assignedUser, setAssignedUser] = useState('');

  // Reply box text state
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({});

  const [commentToDelete, setCommentToDelete] = useState<{
    threadId: string;
    commentDate: string;
    commentAuthor: string;
  } | null>(null);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const handleWindowClick = () => {
      setContextMenu(null);
    };
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, []);

  // Clear the verse highlight when the user clicks outside any verse span
  // or when the document selection becomes collapsed.
  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setVerseHighlight(null);
      }
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);
  const [replying, setReplying] = useState<Record<string, boolean>>({});

  // File attachment elements
  const [replyAttaching, setReplyAttaching] = useState<Record<string, boolean>>({});
  const [newNoteAttachment, setNewNoteAttachment] = useState<{
    filename: string;
    base64Data: string;
  } | null>(null);
  const [newNoteAudio, setNewNoteAudio] = useState<{ filename: string; base64Data: string } | null>(
    null,
  );
  const newNoteFileInputRef = useRef<HTMLInputElement>(null);
  const replyFileInputRef = useRef<HTMLInputElement>(null);
  const [activeReplyThreadId, setActiveReplyThreadId] = useState<string | null>(null);

  // Voice recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTarget, setRecordingTarget] = useState<{
    type: 'new' | 'reply';
    threadId?: string;
  } | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [recordDuration, setRecordDuration] = useState(0);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Listen to cross-webview navigateToVerse events
  useEffect(() => {
    const unsubscribe = papi.network.getNetworkEvent<{
      projectId: string;
      bookCode: string;
      chapter: number;
      verse: number;
    }>('paratextProjectManager.onNavigateToVerse')((eventData) => {
      if (!eventData || eventData.projectId !== projectId) return;
      const { bookCode, chapter, verse } = eventData;
      const bookChanged = selectedBook !== bookCode;
      const chapterChanged = selectedChapter !== chapter;

      if (bookChanged || chapterChanged) {
        pendingVerseRef.current = verse;
        setSelectedBook(bookCode);
        setSelectedChapter(chapter);
        setIsEditingVerse(false);
      } else {
        setSelectedVerseNum(verse);
        setIsEditingVerse(false);
        triggerVerseFlash(verse);
      }

      if (scrollGroupId !== undefined && setScrRef) {
        setScrRef({
          book: bookCode,
          chapterNum: chapter,
          verseNum: verse,
        });
      }
    });
    return () => {
      unsubscribe();
    };
  }, [projectId, selectedBook, selectedChapter, scrollGroupId, setScrRef]);

  // Keep refs of current values to avoid stale closures in scroll group sync
  const selectedBookRef = useRef(selectedBook);
  selectedBookRef.current = selectedBook;
  const selectedChapterRef = useRef(selectedChapter);
  selectedChapterRef.current = selectedChapter;
  const selectedVerseNumRef = useRef(selectedVerseNum);
  selectedVerseNumRef.current = selectedVerseNum;

  // Sync scroll group changes (from other windows) to local state
  useEffect(() => {
    if (!scrRef) return;
    const { book, chapterNum, verseNum } = scrRef;
    if (!book) return;

    const bookChanged = selectedBookRef.current !== book;
    const chapterChanged = selectedChapterRef.current !== chapterNum;
    const verseChanged = selectedVerseNumRef.current !== verseNum;

    if (bookChanged || chapterChanged) {
      pendingVerseRef.current = verseNum;
      setSelectedBook(book);
      setSelectedChapter(chapterNum);
      setIsEditingVerse(false);
    } else if (verseChanged) {
      setSelectedVerseNum(verseNum);
      setIsEditingVerse(false);
    }
  }, [scrRef]);

  // Helper to navigate to a new reference and explicitly push it to the scroll group
  const navigateToReference = useCallback(
    (bookCode: string, chapterNum: number, verseNum: number = 1) => {
      setIsEditingVerse(false);
      setSelectedBook(bookCode);
      setSelectedChapter(chapterNum);
      setSelectedVerseNum(verseNum);
      if (scrollGroupId !== undefined && setScrRef) {
        setScrRef({
          book: bookCode,
          chapterNum,
          verseNum,
        });
      }
    },
    [scrollGroupId, setScrRef],
  );

  // Helper to select a verse locally and explicitly push it to the scroll group
  const selectVerse = useCallback(
    (verseNum: number | null) => {
      setSelectedVerseNum(verseNum);
      if (verseNum !== null && scrollGroupId !== undefined && setScrRef) {
        setScrRef({
          book: selectedBookRef.current,
          chapterNum: selectedChapterRef.current,
          verseNum,
        });
      }
    },
    [scrollGroupId, setScrRef],
  );

  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const loadChapterRef = useRef(loadChapter);
  loadChapterRef.current = loadChapter;
  const loadNotesRef = useRef(loadNotes);
  loadNotesRef.current = loadNotes;
  const loadKeyTermsMatchesRef = useRef(loadKeyTermsMatches);
  loadKeyTermsMatchesRef.current = loadKeyTermsMatches;

  // Listen to collaboration events
  useEffect(() => {
    let unsubEvent: any;
    try {
      unsubEvent = papi.network.getNetworkEvent<any>('paratextProjectManager.onCollabEvent')(
        (event: any) => {
          if (!event) return;
          const { type, payload } = event;
          const currentProjId = projectIdRef.current;
          const currentUsr = currentUserRef.current;
          const currentBook = selectedBookRef.current;
          const currentChapter = selectedChapterRef.current;

          if (type === 'cursor_update') {
            if (
              !payload?.user ||
              payload.user === currentUsr ||
              payload.projectId !== currentProjId
            ) {
              return;
            }
            setCollabCursors((prev) => {
              const next = { ...prev };
              if (payload.verse === null) {
                delete next[payload.user];
              } else {
                next[payload.user] = { ...payload, timestamp: payload.timestamp ?? Date.now() };
              }
              return next;
            });
          } else if (type === 'note_update') {
            if (payload.projectId === currentProjId) {
              loadNotesRef.current();
            }
          } else if (type === 'verse_update') {
            if (
              payload.projectId === currentProjId &&
              payload.book === currentBook &&
              payload.chapter === currentChapter
            ) {
              // CRITICAL: Do NOT reload the chapter if the user is currently editing.
              // The EditableVerse uses contentEditable with the chapterBlocks text as initialText.
              // Reloading chapterBlocks would cause React to re-render the DOM and
              // ERASE the user's in-progress typing (data loss!).
              if (isEditingVerseRef.current) {
                console.log(
                  `[collab] Skipped verse_update reload — user is editing verse ${editingVerseNumRef.current}`,
                );
                return;
              }
              // Also skip if this verse_update is from our OWN save (avoid double loadChapter)
              const self = selfVerseUpdateRef.current;
              if (
                self &&
                self.book === payload.book &&
                self.chapter === payload.chapter &&
                self.verse === payload.verse &&
                Date.now() - self.ts < 5000
              ) {
                console.log(
                  `[collab] Skipped self-triggered verse_update for ${payload.book} ${payload.chapter}:${payload.verse}`,
                );
                selfVerseUpdateRef.current = null;
                return;
              }
              loadChapterRef.current(currentBook, currentChapter);
            }
          } else if (type === 'verse_edit') {
            // Live keystroke broadcast from another collaborator.
            // Apply it optimistically to the displayed verse text (do NOT save).
            if (
              payload &&
              payload.projectId === currentProjId &&
              payload.book === currentBook &&
              payload.chapter === currentChapter &&
              payload.user !== currentUsr
            ) {
              // Don't overwrite the verse that the LOCAL user is currently editing
              if (isEditingVerseRef.current && editingVerseNumRef.current === payload.verse) {
                return;
              }
              const newText = payload.newText ?? '';
              setChapterBlocks((prev) =>
                prev.map((block) => {
                  if (block.type === 'paragraph' || block.type === 'poetry') {
                    return {
                      ...block,
                      children: block.children.map((child) => {
                        if (child.type === 'verse' && child.number === payload.verse) {
                          return { ...child, text: newText };
                        }
                        return child;
                      }),
                    };
                  }
                  return block;
                }),
              );
            }
          } else if (type === 'key_terms_update') {
            if (payload.projectId === currentProjId) {
              loadKeyTermsMatchesRef.current(currentBook, currentChapter).catch((err) => {
                console.error('Failed to load key terms matches in collab event:', err);
              });
            }
          } else if (type === 'user_changed') {
            if (payload.username) {
              setCurrentUser(payload.username);
            }
          }
        },
      );
    } catch (e) {
      console.error('Failed to subscribe to collab event:', e);
    }
    return () => {
      if (unsubEvent) unsubEvent();
    };
  }, [projectId]);

  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 30_000;
      setCollabCursors((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [user, cursor] of Object.entries(next)) {
          if ((cursor.timestamp ?? 0) < cutoff) {
            delete next[user];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  // Broadcast cursor when editing state changes
  useEffect(() => {
    if (!currentUser || !projectId) return;
    const updateCursor = async () => {
      try {
        const verseToBroadcast = isEditingVerse ? selectedVerseNum : null;
        await papi.commands.sendCommand(
          'paratextProjectManager.broadcastCursor',
          currentUser,
          projectId,
          selectedBook,
          selectedChapter,
          verseToBroadcast,
          isEditingVerse ? initialOffset : null,
        );
      } catch (e) {
        console.error('Failed to broadcast cursor position:', e);
      }
    };
    updateCursor();
  }, [
    isEditingVerse,
    selectedVerseNum,
    selectedBook,
    selectedChapter,
    currentUser,
    projectId,
    initialOffset,
  ]);

  // Scroll to active verse element when selectedVerseNum or chapterBlocks changes
  useEffect(() => {
    if (selectedVerseNum !== null) {
      const timer = setTimeout(() => {
        const element = document.getElementById(`verse-${selectedVerseNum}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 80);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [selectedVerseNum, chapterBlocks]);

  // Scroll to focused thread card in right sidebar
  useEffect(() => {
    if (selectedThreadIdInSidebar) {
      const timer = setTimeout(() => {
        const element = document.getElementById(`thread-card-${selectedThreadIdInSidebar}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [selectedThreadIdInSidebar]);

  // Reset states on active verse changes
  useEffect(() => {
    setSelectedThreadIdInSidebar(null);
  }, [selectedVerseNum]);

  // Caret focus and selection are handled natively by EditableVerse on mount.

  // Helper to extract raw text of any verse from chapterBlocks
  const getVerseText = (verseNum: number | null) => {
    if (verseNum === null) return '';
    for (const block of chapterBlocks) {
      if (block.type === 'paragraph' || block.type === 'poetry') {
        for (const child of block.children) {
          if (child.type === 'verse' && child.number === verseNum) {
            return child.text;
          }
        }
      }
    }
    return '';
  };



  const handleContentEditableSave = async (newText: string, verseNum: number) => {
    if (!projectId) return;
    const originalText = getVerseText(verseNum);

    if (newText.trim() === originalText.trim()) {
      if (selectedVerseNum === verseNum) {
        setIsEditingVerse(false);
        setSelectedVerseNum(null);
      }
      return;
    }

    selfVerseUpdateRef.current = {
      book: selectedBook || '',
      chapter: selectedChapter,
      verse: verseNum,
      ts: Date.now(),
    };
    try {
      const res = await papi.commands.sendCommand(
        'paratextProjectManager.updateVerseText',
        projectId,
        selectedBook,
        selectedChapter,
        verseNum,
        newText,
      );

      if (res === 'ok') {
        // Optimistically update chapterBlocks so the UI immediately shows the
        // saved text. Without this, the verse_update event is blocked by
        // selfVerseUpdateRef and the view snaps back to the old text.
        setChapterBlocks((prev) =>
          prev.map((block) => {
            if (block.type === 'paragraph' || block.type === 'poetry') {
              return {
                ...block,
                children: block.children.map((child) => {
                  if (child.type === 'verse' && child.number === verseNum) {
                    return { ...child, text: newText };
                  }
                  return child;
                }),
              };
            }
            return block;
          }),
        );
        if (selectedVerseNum === verseNum) {
          setIsEditingVerse(false);
          setSelectedVerseNum(null);
        }
        // verse_update broadcast will trigger loadChapter on remote machines
      } else {
        showErrorMessage(`Error al guardar el texto: ${res}`);
        if (selectedVerseNum === verseNum) {
          setIsEditingVerse(false);
          setSelectedVerseNum(null);
        }
        selfVerseUpdateRef.current = null;
      }
    } catch (err) {
      showErrorMessage(`Error al guardar el texto: ${err}`);
      if (selectedVerseNum === verseNum) {
        setIsEditingVerse(false);
        setSelectedVerseNum(null);
      }
      selfVerseUpdateRef.current = null;
    } finally {
      /* done */
    }
  };

  // Highlights text segments matching selections in note threads
  const highlightText = (text: string, notes: ParatextNoteThread[], verseNum: number) => {
    const highlights = notes
      .filter((n) => n.selectedText && n.selectedText.trim())
      .map((n) => ({ text: n.selectedText.trim(), threadId: n.threadId }));

    if (highlights.length === 0) return text;
    highlights.sort((a, b) => b.text.length - a.text.length);

    const escapedTerms = highlights.map((h) => h.text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
    const uniqueTerms = Array.from(new Set(escapedTerms));
    if (uniqueTerms.length === 0) return text;

    const regex = new RegExp(`(${uniqueTerms.join('|')})`, 'g');
    const parts = text.split(regex);

    return parts.map((part, index) => {
      const match = highlights.find((h) => h.text.toLowerCase() === part.toLowerCase());
      if (match) {
        const isSelectedThread = selectedThreadIdInSidebar === match.threadId;
        const clickHandler = (e: React.MouseEvent) => {
          e.stopPropagation();
          selectVerse(verseNum);
          setNotesPopupVerseNum(verseNum);
          setSelectedThreadIdInSidebar(match.threadId);
        };

        if (notesDisplayStyle === 'highlight') {
          return (
            <mark
              key={index}
              onClick={clickHandler}
              className={`tw:cursor-pointer tw:px-0.5 tw:rounded tw:transition ${
                isSelectedThread
                  ? 'tw:bg-yellow-400 tw:text-slate-900 tw:font-semibold tw:ring-2 tw:ring-yellow-500'
                  : 'tw:bg-yellow-200/80 tw:hover:bg-yellow-300 tw:text-slate-800'
              }`}
              title="Click para ver la nota"
            >
              {part}
            </mark>
          );
        } else {
          let symbol = '🚩';
          if (notesDisplayStyle === 'pin') symbol = '📌';
          else if (notesDisplayStyle === 'dialog') symbol = '💬';
          else if (notesDisplayStyle === 'tag') symbol = '🏷️';

          return (
            <span
              key={index}
              onClick={clickHandler}
              className={`tw:cursor-pointer tw:px-0.5 tw:rounded tw:transition tw:inline-flex tw:items-center tw:gap-0.5 ${
                isSelectedThread
                  ? 'tw:border tw:border-indigo-400 tw:bg-indigo-50 tw:text-indigo-800 tw:font-semibold'
                  : 'tw:hover:bg-slate-100 tw:text-slate-800'
              }`}
              title="Click para ver la nota"
            >
              <span className="tw:border-b tw:border-dashed tw:border-slate-400">{part}</span>
              <span className="tw:text-xs" role="img" aria-label="nota">{symbol}</span>
            </span>
          );
        }
      }
      return part;
    });
  };

  // Wrap a character range within a string in a highlighted <mark> element.
  // Used to draw attention to the currently selected word/phrase in a verse.
  // Returns a React node (string + mark + string) that can be safely composed
  // with the note highlights and cursor injection.
  const wrapRangeInMark = (
    node: React.ReactNode,
    start: number,
    end: number,
    keyBase: string,
  ): React.ReactNode => {
    if (typeof node === 'string') {
      const safeStart = Math.max(0, Math.min(start, node.length));
      const safeEnd = Math.max(safeStart, Math.min(end, node.length));
      if (safeEnd <= safeStart) return node;
      return (
        <>
          {node.substring(0, safeStart)}
          <mark
            key={`${keyBase}-hl`}
            className="tw:transition-colors"
            style={{
              backgroundColor: 'rgba(99, 102, 241, 0.28)',
              borderRadius: '3px',
              padding: '0 2px',
            }}
          >
            {node.substring(safeStart, safeEnd)}
          </mark>
          {node.substring(safeEnd)}
        </>
      );
    }

    if (Array.isArray(node)) {
      let currentOffset = 0;
      return node.map((child, idx) => {
        if (typeof child === 'string') {
          const childStart = currentOffset;
          const childEnd = currentOffset + child.length;
          currentOffset = childEnd;

          const overlapStart = Math.max(start, childStart);
          const overlapEnd = Math.min(end, childEnd);

          if (overlapEnd > overlapStart) {
            const relStart = overlapStart - childStart;
            const relEnd = overlapEnd - childStart;
            return (
              <React.Fragment key={`${keyBase}-node-${idx}`}>
                {child.substring(0, relStart)}
                <mark
                  key={`${keyBase}-hl`}
                  className="tw:transition-colors"
                  style={{
                    backgroundColor: 'rgba(99, 102, 241, 0.28)',
                    borderRadius: '3px',
                    padding: '0 2px',
                  }}
                >
                  {child.substring(relStart, relEnd)}
                </mark>
                {child.substring(relEnd)}
              </React.Fragment>
            );
          }
          return child;
        } else {
          const childText =
            child &&
            typeof child === 'object' &&
            'props' in child &&
            typeof child.props?.children === 'string'
              ? child.props.children
              : '';
          const childEnd = currentOffset + childText.length;
          currentOffset = childEnd;
          return child;
        }
      });
    }

    return node;
  };

  // Fetch books & config
  const initData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    try {
      const [uRes, tmRes, bRes, collabRes] = await Promise.all([
        papi.commands.sendCommand('paratextProjectManager.getCurrentUser'),
        papi.commands.sendCommand('paratextProjectManager.getTeamMembers'),
        papi.commands.sendCommand('paratextProjectManager.getProjectBooks', projectId),
        papi.commands.sendCommand('paratextProjectManager.getCollabStatus'),
      ]);
      if (uRes) {
        setCurrentUser(uRes);
      } else if (collabRes && collabRes.username) {
        setCurrentUser(collabRes.username);
      }
      if (tmRes) setTeamMembers(JSON.parse(tmRes as string) as string[]);

      const bookList = JSON.parse(bRes as string) as BookInfo[];
      setBooks(bookList);

      if (bookList.length > 0) {
        const lastNav = await papi.commands.sendCommand(
          'paratextProjectManager.getLastNavigatedVerse',
          projectId,
        );
        if (lastNav) {
          setSelectedBook(lastNav.bookCode);
          setSelectedChapter(lastNav.chapter);
          pendingVerseRef.current = lastNav.verse;
          if (scrollGroupId !== undefined && setScrRef) {
            setScrRef({
              book: lastNav.bookCode,
              chapterNum: lastNav.chapter,
              verseNum: lastNav.verse,
            });
          }
        } else if (scrRefRef.current && scrRefRef.current.book) {
          setSelectedBook(scrRefRef.current.book);
          setSelectedChapter(scrRefRef.current.chapterNum);
          pendingVerseRef.current = scrRefRef.current.verseNum;
        } else {
          const defaultBook = bookList.find((b) => b.code === 'RUT') || bookList[0];
          setSelectedBook(defaultBook.code);
          setSelectedChapter(1);
          if (scrollGroupId !== undefined && setScrRef) {
            setScrRef({
              book: defaultBook.code,
              chapterNum: 1,
              verseNum: 1,
            });
          }
        }
      } else {
        setError('No se encontraron libros de Escritura en este proyecto (archivos .SFM).');
      }
    } catch (err) {
      // Auto-retry once after 3s — handles papi timeouts after long idle
      try {
        await new Promise((r) => setTimeout(r, 3000));
        const [uRes, tmRes, bRes, collabRes] = await Promise.all([
          papi.commands.sendCommand('paratextProjectManager.getCurrentUser'),
          papi.commands.sendCommand('paratextProjectManager.getTeamMembers'),
          papi.commands.sendCommand('paratextProjectManager.getProjectBooks', projectId),
          papi.commands.sendCommand('paratextProjectManager.getCollabStatus'),
        ]);
        if (uRes) {
          setCurrentUser(uRes);
        } else if (collabRes && collabRes.username) {
          setCurrentUser(collabRes.username);
        }
        if (tmRes) setTeamMembers(JSON.parse(tmRes as string) as string[]);

        const bookList = JSON.parse(bRes as string) as BookInfo[];
        setBooks(bookList);

        if (bookList.length > 0) {
          const lastNav = await papi.commands.sendCommand(
            'paratextProjectManager.getLastNavigatedVerse',
            projectId,
          );
          if (lastNav) {
            setSelectedBook(lastNav.bookCode);
            setSelectedChapter(lastNav.chapter);
            pendingVerseRef.current = lastNav.verse;
            if (scrollGroupId !== undefined && setScrRef) {
              setScrRef({
                book: lastNav.bookCode,
                chapterNum: lastNav.chapter,
                verseNum: lastNav.verse,
              });
            }
          } else if (scrRefRef.current && scrRefRef.current.book) {
            setSelectedBook(scrRefRef.current.book);
            setSelectedChapter(scrRefRef.current.chapterNum);
            pendingVerseRef.current = scrRefRef.current.verseNum;
          } else {
            const defaultBook = bookList.find((b) => b.code === 'RUT') || bookList[0];
            setSelectedBook(defaultBook.code);
            setSelectedChapter(1);
            if (scrollGroupId !== undefined && setScrRef) {
              setScrRef({
                book: defaultBook.code,
                chapterNum: 1,
                verseNum: 1,
              });
            }
          }
        }
      } catch (retryErr) {
        console.error(retryErr);
        setError('Error al cargar libros de Escritura.');
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, scrollGroupId, setScrRef]);

  useEffect(() => {
    initData();
  }, [initData]);

  // Refresh on visibility change but no more than once every 2 minutes
  const lastRefreshRef = useRef(0);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRefreshRef.current > 120_000) {
        lastRefreshRef.current = Date.now();
        if (selectedBook) {
          loadChapter(selectedBook, selectedChapter);
        }
        loadNotes();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [selectedBook, selectedChapter, loadChapter, loadNotes]);

  // Cleaned up original non-callback loadChapter/loadNotes definitions since they were moved to top.

  useEffect(() => {
    if (selectedBook) {
      setVerseHighlight(null);
      loadChapter(selectedBook, selectedChapter);
      if (pendingVerseRef.current !== null) {
        const pv = pendingVerseRef.current;
        setSelectedVerseNum(pv);
        pendingVerseRef.current = null;
        triggerVerseFlash(pv);
      } else {
        setSelectedVerseNum(null);
      }
      resetForms();
    }
  }, [selectedBook, selectedChapter]);

  const resetForms = () => {
    setShowNewNoteForm(false);
    setNewNoteText('');
    setAssignedUser('');
    setNewNoteAttachment(null);
    setNewNoteAudio(null);
    setIsEditingVerse(false);
    setSelectedText('');
    setStartPosition(0);
    setContextBefore('');
    setContextAfter('');
    cleanupRecording();
    setNotesPopupVerseNum(null);
  };

  // Group threads by verse number for the current book and chapter
  const chapterNotesByVerse = useMemo(() => {
    const map: Record<number, ParatextNoteThread[]> = {};
    for (const thread of allNotes) {
      if (
        thread.book?.toUpperCase() === selectedBook?.toUpperCase() &&
        Number(thread.chapter) === selectedChapter
      ) {
        const vNum = Number(thread.verse);
        if (!isNaN(vNum)) {
          if (!map[vNum]) map[vNum] = [];
          map[vNum].push(thread);
        }
      }
    }
    return map;
  }, [allNotes, selectedBook, selectedChapter]);

  const selectedVerseThreads = useMemo(() => {
    if (notesPopupVerseNum === null) return [];
    return chapterNotesByVerse[notesPopupVerseNum] || [];
  }, [notesPopupVerseNum, chapterNotesByVerse]);

  // Voice recording logic
  const startRecording = async (type: 'new' | 'reply', threadId?: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        if (audioChunksRef.current.length === 0) return;
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (audioBlob.size === 0) return;

        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          if (!projectId) return;
          const base64data = (reader.result as string).split(',')[1];
          const filename = `audio_${Date.now()}.webm`;

          if (type === 'new') {
            setNewNoteAudio({ filename, base64Data: base64data });
          } else if (type === 'reply' && threadId) {
            try {
              const saveRes = await papi.commands.sendCommand(
                'paratextProjectManager.saveAudioNote',
                projectId,
                filename,
                base64data,
              );
              if (saveRes && saveRes.status === 'ok') {
                const audioLink =
                  saveRes.driveUrl ||
                  `http://localhost:49876/play?project=${projectId}&file=${filename}`;
                const matchedThread = allNotes.find((t) => t.threadId === threadId);
                if (!matchedThread) return;

                const replyData = {
                  threadId,
                  verseRef: matchedThread.verseRef,
                  language: matchedThread.language,
                  selectedText: matchedThread.selectedText,
                  startPosition: matchedThread.startPosition,
                  contextBefore: matchedThread.contextBefore,
                  contextAfter: matchedThread.contextAfter,
                  verseXml: matchedThread.verseXml,
                  replyToUser: matchedThread.latestUser,
                  hideInTextWindow: matchedThread.hideInTextWindow,
                  contents: `[Audio: ${filename}]\nEscuchar audio: ${audioLink}`,
                };

                const res = await papi.commands.sendCommand(
                  'paratextProjectManager.addNoteReply',
                  projectId,
                  currentUser,
                  JSON.stringify(replyData),
                );
                if (res === 'ok') {
                  await loadNotes();
                } else {
                  showErrorMessage(`Error al enviar respuesta de audio: ${res}`);
                }
              } else {
                showErrorMessage(`Error al guardar audio: ${saveRes?.error || 'Unknown error'}`);
              }
            } catch (err) {
              console.error(err);
            }
          }
        };
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
      setRecordingTarget({ type, threadId });
      setRecordDuration(0);

      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setRecordDuration((d) => d + 1);
      }, 1000);
    } catch (e) {
      showErrorMessage(`No se pudo acceder al micrófono: ${e}`);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    cleanupRecording();
  };

  const cancelRecording = () => {
    audioChunksRef.current = [];
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    cleanupRecording();
    if (recordingTarget?.type === 'new') {
      setNewNoteAudio(null);
    }
  };

  const cleanupRecording = () => {
    setIsRecording(false);
    setRecordingTarget(null);
    setMediaRecorder(null);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Reply Attachment Trigger
  const handleReplyAttachClick = (threadId: string) => {
    setActiveReplyThreadId(threadId);
    replyFileInputRef.current?.click();
  };

  const handleReplyFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!projectId) return;
    const threadId = activeReplyThreadId;
    if (!threadId || !e.target.files || e.target.files.length === 0) {
      setActiveReplyThreadId(null);
      return;
    }

    const file = e.target.files[0];
    const matchedThread = allNotes.find((t) => t.threadId === threadId);
    if (!matchedThread) {
      setActiveReplyThreadId(null);
      return;
    }

    setReplyAttaching((prev) => ({ ...prev, [threadId]: true }));
    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onloadend = async () => {
        try {
          const base64Data = (reader.result as string).split(',')[1];
          const cleanedName =
            'att_' + Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');

          const saveRes = await papi.commands.sendCommand(
            'paratextProjectManager.saveAttachment',
            projectId,
            cleanedName,
            base64Data,
          );
          if (saveRes && saveRes.status === 'ok') {
            const link =
              saveRes.driveUrl ||
              `http://localhost:49876/attachment?project=${projectId}&file=${cleanedName}`;
            const replyData = {
              threadId: matchedThread.threadId,
              verseRef: matchedThread.verseRef,
              language: matchedThread.language,
              selectedText: matchedThread.selectedText,
              startPosition: matchedThread.startPosition,
              contextBefore: matchedThread.contextBefore,
              contextAfter: matchedThread.contextAfter,
              verseXml: matchedThread.verseXml,
              replyToUser: matchedThread.latestUser,
              hideInTextWindow: matchedThread.hideInTextWindow,
              contents: `[Attachment: ${cleanedName}]\nVer archivo: ${link}`,
            };

            const res = await papi.commands.sendCommand(
              'paratextProjectManager.addNoteReply',
              projectId,
              currentUser,
              JSON.stringify(replyData),
            );
            if (res === 'ok') {
              await loadNotes();
            } else {
              showErrorMessage(`Error al enviar adjunto: ${res}`);
            }
          } else {
            showErrorMessage(
              `Error al guardar archivo adjunto: ${saveRes?.error || 'Unknown error'}`,
            );
          }
        } catch (err) {
          showErrorMessage(`Error al guardar adjunto: ${err}`);
        } finally {
          setReplyAttaching((prev) => ({ ...prev, [threadId]: false }));
          setActiveReplyThreadId(null);
          e.target.value = '';
        }
      };
    } catch (err) {
      showErrorMessage(`Error al leer archivo: ${err}`);
      setReplyAttaching((prev) => ({ ...prev, [threadId]: false }));
      setActiveReplyThreadId(null);
    }
  };

  // New Note File selection
  const handleNewNoteAttachClick = () => {
    newNoteFileInputRef.current?.click();
  };

  const handleNewNoteFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onloadend = () => {
      const base64Data = (reader.result as string).split(',')[1];
      setNewNoteAttachment({ filename: file.name, base64Data });
    };
  };

  // Reply text handler
  const handleSendReply = async (thread: ParatextNoteThread) => {
    if (!projectId) return;
    const text = replyTexts[thread.threadId]?.trim();
    if (!text) return;

    setReplying((prev) => ({ ...prev, [thread.threadId]: true }));
    try {
      const replyData = {
        threadId: thread.threadId,
        verseRef: thread.verseRef,
        language: thread.language,
        selectedText: thread.selectedText,
        startPosition: thread.startPosition,
        contextBefore: thread.contextBefore,
        contextAfter: thread.contextAfter,
        verseXml: thread.verseXml,
        replyToUser: thread.latestUser,
        hideInTextWindow: thread.hideInTextWindow,
        contents: text,
      };

      const res = await papi.commands.sendCommand(
        'paratextProjectManager.addNoteReply',
        projectId,
        currentUser,
        JSON.stringify(replyData),
      );
      if (res === 'ok') {
        setReplyTexts((prev) => ({ ...prev, [thread.threadId]: '' }));
        await loadNotes();
      } else {
        showErrorMessage(`Error al enviar respuesta: ${res}`);
      }
    } catch (err) {
      showErrorMessage(`Error al enviar respuesta: ${err}`);
    } finally {
      setReplying((prev) => ({ ...prev, [thread.threadId]: false }));
    }
  };

  // Delete Comment Handler
  const handleDeleteComment = (threadId: string, commentDate: string, commentAuthor: string) => {
    setCommentToDelete({ threadId, commentDate, commentAuthor });
  };

  const handleDeleteCommentConfirm = async () => {
    if (!commentToDelete || !projectId) return;
    const target = commentToDelete;
    setCommentToDelete(null);
    try {
      const res = await papi.commands.sendCommand(
        'paratextProjectManager.deleteProjectNote',
        projectId,
        target.commentAuthor,
        target.threadId,
        target.commentDate,
      );
      if (res === 'ok') {
        await loadNotes();
      } else {
        console.error(`Error al eliminar comentario: ${res}`);
      }
    } catch (e) {
      console.error(`Error al eliminar comentario: ${e}`);
    }
  };

  // Verse click — always enter edit mode on left click.
  // Text selection for note creation is handled via right-click context menu.
  const handleVerseClick = (verseNum: number, verseText: string) => {
    const selection = window.getSelection();
    const selectedStr = selection ? selection.toString().trim() : '';
    const isEmpty = !verseText || verseText.trim().length === 0;

    if (selection && selectedStr && !isEmpty) {
      // User is selecting/has selected text. Do NOT enter edit mode.
      // Save the selection for context menu
      selectVerse(verseNum);
      setSelectedText(selectedStr);
      setIsEditingVerse(false);

      const anchorNode = selection.anchorNode;
      const fullText = anchorNode?.textContent || '';
      const offset = selection.anchorOffset;
      setStartPosition(offset);

      const before = fullText.substring(Math.max(0, offset - 30), offset);
      const after = fullText.substring(
        offset + selectedStr.length,
        offset + selectedStr.length + 30,
      );
      setContextBefore(before);
      setContextAfter(after);
      return;
    }

    // Capture the click caret offset before swapping to edit component
    let offset = 0;
    if (selection && selection.rangeCount > 0) {
      offset = selection.getRangeAt(0).startOffset;
    }
    setInitialOffset(offset);

    // If currently editing a different verse, blur it first
    if (isEditingVerse && selectedVerseNum !== null && selectedVerseNum !== verseNum) {
      const prevEditable = document.querySelector(
        `#verse-${selectedVerseNum} [contenteditable="true"]`,
      ) as HTMLElement | null;
      prevEditable?.blur();
    }
    selectVerse(verseNum);
    setIsEditingVerse(true);
    setSelectedText('');
    setStartPosition(0);
    setContextBefore('');
    setContextAfter('');
  };

  const handleVerseContextMenu = (e: React.MouseEvent, verseNum: number, verseText: string) => {
    const selection = window.getSelection();
    const selectedStr = selection ? selection.toString().trim() : '';
    const isEmpty = !verseText || verseText.trim().length === 0;
    if (selection && selectedStr && !isEmpty) {
      e.preventDefault();
      e.stopPropagation();

      selectVerse(verseNum);
      setSelectedText(selectedStr);
      setIsEditingVerse(false);

      const anchorNode = selection.anchorNode;
      const fullText = anchorNode?.textContent || '';
      const offset = selection.anchorOffset;
      setStartPosition(offset);

      const before = fullText.substring(Math.max(0, offset - 30), offset);
      const after = fullText.substring(
        offset + selectedStr.length,
        offset + selectedStr.length + 30,
      );
      setContextBefore(before);
      setContextAfter(after);

      setContextMenu({
        x: e.clientX,
        y: e.clientY,
      });
    }
  };



  // Create new note thread
  const handleCreateNote = async () => {
    if (!projectId) return;
    if (!newNoteText.trim() && !newNoteAudio && !newNoteAttachment) return;
    if (notesPopupVerseNum === null) return;

    setLoading(true);
    try {
      let finalContents = newNoteText;

      // 1. Upload audio if captured
      if (newNoteAudio) {
        const audioRes = await papi.commands.sendCommand(
          'paratextProjectManager.saveAudioNote',
          projectId,
          newNoteAudio.filename,
          newNoteAudio.base64Data,
        );
        if (audioRes && audioRes.status === 'ok') {
          const audioLink =
            audioRes.driveUrl ||
            `http://localhost:49876/play?project=${projectId}&file=${newNoteAudio.filename}`;
          finalContents += `\n[Audio: ${newNoteAudio.filename}]\nEscuchar audio: ${audioLink}`;
        }
      }

      // 2. Upload attachment if captured
      if (newNoteAttachment) {
        const cleanedName =
          'att_' + Date.now() + '_' + newNoteAttachment.filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
        const attachRes = await papi.commands.sendCommand(
          'paratextProjectManager.saveAttachment',
          projectId,
          cleanedName,
          newNoteAttachment.base64Data,
        );
        if (attachRes && attachRes.status === 'ok') {
          const link =
            attachRes.driveUrl ||
            `http://localhost:49876/attachment?project=${projectId}&file=${cleanedName}`;
          finalContents += `\n[Attachment: ${cleanedName}]\nVer archivo: ${link}`;
        }
      }

      const verseRef = `${selectedBook} ${selectedChapter}:${notesPopupVerseNum}`;
      const threadId = `th_${Date.now()}`;

      const newNoteData = {
        threadId,
        verseRef,
        language: '',
        selectedText,
        startPosition: String(startPosition),
        contextBefore,
        contextAfter,
        verseXml: '', // populated in backend
        replyToUser: '',
        hideInTextWindow: 'false',
        contents: finalContents,
        assignedUser,
      };

      const res = await papi.commands.sendCommand(
        'paratextProjectManager.addNoteReply',
        projectId,
        currentUser,
        JSON.stringify(newNoteData),
      );
      if (res === 'ok') {
        resetForms();
        await loadNotes();
      } else {
        showErrorMessage(`Error al crear la nota: ${res}`);
      }
    } catch (err) {
      showErrorMessage(`Error al crear la nota: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const isMe = (name: string) => {
    if (!name || !currentUser) return false;
    const clean = (n: string) =>
      n
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
    const cleanN = clean(name);
    const cleanU = clean(currentUser);
    return cleanN.includes(cleanU) || cleanU.includes(cleanN);
  };

  return (
    <div className="tw:flex tw:flex-col tw:h-full tw:w-full tw:overflow-hidden tw:bg-slate-50 tw:text-sm">
      {/* Hidden file inputs */}
      <input
        type="file"
        ref={newNoteFileInputRef}
        onChange={handleNewNoteFileChange}
        style={{ display: 'none' }}
      />
      <input
        type="file"
        ref={replyFileInputRef}
        onChange={handleReplyFileChange}
        style={{ display: 'none' }}
      />

      {/* Main horizontal split */}
      <div className="tw:flex-1 tw:flex tw:flex-row tw:overflow-hidden">
        {/* Left Pane: Scripture Text */}
        <div className="tw:flex-1 tw:flex tw:flex-col tw:bg-white tw:min-w-0 tw:h-full tw:overflow-hidden">
        {/* Toolbar */}
        <div className="tw:px-4 tw:py-2 tw:bg-white tw:border-b tw:border-gray-200 tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:shrink-0 tw:shadow-sm">
          <div className="tw:flex tw:items-center tw:gap-2">
            <button
              onClick={toggleControls}
              className="tw:p-1.5 tw:rounded-md tw:text-slate-600 tw:hover:bg-slate-100 tw:hover:text-slate-800 tw:transition-colors tw:cursor-pointer tw:flex tw:items-center tw:justify-center"
              title={controlsVisible ? 'Ocultar controles' : 'Mostrar controles'}
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
                ></path>
              </svg>
            </button>
            <span className="tw:font-bold tw:text-slate-800 tw:text-base">Lector</span>
            <button
              onClick={() => selectProject()}
              className="tw:px-2 tw:py-1 tw:bg-slate-100 tw:hover:bg-slate-200 tw:border tw:border-slate-350 tw:rounded tw:text-xs tw:font-semibold tw:text-slate-700 tw:cursor-pointer"
              title="Cambiar de proyecto o recurso"
            >
              Recurso
            </button>
            <select
              value={selectedBook}
              onChange={(e) => {
                navigateToReference(e.target.value, 1, 1);
              }}
              className="tw:border tw:border-gray-300 tw:rounded tw:px-2 tw:py-1 tw:bg-white tw:text-xs tw:font-semibold tw:text-slate-700 focus:tw:outline-none focus:tw:border-indigo-500"
            >
              {books.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
            </select>

            {/* Chapter Selection */}
            <div className="tw:flex tw:items-center tw:gap-1">
              <button
                disabled={selectedChapter <= 1}
                onClick={() => navigateToReference(selectedBook, selectedChapter - 1, 1)}
                className="tw:px-2 tw:py-1 tw:bg-slate-100 tw:hover:bg-slate-200 tw:border tw:rounded tw:text-xs tw:disabled:opacity-40 tw:cursor-pointer"
              >
                ◀
              </button>
              <select
                value={selectedChapter}
                onChange={(e) => navigateToReference(selectedBook, Number(e.target.value), 1)}
                className="tw:border tw:border-gray-300 tw:rounded tw:px-2 tw:py-1 tw:bg-white tw:text-xs tw:font-semibold tw:text-slate-700 focus:tw:outline-none focus:tw:border-indigo-500"
              >
                {Array.from({ length: totalChapters }, (_, idx) => idx + 1).map((ch) => (
                  <option key={ch} value={ch}>
                    Cap {ch}
                  </option>
                ))}
              </select>
              <button
                disabled={selectedChapter >= totalChapters}
                onClick={() => navigateToReference(selectedBook, selectedChapter + 1, 1)}
                className="tw:px-2 tw:py-1 tw:bg-slate-100 tw:hover:bg-slate-200 tw:border tw:rounded tw:text-xs tw:disabled:opacity-40 tw:cursor-pointer"
              >
                ▶
              </button>
            </div>
          </div>

          <div className="tw:flex tw:items-center tw:gap-2">
            {/* User picker */}
            {controlsVisible &&
              (currentUser ? (
                <span
                  className="tw:text-xs tw:font-semibold tw:text-slate-700 tw:bg-slate-100 tw:border tw:px-2 tw:py-1 tw:rounded tw:cursor-pointer hover:tw:bg-slate-200 tw:transition-colors tw:flex tw:items-center tw:gap-1"
                  onClick={() => setCurrentUser('')}
                  title="Haga clic para cambiar de usuario"
                >
                  Usuario: {currentUser}
                </span>
              ) : (
                <div className="tw:flex tw:items-center tw:gap-1 tw:bg-amber-50 tw:border tw:border-amber-200 tw:px-2 tw:py-1 tw:rounded">
                  <span className="tw:text-amber-800 tw:font-medium tw:text-[10px]">
                    ¿Quién eres?
                  </span>
                  <select
                    className="tw:border tw:rounded tw:px-1.5 tw:py-0.5 tw:bg-white tw:text-[10px] focus:tw:outline-none"
                    value={currentUser}
                    onChange={async (e) => {
                      const val = e.target.value;
                      if (val) {
                        setCurrentUser(val);
                        try {
                          await papi.commands.sendCommand(
                            'paratextProjectManager.setCurrentUser',
                            val,
                          );
                        } catch (_) {}
                      }
                    }}
                  >
                    <option value="">Seleccionar...</option>
                    {teamMembers.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              ))}

            {/* Scroll Group Selector */}
            {controlsVisible && typeof useWebViewScrollGroupScrRef === 'function' && setScrollGroupId && (
              <div className="tw:inline-flex tw:items-center tw:scale-90">
                <ScrollGroupSelector
                  availableScrollGroupIds={[undefined, ...Array(5).keys()]}
                  onChangeScrollGroupId={setScrollGroupId}
                  scrollGroupId={scrollGroupId}
                />
              </div>
            )}

            {/* Font size adjustment */}
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setFontSize((f) => Math.max(12, f - 2))}
              className="tw:px-2.5 tw:py-1 tw:bg-slate-50 tw:hover:bg-slate-100 tw:border tw:rounded tw:text-xs tw:cursor-pointer"
              title="Disminuir tamaño de letra"
            >
              A-
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setFontSize((f) => Math.min(30, f + 2))}
              className="tw:px-2.5 tw:py-1 tw:bg-slate-50 tw:hover:bg-slate-100 tw:border tw:rounded tw:text-xs tw:cursor-pointer"
              title="Aumentar tamaño de letra"
            >
              A+
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const nextVal = !keyTermsOverlayEnabled;
                setKeyTermsOverlayEnabled(nextVal);
                localStorage.setItem('key_terms_overlay_enabled', nextVal ? 'true' : 'false');
              }}
              className={`tw:px-2.5 tw:py-1 tw:border tw:rounded tw:text-xs tw:cursor-pointer tw:flex tw:items-center tw:gap-1 tw:transition-all ${
                keyTermsOverlayEnabled
                  ? 'tw:bg-indigo-600 tw:hover:bg-indigo-700 tw:border-indigo-600 tw:text-white'
                  : 'tw:bg-slate-50 tw:hover:bg-slate-100 tw:border-slate-300 tw:text-slate-700'
              }`}
              title="Alternar resaltado de Términos Clave"
            >
              🔑 Términos Clave
            </button>
            <div className="tw:relative">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShowSettings(!showSettings)}
                className={`tw:px-2.5 tw:py-1 tw:border tw:rounded tw:text-xs tw:cursor-pointer tw:flex tw:items-center tw:gap-1 tw:transition-all ${
                  showSettings
                    ? 'tw:bg-slate-700 tw:border-slate-700 tw:text-white'
                    : 'tw:bg-slate-50 tw:hover:bg-slate-100 tw:border-slate-300 tw:text-slate-700'
                }`}
                title="Configuración del Lector"
              >
                ⚙️ Configuración
              </button>

              {showSettings && (
                <div className="tw:absolute tw:right-0 tw:top-full tw:mt-1.5 tw:z-[1000] tw:w-64 tw:bg-white tw:border tw:border-slate-200 tw:rounded-xl tw:shadow-xl tw:p-4 tw:space-y-3.5 tw:text-xs">
                  <div className="tw:font-bold tw:text-slate-700 tw:border-b tw:pb-1.5">Configuración de Lectura</div>
                  <div className="tw:flex tw:items-center tw:justify-between tw:gap-2">
                    <span className="tw:text-slate-600 tw:font-medium">Versículo en línea propia</span>
                    <input
                      type="checkbox"
                      checked={versesOnOwnLine}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setVersesOnOwnLine(val);
                        localStorage.setItem('scripture_viewer_verses_own_line', String(val));
                      }}
                      className="tw:cursor-pointer"
                    />
                  </div>

                  <div className="tw:flex tw:flex-col tw:gap-1">
                    <span className="tw:text-slate-600 tw:font-medium">Fuente del Texto</span>
                    <select
                      value={fontFamily}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFontFamily(val);
                        localStorage.setItem('scripture_viewer_font_family', val);
                      }}
                      className="tw:border tw:border-slate-200 tw:rounded-lg tw:px-2 tw:py-1.5 tw:bg-slate-50 tw:text-slate-700 focus:tw:outline-none"
                    >
                      <option value="sans-serif">Predeterminado (Sans)</option>
                      <option value="serif">Georgia (Serif)</option>
                      <option value="monospace">Consolas (Monospace)</option>
                      <option value="outfit">Outfit (Premium)</option>
                      <option value="inter">Inter (Moderno)</option>
                    </select>
                  </div>

                  <div className="tw:flex tw:flex-col tw:gap-1">
                    <span className="tw:text-slate-600 tw:font-medium">Visualización de Notas</span>
                    <select
                      value={notesDisplayStyle}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNotesDisplayStyle(val);
                        localStorage.setItem('scripture_viewer_notes_display_style', val);
                      }}
                      className="tw:border tw:border-slate-200 tw:rounded-lg tw:px-2 tw:py-1.5 tw:bg-slate-50 tw:text-slate-700 focus:tw:outline-none"
                    >
                      <option value="highlight">Resaltado Amarillo</option>
                      <option value="flag">Bandera (🚩)</option>
                      <option value="pin">Pin (📌)</option>
                      <option value="dialog">Globo de Diálogo (💬)</option>
                      <option value="tag">Etiqueta (🏷️)</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const nextVal = !showDraftingSidebar;
                setShowDraftingSidebar(nextVal);
                localStorage.setItem('scripture_viewer_drafting_sidebar', String(nextVal));
              }}
              className={`tw:px-2.5 tw:py-1 tw:border tw:rounded tw:text-xs tw:cursor-pointer tw:flex tw:items-center tw:gap-1 tw:transition-all ${
                showDraftingSidebar
                  ? 'tw:bg-violet-600 tw:hover:bg-violet-700 tw:border-violet-600 tw:text-white'
                  : 'tw:bg-slate-50 tw:hover:bg-slate-100 tw:border-slate-300 tw:text-slate-700'
              }`}
              title="Alternar panel lateral de redactado"
            >
              ✍️ Redactar (Términos)
            </button>
            {isEditingVerse && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  triggerVerseUndo();
                }}
                disabled={!verseEditorCanUndo}
                title="Deshacer (Ctrl+Z)"
                className="tw:px-2.5 tw:py-1 tw:bg-amber-50 tw:hover:bg-amber-100 tw:border tw:border-amber-300 tw:text-amber-800 tw:rounded tw:text-xs tw:font-semibold tw:cursor-pointer disabled:tw:opacity-40 disabled:tw:cursor-not-allowed tw:flex tw:items-center tw:gap-1 tw:transition-all"
              >
                Deshacer
              </button>
            )}
            <button
              onClick={() => loadChapter(selectedBook, selectedChapter)}
              className="tw:px-3 tw:py-1 tw:bg-slate-100 tw:hover:bg-slate-200 tw:border tw:border-slate-200 tw:text-slate-700 tw:rounded tw:text-xs tw:font-semibold tw:cursor-pointer"
            >
              {loading ? 'Cargando...' : 'Actualizar'}
            </button>
          </div>
        </div>

        {/* Scrollable text sheet */}
        <div className="tw:flex-1 tw:overflow-y-auto tw:p-8 tw:leading-relaxed tw:text-slate-800">
          <div
            className="tw:max-w-2xl tw:mx-auto tw:space-y-6"
            style={{
              fontSize: `${fontSize}px`,
              fontFamily: fontFamily === 'sans-serif' ? 'system-ui, -apple-system, sans-serif' :
                          fontFamily === 'serif' ? 'Georgia, Cambria, "Times New Roman", serif' :
                          fontFamily === 'monospace' ? 'Consolas, "Courier New", monospace' :
                          fontFamily === 'outfit' ? '"Outfit", system-ui, sans-serif' :
                          fontFamily === 'inter' ? '"Inter", system-ui, sans-serif' :
                          'system-ui, -apple-system, sans-serif'
            }}
          >
            {error && (
              <div className="tw:p-4 tw:text-red-750 tw:bg-red-50 tw:border tw:border-red-200 tw:rounded-lg tw:text-sm">
                {error}
              </div>
            )}

            {loading && chapterBlocks.length === 0 ? (
              <div className="tw:p-12 tw:text-center tw:text-gray-400 tw:italic tw:text-sm">
                Cargando el texto de la Escritura...
              </div>
            ) : (
              chapterBlocks.map((block, bIdx) => {
                if (block.type === 'heading') {
                  return (
                    <h3
                      key={bIdx}
                      className="tw:text-lg tw:font-bold tw:text-slate-900 tw:mt-6 tw:mb-3 tw:text-justify"
                    >
                      {block.text}
                    </h3>
                  );
                }

                const isPoetry = block.type === 'poetry';
                const indentClass = isPoetry ? `tw:pl-${(block.indent || 1) * 4}` : '';

                return (
                  <p
                    key={bIdx}
                    className={`tw:mb-4 ${isPoetry ? 'tw:mb-2' : ''} ${indentClass} tw:text-justify`}
                  >
                    {block.children.map((child, cIdx) => {
                      if (child.type === 'text') {
                        return <span key={cIdx}>{renderFootnotes(child.text)}</span>;
                      }

                      const isSelected = selectedVerseNum === child.number;
                      const isEditing = isEditingVerse && isSelected;
                      const editorsWithCursors = Object.entries(collabCursors)
                        .filter(([user, cursor]) => {
                          return (
                            user !== currentUser &&
                            cursor.projectId === projectId &&
                            cursor.book === selectedBook &&
                            cursor.chapter === selectedChapter &&
                            cursor.verse === child.number
                          );
                        })
                        .map(([user, cursor]) => ({ user, offset: cursor.offset ?? 0 }));

                      const otherEditingUsers = Object.entries(collabCursors).filter(
                        ([user, cursor]) =>
                          user !== currentUser &&
                          cursor.projectId === projectId &&
                          cursor.book === selectedBook &&
                          cursor.chapter === selectedChapter &&
                          cursor.verse === child.number,
                      );
                      const otherEditor = otherEditingUsers[0];
                      const otherEditorHighlight = otherEditor
                        ? getCursorColors(otherEditor[0]).highlight
                        : null;

                      const isEmpty = !child.text || child.text.trim().length === 0;
                      const selectionForThisVerse =
                        verseHighlight && verseHighlight.verseNum === child.number
                          ? verseHighlight
                          : null;
                      return (
                        <span
                          key={cIdx}
                          id={`verse-${child.number}`}
                          onClick={() => handleVerseClick(child.number, child.text)}
                          onContextMenu={(e) => handleVerseContextMenu(e, child.number, child.text)}
                          onMouseUp={() => {
                            if (!isEditing) {
                              captureVerseHighlight(child.number, child.text);
                            }
                          }}
                          className={`tw:relative tw:rounded tw:transition-all tw:py-0.5 tw:cursor-text ${
                            versesOnOwnLine ? 'tw:block tw:mb-2' : 'tw:inline'
                          }`}
                          style={{
                            ...(otherEditorHighlight
                              ? {
                                  backgroundColor: otherEditorHighlight,
                                  padding: '2px 4px',
                                  borderRadius: '4px',
                                }
                              : {}),
                            // Show the dashed placeholder only when not actively editing
                            ...(isEmpty && !isEditing
                              ? {
                                  minWidth: '32px',
                                  display: 'inline-block',
                                  height: '1.2em',
                                  verticalAlign: 'middle',
                                  borderBottom: '1px dashed #94a3b8',
                                  marginRight: '4px',
                                }
                              : {}),
                          }}
                        >
                          {/* Verse number tag */}
                          {keyTermsOverlayEnabled &&
                            (() => {
                              const verseMatches = Object.values(chapterKeyTermsMatches).filter(
                                (m: any) =>
                                  isVerseInRef(
                                    selectedBook,
                                    selectedChapter,
                                    child.number,
                                    m.reference,
                                  ),
                              );
                              if (verseMatches.length === 0) return null;
                              const totalExpected = verseMatches.length;
                              const totalFound = verseMatches.filter(
                                (m: any) => m.matchResult?.found,
                              ).length;
                              const verseRef = `${selectedBook} ${selectedChapter}:${child.number}`;
                              return (
                                <span
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveVersePopup({
                                      verseNum: child.number,
                                      reference: verseRef,
                                      expected: verseMatches,
                                    });
                                  }}
                                  className="tw:inline-flex tw:items-center tw:justify-center tw:w-5 tw:h-5 tw:cursor-pointer tw:mr-0.5 tw:align-middle"
                                  title={`Términos clave: ${totalFound}/${totalExpected} encontrados. Haga clic para ver detalles.`}
                                  style={{ position: 'relative', top: '-1px' }}
                                >
                                  <span
                                    className={`tw:w-2.5 tw:h-2.5 tw:rounded-full tw:transition-transform hover:tw:scale-125 ${
                                      totalFound === totalExpected
                                        ? 'tw:bg-emerald-500'
                                        : totalFound > 0
                                          ? 'tw:bg-amber-500'
                                          : 'tw:bg-rose-500'
                                    }`}
                                  />
                                </span>
                              );
                            })()}
                          <sup
                            className={`tw:select-none tw:font-bold tw:mr-1 tw:px-1 tw:rounded ${
                              flashVerseNum === child.number
                                ? 'verse-flash tw:text-white'
                                : 'tw:text-slate-400'
                            }`}
                            style={{ fontSize: '0.65em', top: '-0.3em' }}
                          >
                            {child.numberStr || child.number}
                          </sup>

                          {/* Verse text content */}
                          {isEditing ? (
                            <EditableVerse
                              initialText={child.text}
                              initialOffset={initialOffset}
                              onSave={async (newText) => {
                                await handleContentEditableSave(newText, child.number);
                              }}
                              onCancel={() => {
                                setIsEditingVerse(false);
                                setSelectedVerseNum(null);
                              }}
                              onContextMenu={(e) =>
                                handleVerseContextMenu(e, child.number, child.text)
                              }
                              onCursorChange={(offset) => {
                                handleCursorChange(child.number, offset);
                              }}
                              onUndoStateChange={(canUndoNow) => {
                                setVerseEditorCanUndo(canUndoNow);
                              }}
                              onEditBroadcast={(text) => {
                                handleVerseEditBroadcast(child.number, text);
                              }}
                            />
                          ) : (
                            <span>
                              {highlightKeyTermsInNode(
                                renderFootnotes(
                                  injectCursorsIntoElements(
                                    selectionForThisVerse
                                      ? wrapRangeInMark(
                                          highlightText(
                                            child.text,
                                            chapterNotesByVerse[child.number] ?? [],
                                            child.number,
                                          ),
                                          selectionForThisVerse.start,
                                          selectionForThisVerse.end,
                                          `v${child.number}`,
                                        )
                                      : highlightText(
                                          child.text,
                                          chapterNotesByVerse[child.number] ?? [],
                                          child.number,
                                        ),
                                    editorsWithCursors,
                                  ),
                                ),
                                child.number,
                                selectedBook,
                              )}
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </p>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Right Sidebar: Key Terms for Drafting (zero clicks) */}
      {showDraftingSidebar && (
        <div className="tw:w-80 tw:border-l tw:border-slate-200 tw:bg-slate-50 tw:flex tw:flex-col tw:h-full tw:overflow-hidden tw:shrink-0 tw:no-print">
          {/* Sidebar Header */}
          <div className="tw:px-4 tw:py-3 tw:bg-white tw:border-b tw:border-slate-200 tw:flex tw:items-center tw:justify-between tw:shrink-0">
            <span className="tw:font-bold tw:text-slate-800 tw:text-xs uppercase tw:tracking-wider">
              ✍️ Términos para Redactar
            </span>
            {selectedVerseNum && (
              <span className="tw:px-2 tw:py-0.5 tw:bg-slate-100 tw:text-slate-600 tw:rounded-full tw:text-[10px] tw:font-semibold">
                Versículo {selectedVerseNum}
              </span>
            )}
          </div>

          {/* Sidebar Content */}
          <div className="tw:flex-grow tw:overflow-y-auto tw:p-4 tw:space-y-4">
            {!selectedVerseNum ? (
              <div className="tw:text-center tw:text-slate-400 tw:italic tw:py-12 tw:text-xs">
                Haz clic en un versículo para ver los términos clave que debes usar.
              </div>
            ) : (
              (() => {
                const verseRef = `${selectedBook} ${selectedChapter}:${selectedVerseNum}`;
                const verseMatches = Object.values(chapterKeyTermsMatches).filter(
                  (m: any) =>
                    isVerseInRef(
                      selectedBook,
                      selectedChapter,
                      selectedVerseNum,
                      m.reference,
                    ),
                );

                if (verseMatches.length === 0) {
                  return (
                    <div className="tw:text-center tw:text-slate-400 tw:italic tw:py-12 tw:text-xs">
                      No hay términos clave registrados para {selectedBook} {selectedChapter}:{selectedVerseNum}.
                    </div>
                  );
                }

                return (
                  <div className="tw:space-y-3">
                    <div className="tw:text-[10.5px] tw:font-bold tw:text-slate-500 uppercase tw:tracking-wider">
                      Términos requeridos en {selectedBook} {selectedChapter}:{selectedVerseNum}:
                    </div>
                    <div className="tw:space-y-2.5">
                      {verseMatches.map((m: any) => (
                        <div
                          key={m.termId}
                          className="tw:bg-white tw:p-3 tw:rounded-xl tw:border tw:border-slate-200 tw:shadow-sm tw:space-y-2 tw:transition-all hover:tw:shadow-md"
                        >
                          <div className="tw:flex tw:items-start tw:justify-between tw:gap-2">
                            <div>
                              <button
                                onClick={() => {
                                  papi.commands.sendCommand(
                                    'paratextProjectManager.openHebrewGreekDictionary',
                                    m.strongs || m.lemma
                                  ).catch((err) => console.error(err));
                                }}
                                className="tw:text-left tw:font-bold tw:text-xs tw:text-slate-700 hover:tw:text-indigo-600 hover:tw:underline tw:cursor-pointer tw:bg-transparent tw:border-none tw:p-0"
                                title={m.strongs ? `Diccionario Strong: ${m.strongs}` : `Buscar definición: ${m.lemma}`}
                              >
                                {m.gloss}
                              </button>
                              <div className="tw:text-[10px] tw:text-slate-400 tw:font-serif tw:mt-0.5">{m.lemma}</div>
                            </div>
                            {m.matchResult?.found ? (
                              <span className="tw:text-[9px] tw:bg-emerald-50 tw:text-emerald-700 tw:px-2 tw:py-0.5 tw:border tw:border-emerald-250 tw:rounded-full tw:font-semibold tw:whitespace-nowrap">
                                ✓ Usado
                              </span>
                            ) : (
                              <span className="tw:text-[9px] tw:bg-rose-50 tw:text-rose-700 tw:px-2 tw:py-0.5 tw:border tw:border-rose-250 tw:rounded-full tw:font-semibold tw:whitespace-nowrap">
                                ✗ Faltante
                              </span>
                            )}
                          </div>

                          {/* Expected Renderings */}
                          <div className="tw:text-[10px] tw:text-slate-500">
                            <span className="tw:font-semibold">Traducciones sugeridas:</span>
                            {m.expectedRenderings && m.expectedRenderings.length > 0 ? (
                              <div className="tw:flex tw:flex-wrap tw:gap-1 tw:mt-1">
                                {m.expectedRenderings.map((r: string, rIdx: number) => (
                                  <span
                                    key={rIdx}
                                    className="tw:text-[9px] tw:bg-indigo-50/50 tw:text-indigo-600 tw:px-1.5 tw:py-0.5 tw:rounded tw:border tw:border-indigo-100"
                                  >
                                    {r}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="tw:italic tw:text-slate-400 tw:ml-1">Ninguna registrada</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        </div>
      )}
    </div>

    {/* Context menu for selection */}
      {contextMenu && (
        <div
          className="tw:fixed tw:z-[10000] tw:bg-white tw:border tw:border-slate-200 tw:shadow-lg tw:rounded-lg tw:py-1 tw:w-40 tw:text-xs"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              setContextMenu(null);
              setIsEditingVerse(false);
              setNotesPopupVerseNum(selectedVerseNum);
              setShowNewNoteForm(true);
            }}
            className="tw:w-full tw:text-left tw:px-3 tw:py-2 tw:hover:bg-slate-100 tw:text-slate-700 tw:font-semibold tw:flex tw:items-center tw:gap-1.5 tw:cursor-pointer tw:border-none tw:bg-white"
          >
            Agregar nota
          </button>
        </div>
      )}

      {/* Floating Key Terms Details Popup */}
      {activeVersePopup && (
        <div
          className="tw:fixed tw:inset-0 tw:z-[9999] tw:flex tw:items-center tw:justify-center tw:bg-slate-900/40 tw:backdrop-blur-sm"
          onClick={() => setActiveVersePopup(null)}
        >
          <div
            className="tw:bg-white tw:rounded-xl tw:shadow-2xl tw:border tw:border-slate-200 tw:w-96 tw:max-w-[90vw] tw:p-4 tw:space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tw:flex tw:items-center tw:justify-between tw:border-b tw:border-slate-100 tw:pb-2">
              <span className="tw:font-bold tw:text-slate-800 tw:text-sm">
                Términos Clave: {activeVersePopup.reference}
              </span>
              <button
                onClick={() => setActiveVersePopup(null)}
                className="tw:text-slate-400 tw:hover:text-slate-600 tw:text-sm tw:cursor-pointer tw:bg-transparent tw:border-none"
              >
                ✕
              </button>
            </div>
            <div className="tw:space-y-2.5 tw:max-h-60 tw:overflow-y-auto">
              {activeVersePopup.expected.map((m: any) => (
                <div
                  key={m.termId}
                  className="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:p-2 tw:bg-slate-50 tw:rounded-lg tw:border tw:border-slate-100"
                >
                  <div className="tw:space-y-0.5">
                    <div className="tw:font-bold tw:text-xs tw:text-slate-700">{m.gloss}</div>
                    <div className="tw:text-[10px] tw:text-slate-400 tw:font-serif">{m.lemma}</div>
                    {m.expectedRenderings && m.expectedRenderings.length > 0 ? (
                      <div className="tw:flex tw:flex-wrap tw:gap-1 tw:mt-1.5">
                        {m.expectedRenderings.map((r: string, rIdx: number) => (
                          <span
                            key={rIdx}
                            className="tw:text-[9px] tw:bg-indigo-50 tw:text-indigo-700 tw:px-1.5 tw:py-0.5 tw:rounded tw:border tw:border-indigo-100 tw:font-medium"
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="tw:text-[10px] tw:text-amber-600 tw:italic tw:mt-1">
                        Sin renderings aprobados
                      </div>
                    )}
                  </div>
                  <div className="tw:flex tw:items-center tw:gap-2">
                    {m.matchResult?.found ? (
                      <span className="tw:text-[10px] tw:bg-emerald-50 tw:text-emerald-700 tw:px-2 tw:py-0.5 tw:border tw:border-emerald-200 tw:rounded-full tw:font-semibold">
                        ✓ Encontrado
                      </span>
                    ) : (
                      <span className="tw:text-[10px] tw:bg-rose-50 tw:text-rose-700 tw:px-2 tw:py-0.5 tw:border tw:border-rose-200 tw:rounded-full tw:font-semibold">
                        ✗ Faltante
                      </span>
                    )}
                    <button
                      onClick={async () => {
                        if (!projectId) return;
                        setActiveVersePopup(null);
                        try {
                          await papi.commands.sendCommand(
                            'paratextProjectManager.openKeyTerms',
                            projectId,
                          );
                          // Small delay to allow the webview to finish opening/focusing before emitting the select event
                          await new Promise((r) => setTimeout(r, 400));
                          await papi.commands.sendCommand(
                            'paratextProjectManager.selectKeyTerm',
                            projectId,
                            m.termId,
                          );
                        } catch (e) {
                          console.error('Failed to open key terms from popup:', e);
                        }
                      }}
                      className="tw:text-[10px] tw:text-indigo-600 tw:hover:underline tw:font-medium tw:cursor-pointer tw:bg-transparent tw:border-none"
                    >
                      Editar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Floating Notes Popup Modal */}
      {notesPopupVerseNum !== null && (
        <div className="tw:fixed tw:inset-0 tw:bg-black/50 tw:flex tw:items-center tw:justify-center tw:z-[9999] tw:backdrop-blur-sm">
          <div className="tw:bg-white tw:rounded-xl tw:shadow-2xl tw:p-5 tw:w-[500px] tw:max-w-[90vw] tw:max-h-[85vh] tw:flex tw:flex-col tw:border tw:border-slate-200">
            {/* Header */}
            <div className="tw:pb-3 tw:border-b tw:border-gray-200 tw:flex tw:items-center tw:justify-between tw:shrink-0">
              <h3 className="tw:font-bold tw:text-slate-800 tw:text-base">
                Notas en {selectedBook} {selectedChapter}:{notesPopupVerseNum}
              </h3>
              <button
                onClick={() => setNotesPopupVerseNum(null)}
                className="tw:text-gray-400 tw:hover:text-gray-600 tw:text-lg tw:cursor-pointer tw:bg-transparent tw:border-none"
              >
                ✕
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="tw:flex-1 tw:overflow-y-auto tw:py-4 tw:space-y-4 tw:min-h-0">
              {/* Show selected text selection if any */}
              {selectedText && (
                <div className="tw:bg-yellow-50 tw:border tw:border-yellow-200 tw:rounded-lg tw:p-3">
                  <span className="tw:block tw:text-[10px] tw:text-yellow-800 tw:font-bold tw:uppercase tw:tracking-wider tw:mb-1">
                    Texto Seleccionado:
                  </span>
                  <p className="tw:text-xs tw:italic tw:text-slate-700">"{selectedText}"</p>
                </div>
              )}

              {/* Show new note form button if not showing */}
              {!showNewNoteForm && (
                <button
                  onClick={() => setShowNewNoteForm(true)}
                  className="tw:w-full tw:py-2 tw:bg-slate-600 tw:hover:bg-slate-700 tw:text-white tw:font-semibold tw:rounded-lg tw:text-xs tw:shadow-sm tw:transition-colors tw:cursor-pointer tw:border-none"
                >
                  Nueva nota en versículo
                </button>
              )}

              {/* New note thread form */}
              {showNewNoteForm && (
                <div className="tw:bg-white tw:border tw:border-gray-200 tw:rounded-lg tw:p-3 tw:space-y-3 shadow-sm">
                  <div className="tw:flex tw:items-center tw:justify-between">
                    <span className="tw:font-bold tw:text-slate-700 tw:text-xs">Nueva Nota</span>
                    <button
                      onClick={() => setShowNewNoteForm(false)}
                      className="tw:text-gray-400 tw:hover:text-gray-600 tw:bg-transparent tw:border-none"
                    >
                      ✕
                    </button>
                  </div>

                  <textarea
                    placeholder="Contenido de la nota..."
                    value={newNoteText}
                    onChange={(e) => setNewNoteText(e.target.value)}
                    className="tw:w-full tw:border tw:rounded-lg tw:p-2 tw:text-xs focus:tw:outline-none focus:tw:border-indigo-400"
                    rows={3}
                  />

                  {/* Attachment badges */}
                  {newNoteAttachment && (
                    <div className="tw:flex tw:items-center tw:justify-between tw:bg-slate-50 tw:border tw:px-2 tw:py-1 tw:rounded tw:text-[10px]">
                      <span className="tw:text-slate-600 tw:truncate tw:max-w-[180px]">
                        📎 {newNoteAttachment.filename}
                      </span>
                      <button
                        onClick={() => setNewNoteAttachment(null)}
                        className="tw:text-red-500 font-bold tw:bg-transparent tw:border-none"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                  {newNoteAudio && (
                    <div className="tw:flex tw:items-center tw:justify-between tw:bg-slate-50 tw:border tw:px-2 tw:py-1 tw:rounded tw:text-[10px]">
                      <span className="tw:text-slate-600">🎙️ Audio note captured</span>
                      <button
                        onClick={() => setNewNoteAudio(null)}
                        className="tw:text-red-500 font-bold tw:bg-transparent tw:border-none"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                  {/* Mic recording indicator */}
                  {isRecording && recordingTarget?.type === 'new' && (
                    <div className="tw:flex tw:items-center tw:justify-between tw:bg-red-50 tw:border tw:border-red-100 tw:px-2 tw:py-1 tw:rounded tw:text-[10px] tw:text-red-600 tw:animate-pulse">
                      <span>Grabando... ({formatDuration(recordDuration)})</span>
                      <div className="tw:flex tw:gap-1">
                        <button
                          onClick={stopRecording}
                          className="tw:bg-green-600 tw:text-white tw:px-1.5 tw:py-0.2 tw:rounded tw:border-none"
                        >
                          OK
                        </button>
                        <button
                          onClick={cancelRecording}
                          className="tw:bg-gray-400 tw:text-white tw:px-1.5 tw:py-0.2 tw:rounded tw:border-none"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Assignee select */}
                  <div>
                    <label className="tw:block tw:text-[10px] tw:text-slate-400 tw:mb-0.5">
                      Asignar a:
                    </label>
                    <select
                      value={assignedUser}
                      onChange={(e) => setAssignedUser(e.target.value)}
                      className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1 tw:bg-white tw:text-xs"
                    >
                      <option value="">Sin asignar</option>
                      {teamMembers.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="tw:flex tw:justify-between tw:items-center tw:gap-2">
                    <div className="tw:flex tw:gap-1.5">
                      <button
                        onClick={handleNewNoteAttachClick}
                        className="tw:p-1.5 tw:bg-slate-100 tw:hover:bg-slate-200 tw:border tw:rounded tw:cursor-pointer"
                        title="Adjuntar archivo"
                      >
                        📎
                      </button>
                      <button
                        onClick={() => startRecording('new')}
                        className="tw:p-1.5 tw:bg-slate-100 tw:hover:bg-slate-200 tw:border tw:rounded tw:cursor-pointer"
                        title="Grabar nota de voz"
                      >
                        🎙️
                      </button>
                    </div>
                    <button
                      onClick={handleCreateNote}
                      className="tw:px-3 tw:py-1.5 tw:bg-slate-600 tw:hover:bg-slate-700 tw:text-white tw:font-semibold tw:rounded tw:text-xs shadow-sm tw:cursor-pointer tw:border-none"
                    >
                      Crear Nota
                    </button>
                  </div>
                </div>
              )}

              {/* List of existing threads for this verse */}
              <div className="tw:space-y-4">
                {selectedVerseThreads.length === 0 ? (
                  <p className="tw:text-center tw:text-gray-400 tw:italic tw:text-xs tw:py-6">
                    No hay notas creadas en este versículo.
                  </p>
                ) : (
                  selectedVerseThreads.map((thread) => {
                    const isFocussedCard = selectedThreadIdInSidebar === thread.threadId;

                    return (
                      <div
                        key={thread.threadId}
                        id={`thread-card-${thread.threadId}`}
                        className={`tw:bg-white tw:border tw:rounded-lg tw:p-3 tw:space-y-3.5 tw:shadow-sm tw:transition-all ${
                          isFocussedCard
                            ? 'tw:ring-2 tw:ring-indigo-400 tw:border-indigo-400'
                            : 'tw:border-gray-200'
                        }`}
                      >
                        {/* Thread Card Header */}
                        <div className="tw:flex tw:items-start tw:justify-between tw:gap-2">
                          <span className="tw:text-[10px] tw:text-gray-400">
                            Creada:{' '}
                            {new Date(thread.comments[0]?.date || Date.now()).toLocaleDateString(
                              'es',
                              {
                                month: 'short',
                                day: 'numeric',
                              },
                            )}
                          </span>
                          {thread.assignedUser && (
                            <span className="tw:bg-blue-50 tw:text-blue-700 tw:border tw:border-blue-100 tw:px-1.5 tw:py-0.2 tw:rounded tw:text-[9px] tw:font-semibold">
                              Asignado a: {thread.assignedUser}
                            </span>
                          )}
                        </div>

                        {/* Selected quote text */}
                        {thread.selectedText && (
                          <div className="tw:pl-2 tw:border-l-2 tw:border-slate-200 tw:italic tw:text-gray-500 tw:text-[11px] tw:font-serif">
                            "{thread.selectedText}"
                          </div>
                        )}

                        {/* Comments trail */}
                        <div className="tw:space-y-3 tw:pl-1.5 tw:border-l tw:border-slate-100">
                          {thread.comments.map((comm, cIdx) => {
                            const isOwn = isMe(comm.user);
                            return (
                              <div key={cIdx} className="tw:space-y-0.5">
                                <div className="tw:flex tw:items-center tw:justify-between tw:text-[10px] tw:text-gray-400">
                                  <span className="tw:font-bold tw:text-slate-700">
                                    {comm.user}
                                  </span>
                                  <div className="tw:flex tw:gap-2">
                                    <span>
                                      {new Date(comm.date).toLocaleDateString('es', {
                                        month: 'numeric',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}
                                    </span>
                                    {isOwn && (
                                      <button
                                        onClick={() =>
                                          handleDeleteComment(thread.threadId, comm.date, comm.user)
                                        }
                                        className="tw:text-red-500 tw:hover:underline tw:cursor-pointer tw:bg-transparent tw:border-none tw:p-0"
                                      >
                                        Eliminar
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <CommentText text={comm.plainText} projectId={projectId || ''} />
                              </div>
                            );
                          })}
                        </div>

                        {/* Reply form / recording state */}
                        {isRecording &&
                        recordingTarget?.type === 'reply' &&
                        recordingTarget?.threadId === thread.threadId ? (
                          <div className="tw:flex tw:items-center tw:justify-between tw:bg-red-50 tw:border tw:border-red-100 tw:p-2 tw:rounded tw:text-[10px] tw:text-red-600 tw:animate-pulse">
                            <span>Grabando... ({formatDuration(recordDuration)})</span>
                            <div className="tw:flex tw:gap-1.5">
                              <button
                                onClick={stopRecording}
                                className="tw:bg-green-600 tw:text-white tw:px-2 tw:py-0.5 tw:rounded tw:cursor-pointer tw:border-none"
                              >
                                Enviar
                              </button>
                              <button
                                onClick={cancelRecording}
                                className="tw:bg-gray-400 tw:text-white tw:px-2 tw:py-0.5 tw:rounded tw:cursor-pointer tw:border-none"
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="tw:pt-2.5 tw:border-t tw:border-slate-50 tw:flex tw:gap-1.5 tw:items-center">
                            <input
                              type="text"
                              value={replyTexts[thread.threadId] || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setReplyTexts((prev) => ({ ...prev, [thread.threadId]: val }));
                              }}
                              placeholder="Responder..."
                              className="tw:flex-1 tw:border tw:border-gray-200 tw:rounded tw:px-2 tw:py-0.5 tw:text-xs focus:tw:outline-none focus:tw:border-indigo-400"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSendReply(thread);
                                }
                              }}
                              disabled={
                                replying[thread.threadId] ||
                                replyAttaching[thread.threadId] ||
                                isRecording
                              }
                            />
                            <button
                              onClick={() => handleReplyAttachClick(thread.threadId)}
                              disabled={
                                replying[thread.threadId] ||
                                replyAttaching[thread.threadId] ||
                                isRecording
                              }
                              className="tw:p-1 tw:text-xs tw:bg-slate-100 tw:hover:bg-slate-200 tw:text-slate-700 tw:border tw:border-slate-200 tw:rounded tw:transition-colors tw:cursor-pointer"
                              title="Adjuntar archivo"
                            >
                              {replyAttaching[thread.threadId] ? '⏳' : '📎'}
                            </button>
                            <button
                              onClick={() => startRecording('reply', thread.threadId)}
                              disabled={
                                replying[thread.threadId] ||
                                replyAttaching[thread.threadId] ||
                                isRecording
                              }
                              className="tw:p-1 tw:text-xs tw:bg-slate-100 tw:hover:bg-slate-200 tw:text-slate-700 tw:border tw:border-slate-200 tw:rounded tw:transition-colors tw:cursor-pointer"
                              title="Grabar nota de voz"
                            >
                              🎙️
                            </button>
                            <button
                              onClick={() => handleSendReply(thread)}
                              disabled={
                                replying[thread.threadId] ||
                                replyAttaching[thread.threadId] ||
                                !replyTexts[thread.threadId]?.trim() ||
                                isRecording
                              }
                              className="tw:px-2.5 tw:py-1 tw:bg-slate-600 tw:hover:bg-slate-700 tw:text-white tw:font-semibold tw:rounded tw:text-[10px] disabled:tw:opacity-40 tw:transition-colors tw:cursor-pointer tw:border-none"
                            >
                              {replying[thread.threadId] ? '...' : 'Crear Nota'}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {commentToDelete && (
        <div className="tw:fixed tw:inset-0 tw:bg-black/50 tw:flex tw:items-center tw:justify-center tw:z-[10001] tw:backdrop-blur-sm">
          <div className="tw:bg-white tw:rounded-xl tw:shadow-xl tw:p-6 tw:w-96 tw:max-w-[90%] tw:border tw:border-slate-200">
            <h3 className="tw:text-lg tw:font-bold tw:text-slate-800 tw:mb-2">
              ¿Eliminar comentario?
            </h3>
            <p className="tw:text-sm tw:text-slate-600 tw:mb-5">
              ¿Estás seguro de que quieres eliminar este comentario? Esta acción no se puede
              deshacer.
            </p>
            <div className="tw:flex tw:justify-end tw:gap-3">
              <button
                onClick={() => setCommentToDelete(null)}
                className="tw:px-4 tw:py-2 tw:bg-slate-100 tw:hover:bg-slate-200 tw:border tw:border-slate-200 tw:text-slate-700 tw:rounded-lg tw:text-sm tw:font-semibold tw:transition-colors tw:cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteCommentConfirm}
                className="tw:px-4 tw:py-2 tw:bg-red-600 tw:hover:bg-red-700 tw:text-white tw:rounded-lg tw:text-sm tw:font-semibold tw:transition-colors tw:cursor-pointer"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
