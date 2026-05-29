import { WebViewProps } from '@papi/core';
import papi from '@papi/frontend';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { ParatextNoteThread, ParatextComment } from './types/note.types';
import { ScrollGroupSelector } from 'platform-bible-react';

// Hardcoded default lists
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
];

function AudioPlayer({ projectId, filename }: { projectId: string; filename: string }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const loadAudio = async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await papi.commands.sendCommand(
          'paratextProjectManager.getAudioNote',
          projectId,
          filename,
        );
        if (active) {
          if (res.startsWith('data:audio/') || res.startsWith('data:application/octet-stream')) {
            setAudioUrl(res);
          } else {
            console.error('Failed to load audio:', res);
            setError(true);
          }
        }
      } catch (e) {
        console.error('Failed to load audio:', e);
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    loadAudio();
    return () => {
      active = false;
    };
  }, [projectId, filename]);

  if (loading)
    return (
      <span className="tw:inline-flex tw:items-center tw:text-[10px] tw:text-slate-500 tw:gap-1 tw:my-1">
        ⏳ Cargando nota de voz...
      </span>
    );
  if (error)
    return (
      <span className="tw:inline-flex tw:items-center tw:text-[10px] tw:text-red-500 tw:gap-1 tw:my-1">
        ⚠️ Error al cargar nota de voz
      </span>
    );

  return (
    <div className="tw:my-1.5 tw:p-1.5 tw:bg-slate-50 tw:border tw:border-slate-200 tw:rounded tw:flex tw:items-center tw:gap-2 tw:max-w-xs">
      <span className="tw:text-[11px] tw:flex-shrink-0">🎙️ Voz:</span>
      {audioUrl ? (
        <audio
          src={audioUrl}
          controls
          className="tw:h-6 tw:w-44 tw:outline-none"
          style={{ maxHeight: '24px' }}
        />
      ) : null}
    </div>
  );
}

