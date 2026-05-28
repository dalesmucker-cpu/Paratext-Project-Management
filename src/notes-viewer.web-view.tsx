import { WebViewProps } from '@papi/core';
import papi from '@papi/frontend';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ParatextNoteThread, ParatextComment, NotesDisplaySettings } from './types/note.types';
import { DEFAULT_NOTES_SETTINGS } from './types/note.types';

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

  if (loading) {
    return (
      <span className="tw:inline-flex tw:items-center tw:text-[10px] tw:text-slate-500 tw:gap-1 tw:my-1">
        ⏳ Cargando nota de voz...
      </span>
    );
  }

  if (error) {
    return (
      <span className="tw:inline-flex tw:items-center tw:text-[10px] tw:text-red-500 tw:gap-1 tw:my-1">
        ⚠️ Error al cargar nota de voz
      </span>
    );
  }

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
    if (!isImage) return; // Only load previews for images
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
      if (res !== 'ok') {
        alert(`Error al abrir archivo: ${res}`);
      }
    } catch (e) {
      alert(`No se pudo abrir el archivo: ${e}`);
    }
  };

  if (isImage) {
    if (loading) {
      return (
        <span className="tw:inline-flex tw:items-center tw:text-[10px] tw:text-slate-500 tw:gap-1 tw:my-1">
          ⏳ Cargando imagen...
        </span>
      );
    }
    if (error) {
      return (
        <span className="tw:inline-flex tw:items-center tw:text-[10px] tw:text-red-500 tw:gap-1 tw:my-1">
          ⚠️ Error al cargar imagen
        </span>
      );
    }
    return (
      <div
        className="tw:my-1.5 tw:max-w-xs tw:cursor-pointer tw:group"
        onClick={handleOpen}
        title="Haga clic para abrir en tamaño original"
      >
        {dataUrl ? (
          <div className="tw:relative tw:overflow-hidden tw:rounded tw:border tw:border-slate-200 tw:bg-slate-50 tw:transition tw:hover:shadow-md">
            <img
              src={dataUrl}
              alt={filename}
              className="tw:max-h-40 tw:w-auto tw:object-cover tw:max-w-full"
            />
            <div className="tw:absolute tw:inset-0 tw:bg-black/10 tw:opacity-0 tw:group-hover:tw:opacity-100 tw:transition tw:flex tw:items-center tw:justify-center tw:text-white tw:text-[10px] tw:font-semibold tw:backdrop-blur-[1px]">
              🔎 Abrir archivo
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // General document display card
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
        title="Abrir enlace en el navegador"
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

function CommentText({
  text,
  projectId,
  textSize,
}: {
  text: string;
  projectId: string;
  textSize: 'small' | 'medium' | 'large' | 'xlarge';
}) {
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

  const sizeClass =
    textSize === 'small'
      ? 'tw:text-[11px]'
      : textSize === 'large'
        ? 'tw:text-sm'
        : textSize === 'xlarge'
          ? 'tw:text-base'
          : 'tw:text-xs';

  const contentToRender = parts.length > 0 ? parts : renderTextWithLinks(cleanText, 'root');

  return (
    <div
      className={`tw:text-slate-800 tw:leading-relaxed tw:whitespace-pre-wrap tw:break-words ${sizeClass}`}
    >
      {contentToRender}
    </div>
  );
}

globalThis.webViewComponent = function NotesViewerWebView({ projectId }: WebViewProps) {
  const [threads, setThreads] = useState<ParatextNoteThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentUser, setCurrentUser] = useState('');
  const [teamMembers, setTeamMembers] = useState<string[]>([]);
  const [showUserPicker, setShowUserPicker] = useState(false);

  // Selected thread in detail pane
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  // Settings
  const [settings, setSettings] = useState<NotesDisplaySettings>({
    ...DEFAULT_NOTES_SETTINGS,
    showMode: 'all',
    limitCount: 50,
  });
  const [showSettings, setShowSettings] = useState(false);

  // Quick filters
  const [filterBook, setFilterBook] = useState<string>('all');
  const [filterAuthor, setFilterAuthor] = useState<string>('all');
  const [searchText, setSearchText] = useState('');

  // Actions states
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [editingComment, setEditingComment] = useState<{ date: string; text: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Voice recording states
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [recordDuration, setRecordDuration] = useState(0);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // File attachment elements
  const [attaching, setAttaching] = useState(false);
  const [commentToDelete, setCommentToDelete] = useState<{
    threadId: string;
    commentDate: string;
    commentAuthor: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const commentsTimelineRef = useRef<HTMLDivElement>(null);

  // Fetch settings from user config
  const loadSettings = useCallback(async (user: string) => {
    if (!user) return;
    try {
      const res = await papi.commands.sendCommand('paratextProjectManager.getNotesSettings', user);
      if (res) {
        const parsed = JSON.parse(res) as NotesDisplaySettings;
        setSettings({
          ...parsed,
          showMode: parsed.showMode || 'all',
          limitCount: parsed.limitCount || 50,
        });
      }
    } catch (_) {}
  }, []);

  // Fetch user information and list of members
  const loadUserAndMembers = useCallback(async () => {
    try {
      const [userResult, membersResult] = await Promise.all([
        papi.commands.sendCommand('paratextProjectManager.getCurrentUser'),
        papi.commands.sendCommand('paratextProjectManager.getTeamMembers'),
      ]);
      if (userResult) {
        setCurrentUser(userResult);
        loadSettings(userResult);
      }
      if (membersResult) {
        setTeamMembers(JSON.parse(membersResult as string) as string[]);
      }
    } catch (_) {}
  }, [loadSettings]);

  // Load threads
  const loadNotes = useCallback(
    async (selectIdAfterLoad?: string | null) => {
      if (!projectId || !currentUser) return;
      setLoading(true);
      setError('');
      try {
        const res = await papi.commands.sendCommand(
          'paratextProjectManager.getProjectNotes',
          projectId,
          currentUser,
        );
        const parsed = JSON.parse(res) as {
          threads: ParatextNoteThread[];
          authors: string[];
          error?: string;
        };
        if (parsed.error) {
          setError(parsed.error);
          return;
        }
        const loadedThreads = parsed.threads || [];
        setThreads(loadedThreads);

        if (selectIdAfterLoad) {
          const exists = loadedThreads.some((t) => t.threadId === selectIdAfterLoad);
          if (exists) {
            setSelectedThreadId(selectIdAfterLoad);
          } else if (loadedThreads.length > 0) {
            setSelectedThreadId(loadedThreads[0].threadId);
          } else {
            setSelectedThreadId(null);
          }
        } else if (loadedThreads.length > 0 && !selectedThreadId) {
          setSelectedThreadId(loadedThreads[0].threadId);
        }
      } catch (e) {
        setError(`Error al cargar notas: ${e}`);
      } finally {
        setLoading(false);
      }
    },
    [projectId, currentUser, selectedThreadId],
  );

  useEffect(() => {
    loadUserAndMembers();
  }, [loadUserAndMembers]);

  useEffect(() => {
    if (projectId && currentUser) {
      loadNotes();
    }
  }, [projectId, currentUser, loadNotes]);

  // Listen to collaboration events to refresh notes in real-time
  useEffect(() => {
    let unsubCollab: any;
    const listen = async () => {
      try {
        unsubCollab = await papi.network.subscribeNetworkEvent(
          'paratextProjectManager.onCollabEvent',
          (event: any) => {
            if (event && event.type === 'note_update' && event.payload.projectId === projectId) {
              loadNotes();
            }
          }
        );
      } catch (_) {}
    };
    listen();
    return () => {
      if (unsubCollab) unsubCollab();
    };
  }, [projectId, loadNotes]);

  // Save Settings
  const saveSettings = async (updates: Partial<NotesDisplaySettings>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    if (!currentUser) return;
    try {
      await papi.commands.sendCommand(
        'paratextProjectManager.saveNotesSettings',
        currentUser,
        JSON.stringify(newSettings),
      );
    } catch (_) {}
  };

  // Set active user
  const handleSetUser = async (name: string) => {
    if (!name) return;
    setCurrentUser(name);
    setShowUserPicker(false);
    try {
      await papi.commands.sendCommand('paratextProjectManager.setCurrentUser', name);
      loadSettings(name);
    } catch (_) {}
  };

  // Helper for name normalizations
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

  // Mark thread as read
  const handleMarkRead = async (thread: ParatextNoteThread) => {
    if (!thread.isUnread) return;
    try {
      const res = await papi.commands.sendCommand(
        'paratextProjectManager.markNoteAsRead',
        currentUser,
        thread.threadId,
        thread.latestDate,
      );
      if (res === 'ok') {
        setThreads((prev) =>
          prev.map((t) => (t.threadId === thread.threadId ? { ...t, isUnread: false } : t)),
        );
      }
    } catch (_) {}
  };

  // Handle click on thread card
  const handleSelectThread = (thread: ParatextNoteThread) => {
    setSelectedThreadId(thread.threadId);
    setReplyText('');
    setEditingComment(null);
    if (thread.isUnread) {
      handleMarkRead(thread);
    }
    // Scroll right pane comments timeline to top
    setTimeout(() => {
      commentsTimelineRef.current?.scrollTo(0, 0);
    }, 50);
  };

  // Trigger hidden file selection
  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const currentThread = threads.find((t) => t.threadId === selectedThreadId);
    if (!currentThread || !e.target.files || e.target.files.length === 0) return;

    const file = e.target.files[0];
    setAttaching(true);
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
              threadId: currentThread.threadId,
              verseRef: currentThread.verseRef,
              language: currentThread.language,
              selectedText: currentThread.selectedText,
              startPosition: currentThread.startPosition,
              contextBefore: currentThread.contextBefore,
              contextAfter: currentThread.contextAfter,
              verseXml: currentThread.verseXml,
              replyToUser: currentThread.latestUser,
              hideInTextWindow: currentThread.hideInTextWindow,
              contents: `[Attachment: ${cleanedName}]\nVer archivo: ${link}`,
            };

            const res = await papi.commands.sendCommand(
              'paratextProjectManager.addNoteReply',
              projectId,
              currentUser,
              JSON.stringify(replyData),
            );
            if (res === 'ok') {
              await loadNotes(currentThread.threadId);
            } else {
              alert(`Error al enviar adjunto: ${res}`);
            }
          } else {
            const errMsg = saveRes && saveRes.error ? saveRes.error : JSON.stringify(saveRes);
            alert(`Error al guardar archivo: ${errMsg}`);
          }
        } catch (err) {
          alert(`Error al procesar archivo adjunto: ${err}`);
        } finally {
          setAttaching(false);
          e.target.value = ''; // Reset input
        }
      };
    } catch (err) {
      alert(`Error al leer archivo: ${err}`);
      setAttaching(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
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

          const saveRes = await papi.commands.sendCommand(
            'paratextProjectManager.saveAudioNote',
            projectId,
            filename,
            base64data,
          );
          if (saveRes && saveRes.status === 'ok') {
            const currentThread = threads.find((t) => t.threadId === selectedThreadId);
            if (!currentThread) return;
            const audioLink =
              saveRes.driveUrl ||
              `http://localhost:49876/play?project=${projectId}&file=${filename}`;
            const replyData = {
              threadId: currentThread.threadId,
              verseRef: currentThread.verseRef,
              language: currentThread.language,
              selectedText: currentThread.selectedText,
              startPosition: currentThread.startPosition,
              contextBefore: currentThread.contextBefore,
              contextAfter: currentThread.contextAfter,
              verseXml: currentThread.verseXml,
              replyToUser: currentThread.latestUser,
              hideInTextWindow: currentThread.hideInTextWindow,
              contents: `[Audio: ${filename}]\nEscuchar audio: ${audioLink}`,
            };

            const res = await papi.commands.sendCommand(
              'paratextProjectManager.addNoteReply',
              projectId,
              currentUser,
              JSON.stringify(replyData),
            );
            if (res === 'ok') {
              await loadNotes(currentThread.threadId);
            } else {
              alert(`Error al enviar nota de voz: ${res}`);
            }
          } else {
            const errMsg = saveRes && saveRes.error ? saveRes.error : JSON.stringify(saveRes);
            alert(`Error al guardar audio: ${errMsg}`);
          }
        };
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
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
  };

  const cleanupRecording = () => {
    setIsRecording(false);
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
        await loadNotes(target.threadId);
      } else {
        console.error(`Error al eliminar comentario: ${res}`);
      }
    } catch (e) {
      console.error(`Error al eliminar comentario: ${e}`);
    }
  };

  // Reply handler
  const handleReply = async (thread: ParatextNoteThread) => {
    const text = replyText.trim();
    if (!text) return;

    setReplying(true);
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
        setReplyText('');
        await loadNotes(thread.threadId);
      } else {
        alert(`Error al enviar respuesta: ${res}`);
      }
    } catch (e) {
      alert(`Error al enviar respuesta: ${e}`);
    } finally {
      setReplying(false);
    }
  };

  // Edit comment handler
  const handleSaveEdit = async (threadId: string) => {
    if (!editingComment) return;
    setSavingEdit(true);
    try {
      const res = await papi.commands.sendCommand(
        'paratextProjectManager.saveProjectNote',
        projectId,
        currentUser,
        threadId,
        editingComment.date,
        editingComment.text,
      );
      if (res === 'ok') {
        setEditingComment(null);
        await loadNotes(threadId);
      } else {
        alert(`Error al guardar edición: ${res}`);
      }
    } catch (e) {
      alert(`Error al guardar edición: ${e}`);
    } finally {
      setSavingEdit(false);
    }
  };

  // Process threads with filters and settings
  const filteredThreads = useMemo(() => {
    return threads
      .filter((t) => {
        // 1. Show mode
        if (settings.showMode === 'unread_only' && !t.isUnread) return false;

        // 2. Scope
        if (settings.scope === 'assigned_to_me') {
          if (!t.assignedUser || !isMe(t.assignedUser)) return false;
        } else if (settings.scope === 'my_threads') {
          const rootUser = t.comments[0]?.user || '';
          if (!isMe(rootUser)) return false;
        }

        // 3. Max age
        if (settings.maxAgeDays > 0) {
          const ageMs = settings.maxAgeDays * 24 * 60 * 60 * 1000;
          const noteTime = new Date(t.latestDate).getTime();
          if (Date.now() - noteTime > ageMs) return false;
        }

        // 4. Quick book filter
        if (filterBook !== 'all' && t.book !== filterBook) return false;

        // 5. Quick author filter
        if (filterAuthor !== 'all') {
          const matchAuthor = (cUser: string) => {
            const clean = (n: string) =>
              n
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]/g, '');
            const cleanC = clean(cUser);
            const cleanF = clean(filterAuthor);
            return cleanC.includes(cleanF) || cleanF.includes(cleanC);
          };
          if (!t.comments.some((c) => matchAuthor(c.user))) {
            return false;
          }
        }

        // 6. Text search
        if (searchText.trim()) {
          const query = searchText
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
          const matchText = (
            t.verseRef +
            ' ' +
            t.selectedText +
            ' ' +
            t.comments.map((c) => c.plainText).join(' ')
          )
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
          if (!matchText.includes(query)) return false;
        }

        return true;
      })
      .slice(0, settings.limitCount || 200);
  }, [threads, settings, filterBook, filterAuthor, searchText, currentUser]);

  const selectedThread = useMemo(() => {
    return threads.find((t) => t.threadId === selectedThreadId) || null;
  }, [threads, selectedThreadId]);

  const handleNavigateToVerse = (thread: ParatextNoteThread) => {
    papi.commands
      .sendCommand(
        'paratextProjectManager.navigateToVerse',
        projectId,
        thread.book,
        Number(thread.chapter),
        Number(thread.verse),
      )
      .catch((err) => {
        console.error('Failed to navigate to verse:', err);
      });
  };

  const noteQuoteSizeClass =
    settings.textSize === 'small'
      ? 'tw:text-[10px]'
      : settings.textSize === 'large'
        ? 'tw:text-xs'
        : settings.textSize === 'xlarge'
          ? 'tw:text-sm'
          : 'tw:text-[11px]';

  const detailedQuoteSizeClass =
    settings.textSize === 'small'
      ? 'tw:text-xs'
      : settings.textSize === 'large'
        ? 'tw:text-base'
        : settings.textSize === 'xlarge'
          ? 'tw:text-lg'
          : 'tw:text-sm';

  const inputSizeClass =
    settings.textSize === 'small'
      ? 'tw:text-[11px]'
      : settings.textSize === 'large'
        ? 'tw:text-sm'
        : settings.textSize === 'xlarge'
          ? 'tw:text-base'
          : 'tw:text-xs';

  return (
    <div className="tw:flex tw:flex-col tw:h-full tw:w-full tw:overflow-hidden tw:bg-slate-50 tw:text-sm">
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {/* Top Banner / User Picker */}
      <div className="tw:bg-white tw:border-b tw:border-gray-200 tw:px-4 tw:py-2.5 tw:flex tw:items-center tw:justify-between tw:shrink-0 tw:shadow-sm">
        <div className="tw:flex tw:items-center tw:gap-3">
          <span className="tw:font-bold tw:text-slate-800 tw:text-base tw:flex tw:items-center tw:gap-2">
            💬 Visor de Notas
          </span>
          {!loading && <div className="tw:h-4 tw:w-px tw:bg-gray-300 tw:hidden sm:tw:block"></div>}
          {!loading && (
            <div className="tw:text-xs">
              {currentUser && !showUserPicker ? (
                <div className="tw:flex tw:items-center tw:gap-1.5">
                  <span className="tw:text-gray-505">Usuario actual:</span>
                  <strong className="tw:text-slate-700 tw:bg-slate-100 tw:border tw:px-2 tw:py-0.5 tw:rounded tw:font-semibold">
                    {currentUser}
                  </strong>
                  <button
                    onClick={() => setShowUserPicker(true)}
                    className="tw:text-indigo-600 tw:hover:tw:text-indigo-800 tw:hover:tw:underline tw:text-xs tw:ml-1 tw:cursor-pointer"
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <div className="tw:flex tw:items-center tw:gap-2 tw:bg-amber-50 tw:border tw:border-amber-200 tw:px-2 tw:py-1 tw:rounded">
                  <span className="tw:text-amber-800 tw:font-medium">¿Quién eres?</span>
                  <select
                    onChange={(e) => handleSetUser(e.target.value)}
                    className="tw:border tw:rounded tw:px-1.5 tw:py-0.5 tw:bg-white tw:text-xs tw:text-slate-700 tw:focus:outline-none tw:focus:border-indigo-500"
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Selecciona tu nombre...
                    </option>
                    {teamMembers.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="tw:flex tw:items-center tw:gap-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`tw:px-2.5 tw:py-1 tw:text-xs tw:border tw:rounded-md tw:font-medium tw:hover:tw:bg-slate-50 tw:transition-colors tw:flex tw:items-center tw:gap-1 tw:cursor-pointer ${
              showSettings
                ? 'tw:bg-indigo-50 tw:border-indigo-200 tw:text-indigo-700'
                : 'tw:bg-white tw:text-slate-600 tw:border-slate-200'
            }`}
          >
            ⚙️ Ajustes
          </button>
          <button
            onClick={() => loadNotes(selectedThreadId)}
            disabled={loading}
            className="tw:p-1 tw:px-2.5 tw:text-xs tw:bg-slate-100 tw:hover:tw:bg-slate-200 tw:border tw:border-slate-200 tw:text-slate-700 tw:rounded-md tw:font-medium tw:transition-colors tw:cursor-pointer"
            title="Sincronizar / Actualizar"
          >
            {loading ? 'Sincronizando...' : '↻ Actualizar'}
          </button>
        </div>
      </div>

      {/* Settings Dropdown Panel */}
      {showSettings && (
        <div className="tw:bg-white tw:border-b tw:border-gray-200 tw:p-4 tw:shrink-0 tw:shadow-inner tw:grid tw:grid-cols-1 sm:tw:grid-cols-5 tw:gap-4 tw:text-xs">
          <div className="tw:space-y-1">
            <label className="tw:font-semibold tw:text-slate-600">Estado de lectura</label>
            <select
              value={settings.showMode}
              onChange={(e) => saveSettings({ showMode: e.target.value as any })}
              className="tw:w-full tw:border tw:border-gray-300 tw:rounded tw:px-2 tw:py-1 tw:bg-white"
            >
              <option value="all">Todas las notas</option>
              <option value="unread_only">Solo no leídas</option>
            </select>
          </div>
          <div className="tw:space-y-1">
            <label className="tw:font-semibold tw:text-slate-600">Ámbito de hilos</label>
            <select
              value={settings.scope}
              onChange={(e) => saveSettings({ scope: e.target.value as any })}
              className="tw:w-full tw:border tw:border-gray-300 tw:rounded tw:px-2 tw:py-1 tw:bg-white"
            >
              <option value="all">Todos los hilos</option>
              <option value="assigned_to_me">Asignados a mí</option>
              <option value="my_threads">Iniciados por mí</option>
            </select>
          </div>
          <div className="tw:space-y-1">
            <label className="tw:font-semibold tw:text-slate-600">Antigüedad máxima</label>
            <select
              value={settings.maxAgeDays}
              onChange={(e) => saveSettings({ maxAgeDays: Number(e.target.value) })}
              className="tw:w-full tw:border tw:border-gray-300 tw:rounded tw:px-2 tw:py-1 tw:bg-white"
            >
              <option value={0}>Sin límite</option>
              <option value={7}>Últimos 7 días</option>
              <option value={30}>Últimos 30 días</option>
              <option value={90}>Últimos 90 días</option>
            </select>
          </div>
          <div className="tw:space-y-1">
            <label className="tw:font-semibold tw:text-slate-600">Límite de hilos</label>
            <input
              type="number"
              min={5}
              max={200}
              value={settings.limitCount}
              onChange={(e) => saveSettings({ limitCount: Number(e.target.value) || 50 })}
              className="tw:w-full tw:border tw:border-gray-300 tw:rounded tw:px-2 tw:py-1 tw:bg-white"
            />
          </div>
          <div className="tw:space-y-1">
            <label className="tw:font-semibold tw:text-slate-600">Tamaño de letra</label>
            <select
              value={settings.textSize || 'medium'}
              onChange={(e) => saveSettings({ textSize: e.target.value as any })}
              className="tw:w-full tw:border tw:border-gray-300 tw:rounded tw:px-2 tw:py-1 tw:bg-white"
            >
              <option value="small">Pequeño</option>
              <option value="medium">Mediano</option>
              <option value="large">Grande</option>
              <option value="xlarge">Muy grande</option>
            </select>
          </div>
        </div>
      )}

      {/* Main Split-Pane View */}
      <div className="tw:flex-1 tw:flex tw:overflow-hidden tw:min-h-0">
        {/* Left Column: Thread List */}
        <div className="tw:w-80 md:tw:w-96 tw:border-r tw:border-gray-200 tw:bg-white tw:flex tw:flex-col tw:shrink-0 tw:min-w-0">
          {/* Quick Filters */}
          <div className="tw:p-3 tw:border-b tw:border-gray-100 tw:bg-slate-50/50 tw:space-y-2 tw:shrink-0">
            {/* Search Input */}
            <div className="tw:relative">
              <input
                type="text"
                placeholder="Buscar en notas..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="tw:w-full tw:border tw:border-gray-200 tw:rounded tw:px-2 tw:py-1 tw:text-xs tw:pr-6 tw:focus:outline-none tw:focus:border-indigo-400 tw:focus:ring-1 tw:focus:ring-indigo-100"
              />
              {searchText && (
                <button
                  onClick={() => setSearchText('')}
                  className="tw:absolute tw:right-2 tw:top-1/2 tw:-translate-y-1/2 tw:text-gray-400 tw:hover:tw:text-gray-600 tw:cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Book and Person Filters */}
            <div className="tw:grid tw:grid-cols-2 tw:gap-2">
              <div>
                <select
                  value={filterBook}
                  onChange={(e) => setFilterBook(e.target.value)}
                  className="tw:w-full tw:border tw:border-gray-200 tw:rounded tw:px-1.5 tw:py-1 tw:bg-white tw:text-[11px] tw:text-slate-700"
                >
                  <option value="all">Libro: Todos</option>
                  {BIBLE_BOOKS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <select
                  value={filterAuthor}
                  onChange={(e) => setFilterAuthor(e.target.value)}
                  className="tw:w-full tw:border tw:border-gray-200 tw:rounded tw:px-1.5 tw:py-1 tw:bg-white tw:text-[11px] tw:text-slate-700"
                >
                  <option value="all">Autor: Todos</option>
                  {teamMembers.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* List content */}
          <div className="tw:flex-1 tw:overflow-y-auto tw:divide-y tw:divide-gray-100">
            {loading && threads.length === 0 ? (
              <div className="tw:p-8 tw:text-center tw:text-slate-500 tw:text-xs">
                Cargando notas...
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="tw:p-8 tw:text-center tw:text-slate-500 tw:text-xs">
                No se encontraron hilos que coincidan con los filtros.
              </div>
            ) : (
              filteredThreads.map((thread) => {
                const isSelected = selectedThreadId === thread.threadId;
                const latestComment = thread.comments[thread.comments.length - 1];

                return (
                  <button
                    key={thread.threadId}
                    onClick={() => handleSelectThread(thread)}
                    className={`tw:w-full tw:text-left tw:p-3 tw:flex tw:flex-col tw:gap-1 tw:transition-all tw:cursor-pointer ${
                      isSelected
                        ? 'tw:bg-indigo-50/70 tw:border-l-4 tw:border-indigo-600'
                        : 'tw:hover:tw:bg-slate-50 tw:border-l-4 tw:border-transparent'
                    }`}
                  >
                    <div className="tw:flex tw:items-center tw:justify-between tw:gap-1 tw:w-full">
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNavigateToVerse(thread);
                        }}
                        className="tw:font-bold tw:text-xs tw:text-indigo-600 tw:hover:tw:text-indigo-850 tw:flex tw:items-center tw:gap-1 tw:cursor-pointer tw:hover:tw:underline"
                        title="Ir al versículo en Texto"
                      >
                        📖 {thread.book} {thread.chapter}:{thread.verse}
                      </span>
                      <span className="tw:text-[10px] tw:text-gray-400">
                        {new Date(thread.latestDate).toLocaleDateString('es', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </div>

                    {thread.selectedText && (
                      <div
                        className={`tw:italic tw:text-slate-500 tw:truncate tw:font-serif tw:pl-1 tw:border-l tw:border-gray-200 ${noteQuoteSizeClass}`}
                      >
                        "{thread.selectedText}"
                      </div>
                    )}

                    <div className="tw:text-xs tw:text-slate-600 tw:line-clamp-2 tw:mt-0.5">
                      <strong>{latestComment.user}:</strong> {latestComment.plainText}
                    </div>

                    <div className="tw:flex tw:gap-1.5 tw:items-center tw:mt-1">
                      <span className="tw:text-[9px] tw:bg-slate-100 tw:border tw:text-slate-600 tw:px-1 tw:py-0.2 tw:rounded">
                        💬 {thread.comments.length}
                      </span>
                      {thread.assignedUser && (
                        <span className="tw:text-[9px] tw:bg-blue-50 tw:text-blue-700 tw:px-1 tw:py-0.2 tw:rounded tw:font-medium">
                          👤 {thread.assignedUser}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Thread Detail */}
        <div className="tw:flex-1 tw:flex tw:flex-col tw:bg-slate-50 tw:min-w-0 tw:h-full tw:overflow-hidden">
          {selectedThread ? (
            <div className="tw:flex-1 tw:flex tw:flex-col tw:min-h-0 tw:h-full">
              {/* Thread Header */}
              <div className="tw:bg-white tw:border-b tw:border-gray-200 tw:p-4 tw:shrink-0 tw:shadow-sm tw:flex tw:flex-col sm:tw:flex-row sm:tw:items-center tw:justify-between tw:gap-3">
                <div>
                  <h2 className="tw:text-sm tw:font-bold tw:text-slate-800 tw:flex tw:items-center tw:gap-2">
                    📖 Referencia:{' '}
                    <span
                      onClick={() => handleNavigateToVerse(selectedThread)}
                      className="tw:text-indigo-600 tw:hover:tw:text-indigo-855 tw:hover:tw:underline tw:cursor-pointer tw:font-semibold tw:inline-flex tw:items-center tw:gap-1"
                      title="Ir al versículo en Texto"
                    >
                      {selectedThread.book} {selectedThread.chapter}:{selectedThread.verse}
                    </span>
                  </h2>
                  <p className="tw:text-[10px] tw:text-slate-400 tw:mt-0.5">
                    ID del hilo:{' '}
                    <code className="tw:bg-slate-100 tw:px-1 tw:rounded">
                      {selectedThread.threadId}
                    </code>
                  </p>
                </div>

                <div className="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
                  {selectedThread.assignedUser && (
                    <span className="tw:bg-blue-50 tw:text-blue-700 tw:border tw:border-blue-100 tw:px-2 tw:py-0.5 tw:rounded tw:text-xs tw:font-semibold">
                      Asignado a: {selectedThread.assignedUser}
                    </span>
                  )}
                  {selectedThread.isUnread ? (
                    <button
                      onClick={() => handleMarkRead(selectedThread)}
                      className="tw:px-2.5 tw:py-1 tw:bg-amber-100 tw:hover:tw:bg-amber-200 tw:text-amber-800 tw:border tw:border-amber-200 tw:rounded tw:text-xs tw:transition-colors tw:cursor-pointer"
                    >
                      ✓ Marcar como leída
                    </button>
                  ) : (
                    <span className="tw:text-gray-400 tw:text-xs tw:bg-slate-100 tw:border tw:border-slate-200 tw:px-2.5 tw:py-0.5 tw:rounded">
                      ✓ Leída
                    </span>
                  )}
                </div>
              </div>

              {/* Selected Text context if available */}
              {selectedThread.selectedText && (
                <div className="tw:bg-amber-50/30 tw:border-b tw:border-gray-200 tw:px-4 tw:py-3 tw:shrink-0">
                  <div className="tw:text-xs tw:text-amber-800 tw:font-semibold tw:mb-1 tw:uppercase tw:tracking-wider tw:text-[10px]">
                    Texto seleccionado en Paratext:
                  </div>
                  <blockquote
                    className={`tw:pl-3 tw:border-l-2 tw:border-amber-400 tw:italic tw:text-slate-700 tw:font-serif tw:leading-relaxed tw:bg-white tw:p-2 tw:rounded tw:shadow-sm ${detailedQuoteSizeClass}`}
                  >
                    "{selectedThread.selectedText}"
                  </blockquote>
                </div>
              )}

              {/* Comments Timeline */}
              <div ref={commentsTimelineRef} className="tw:flex-1 tw:overflow-y-auto tw:p-4 tw:space-y-4">
                <div className="tw:max-w-3xl tw:mx-auto tw:space-y-4">
                  {selectedThread.comments.map((comm, idx) => {
                    const isOwnComment = isMe(comm.user);
                    const isEditingThis =
                      editingComment !== null && editingComment.date === comm.date;

                    return (
                      <div
                        key={idx}
                        className={`tw:flex tw:flex-col tw:gap-1 tw:rounded-lg tw:border tw:shadow-sm tw:p-3.5 tw:transition-all tw:max-w-[85%] ${
                          isOwnComment
                            ? 'tw:ml-auto tw:bg-indigo-50/30 tw:border-indigo-100'
                            : 'tw:mr-auto tw:bg-white tw:border-slate-200'
                        }`}
                      >
                        {/* Comment Header */}
                        <div className="tw:flex tw:items-center tw:justify-between tw:gap-4 tw:text-[10px] tw:text-slate-400 tw:shrink-0 tw:border-b tw:border-slate-100/50 tw:pb-1.5 tw:mb-1.5">
                          <span className="tw:font-bold tw:text-slate-700">
                            {comm.user} {isOwnComment && '(Tú)'}
                          </span>
                          <div className="tw:flex tw:items-center tw:gap-2">
                            <span>
                              {new Date(comm.date).toLocaleString('es', {
                                year: '2-digit',
                                month: 'numeric',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            {isOwnComment && !isEditingThis && (
                              <div className="tw:flex tw:gap-2">
                                <button
                                  onClick={() =>
                                    setEditingComment({ date: comm.date, text: comm.plainText })
                                  }
                                  className="tw:text-indigo-600 tw:hover:tw:underline tw:hover:tw:text-indigo-800 tw:font-medium tw:cursor-pointer tw:bg-transparent tw:border-none tw:p-0"
                                >
                                  Editar
                                </button>
                                <button
                                  onClick={() =>
                                    handleDeleteComment(
                                      selectedThread.threadId,
                                      comm.date,
                                      comm.user,
                                    )
                                  }
                                  className="tw:text-red-500 tw:hover:tw:underline tw:hover:tw:text-red-700 tw:font-medium tw:cursor-pointer tw:bg-transparent tw:border-none tw:p-0"
                                >
                                  Eliminar
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Comment Body */}
                        {isEditingThis ? (
                          <div className="tw:space-y-2 tw:mt-1 tw:w-full">
                            <textarea
                              value={editingComment.text}
                              onChange={(e) =>
                                setEditingComment({ ...editingComment, text: e.target.value })
                              }
                              className={`tw:w-full tw:border tw:border-slate-300 tw:rounded tw:p-2 tw:focus:outline-none tw:focus:border-indigo-500 tw:focus:ring-1 tw:focus:ring-indigo-100 ${inputSizeClass}`}
                              rows={3}
                            />
                            <div className="tw:flex tw:justify-end tw:gap-2">
                              <button
                                onClick={() => setEditingComment(null)}
                                className="tw:px-2.5 tw:py-1 tw:bg-slate-100 tw:hover:tw:bg-slate-200 tw:rounded tw:border tw:border-slate-200 tw:text-xs tw:font-medium tw:cursor-pointer"
                                disabled={savingEdit}
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={() => handleSaveEdit(selectedThread.threadId)}
                                className="tw:px-2.5 tw:py-1 tw:bg-indigo-600 tw:hover:tw:bg-indigo-700 tw:text-white tw:rounded tw:text-xs tw:font-medium tw:transition-colors tw:cursor-pointer"
                                disabled={savingEdit}
                              >
                                {savingEdit ? 'Guardando...' : 'Guardar'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <CommentText
                            text={comm.plainText}
                            projectId={projectId}
                            textSize={settings.textSize || 'medium'}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Reply Box Section / Audio recording */}
              {isRecording ? (
                <div className="tw:bg-white tw:border-t tw:border-gray-200 tw:p-4 tw:shrink-0 tw:shadow-lg">
                  <div className="tw:max-w-3xl tw:mx-auto tw:flex tw:items-center tw:justify-between tw:gap-3 tw:bg-red-50/50 tw:p-3 tw:rounded-lg tw:border tw:border-red-100">
                    <span className="tw:text-red-600 tw:text-sm tw:flex tw:items-center tw:gap-2 tw:animate-pulse tw:font-medium">
                      <span className="tw:w-2.5 tw:h-2.5 tw:rounded-full tw:bg-red-600"></span>
                      Grabando nota de voz... ({formatDuration(recordDuration)})
                    </span>
                    <div className="tw:flex tw:gap-2">
                      <button
                        onClick={stopRecording}
                        className="tw:px-3.5 tw:py-1.5 tw:bg-green-600 tw:hover:tw:bg-green-700 tw:text-white tw:font-semibold tw:text-xs tw:rounded-md tw:shadow-sm tw:transition-colors tw:cursor-pointer"
                      >
                        Enviar nota
                      </button>
                      <button
                        onClick={cancelRecording}
                        className="tw:px-3.5 tw:py-1.5 tw:bg-gray-400 tw:hover:tw:bg-gray-500 tw:text-white tw:font-semibold tw:text-xs tw:rounded-md tw:shadow-sm tw:transition-colors tw:cursor-pointer"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="tw:bg-white tw:border-t tw:border-gray-200 tw:p-4 tw:shrink-0 tw:shadow-lg">
                  <div className="tw:max-w-3xl tw:mx-auto tw:flex tw:gap-2 tw:items-end">
                    <div className="tw:flex-1">
                      <textarea
                        placeholder={`Escribe una respuesta a ${selectedThread.latestUser}...`}
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleReply(selectedThread);
                          }
                        }}
                        rows={2}
                        className={`tw:w-full tw:border tw:border-gray-350 tw:rounded-lg tw:p-2 tw:focus:outline-none tw:focus:border-indigo-500 tw:focus:ring-1 tw:focus:ring-indigo-100 tw:resize-none ${inputSizeClass}`}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAttachClick}
                      disabled={replying || attaching || !currentUser}
                      className="tw:p-2 tw:bg-slate-100 tw:hover:tw:bg-slate-200 tw:text-slate-700 tw:border tw:border-slate-200 tw:rounded-lg tw:transition-colors tw:h-[38px] tw:flex tw:items-center tw:justify-center tw:w-[38px] tw:cursor-pointer"
                      title="Adjuntar archivo"
                    >
                      {attaching ? '⏳' : '📎'}
                    </button>
                    <button
                      type="button"
                      onClick={startRecording}
                      disabled={replying || attaching || !currentUser}
                      className="tw:p-2 tw:bg-slate-100 tw:hover:tw:bg-slate-200 tw:text-slate-700 tw:border tw:border-slate-200 tw:rounded-lg tw:transition-colors tw:h-[38px] tw:flex tw:items-center tw:justify-center tw:w-[38px] tw:cursor-pointer"
                      title="Grabar nota de voz"
                    >
                      🎙️
                    </button>
                    <button
                      onClick={() => handleReply(selectedThread)}
                      disabled={replying || attaching || !replyText.trim() || !currentUser}
                      className="tw:px-4 tw:py-2 tw:bg-indigo-600 tw:hover:tw:bg-indigo-700 tw:text-white tw:font-semibold tw:rounded-lg tw:text-xs tw:disabled:tw:opacity-40 tw:whitespace-nowrap tw:transition-all tw:shadow-sm tw:h-[38px] tw:cursor-pointer"
                    >
                      {replying ? 'Enviando...' : 'Responder'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="tw:flex-1 tw:flex tw:flex-col tw:items-center tw:justify-center tw:text-gray-400 tw:p-8 tw:text-center">
              <span className="tw:text-4xl tw:mb-2">💬</span>
              <p className="tw:text-sm">
                Selecciona una nota de la lista de la izquierda para ver su conversación.
              </p>
            </div>
          )}
        </div>
      </div>

      {commentToDelete && (
        <div className="tw:fixed tw:inset-0 tw:bg-black/50 tw:flex tw:items-center tw:justify-center tw:z-[9999] tw:backdrop-blur-sm">
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
