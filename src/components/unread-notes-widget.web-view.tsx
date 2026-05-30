import { useState, useEffect, useCallback, useRef } from 'react';
import papi from '@papi/frontend';
import type { ParatextNoteThread, NotesDisplaySettings } from '../types/note.types';
import { DEFAULT_NOTES_SETTINGS } from '../types/note.types';

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
            <div className="tw:absolute tw:inset-0 tw:bg-black/10 tw:opacity-0 tw:group-tw:hover:opacity-100 tw:transition tw:flex tw:items-center tw:justify-center tw:text-white tw:text-[10px] tw:font-semibold tw:backdrop-blur-[1px]">
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
    cardColor = 'tw:bg-red-50/50 tw:border-red-200 tw:hover:bg-red-50';
  } else if (['doc', 'docx'].includes(ext)) {
    fileIcon = '📘';
    cardColor = 'tw:bg-blue-50/50 tw:border-blue-200 tw:hover:bg-blue-50';
  } else if (['xls', 'xlsx'].includes(ext)) {
    fileIcon = '📗';
    cardColor = 'tw:bg-emerald-50/50 tw:border-emerald-200 tw:hover:bg-emerald-55';
  } else if (ext === 'txt') {
    fileIcon = '📝';
    cardColor = 'tw:bg-amber-50/50 tw:border-amber-200 tw:hover:bg-amber-50';
  }

  // Remove the timestamp prefix att_12345678_ from the displayed name
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
        className="tw:px-2.5 tw:py-1 tw:bg-white tw:hover:bg-slate-50 tw:border tw:border-slate-300 tw:rounded tw:text-[10px] tw:font-semibold tw:text-slate-700 tw:shadow-sm tw:transition tw:whitespace-nowrap tw:cursor-pointer"
      >
        Abrir
      </button>
    </div>
  );
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
  // Strip out audio play links: "Escuchar audio: ..." (either localhost or drive.google.com)
  let cleanText = text.replace(
    /\s*Escuchar audio:\s*(https:\/\/drive\.google\.com\/\S*|http:\/\/localhost:\d+\/play\S*)/g,
    '',
  );
  // Strip out attachment links: "Ver archivo: ..." (either localhost or drive.google.com)
  cleanText = cleanText.replace(
    /\s*Ver archivo:\s*(https:\/\/drive\.google\.com\/\S*|http:\/\/localhost:\d+\/attachment\S*)/g,
    '',
  );

  const audioRegex = /\[Audio:\s*([^\]]+)\]/g;
  const attachmentRegex = /\[Attachment:\s*([^\]]+)\]/g;

  const elements: { index: number; length: number; node: React.ReactNode }[] = [];
  let match;

  // Audio matches
  while ((match = audioRegex.exec(cleanText)) !== null) {
    const filename = match[1].trim();
    elements.push({
      index: match.index,
      length: match[0].length,
      node: <AudioPlayer key={`audio-${match.index}`} projectId={projectId} filename={filename} />,
    });
  }

  // Attachment matches
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

  // Sort matches by index
  elements.sort((a, b) => a.index - b.index);

  const parts = [];
  let lastIndex = 0;

  for (const el of elements) {
    if (el.index > lastIndex) {
      parts.push(<span key={`text-${lastIndex}`}>{cleanText.substring(lastIndex, el.index)}</span>);
    }
    parts.push(el.node);
    lastIndex = el.index + el.length;
  }

  if (lastIndex < cleanText.length) {
    parts.push(<span key={`text-${lastIndex}`}>{cleanText.substring(lastIndex)}</span>);
  }

  const sizeClass =
    textSize === 'small'
      ? 'tw:text-[11px]'
      : textSize === 'large'
        ? 'tw:text-sm'
        : textSize === 'xlarge'
          ? 'tw:text-base'
          : 'tw:text-xs';

  return (
    <div
      className={`tw:text-gray-700 tw:leading-relaxed tw:whitespace-pre-wrap tw:break-words ${sizeClass}`}
    >
      {parts.length > 0 ? parts : cleanText}
    </div>
  );
}

interface UnreadNotesWidgetProps {
  projectId: string;
  currentUser: string;
  onRefreshTrigger?: () => void;
}