function AttachmentViewer({ projectId, filename }: { projectId: string; filename: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext);

  useEffect(() => {
    if (!isImage) return;
    let active = true;
    const loadAttachment = async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await papi.commands.sendCommand(
          'paratextProjectManager.getAttachment',
          projectId,
          filename,
        );
        if (active) {
          if (res.startsWith('data:')) {
            setDataUrl(res);
          } else {
            console.error('Failed to load attachment:', res);
            setError(true);
          }
        }
      } catch (e) {
        console.error('Failed to load attachment:', e);
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    loadAttachment();
    return () => {
      active = false;
    };
  }, [projectId, filename, isImage]);

  const handleOpen = async () => {
    try {
      const res = await papi.commands.sendCommand(
        'paratextProjectManager.openAttachment',
        projectId,
        filename,
      );
      if (res !== 'ok') alert(`Error al abrir archivo: ${res}`);
    } catch (e) {
      alert(`No se pudo abrir el archivo: ${e}`);
    }
  };

  if (isImage) {
    if (loading)
      return (
        <span className="tw:inline-flex tw:items-center tw:text-[10px] tw:text-slate-500 tw:gap-1 tw:my-1">
          ⏳ Cargando imagen...
        </span>
      );
    if (error)
      return (
        <span className="tw:inline-flex tw:items-center tw:text-[10px] tw:text-red-500 tw:gap-1 tw:my-1">
          ⚠️ Error al cargar imagen
        </span>
      );
    return (
      <div className="tw:my-1.5 tw:max-w-xs tw:cursor-pointer tw:group" onClick={handleOpen}>
        {dataUrl ? (
          <div className="tw:relative tw:overflow-hidden tw:rounded tw:border tw:border-slate-200 tw:bg-slate-50 tw:transition tw:hover:shadow-md">
            <img
              src={dataUrl}
              alt={filename}
              className="tw:max-h-40 tw:w-auto tw:tw:object-cover tw:max-w-full"
            />
            <div className="tw:absolute tw:inset-0 tw:bg-black/10 tw:opacity-0 tw:group-hover:tw:opacity-100 tw:transition tw:flex tw:items-center tw:justify-center tw:text-white tw:text-[10px] tw:font-semibold tw:backdrop-blur-[1px]">
              🔎 Abrir archivo
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  let fileIcon = '📄';
  let cardColor = 'tw:bg-slate-50 tw:border-slate-200 tw:hover:bg-slate-100';
  if (ext === 'pdf') {
    fileIcon = '📕';
    cardColor = 'tw:bg-red-50/50 tw:border-red-200 tw:hover:tw:bg-red-50';
  } else if (['doc', 'docx'].includes(ext)) {
    fileIcon = '📘';
    cardColor = 'tw:bg-blue-50/50 tw:border-blue-200 tw:hover:tw:bg-blue-50';
  } else if (['xls', 'xlsx'].includes(ext)) {
    fileIcon = '📗';
    cardColor = 'tw:bg-emerald-50/50 tw:border-emerald-200 tw:hover:tw:bg-emerald-55';
  } else if (ext === 'txt') {
    fileIcon = '📝';
    cardColor = 'tw:bg-amber-50/50 tw:border-amber-200 tw:hover:tw:bg-amber-50';
  }

  const cleanDisplayName = filename.replace(/^att_\d+_/, '');

  return (
    <div
      className={`tw:my-1.5 tw:p-2 tw:border tw:rounded tw:flex tw:items-center tw:justify-between tw:gap-3 tw:max-w-xs tw:transition tw:shadow-sm ${cardColor}`}
    >
      <div className="tw:flex tw:items-center tw:gap-2 tw:overflow-hidden">
        <span className="tw:text-lg tw:flex-shrink-0">{fileIcon}</span>
        <span
          className="tw:text-[11px] tw:font-medium tw:text-slate-700 tw:truncate"
          title={cleanDisplayName}
        >
          {cleanDisplayName}
        </span>
      </div>
      <button
        type="button"
        onClick={handleOpen}
        className="tw:px-2.5 tw:py-1 tw:bg-white tw:hover:tw:bg-slate-50 tw:border tw:border-slate-300 tw:rounded tw:text-[10px] tw:font-semibold tw:text-slate-700 tw:shadow-sm tw:transition tw:whitespace-nowrap tw:cursor-pointer"
      >
        Abrir
      </button>
    </div>
  );
}

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
        className="tw:text-indigo-600 tw:hover:tw:text-indigo-800 tw:underline tw:break-all tw:cursor-pointer tw:font-medium"
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
}

const EditableVerse: React.FC<EditableVerseProps> = ({
  initialText,
  initialOffset,
  onSave,
  onCancel,
  onContextMenu,
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [hasSaved, setHasSaved] = useState(false);

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
      } catch (err) {
        // Fallback: collapse caret to the end
        try {
          const range = document.createRange();
          const sel = window.getSelection();
          range.selectNodeContents(ref.current);
          range.collapse(false);
          sel?.removeAllRanges();
          sel?.addRange(range);
        } catch (_) {}
      }
    }
  }, [initialOffset]);

  const handleBlur = async (e: React.FocusEvent<HTMLSpanElement>) => {
    if (hasSaved) return;
    const text = e.currentTarget.textContent || '';
    setHasSaved(true);
    await onSave(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setHasSaved(true);
      if (ref.current) {
        ref.current.textContent = initialText;
      }
      onCancel();
    }
  };

  return (
    <span
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={onContextMenu}
      className="tw:outline-none tw:bg-transparent tw:p-0 tw:m-0 tw:inline tw:border-none"
    >
      {initialText}
    </span>
  );
};

