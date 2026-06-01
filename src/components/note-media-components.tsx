import papi from '@papi/frontend';
import { useState, useEffect } from 'react';

export function AudioPlayer({ projectId, filename }: { projectId: string; filename: string }) {
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

export function AttachmentViewer({ projectId, filename }: { projectId: string; filename: string }) {
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