export default function UnreadNotesWidget({
  projectId,
  currentUser,
  onRefreshTrigger,
}: UnreadNotesWidgetProps) {
  const [threads, setThreads] = useState<ParatextNoteThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<NotesDisplaySettings>(DEFAULT_NOTES_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);

  // Form states per thread ID
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({});
  const [replying, setReplying] = useState<Record<string, boolean>>({});
  const [editingComment, setEditingComment] = useState<{
    threadId: string;
    date: string;
    text: string;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [commentToDelete, setCommentToDelete] = useState<{
    threadId: string;
    commentDate: string;
    commentAuthor: string;
  } | null>(null);

  // File attachments state & inputs
  const [attachingThreadId, setAttachingThreadId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Expandability
  const [isExpanded, setIsExpanded] = useState(
    () => localStorage.getItem('notes_widget_expanded') === 'true',
  );

  const toggleExpand = () => {
    const next = !isExpanded;
    setIsExpanded(next);
    localStorage.setItem('notes_widget_expanded', String(next));
  };

  // Voice recording states
  const [recordingThreadId, setRecordingThreadId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [recordDuration, setRecordDuration] = useState(0);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startRecording = async (threadId: string) => {
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
            const currentThread = threads.find((t) => t.threadId === threadId);
            if (!currentThread) return;
            const audioLink =
              saveRes.driveUrl ||
              `http://localhost:49876/play?project=${projectId}&file=${filename}`;
            const replyData = {
              threadId: threadId,
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
              await loadNotes();
              if (onRefreshTrigger) onRefreshTrigger();
            } else {
              alert(`Error al enviar respuesta de audio: ${res}`);
            }
          } else {
            const errMsg = saveRes && saveRes.error ? saveRes.error : JSON.stringify(saveRes);
            alert(`Error al guardar audio: ${errMsg}`);
          }
        };
      };

      recorder.start();
      setMediaRecorder(recorder);
      setRecordingThreadId(threadId);
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
    setRecordingThreadId(null);
    setMediaRecorder(null);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

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
        await loadNotes();
        if (onRefreshTrigger) onRefreshTrigger();
      } else {
        console.error(`Error al eliminar comentario: ${res}`);
      }
    } catch (e) {
      console.error(`Error al eliminar comentario: ${e}`);
    }
  };

  // Load user settings
  const loadSettings = useCallback(async () => {
    if (!currentUser) return;
    try {
      const res = await papi.commands.sendCommand(
        'paratextProjectManager.getNotesSettings',
        currentUser,
      );
      if (res) {
        setSettings(JSON.parse(res) as NotesDisplaySettings);
      } else {
        setSettings(DEFAULT_NOTES_SETTINGS);
      }
    } catch (_) {
      setSettings(DEFAULT_NOTES_SETTINGS);
    }
  }, [currentUser]);

  // Save user settings
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

  // Trigger local file selection using hidden input
  const handleAttachClick = (threadId: string) => {
    setAttachingThreadId(threadId);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const threadId = attachingThreadId;
    if (!threadId || !e.target.files || e.target.files.length === 0) {
      setAttachingThreadId(null);
      return;
    }

    const file = e.target.files[0];
    const currentThread = threads.find((t) => t.threadId === threadId);
    if (!currentThread) {
      setAttachingThreadId(null);
      return;
    }

    setReplying((prev) => ({ ...prev, [threadId]: true }));
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
              await loadNotes();
              if (onRefreshTrigger) onRefreshTrigger();
            } else {
              alert(`Error al enviar adjunto: ${res}`);
            }
          } else {
            const errMsg = saveRes && saveRes.error ? saveRes.error : JSON.stringify(saveRes);
            alert(`Error al guardar archivo adjunto: ${errMsg}`);
          }
        } catch (err) {
          alert(`Error al guardar adjunto: ${err}`);
        } finally {
          setReplying((prev) => ({ ...prev, [threadId]: false }));
          setAttachingThreadId(null);
          e.target.value = ''; // Reset input
        }
      };
    } catch (err) {
      alert(`Error al leer archivo adjunto: ${err}`);
      setReplying((prev) => ({ ...prev, [threadId]: false }));
      setAttachingThreadId(null);
    }
  };

  // Load threads
  const loadNotes = useCallback(async () => {
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
      setThreads(parsed.threads || []);
    } catch (e) {
      setError(`Error al cargar notas: ${e}`);
    } finally {
      setLoading(false);
    }
  }, [projectId, currentUser]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (projectId && currentUser) {
      loadNotes();
    }
  }, [projectId, currentUser, loadNotes]);

  // Helper: check if a name matches currentUser
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

  // Apply dashboard settings filtering
  const filteredThreads = threads
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

      // 4. Persons filter
      if (settings.persons.length > 0) {
        if (
          !settings.persons.some((p) => isMe(t.latestUser) || t.comments.some((c) => isMe(c.user)))
        ) {
          return false;
        }
      }

      return true;
    })
    .slice(0, settings.limitCount);

  // Reply handler
  const handleReply = async (thread: ParatextNoteThread) => {
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
        if (onRefreshTrigger) onRefreshTrigger();
      } else {
        alert(`Error al enviar respuesta: ${res}`);
      }
    } catch (e) {
      alert(`Error al enviar respuesta: ${e}`);
    } finally {
      setReplying((prev) => ({ ...prev, [thread.threadId]: false }));
    }
  };

  // Mark read handler
  const handleMarkRead = async (thread: ParatextNoteThread) => {
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

  // Edit comment handler
  const handleSaveEdit = async () => {
    if (!editingComment) return;
    setSavingEdit(true);
    try {
      const res = await papi.commands.sendCommand(
        'paratextProjectManager.saveProjectNote',
        projectId,
        currentUser,
        editingComment.threadId,
        editingComment.date,
        editingComment.text,
      );
      if (res === 'ok') {
        setEditingComment(null);
        await loadNotes();
      } else {
        alert(`Error al guardar edición: ${res}`);
      }
    } catch (e) {
      alert(`Error al guardar edición: ${e}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleNavigateToVerse = async (thread: ParatextNoteThread) => {
    try {
      await papi.commands.sendCommand(
        'paratextProjectManager.navigateToVerse',
        projectId,
        thread.book,
        Number(thread.chapter),
        Number(thread.verse),
      );
    } catch (err) {
      console.error('Failed to navigate to verse:', err);
    }
  };

  return (
    <div className="tw:bg-white tw:rounded-lg tw:shadow-sm tw:border tw:border-gray-200 tw:overflow-hidden">
      {/* Hidden file input for attachments */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {/* Title / Header */}
      <div className="tw:px-3 tw:py-2 tw:bg-slate-50 tw:border-b tw:flex tw:items-center tw:justify-between">
        <span className="tw:font-semibold tw:text-slate-700 tw:flex tw:items-center tw:gap-1.5 tw:text-xs tw:uppercase tw:tracking-wider">
          💬 Notas de Paratext ({threads.filter((t) => t.isUnread).length} no leídas)
        </span>
        <div className="tw:flex tw:gap-2">
          <button
            onClick={toggleExpand}
            className="tw:p-1 tw:rounded tw:hover:bg-slate-200 tw:transition-colors tw:text-xs tw:font-medium tw:cursor-pointer"
            title={isExpanded ? 'Contraer vista' : 'Expandir vista'}
          >
            {isExpanded ? '🔍 Contraer' : '🔍 Expandir'}
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`tw:p-1 tw:rounded tw:hover:bg-slate-200 tw:transition-colors tw:text-xs tw:cursor-pointer ${showSettings ? 'tw:bg-slate-200' : ''}`}
            title="Configurar visualización"
          >
            ⚙️ Configurar
          </button>
          <button
            onClick={loadNotes}
            className="tw:p-1 tw:rounded tw:hover:bg-slate-200 tw:transition-colors tw:text-xs tw:cursor-pointer"
            title="Actualizar notas"
            disabled={loading}
          >
            {loading ? '⟳' : '↻'}
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="tw:p-3 tw:bg-slate-50 tw:border-b tw:text-xs tw:space-y-2.5">
          <div className="tw:grid tw:grid-cols-2 tw:gap-2">
            <div>
              <label className="tw:block tw:text-gray-500 tw:mb-0.5">Mostrar</label>
              <select
                value={settings.showMode}
                onChange={(e) => saveSettings({ showMode: e.target.value as any })}
                className="tw:w-full tw:border tw:rounded tw:px-1.5 tw:py-0.5 tw:bg-white"
              >
                <option value="unread_only">Solo no leídas</option>
                <option value="all">Todas las notas</option>
              </select>
            </div>
            <div>
              <label className="tw:block tw:text-gray-500 tw:mb-0.5">Filtro de hilos</label>
              <select
                value={settings.scope}
                onChange={(e) => saveSettings({ scope: e.target.value as any })}
                className="tw:w-full tw:border tw:rounded tw:px-1.5 tw:py-0.5 tw:bg-white"
              >
                <option value="all">Todos los hilos</option>
                <option value="assigned_to_me">Asignados a mí</option>
                <option value="my_threads">Iniciados por mí</option>
              </select>
            </div>
          </div>
          <div className="tw:grid tw:grid-cols-2 tw:gap-2">
            <div>
              <label className="tw:block tw:text-gray-500 tw:mb-0.5">Límite a mostrar</label>
              <input
                type="number"
                min={1}
                max={50}
                value={settings.limitCount}
                onChange={(e) => saveSettings({ limitCount: Number(e.target.value) || 5 })}
                className="tw:w-full tw:border tw:rounded tw:px-1.5 tw:py-0.5 tw:bg-white"
              />
            </div>
            <div>
              <label className="tw:block tw:text-gray-500 tw:mb-0.5">Antigüedad máxima</label>
              <select
                value={settings.maxAgeDays}
                onChange={(e) => saveSettings({ maxAgeDays: Number(e.target.value) })}
                className="tw:w-full tw:border tw:rounded tw:px-1.5 tw:py-0.5 tw:bg-white"
              >
                <option value={7}>Últimos 7 días</option>
                <option value={30}>Últimos 30 días</option>
                <option value={90}>Últimos 90 días</option>
                <option value={0}>Sin límite</option>
              </select>
            </div>
          </div>
          <div className="tw:grid tw:grid-cols-2 tw:gap-2">
            <div>
              <label className="tw:block tw:text-gray-500 tw:mb-0.5">Tamaño de letra</label>
              <select
                value={settings.textSize || 'medium'}
                onChange={(e) => saveSettings({ textSize: e.target.value as any })}
                className="tw:w-full tw:border tw:rounded tw:px-1.5 tw:py-0.5 tw:bg-white"
              >
                <option value="small">Pequeño</option>
                <option value="medium">Mediano</option>
                <option value="large">Grande</option>
                <option value="xlarge">Muy grande</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="tw:p-3 tw:text-red-600 tw:bg-red-50 tw:text-xs tw:border-b">{error}</div>
      )}

      {/* Note List */}
      <div
        className={`tw:divide-y tw:divide-gray-100 tw:overflow-y-auto tw:transition-all ${isExpanded ? 'tw:max-h-[650px]' : 'tw:max-h-[300px]'}`}
      >
        {loading && threads.length === 0 ? (
          <div className="tw:p-8 tw:text-center tw:text-slate-500 tw:text-xs">Cargando notas...</div>
        ) : filteredThreads.length === 0 ? (
          <div className="tw:p-8 tw:text-center tw:text-slate-500 tw:text-xs">
            {settings.showMode === 'unread_only'
              ? 'No hay notas nuevas pendientes.'
              : 'No se encontraron notas.'}
          </div>
        ) : (
          filteredThreads.map((thread) => {
            const latestComment = thread.comments[thread.comments.length - 1];

            return (
              <div
                key={thread.threadId}
                className={`tw:p-3 tw:space-y-2 tw:text-xs tw:transition-colors ${thread.isUnread ? 'tw:bg-amber-50/40' : 'tw:bg-white'}`}
              >
                {/* Header line */}
                <div className="tw:flex tw:items-start tw:justify-between tw:gap-1 tw:flex-wrap">
                  <div className="tw:flex tw:items-center tw:gap-1.5 tw:flex-wrap">
                    <button
                      onClick={() => handleNavigateToVerse(thread)}
                      className="tw:font-bold tw:text-slate-800 tw:bg-slate-100 tw:border tw:px-1.5 tw:py-0.5 tw:rounded tw:hover:bg-slate-200 tw:transition tw:cursor-pointer"
                      title="Ir al versículo en Texto"
                    >
                      📖 {thread.book} {thread.chapter}:{thread.verse}
                    </button>
                    {thread.assignedUser && (
                      <span className="tw:bg-blue-50 tw:text-blue-700 tw:px-1 tw:py-0.5 tw:rounded tw:text-[10px]">
                        Asignado: {thread.assignedUser}
                      </span>
                    )}
                  </div>

                  {/* Mark as read button */}
                  {thread.isUnread && (
                    <button
                      onClick={() => handleMarkRead(thread)}
                      className="tw:px-2 tw:py-0.5 tw:bg-amber-100 tw:hover:bg-amber-200 tw:text-amber-800 tw:border tw:border-amber-200 tw:rounded tw:text-[10px] tw:cursor-pointer"
                      title="Marcar como leída"
                    >
                      ✓ Marcar como leída
                    </button>
                  )}
                </div>

                {/* Selected text quote */}
                {thread.selectedText && (
                  <div
                    className={`tw:pl-2 tw:border-l-2 tw:border-slate-300 tw:italic tw:text-gray-500 tw:font-serif ${
                      settings.textSize === 'small'
                        ? 'tw:text-[10px]'
                        : settings.textSize === 'large'
                          ? 'tw:text-xs'
                          : settings.textSize === 'xlarge'
                            ? 'tw:text-sm'
                            : 'tw:text-[11px]'
                    }`}
                  >
                    "{thread.selectedText}"
                  </div>
                )}

                {/* Comments trail */}
                <div className="tw:space-y-2 tw:pl-1.5 tw:mt-1 tw:border-l tw:border-gray-100">
                  {thread.comments.map((comm, idx) => {
                    const isOwnComment = isMe(comm.user);
                    const isEditingThis =
                      editingComment?.threadId === thread.threadId &&
                      editingComment?.date === comm.date;

                    return (
                      <div key={idx} className="tw:space-y-0.5">
                        <div className="tw:flex tw:items-center tw:justify-between tw:text-[10px] tw:text-gray-400">
                          <span>
                            <strong>{comm.user}</strong> •{' '}
                            {new Date(comm.date).toLocaleDateString('es', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          {isOwnComment && !isEditingThis && (
                            <div className="tw:flex tw:gap-2">
                              <button
                                onClick={() =>
                                  setEditingComment({
                                    threadId: thread.threadId,
                                    date: comm.date,
                                    text: comm.plainText,
                                  })
                                }
                                className="tw:text-slate-500 tw:hover:underline tw:hover:text-slate-700 tw:cursor-pointer tw:bg-transparent tw:border-none tw:p-0"
                              >
                                Editar
                              </button>
                              <button
                                onClick={() =>
                                  handleDeleteComment(thread.threadId, comm.date, comm.user)
                                }
                                className="tw:text-red-500 tw:hover:underline tw:hover:text-red-700 tw:cursor-pointer tw:bg-transparent tw:border-none tw:p-0"
                              >
                                Eliminar
                              </button>
                            </div>
                          )}
                        </div>

                        {isEditingThis ? (
                          <div className="tw:space-y-1 tw:mt-1 tw:bg-gray-50 tw:p-1.5 tw:rounded tw:border tw:border-gray-200">
                            <textarea
                              value={editingComment!.text}
                              onChange={(e) =>
                                setEditingComment((prev) =>
                                  prev ? { ...prev, text: e.target.value } : null,
                                )
                              }
                              className="tw:w-full tw:border tw:rounded tw:p-1 tw:text-xs tw:focus:outline-none tw:focus:border-slate-400"
                              rows={2}
                            />
                            <div className="tw:flex tw:justify-end tw:gap-1.5">
                              <button
                                onClick={() => setEditingComment(null)}
                                className="tw:px-2 tw:py-0.5 tw:bg-gray-200 tw:hover:bg-gray-300 tw:rounded tw:text-[10px] tw:cursor-pointer"
                                disabled={savingEdit}
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={handleSaveEdit}
                                className="tw:px-2 tw:py-0.5 tw:bg-slate-600 tw:hover:bg-slate-700 tw:text-white tw:rounded tw:text-[10px] tw:cursor-pointer"
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

                {/* Reply box / Audio recording */}
                {isRecording && recordingThreadId === thread.threadId ? (
                  <div className="tw:mt-2 tw:flex tw:items-center tw:justify-between tw:gap-2 tw:pt-1.5 tw:border-t tw:border-gray-50 tw:bg-red-50/50 tw:p-1.5 tw:rounded tw:border tw:border-red-100">
                    <span className="tw:text-red-600 tw:text-xs tw:flex tw:items-center tw:gap-1.5 tw:animate-pulse tw:font-medium">
                      <span className="tw:w-2 tw:h-2 tw:rounded-full tw:bg-red-600"></span>
                      Grabando... ({formatDuration(recordDuration)})
                    </span>
                    <div className="tw:flex tw:gap-1.5">
                      <button
                        onClick={stopRecording}
                        className="tw:px-2 tw:py-0.5 tw:bg-green-600 tw:hover:bg-green-700 tw:text-white tw:font-medium tw:text-[10px] tw:rounded tw:transition-colors tw:cursor-pointer"
                      >
                        Enviar
                      </button>
                      <button
                        onClick={cancelRecording}
                        className="tw:px-2 tw:py-0.5 tw:bg-gray-400 tw:hover:bg-gray-500 tw:text-white tw:font-medium tw:text-[10px] tw:rounded tw:transition-colors tw:cursor-pointer"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="tw:mt-2 tw:pt-1.5 tw:border-t tw:border-gray-50">
                    <div className="tw:flex tw:gap-1.5 tw:items-center">
                      <input
                        type="text"
                        value={replyTexts[thread.threadId] || ''}
                        onChange={(e) =>
                          setReplyTexts((prev) => ({ ...prev, [thread.threadId]: e.target.value }))
                        }
                        placeholder={`Responder a ${latestComment.user}...`}
                        className="tw:flex-1 tw:border tw:border-gray-200 tw:rounded tw:px-2 tw:py-0.5 tw:text-xs tw:focus:outline-none tw:focus:border-slate-400"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleReply(thread);
                          }
                        }}
                        disabled={
                          isRecording || replying[thread.threadId] || attachingThreadId !== null
                        }
                      />
                      <button
                        type="button"
                        onClick={() => handleAttachClick(thread.threadId)}
                        disabled={
                          isRecording || replying[thread.threadId] || attachingThreadId !== null
                        }
                        className="tw:p-1 tw:text-xs tw:bg-slate-100 tw:hover:bg-slate-200 tw:text-slate-700 tw:border tw:border-slate-200 tw:rounded tw:transition-colors tw:cursor-pointer"
                        title="Adjuntar archivo"
                      >
                        {attachingThreadId === thread.threadId ? '⏳' : '📎'}
                      </button>
                      <button
                        type="button"
                        onClick={() => startRecording(thread.threadId)}
                        disabled={
                          isRecording || replying[thread.threadId] || attachingThreadId !== null
                        }
                        className="tw:p-1 tw:text-xs tw:bg-slate-100 tw:hover:bg-slate-200 tw:text-slate-700 tw:border tw:border-slate-200 tw:rounded tw:transition-colors tw:cursor-pointer"
                        title="Grabar nota de voz"
                      >
                        🎙️
                      </button>
                      <button
                        onClick={() => handleReply(thread)}
                        disabled={
                          replying[thread.threadId] ||
                          !replyTexts[thread.threadId]?.trim() ||
                          isRecording ||
                          attachingThreadId !== null
                        }
                        className="tw:px-2.5 tw:py-0.5 tw:bg-slate-600 tw:hover:bg-slate-700 tw:text-white tw:font-semibold tw:rounded tw:text-[10px] tw:disabled:opacity-40 tw:whitespace-nowrap tw:transition-colors tw:cursor-pointer"
                      >
                        {replying[thread.threadId] ? 'Enviando...' : 'Responder'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
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
}
