import papi from '@papi/frontend';
import React, { useState, useEffect, useRef } from 'react';
import { X, Upload, RefreshCw, Smile, Image as ImageIcon, FileText, Check } from 'lucide-react';
import { updateLocalAvatarCache, AvatarData } from './avatar';

interface AvatarSettingsModalProps {
  currentUser: string;
  onClose: () => void;
}

const CARTOON_STYLES = [
  { id: 'adventurer', name: 'Aventurero' },
  { id: 'bottts', name: 'Robots' },
  { id: 'pixel-art', name: 'Pixel Art' },
  { id: 'lorelei', name: 'Lorelei' },
  { id: 'avataaars', name: 'Personas' },
];

export function AvatarSettingsModal({ currentUser, onClose }: AvatarSettingsModalProps) {
  const [avatarType, setAvatarType] = useState<'initials' | 'upload' | 'cartoon'>('initials');
  const [uploadValue, setUploadValue] = useState<string>('');
  const [cartoonStyle, setCartoonStyle] = useState<string>('adventurer');
  const [cartoonSeed, setCartoonSeed] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>();

  // Load current avatar settings on mount
  useEffect(() => {
    const fetchCurrentSettings = async () => {
      try {
        const dataStr = await papi.commands.sendCommand('paratextProjectManager.getUserAvatars');
        if (dataStr) {
          const allAvatars: Record<string, AvatarData> = JSON.parse(dataStr);
          const userAvatar = allAvatars[currentUser];
          if (userAvatar) {
            setAvatarType(userAvatar.type);
            if (userAvatar.type === 'upload') {
              setUploadValue(userAvatar.value);
            } else if (userAvatar.type === 'cartoon') {
              const parts = userAvatar.value.split(':');
              setCartoonStyle(parts[0] || 'adventurer');
              setCartoonSeed(parts[1] || '');
            }
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to fetch user avatar config:', err);
      }
    };
    fetchCurrentSettings();
    // Default seed is username
    setCartoonSeed(currentUser);
  }, [currentUser]);

  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Por favor seleccione un archivo de imagen válido.');
      return;
    }
    // Limit to 15MB to prevent browser crashes on extremely huge files
    if (file.size > 15 * 1024 * 1024) {
      setErrorMsg('La imagen es demasiado grande. Por favor elija una imagen menor a 15MB.');
      return;
    }
    setErrorMsg('');

    const reader = new FileReader();
    reader.onload = (event) => {
      const originalResult = String(event.target?.result || '');
      if (!originalResult) return;

      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const size = 128; // 128x128 is perfect for small circular avatars
          canvas.width = size;
          canvas.height = size;

          const ctx = canvas.getContext('2d');
          if (ctx) {
            // Center crop to a square
            const minDim = Math.min(img.width, img.height);
            const sx = (img.width - minDim) / 2;
            const sy = (img.height - minDim) / 2;

            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

            // Compress to JPEG at 80% quality
            const compressed = canvas.toDataURL('image/jpeg', 0.8);
            setUploadValue(compressed);
          } else {
            setUploadValue(originalResult);
          }
        } catch (err) {
          setUploadValue(originalResult);
        }
      };
      img.onerror = () => {
        setErrorMsg('Error al procesar la imagen.');
      };
      img.src = originalResult;
    };
    reader.readAsDataURL(file);
  };

  // Handle image upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleRandomizeSeed = () => {
    const randomSeed = Math.random().toString(36).substring(2, 10);
    setCartoonSeed(randomSeed);
  };

  // Save selection
  const handleSave = async () => {
    setLoading(true);
    let value = '';
    if (avatarType === 'upload') {
      if (!uploadValue) {
        setErrorMsg('Por favor suba una imagen o cambie el tipo de avatar.');
        setLoading(false);
        return;
      }
      value = uploadValue;
    } else if (avatarType === 'cartoon') {
      value = `${cartoonStyle}:${cartoonSeed || currentUser}`;
    }

    const config: AvatarData = {
      type: avatarType,
      value,
    };

    try {
      const res = await papi.commands.sendCommand(
        'paratextProjectManager.saveUserAvatar',
        currentUser,
        JSON.stringify(config),
      );
      if (res === 'ok') {
        // Update local React cache immediately
        updateLocalAvatarCache(currentUser, config);
        onClose();
      } else {
        setErrorMsg(`Error al guardar: ${res}`);
      }
    } catch (err) {
      setErrorMsg(`Error de red al guardar avatar: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  // Helper to extract initials for preview
  const getInitials = (str: string) => {
    if (!str) return '?';
    const parts = str.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Live preview image source
  let previewContent: React.ReactNode = (
    <div className="tw:w-full tw:h-full tw:flex tw:items-center tw:justify-center tw:bg-slate-800 dark:tw:bg-slate-700 tw:text-white tw:text-2xl tw:font-semibold">
      {getInitials(currentUser)}
    </div>
  );

  if (avatarType === 'upload' && uploadValue) {
    previewContent = (
      <img src={uploadValue} alt="Preview" className="tw:w-full tw:h-full tw:object-cover" />
    );
  } else if (avatarType === 'cartoon') {
    const seed = cartoonSeed || currentUser;
    const url = `https://api.dicebear.com/7.x/${cartoonStyle}/svg?seed=${seed}`;
    previewContent = (
      <img src={url} alt="Preview" className="tw:w-full tw:h-full tw:object-cover" />
    );
  }

  return (
    <div className="tw:fixed tw:inset-0 tw:z-50 tw:flex tw:items-center tw:justify-center tw:bg-black/60 tw:backdrop-blur-sm tw:p-4">
      {/* Modal Card */}
      <div className="tw:bg-white dark:tw:bg-slate-900 tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:rounded-2xl tw:shadow-xl tw:max-w-md tw:w-full tw:overflow-hidden tw:flex tw:flex-col tw:animate-in tw:fade-in tw:zoom-in-95 tw:duration-200">
        {/* Header */}
        <div className="tw:px-5 tw:py-4 tw:border-b tw:border-slate-100 dark:tw:border-slate-800 tw:flex tw:items-center tw:justify-between">
          <h3 className="tw:text-lg tw:font-semibold tw:text-slate-950 dark:tw:text-slate-50">
            Configurar Avatar de {currentUser}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="tw:p-1.5 tw:rounded-lg tw:text-slate-400 hover:tw:text-slate-600 dark:hover:tw:text-slate-200 hover:tw:bg-slate-100 dark:hover:tw:bg-slate-800 tw:transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="tw:p-6 tw:space-y-6 tw:flex-1 tw:overflow-y-auto">
          {/* Live Preview Header */}
          <div className="tw:flex tw:flex-col tw:items-center tw:justify-center tw:space-y-2">
            <div className="tw:w-20 tw:h-20 tw:rounded-full tw:overflow-hidden tw:ring-4 tw:ring-indigo-500/20 tw:shadow-md">
              {previewContent}
            </div>
            <span className="tw:text-xs tw:text-slate-500">Vista previa en tiempo real</span>
          </div>

          {/* Selector Tabs */}
          <div className="tw:grid tw:grid-cols-3 tw:gap-1.5 tw:bg-slate-100 dark:tw:bg-slate-800/60 tw:p-1 tw:rounded-xl">
            <button
              type="button"
              onClick={() => setAvatarType('initials')}
              className={`tw:flex tw:items-center tw:justify-center tw:gap-1.5 tw:py-2 tw:text-xs tw:font-medium tw:rounded-lg tw:transition-all ${
                avatarType === 'initials'
                  ? 'tw:bg-white dark:tw:bg-slate-900 tw:text-indigo-600 dark:tw:text-indigo-400 tw:shadow-sm'
                  : 'tw:text-slate-500 dark:tw:text-slate-400 hover:tw:text-slate-800 dark:hover:tw:text-slate-200'
              }`}
            >
              <FileText size={14} />
              <span>Iniciales</span>
            </button>
            <button
              type="button"
              onClick={() => setAvatarType('upload')}
              className={`tw:flex tw:items-center tw:justify-center tw:gap-1.5 tw:py-2 tw:text-xs tw:font-medium tw:rounded-lg tw:transition-all ${
                avatarType === 'upload'
                  ? 'tw:bg-white dark:tw:bg-slate-900 tw:text-indigo-600 dark:tw:text-indigo-400 tw:shadow-sm'
                  : 'tw:text-slate-500 dark:tw:text-slate-400 hover:tw:text-slate-800 dark:hover:tw:text-slate-200'
              }`}
            >
              <ImageIcon size={14} />
              <span>Subir Foto</span>
            </button>
            <button
              type="button"
              onClick={() => setAvatarType('cartoon')}
              className={`tw:flex tw:items-center tw:justify-center tw:gap-1.5 tw:py-2 tw:text-xs tw:font-medium tw:rounded-lg tw:transition-all ${
                avatarType === 'cartoon'
                  ? 'tw:bg-white dark:tw:bg-slate-900 tw:text-indigo-600 dark:tw:text-indigo-400 tw:shadow-sm'
                  : 'tw:text-slate-500 dark:tw:text-slate-400 hover:tw:text-slate-800 dark:hover:tw:text-slate-200'
              }`}
            >
              <Smile size={14} />
              <span>Caricatura</span>
            </button>
          </div>

          {/* Option Panels */}
          {avatarType === 'initials' && (
            <div className="tw:text-center tw:py-6 tw:px-4 tw:bg-slate-50 dark:tw:bg-slate-800/30 tw:rounded-xl tw:border tw:border-slate-100 dark:tw:border-slate-800/80">
              <p className="tw:text-sm tw:text-slate-600 dark:tw:text-slate-400">
                Se generará automáticamente un avatar circular basado en las iniciales de su nombre:{' '}
                <strong className="tw:text-slate-800 dark:tw:text-slate-200">
                  {getInitials(currentUser)}
                </strong>
                .
              </p>
            </div>
          )}

          {avatarType === 'upload' && (
            <div className="tw:space-y-4">
              <div
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                role="button"
                tabIndex={0}
                className="tw:border-2 tw:border-dashed tw:border-slate-300 dark:tw:border-slate-700 hover:tw:border-indigo-500 dark:hover:tw:border-indigo-500 tw:bg-slate-50 dark:tw:bg-slate-800/30 hover:tw:bg-indigo-50/10 tw:rounded-xl tw:p-6 tw:text-center tw:cursor-pointer tw:transition-all tw:group focus:tw:outline-none focus:tw:ring-2 focus:tw:ring-indigo-500/35"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*"
                  className="tw:hidden"
                />
                <div className="tw:flex tw:flex-col tw:items-center tw:space-y-2">
                  <div className="tw:p-3 tw:rounded-full tw:bg-slate-100 dark:tw:bg-slate-800 group-hover:tw:bg-indigo-50 dark:group-hover:tw:bg-indigo-950/40 tw:transition-colors">
                    <Upload className="tw:w-6 tw:h-6 tw:text-slate-400 group-hover:tw:text-indigo-600" />
                  </div>
                  <p className="tw:text-sm tw:font-medium tw:text-slate-700 dark:tw:text-slate-300">
                    Arrastre su imagen aquí o haga clic para buscar
                  </p>
                  <p className="tw:text-xs tw:text-slate-500">
                    Formatos JPG, PNG, GIF. Máximo 1MB.
                  </p>
                </div>
              </div>

              {uploadValue && (
                <div className="tw:flex tw:items-center tw:justify-between tw:p-3 tw:bg-emerald-50/50 dark:tw:bg-emerald-950/20 tw:border tw:border-emerald-100 dark:tw:border-emerald-900/50 tw:rounded-xl">
                  <div className="tw:flex tw:items-center tw:gap-2 tw:text-xs tw:text-emerald-700 dark:tw:text-emerald-400">
                    <Check size={14} className="tw:stroke-2" />
                    <span>¡Imagen lista para guardar!</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUploadValue('')}
                    className="tw:text-xs tw:text-rose-600 hover:tw:underline tw:font-medium"
                  >
                    Eliminar
                  </button>
                </div>
              )}
            </div>
          )}

          {avatarType === 'cartoon' && (
            <div className="tw:space-y-4">
              {/* Style Selection */}
              <div className="tw:space-y-1.5">
                <div className="tw:text-xs tw:font-semibold tw:text-slate-500">
                  Estilo de Caricatura
                </div>
                <div className="tw:grid tw:grid-cols-2 tw:gap-2">
                  {CARTOON_STYLES.map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => setCartoonStyle(style.id)}
                      className={`tw:py-2.5 tw:px-3.5 tw:text-xs tw:font-medium tw:rounded-xl tw:text-left tw:border tw:transition-all ${
                        cartoonStyle === style.id
                          ? 'tw:bg-indigo-50 dark:tw:bg-indigo-950/20 tw:border-indigo-500 tw:text-indigo-700 dark:tw:text-indigo-400 tw:font-semibold'
                          : 'tw:bg-white dark:tw:bg-slate-900 tw:border-slate-200 dark:tw:border-slate-800 tw:text-slate-700 dark:tw:text-slate-300 hover:tw:bg-slate-50 dark:hover:tw:bg-slate-800'
                      }`}
                    >
                      {style.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Seed Selection */}
              <div className="tw:space-y-1.5">
                <label
                  htmlFor="cartoon-seed-input"
                  className="tw:text-xs tw:font-semibold tw:text-slate-500"
                >
                  Semilla del Personaje (Seed)
                </label>
                <div className="tw:flex tw:gap-2">
                  <input
                    id="cartoon-seed-input"
                    type="text"
                    value={cartoonSeed}
                    onChange={(e) => setCartoonSeed(e.target.value)}
                    placeholder="Escriba algo para cambiar detalles..."
                    className="tw:flex-1 tw:py-2 tw:px-3 tw:text-sm tw:rounded-xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:bg-white dark:tw:bg-slate-900 focus:tw:outline-none focus:tw:ring-2 focus:tw:ring-indigo-500/20 focus:tw:border-indigo-500 tw:transition-all"
                  />
                  <button
                    type="button"
                    onClick={handleRandomizeSeed}
                    title="Aleatorizar"
                    className="tw:px-3.5 tw:rounded-xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:bg-slate-50 dark:tw:bg-slate-800 hover:tw:bg-slate-100 dark:hover:tw:bg-slate-700 tw:flex tw:items-center tw:justify-center tw:transition-colors"
                  >
                    <RefreshCw size={14} className="tw:text-slate-500" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="tw:p-3 tw:text-xs tw:text-rose-600 dark:tw:text-rose-400 tw:bg-rose-50 dark:tw:bg-rose-950/20 tw:border tw:border-rose-100 dark:tw:border-rose-900/50 tw:rounded-xl">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="tw:px-5 tw:py-4 tw:bg-slate-50 dark:tw:bg-slate-800/40 tw:border-t tw:border-slate-100 dark:tw:border-slate-800 tw:flex tw:items-center tw:justify-end tw:gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="tw:px-4 tw:py-2 tw:text-xs tw:font-semibold tw:rounded-lg tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:text-slate-700 dark:tw:text-slate-300 hover:tw:bg-slate-100 dark:hover:tw:bg-slate-800 disabled:tw:opacity-50 tw:transition-all"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="tw:px-4 tw:py-2 tw:text-xs tw:font-semibold tw:rounded-lg tw:bg-indigo-600 hover:tw:bg-indigo-700 active:tw:bg-indigo-800 tw:text-white tw:shadow-sm disabled:tw:opacity-50 disabled:tw:cursor-not-allowed tw:flex tw:items-center tw:gap-1.5 tw:transition-all"
          >
            {loading ? (
              <>
                <RefreshCw size={12} className="tw:animate-spin" />
                <span>Guardando...</span>
              </>
            ) : (
              <span>Guardar</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