globalThis.webViewComponent = function ScriptureViewerWebView({
  projectId,
  useWebViewScrollGroupScrRef,
}: WebViewProps) {
  const [books, setBooks] = useState<BookInfo[]>([]);
  const [selectedBook, setSelectedBook] = useState<string>('');
  const [selectedChapter, setSelectedChapter] = useState<number>(1);
  const [totalChapters, setTotalChapters] = useState<number>(1);

  // Scroll group integration
  const [scrRef, setScrRef, scrollGroupId, setScrollGroupId] = useWebViewScrollGroupScrRef
    ? useWebViewScrollGroupScrRef()
    : [undefined, undefined, undefined, undefined];

  // Content states
  const [chapterBlocks, setChapterBlocks] = useState<ChapterBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Note integration states
  const [allNotes, setAllNotes] = useState<ParatextNoteThread[]>([]);
  const [selectedVerseNum, setSelectedVerseNum] = useState<number | null>(null);
  const [notesPopupVerseNum, setNotesPopupVerseNum] = useState<number | null>(null);
  const [currentUser, setCurrentUser] = useState('Dale');
  const [collabCursors, setCollabCursors] = useState<Record<string, { projectId: string; book: string; chapter: number; verse: number | null }>>({});
  const [teamMembers, setTeamMembers] = useState<string[]>([]);

  // Focus and Selection Navigation
  const [selectedThreadIdInSidebar, setSelectedThreadIdInSidebar] = useState<string | null>(null);
  const pendingVerseRef = useRef<number | null>(null);

  // Verse editing states
  const [isEditingVerse, setIsEditingVerse] = useState(false);
  const [verseEditText, setVerseEditText] = useState('');
  const [savingVerse, setSavingVerse] = useState(false);
  const [fontSize, setFontSize] = useState(16);

  // Text selection states for new notes
  const [selectedText, setSelectedText] = useState('');
  const [startPosition, setStartPosition] = useState(0);
  const [contextBefore, setContextBefore] = useState('');
  const [contextAfter, setContextAfter] = useState('');
  const [initialOffset, setInitialOffset] = useState(0);

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
  const fileInputRef = useRef<HTMLInputElement>(null);
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
      }

      if (scrollGroupId !== undefined && setScrRef) {
        setScrRef({
          book: bookCode,
          chapterNum: chapter,
          verseNum: verse,
        });
      }
    });
    return () => unsubscribe();
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

  // Listen to collaboration events
  useEffect(() => {
    let unsubEvent: any;
    const listen = async () => {
      try {
        unsubEvent = await papi.network.subscribeNetworkEvent(
          'paratextProjectManager.onCollabEvent',
          (event: any) => {
            if (!event) return;
            const { type, payload } = event;
            if (type === 'cursor_update') {
              setCollabCursors((prev) => ({
                ...prev,
                [payload.user]: payload,
              }));
            } else if (type === 'note_update') {
              if (payload.projectId === projectId) {
                loadNotes();
              }
            }
          },
        );
      } catch (_) {}
    };
    listen();
    return () => {
      if (unsubEvent) unsubEvent();
    };
  }, [projectId]);

  // Broadcast cursor when editing state changes
  useEffect(() => {
    if (!currentUser) return;
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
        );
      } catch (_) {}
    };
    updateCursor();
  }, [isEditingVerse, selectedVerseNum, selectedBook, selectedChapter, currentUser, projectId]);

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
  }, [selectedThreadIdInSidebar]);

  // Reset states on active verse changes
  useEffect(() => {
    if (selectedVerseNum !== null) {
      setVerseEditText(getSelectedVerseText());
    } else {
      setVerseEditText('');
    }
    setSelectedThreadIdInSidebar(null);
  }, [selectedVerseNum]);

  // Caret focus and selection are handled natively by EditableVerse on mount.

  // Helper to extract raw text of selected verse from chapterBlocks
  const getSelectedVerseText = () => {
    if (selectedVerseNum === null) return '';
    for (const block of chapterBlocks) {
      if (block.type === 'paragraph' || block.type === 'poetry') {
        for (const child of block.children) {
          if (child.type === 'verse' && child.number === selectedVerseNum) {
            return child.text;
          }
        }
      }
    }
    return '';
  };

  const hasFormattingMarkup = verseEditText.includes('[FN:') || verseEditText.includes('\\');

  const handleSaveVerseText = async (customText?: string) => {
    if (selectedVerseNum === null || !selectedBook) return;
    const textToSave = customText !== undefined ? customText : verseEditText;
    setSavingVerse(true);
    try {
      const res = await papi.commands.sendCommand(
        'paratextProjectManager.updateVerseText',
        projectId,
        selectedBook,
        selectedChapter,
        selectedVerseNum,
        textToSave,
      );

      if (res === 'ok') {
        setIsEditingVerse(false);
        await loadChapter(selectedBook, selectedChapter);
      } else {
        alert(`Error al guardar el texto: ${res}`);
      }
    } catch (err) {
      alert(`Error al guardar el texto: ${err}`);
    } finally {
      setSavingVerse(false);
    }
  };

  const handleContentEditableSave = async (newText: string, verseNum: number) => {
    const originalText = getSelectedVerseText();

    if (newText.trim() === originalText.trim()) {
      setIsEditingVerse(false);
      setSelectedVerseNum(null);
      return;
    }

    setSavingVerse(true);
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
        setIsEditingVerse(false);
        setSelectedVerseNum(null);
        await loadChapter(selectedBook, selectedChapter);
      } else {
        alert(`Error al guardar el texto: ${res}`);
        setIsEditingVerse(false);
        setSelectedVerseNum(null);
      }
    } catch (err) {
      alert(`Error al guardar el texto: ${err}`);
      setIsEditingVerse(false);
      setSelectedVerseNum(null);
    } finally {
      setSavingVerse(false);
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
        return (
          <mark
            key={index}
            onClick={(e) => {
              e.stopPropagation();
              selectVerse(verseNum);
              setNotesPopupVerseNum(verseNum);
              setSelectedThreadIdInSidebar(match.threadId);
            }}
            className={`tw:cursor-pointer tw:px-0.5 tw:rounded tw:transition ${
              selectedThreadIdInSidebar === match.threadId
                ? 'tw:bg-yellow-400 tw:text-slate-900 tw:font-semibold tw:ring-2 tw:ring-yellow-500'
                : 'tw:bg-yellow-200/80 hover:tw:bg-yellow-300 tw:text-slate-800'
            }`}
            title="Click para ver la nota"
          >
            {part}
          </mark>
        );
      }
      return part;
    });
  };

  // Fetch books & config
  const initData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [uRes, tmRes, bRes] = await Promise.all([
        papi.commands.sendCommand('paratextProjectManager.getCurrentUser'),
        papi.commands.sendCommand('paratextProjectManager.getTeamMembers'),
        papi.commands.sendCommand('paratextProjectManager.getProjectBooks', projectId),
      ]);
      if (uRes) setCurrentUser(uRes);
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
        } else if (scrRef && scrRef.book) {
          setSelectedBook(scrRef.book);
          setSelectedChapter(scrRef.chapterNum);
          pendingVerseRef.current = scrRef.verseNum;
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
      console.error(err);
      setError('Error al cargar libros de Escritura.');
    } finally {
      setLoading(false);
    }
  }, [projectId, scrRef, scrollGroupId, setScrRef]);

  useEffect(() => {
    initData();
  }, [initData]);

  // Load chapter text and notes
  const loadChapter = async (bookCode: string, chapterNum: number) => {
    if (!bookCode) return;
    setLoading(true);
    try {
      const textRes = await papi.commands.sendCommand(
        'paratextProjectManager.getChapterText',
        projectId,
        bookCode,
        chapterNum,
      );
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

      await loadNotes();
    } catch (err) {
      console.error(err);
      setError('Error al cargar texto o notas.');
    } finally {
      setLoading(false);
    }
  };

  const loadNotes = async () => {
    try {
      const notesRes = await papi.commands.sendCommand(
        'paratextProjectManager.getProjectNotes',
        projectId,
        currentUser,
      );
      const parsedNotes = JSON.parse(notesRes) as { threads: ParatextNoteThread[] };
      setAllNotes(parsedNotes.threads || []);
    } catch (err) {
      console.error('Failed to load notes', err);
    }
  };

  useEffect(() => {
    if (selectedBook) {
      loadChapter(selectedBook, selectedChapter);
      if (pendingVerseRef.current !== null) {
        setSelectedVerseNum(pendingVerseRef.current);
        pendingVerseRef.current = null;
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
                  alert(`Error al enviar respuesta de audio: ${res}`);
                }
              } else {
                alert(`Error al guardar audio: ${saveRes?.error || 'Unknown error'}`);
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
      alert(`No se pudo acceder al micrófono: ${e}`);
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
              alert(`Error al enviar adjunto: ${res}`);
            }
          } else {
            alert(`Error al guardar archivo adjunto: ${saveRes?.error || 'Unknown error'}`);
          }
        } catch (err) {
          alert(`Error al guardar adjunto: ${err}`);
        } finally {
          setReplyAttaching((prev) => ({ ...prev, [threadId]: false }));
          setActiveReplyThreadId(null);
          e.target.value = '';
        }
      };
    } catch (err) {
      alert(`Error al leer archivo: ${err}`);
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
        alert(`Error al enviar respuesta: ${res}`);
      }
    } catch (err) {
      alert(`Error al enviar respuesta: ${err}`);
    } finally {
      setReplying((prev) => ({ ...prev, [thread.threadId]: false }));
    }
  };

  // Delete Comment Handler
  const handleDeleteComment = (
    threadId: string,
    commentDate: string,
    commentAuthor: string,
  ) => {
    setCommentToDelete({ threadId, commentDate, commentAuthor });
  };

  const handleDeleteCommentConfirm = async () => {
    if (!commentToDelete) return;
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

    if (selectedStr) {
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
      const after = fullText.substring(offset + selectedStr.length, offset + selectedStr.length + 30);
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
    setVerseEditText(verseText);
    setSelectedText('');
    setStartPosition(0);
    setContextBefore('');
    setContextAfter('');
  };

  const handleVerseContextMenu = (e: React.MouseEvent, verseNum: number, verseText: string) => {
    const selection = window.getSelection();
    const selectedStr = selection ? selection.toString().trim() : '';
    if (selectedStr) {
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
      const after = fullText.substring(offset + selectedStr.length, offset + selectedStr.length + 30);
      setContextBefore(before);
      setContextAfter(after);

      setContextMenu({
        x: e.clientX,
        y: e.clientY,
      });
    }
  };

  const handleNoteIndicatorClick = (verseNum: number) => {
    selectVerse(verseNum);
    setNotesPopupVerseNum(verseNum);
    setIsEditingVerse(false);
    setShowNewNoteForm(false);
  };

  // Create new note thread
  const handleCreateNote = async () => {
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
        alert(`Error al crear la nota: ${res}`);
      }
    } catch (err) {
      alert(`Error al crear la nota: ${err}`);
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

      {/* Left Pane: Scripture Text */}
      <div className="tw:flex-1 tw:flex tw:flex-col tw:bg-white tw:min-w-0 tw:h-full tw:w-full">
        {/* Toolbar */}
        <div className="tw:px-4 tw:py-2 tw:bg-white tw:border-b tw:border-gray-200 tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:shrink-0 tw:shadow-sm">
          <div className="tw:flex tw:items-center tw:gap-2">
            <span className="tw:font-bold tw:text-slate-800 tw:text-base">📖 Lector</span>
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
                className="tw:px-2 tw:py-1 tw:bg-slate-100 hover:tw:bg-slate-200 tw:border tw:rounded tw:text-xs tw:disabled:tw:opacity-40 tw:cursor-pointer"
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
                className="tw:px-2 tw:py-1 tw:bg-slate-100 hover:tw:bg-slate-200 tw:border tw:rounded tw:text-xs tw:disabled:tw:opacity-40 tw:cursor-pointer"
              >
                ▶
              </button>
            </div>
          </div>

          <div className="tw:flex tw:items-center tw:gap-2">
            {/* Scroll Group Selector */}
            {useWebViewScrollGroupScrRef && (
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
              onClick={() => setFontSize((f) => Math.max(12, f - 2))}
              className="tw:px-2.5 tw:py-1 tw:bg-slate-50 hover:tw:bg-slate-100 tw:border tw:rounded tw:text-xs tw:cursor-pointer"
              title="Disminuir tamaño de letra"
            >
              A-
            </button>
            <button
              onClick={() => setFontSize((f) => Math.min(30, f + 2))}
              className="tw:px-2.5 tw:py-1 tw:bg-slate-50 hover:tw:bg-slate-100 tw:border tw:rounded tw:text-xs tw:cursor-pointer"
              title="Aumentar tamaño de letra"
            >
              A+
            </button>
            <button
              onClick={() => loadChapter(selectedBook, selectedChapter)}
              className="tw:px-3 tw:py-1 tw:bg-slate-100 hover:tw:bg-slate-200 tw:border tw:border-slate-200 tw:text-slate-700 tw:rounded tw:text-xs tw:font-semibold tw:cursor-pointer"
            >
              {loading ? 'Cargando...' : '↻ Actualizar'}
            </button>
          </div>
        </div>

        {/* Scrollable text sheet */}
        <div className="tw:flex-1 tw:overflow-y-auto tw:p-8 tw:leading-relaxed tw:text-slate-800">
          <div
            className="tw:max-w-2xl tw:mx-auto tw:space-y-6"
            style={{ fontSize: `${fontSize}px` }}
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
                      className="tw:text-lg tw:font-bold tw:text-slate-900 tw:mt-6 tw:mb-3"
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
                        return <span key={cIdx}>{child.text}</span>;
                      }

                      const isSelected = selectedVerseNum === child.number;
                      const isEditing = isEditingVerse && isSelected;
                      const editors = Object.entries(collabCursors)
                        .filter(([user, cursor]) => {
                          return (
                            user !== currentUser &&
                            cursor.projectId === projectId &&
                            cursor.book === selectedBook &&
                            cursor.chapter === selectedChapter &&
                            cursor.verse === child.number
                          );
                        })
                        .map(([user]) => user);

                      return (
                        <span
                          key={cIdx}
                          id={`verse-${child.number}`}
                          onClick={() => handleVerseClick(child.number, child.text)}
                          onContextMenu={(e) => handleVerseContextMenu(e, child.number, child.text)}
                          className="tw:relative tw:inline tw:rounded tw:transition-all tw:py-0.5 tw:cursor-text"
                        >
                          {/* Verse number tag */}
                          <sup
                            className="tw:select-none tw:font-bold tw:mr-1 tw:px-1 tw:rounded tw:text-slate-400"
                            style={{ fontSize: '0.65em', top: '-0.3em' }}
                          >
                            {child.number}
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
                              onContextMenu={(e) => handleVerseContextMenu(e, child.number, child.text)}
                            />
                          ) : (
                            <span>
                              {highlightText(
                                child.text,
                                chapterNotesByVerse[child.number] ?? [],
                                child.number,
                              )}
                            </span>
                          )}

                          {editors.length > 0 && (
                            <span
                              className="tw:inline-flex tw:items-center tw:gap-1 tw:bg-amber-100 tw:text-amber-800 tw:text-[9px] tw:px-1.5 tw:py-0.2 tw:rounded tw:ml-1 tw:select-none tw:animate-pulse tw:font-semibold"
                              title={`Editando por: ${editors.join(', ')}`}
                            >
                              ✍️ {editors.join(', ')}
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
            className="tw:w-full tw:text-left tw:px-3 tw:py-2 hover:tw:bg-slate-100 tw:text-slate-700 tw:font-semibold tw:flex tw:items-center tw:gap-1.5 tw:cursor-pointer tw:border-none tw:bg-white"
          >
            💬 Agregar nota
          </button>
        </div>
      )}

      {/* Floating Notes Popup Modal */}
      {notesPopupVerseNum !== null && (
        <div className="tw:fixed tw:inset-0 tw:bg-black/50 tw:flex tw:items-center tw:justify-center tw:z-[9999] tw:backdrop-blur-sm">
          <div className="tw:bg-white tw:rounded-xl tw:shadow-2xl tw:p-5 tw:w-[500px] tw:max-w-[90vw] tw:max-h-[85vh] tw:flex tw:flex-col tw:border tw:border-slate-200">
            {/* Header */}
            <div className="tw:pb-3 tw:border-b tw:border-gray-200 tw:flex tw:items-center tw:justify-between tw:shrink-0">
              <h3 className="tw:font-bold tw:text-slate-800 tw:text-base">
                📖 Notas en {selectedBook} {selectedChapter}:{notesPopupVerseNum}
              </h3>
              <button
                onClick={() => setNotesPopupVerseNum(null)}
                className="tw:text-gray-400 hover:tw:text-gray-600 tw:text-lg tw:cursor-pointer tw:bg-transparent tw:border-none"
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
                  className="tw:w-full tw:py-2 tw:bg-indigo-600 hover:tw:bg-indigo-700 tw:text-white tw:font-semibold tw:rounded-lg tw:text-xs tw:shadow-sm tw:transition-colors tw:cursor-pointer tw:border-none"
                >
                  ＋ Nueva nota en versículo
                </button>
              )}

              {/* New note thread form */}
              {showNewNoteForm && (
                <div className="tw:bg-white tw:border tw:border-gray-200 tw:rounded-lg tw:p-3 tw:space-y-3 shadow-sm">
                  <div className="tw:flex tw:items-center tw:justify-between">
                    <span className="tw:font-bold tw:text-slate-700 tw:text-xs">Nueva Nota</span>
                    <button
                      onClick={() => setShowNewNoteForm(false)}
                      className="tw:text-gray-400 hover:tw:text-gray-600 tw:bg-transparent tw:border-none"
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
                        className="tw:p-1.5 tw:bg-slate-100 hover:tw:bg-slate-200 tw:border tw:rounded tw:cursor-pointer"
                        title="Adjuntar archivo"
                      >
                        📎
                      </button>
                      <button
                        onClick={() => startRecording('new')}
                        className="tw:p-1.5 tw:bg-slate-100 hover:tw:bg-slate-200 tw:border tw:rounded tw:cursor-pointer"
                        title="Grabar nota de voz"
                      >
                        🎙️
                      </button>
                    </div>
                    <button
                      onClick={handleCreateNote}
                      className="tw:px-3 tw:py-1.5 tw:bg-indigo-600 hover:tw:bg-indigo-700 tw:text-white tw:font-semibold tw:rounded tw:text-xs shadow-sm tw:cursor-pointer tw:border-none"
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
                              👤 {thread.assignedUser}
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
                                        className="tw:text-red-500 hover:tw:underline tw:cursor-pointer tw:bg-transparent tw:border-none tw:p-0"
                                      >
                                        Eliminar
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <CommentText text={comm.plainText} projectId={projectId} />
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
                              className="tw:p-1 tw:text-xs tw:bg-slate-100 hover:tw:bg-slate-200 tw:text-slate-700 tw:border tw:border-slate-200 tw:rounded tw:transition-colors tw:cursor-pointer"
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
                              className="tw:p-1 tw:text-xs tw:bg-slate-100 hover:tw:bg-slate-200 tw:text-slate-700 tw:border tw:border-slate-200 tw:rounded tw:transition-colors tw:cursor-pointer"
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
                              className="tw:px-2.5 tw:py-1 tw:bg-indigo-600 hover:tw:bg-indigo-700 tw:text-white tw:font-semibold tw:rounded tw:text-[10px] disabled:tw:opacity-40 tw:transition-colors tw:cursor-pointer tw:border-none"
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
            <h3 className="tw:text-lg tw:font-bold tw:text-slate-800 tw:mb-2">¿Eliminar comentario?</h3>
            <p className="tw:text-sm tw:text-slate-600 tw:mb-5">
              ¿Estás seguro de que quieres eliminar este comentario? Esta acción no se puede deshacer.
            </p>
            <div className="tw:flex tw:justify-end tw:gap-3">
              <button
                onClick={() => setCommentToDelete(null)}
                className="tw:px-4 tw:py-2 tw:bg-slate-100 hover:tw:bg-slate-200 tw:border tw:border-slate-200 tw:text-slate-700 tw:rounded-lg tw:text-sm tw:font-semibold tw:transition-colors tw:cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteCommentConfirm}
                className="tw:px-4 tw:py-2 tw:bg-red-600 hover:tw:bg-red-700 tw:text-white tw:rounded-lg tw:text-sm tw:font-semibold tw:transition-colors tw:cursor-pointer"
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
