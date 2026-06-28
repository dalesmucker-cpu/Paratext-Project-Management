import papi from '@papi/frontend';
import React, { useState, useEffect, useCallback } from 'react';
import { Avatar } from './avatar';

interface CollabSettingsModalProps {
  projectId: string;
  currentUser: string;
  onClose: () => void;
}

export function CollabSettingsModal({ projectId, currentUser, onClose }: CollabSettingsModalProps) {
  const [collabRole, setCollabRole] = useState<'host' | 'client' | 'none'>('none');
  const [collabType, setCollabType] = useState<'local' | 'online'>('local');
  const [collabRoomId, setCollabRoomId] = useState('');
  const [collabServerUrl, setCollabServerUrl] = useState('wss://paratext-pm-collab.onrender.com');
  const [collabUsername, setCollabUsername] = useState(currentUser || 'Usuario');
  const [collabPort, setCollabPort] = useState(49885);
  const [collabHostIp, setCollabHostIp] = useState('127.0.0.1');
  const [collabActiveUsers, setCollabActiveUsers] = useState<string[]>([]);
  const [collabIps, setCollabIps] = useState<string[]>([]);
  const [collabStatusMsg, setCollabStatusMsg] = useState('');
  const [collabErrorMsg, setCollabErrorMsg] = useState('');
  const [collabConnecting, setCollabConnecting] = useState(false);

  // Load status
  const loadCollabStatus = useCallback(async () => {
    try {
      const status: any = await papi.commands.sendCommand('paratextProjectManager.getCollabStatus');
      if (status) {
        setCollabRole(status.role || 'none');
        setCollabType(status.type || 'local');
        setCollabPort(status.port || 49885);
        setCollabHostIp(status.hostIp || '127.0.0.1');
        setCollabActiveUsers(status.activeUsers || []);
        setCollabIps(status.ips || []);
        if (status.roomId) setCollabRoomId(status.roomId);
        if (status.serverUrl) setCollabServerUrl(status.serverUrl);
        if (status.username) setCollabUsername(status.username);
      }
    } catch (e) {
      console.error('[CollabSettingsModal] Failed to load status:', e);
    }
  }, []);

  // Listen to collaboration events to sync status
  useEffect(() => {
    loadCollabStatus();
    if (!projectId) return;
    const cleanRoomId = `PM-${projectId.substring(0, 8).toUpperCase()}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
    setCollabRoomId((prev) => prev || cleanRoomId);

    let unsubEvent: any;
    try {
      unsubEvent = papi.network.getNetworkEvent<any>('paratextProjectManager.onCollabEvent')(
        (event: any) => {
          if (!event) return;
          const { type } = event;
          if (type === 'status_update' || type === 'user_changed') {
            loadCollabStatus();
          }
        },
      );
    } catch (e) {
      console.error('[CollabSettingsModal] Event subscription failed:', e);
    }

    return () => {
      if (unsubEvent) unsubEvent();
    };
  }, [projectId, loadCollabStatus]);

  const handleStartCollabHost = async () => {
    if (!projectId) {
      setCollabErrorMsg('Proyecto no seleccionado.');
      return;
    }
    if (!collabUsername.trim()) {
      setCollabErrorMsg('Por favor, ingresa un nombre de usuario.');
      return;
    }
    if (collabType === 'online' && !collabRoomId.trim()) {
      setCollabErrorMsg('Por favor, ingresa un ID de Sala.');
      return;
    }
    setCollabConnecting(true);
    setCollabErrorMsg('');
    setCollabStatusMsg('');
    try {
      const res: any = await papi.commands.sendCommand(
        'paratextProjectManager.startCollabHost',
        collabType === 'online' ? collabRoomId.trim() : collabPort,
        collabUsername.trim(),
        projectId,
        collabType,
        collabType === 'online' ? collabServerUrl.trim() : '',
      );
      if (res && res.status === 'ok') {
        setCollabStatusMsg(
          collabType === 'online'
            ? 'Sesión de colaboración online iniciada.'
            : 'Servidor de colaboración local iniciado.',
        );
        await loadCollabStatus();
      } else {
        setCollabErrorMsg(res?.error || 'Error al iniciar colaboración.');
      }
    } catch (e: any) {
      setCollabErrorMsg(e.message || String(e));
    } finally {
      setCollabConnecting(false);
    }
  };

  const handleConnectCollabClient = async () => {
    if (!projectId) {
      setCollabErrorMsg('Proyecto no seleccionado.');
      return;
    }
    if (!collabUsername.trim()) {
      setCollabErrorMsg('Por favor, ingresa un nombre de usuario.');
      return;
    }
    if (collabType === 'online' && !collabRoomId.trim()) {
      setCollabErrorMsg('Por favor, ingresa el ID de la Sala.');
      return;
    }
    if (collabType === 'local' && !collabHostIp.trim()) {
      setCollabErrorMsg('Por favor, ingresa la IP del anfitrión.');
      return;
    }
    setCollabConnecting(true);
    setCollabErrorMsg('');
    setCollabStatusMsg('');
    let finalIp = collabHostIp.trim();
    let finalPort = collabPort;
    if (collabType === 'local' && finalIp.includes(':')) {
      const parts = finalIp.split(':');
      finalIp = parts[0].trim();
      const parsedPort = parseInt(parts[1].trim(), 10);
      if (!isNaN(parsedPort)) {
        finalPort = parsedPort;
      }
    }

    try {
      const res: any = await papi.commands.sendCommand(
        'paratextProjectManager.connectCollabClient',
        collabType === 'online' ? collabRoomId.trim() : finalIp,
        collabType === 'online' ? null : finalPort,
        collabUsername.trim(),
        projectId,
        collabType,
        collabType === 'online' ? collabServerUrl.trim() : '',
      );
      if (res && res.status === 'ok') {
        setCollabStatusMsg(
          collabType === 'online'
            ? 'Conectado a la sala online.'
            : 'Conectado al servidor de colaboración local.',
        );
        await loadCollabStatus();
      } else {
        setCollabErrorMsg(res?.error || 'No se pudo conectar.');
      }
    } catch (e: any) {
      setCollabErrorMsg(e.message || String(e));
    } finally {
      setCollabConnecting(false);
    }
  };

  const handleStopCollab = async () => {
    try {
      await papi.commands.sendCommand('paratextProjectManager.stopCollab');
      setCollabRole('none');
      setCollabActiveUsers([]);
      setCollabStatusMsg('');
      setCollabErrorMsg('');
    } catch (e: any) {
      console.error('[CollabSettingsModal] Failed to stop collab:', e);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      className="tw:fixed tw:inset-0 tw:bg-slate-900/60 tw:backdrop-blur-sm tw:flex tw:items-center tw:justify-center tw:z-[10000] tw:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="collab-modal-title"
      onKeyDown={handleKeyDown}
    >
      <div className="tw:bg-white dark:tw:bg-slate-900 tw:w-full tw:max-w-2xl tw:rounded-2xl tw:shadow-2xl tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:overflow-hidden tw:flex tw:flex-col">
        {/* Header */}
        <div className="tw:px-6 tw:py-4 tw:border-b tw:border-slate-100 dark:tw:border-slate-800 tw:flex tw:items-center tw:justify-between">
          <div className="tw:flex tw:items-center tw:gap-2">
            <span className="tw:text-xl">🤝</span>
            <h3
              id="collab-modal-title"
              className="tw:text-lg tw:font-semibold tw:text-slate-800 dark:tw:text-slate-100"
            >
              Colaboración en Tiempo Real
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar modal"
            className="tw:p-1.5 tw:rounded-lg tw:text-slate-400 hover:tw:text-slate-600 dark:hover:tw:text-slate-200 hover:tw:bg-slate-100 dark:hover:tw:bg-slate-800 tw:transition-colors tw:cursor-pointer"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="tw:px-6 tw:py-5 tw:overflow-y-auto tw:space-y-4 tw:text-sm">
          {collabStatusMsg && (
            <div className="tw:bg-green-50 dark:tw:bg-green-950/30 tw:border tw:border-green-200 dark:tw:border-green-900 tw:text-green-700 dark:tw:text-green-400 tw:p-3 tw:rounded-xl">
              {collabStatusMsg}
            </div>
          )}
          {collabErrorMsg && (
            <div className="tw:bg-red-50 dark:tw:bg-red-950/30 tw:border tw:border-red-200 dark:tw:border-red-900 tw:text-red-700 dark:tw:text-red-400 tw:p-3 tw:rounded-xl tw:whitespace-pre-line">
              {collabErrorMsg}
            </div>
          )}

          {collabRole === 'none' && (
            <div className="tw:flex tw:border tw:border-slate-200 dark:tw:border-slate-700 tw:rounded-xl tw:overflow-hidden tw:bg-slate-50 dark:tw:bg-slate-800 tw:p-0.5">
              <button
                type="button"
                onClick={() => setCollabType('local')}
                className={`tw:flex-1 tw:py-2 tw:text-xs tw:font-semibold tw:rounded-lg tw:transition-colors ${
                  collabType === 'local'
                    ? 'tw:bg-white dark:tw:bg-slate-700 tw:text-slate-800 dark:tw:text-white tw:shadow-sm'
                    : 'tw:text-slate-500 dark:tw:text-slate-400 hover:tw:text-slate-700 dark:hover:tw:text-slate-300'
                }`}
              >
                🌐 Red Local (LAN)
              </button>
              <button
                type="button"
                onClick={() => setCollabType('online')}
                className={`tw:flex-1 tw:py-2 tw:text-xs tw:font-semibold tw:rounded-lg tw:transition-colors ${
                  collabType === 'online'
                    ? 'tw:bg-white dark:tw:bg-slate-700 tw:text-slate-800 dark:tw:text-white tw:shadow-sm'
                    : 'tw:text-slate-500 dark:tw:text-slate-400 hover:tw:text-slate-700 dark:hover:tw:text-slate-300'
                }`}
              >
                ☁️ En Línea (Internet)
              </button>
            </div>
          )}

          {collabRole === 'none' ? (
            <div className="tw:grid tw:grid-cols-1 md:tw:grid-cols-2 tw:gap-5 tw:border tw:border-slate-100 dark:tw:border-slate-800 tw:p-4 tw:rounded-2xl tw:bg-slate-50/50 dark:tw:bg-slate-900/50">
              {/* Host Mode */}
              <div className="tw:space-y-3 tw:flex tw:flex-col">
                <h4 className="tw:font-semibold tw:text-slate-800 dark:tw:text-slate-200 tw:flex tw:items-center tw:gap-1.5">
                  👑 Iniciar Anfitrión (Host)
                </h4>
                <p className="tw:text-xs tw:text-slate-500 dark:tw:text-slate-400 tw:flex-grow">
                  {collabType === 'online'
                    ? 'Crea una sala en internet para colaborar de forma remota desde cualquier lugar.'
                    : 'Levanta un servidor local en tu red para que tu equipo se conecte directamente.'}
                </p>
                <div className="tw:space-y-2">
                  <div>
                    <label className="tw:block tw:text-xs tw:font-medium tw:text-slate-500 dark:tw:text-slate-400 tw:mb-1 font-semibold">
                      Nombre de Usuario
                    </label>
                    <input
                      className="tw:w-full tw:border tw:border-slate-200 dark:tw:border-slate-700 tw:rounded-xl tw:px-3 tw:py-2 tw:bg-white dark:tw:bg-slate-800 dark:tw:text-white"
                      value={collabUsername}
                      onChange={(e) => setCollabUsername(e.target.value)}
                      placeholder="Tu nombre…"
                    />
                  </div>
                  {collabType === 'online' ? (
                    <>
                      <div>
                        <label className="tw:block tw:text-xs tw:font-medium tw:text-slate-500 dark:tw:text-slate-400 tw:mb-1 font-semibold">
                          ID de la Sala
                        </label>
                        <input
                          className="tw:w-full tw:border tw:border-slate-200 dark:tw:border-slate-700 tw:rounded-xl tw:px-3 tw:py-2 tw:bg-white dark:tw:bg-slate-800 tw:font-mono tw:uppercase dark:tw:text-white"
                          value={collabRoomId}
                          onChange={(e) => setCollabRoomId(e.target.value.toUpperCase())}
                          placeholder="e.g. MI-SALA"
                        />
                      </div>
                      <div>
                        <label className="tw:block tw:text-xs tw:font-medium tw:text-slate-500 dark:tw:text-slate-400 tw:mb-1 font-semibold">
                          Servidor Relay (Opcional)
                        </label>
                        <input
                          className="tw:w-full tw:border tw:border-slate-200 dark:tw:border-slate-700 tw:rounded-xl tw:px-3 tw:py-2 tw:bg-white dark:tw:bg-slate-800 tw:font-mono tw:text-xs dark:tw:text-white"
                          value={collabServerUrl}
                          onChange={(e) => setCollabServerUrl(e.target.value)}
                        />
                      </div>
                    </>
                  ) : (
                    <div>
                      <label className="tw:block tw:text-xs tw:font-medium tw:text-slate-500 dark:tw:text-slate-400 tw:mb-1 font-semibold">
                        Puerto Local
                      </label>
                      <input
                        type="number"
                        className="tw:w-full tw:border tw:border-slate-200 dark:tw:border-slate-700 tw:rounded-xl tw:px-3 tw:py-2 tw:bg-white dark:tw:bg-slate-800 dark:tw:text-white"
                        value={collabPort}
                        onChange={(e) => setCollabPort(parseInt(e.target.value, 10) || 49885)}
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleStartCollabHost}
                    disabled={collabConnecting}
                    className="tw:w-full tw:py-2 tw:bg-indigo-600 hover:tw:bg-indigo-700 tw:text-white tw:rounded-xl tw:font-semibold disabled:tw:opacity-50 tw:transition-colors tw:cursor-pointer tw:shadow-md tw:shadow-indigo-500/10"
                  >
                    {collabConnecting ? 'Iniciando...' : 'Iniciar Host'}
                  </button>
                </div>
              </div>

              {/* Client Mode */}
              <div className="tw:space-y-3 tw:flex tw:flex-col tw:border-t md:tw:border-t-0 md:tw:border-l tw:border-slate-100 dark:tw:border-slate-800 tw:pt-4 md:tw:pt-0 md:tw:pl-5">
                <h4 className="tw:font-semibold tw:text-slate-800 dark:tw:text-slate-200 tw:flex tw:items-center tw:gap-1.5">
                  👤 Conectarse como Invitado
                </h4>
                <p className="tw:text-xs tw:text-slate-500 dark:tw:text-slate-400 tw:flex-grow">
                  {collabType === 'online'
                    ? 'Únete a una sala en internet ya creada por un anfitrión usando el ID de la sala.'
                    : 'Conéctate a la IP del anfitrión local dentro de la misma red local.'}
                </p>
                <div className="tw:space-y-2">
                  <div>
                    <label className="tw:block tw:text-xs tw:font-medium tw:text-slate-500 dark:tw:text-slate-400 tw:mb-1 font-semibold">
                      Nombre de Usuario
                    </label>
                    <input
                      className="tw:w-full tw:border tw:border-slate-200 dark:tw:border-slate-700 tw:rounded-xl tw:px-3 tw:py-2 tw:bg-white dark:tw:bg-slate-800 dark:tw:text-white"
                      value={collabUsername}
                      onChange={(e) => setCollabUsername(e.target.value)}
                      placeholder="Tu nombre…"
                    />
                  </div>
                  {collabType === 'online' ? (
                    <>
                      <div>
                        <label className="tw:block tw:text-xs tw:font-medium tw:text-slate-500 dark:tw:text-slate-400 tw:mb-1 font-semibold">
                          ID de la Sala
                        </label>
                        <input
                          className="tw:w-full tw:border tw:border-slate-200 dark:tw:border-slate-700 tw:rounded-xl tw:px-3 tw:py-2 tw:bg-white dark:tw:bg-slate-800 tw:font-mono tw:uppercase dark:tw:text-white"
                          value={collabRoomId}
                          onChange={(e) => setCollabRoomId(e.target.value.toUpperCase())}
                          placeholder="ID del anfitrión…"
                        />
                      </div>
                      <div>
                        <label className="tw:block tw:text-xs tw:font-medium tw:text-slate-500 dark:tw:text-slate-400 tw:mb-1 font-semibold">
                          Servidor Relay (Opcional)
                        </label>
                        <input
                          className="tw:w-full tw:border tw:border-slate-200 dark:tw:border-slate-700 tw:rounded-xl tw:px-3 tw:py-2 tw:bg-white dark:tw:bg-slate-800 tw:font-mono tw:text-xs dark:tw:text-white"
                          value={collabServerUrl}
                          onChange={(e) => setCollabServerUrl(e.target.value)}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="tw:block tw:text-xs tw:font-medium tw:text-slate-500 dark:tw:text-slate-400 tw:mb-1 font-semibold">
                          IP del Anfitrión
                        </label>
                        <input
                          className="tw:w-full tw:border tw:border-slate-200 dark:tw:border-slate-700 tw:rounded-xl tw:px-3 tw:py-2 tw:bg-white dark:tw:bg-slate-800 dark:tw:text-white"
                          value={collabHostIp}
                          onChange={(e) => setCollabHostIp(e.target.value)}
                          placeholder="e.g. 192.168.1.5"
                        />
                      </div>
                      <div>
                        <label className="tw:block tw:text-xs tw:font-medium tw:text-slate-500 dark:tw:text-slate-400 tw:mb-1 font-semibold">
                          Puerto
                        </label>
                        <input
                          type="number"
                          className="tw:w-full tw:border tw:border-slate-200 dark:tw:border-slate-700 tw:rounded-xl tw:px-3 tw:py-2 tw:bg-white dark:tw:bg-slate-800 dark:tw:text-white"
                          value={collabPort}
                          onChange={(e) => setCollabPort(parseInt(e.target.value, 10) || 49885)}
                        />
                      </div>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={handleConnectCollabClient}
                    disabled={collabConnecting}
                    className="tw:w-full tw:py-2 tw:bg-slate-700 hover:tw:bg-slate-800 tw:text-white tw:rounded-xl tw:font-semibold disabled:tw:opacity-50 tw:transition-colors tw:cursor-pointer tw:shadow-md"
                  >
                    {collabConnecting ? 'Conectando...' : 'Unirse a la Sala'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="tw:space-y-4">
              {/* Active Connection Info card */}
              <div className="tw:bg-slate-50 dark:tw:bg-slate-900/50 tw:border tw:border-slate-200 dark:tw:border-slate-800 tw:p-5 tw:rounded-2xl tw:space-y-3">
                <div className="tw:flex tw:items-center tw:justify-between">
                  <div className="tw:flex tw:items-center tw:gap-2">
                    <span className="tw:w-2.5 tw:h-2.5 tw:rounded-full tw:bg-green-500 tw:animate-pulse" />
                    <h4 className="tw:font-semibold tw:text-slate-800 dark:tw:text-slate-100">
                      Sesión {collabType === 'online' ? 'Online' : 'Local'} Activa
                    </h4>
                  </div>
                  <span className="tw:text-xs tw:bg-indigo-50 dark:tw:bg-indigo-950/40 tw:text-indigo-600 dark:tw:text-indigo-400 tw:px-2.5 tw:py-1 tw:rounded-lg tw:font-bold">
                    {collabRole === 'host' ? 'ANFITRIÓN' : 'INVITADO'}
                  </span>
                </div>

                <div className="tw:grid tw:grid-cols-2 tw:gap-4 tw:pt-2 tw:border-t tw:border-slate-100 dark:tw:border-slate-800 tw:text-xs">
                  <div>
                    <span className="tw:text-slate-400 tw:block tw:mb-0.5">Usuario Local</span>
                    <span className="tw:font-semibold tw:text-slate-700 dark:tw:text-slate-300">
                      {collabUsername}
                    </span>
                  </div>

                  {collabType === 'online' ? (
                    <div>
                      <span className="tw:text-slate-400 tw:block tw:mb-0.5">ID de la Sala</span>
                      <span className="tw:font-mono tw:font-bold tw:bg-slate-200/60 dark:tw:bg-slate-800 tw:text-slate-700 dark:tw:text-slate-300 tw:px-2 tw:py-0.5 tw:rounded">
                        {collabRoomId}
                      </span>
                    </div>
                  ) : (
                    <div>
                      <span className="tw:text-slate-400 tw:block tw:mb-0.5">Puerto</span>
                      <span className="tw:font-mono tw:font-semibold tw:text-slate-700 dark:tw:text-slate-300">
                        {collabPort}
                      </span>
                    </div>
                  )}
                </div>

                {collabType === 'local' && collabRole === 'host' && collabIps.length > 0 && (
                  <div className="tw:pt-2 tw:border-t tw:border-slate-100 dark:tw:border-slate-800 tw:text-xs">
                    <span className="tw:text-slate-400 tw:block tw:mb-1 font-semibold">
                      IPs Locales para compartir:
                    </span>
                    <div className="tw:flex tw:flex-wrap tw:gap-1.5">
                      {collabIps.map((ip) => (
                        <span
                          key={ip}
                          className="tw:bg-slate-100 dark:tw:bg-slate-800 tw:text-slate-600 dark:tw:text-slate-400 tw:px-2 tw:py-0.5 tw:rounded-lg tw:font-mono"
                        >
                          {ip}:{collabPort}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Active Collaborators list */}
              <div className="tw:space-y-2">
                <h5 className="tw:font-semibold tw:text-slate-500 dark:tw:text-slate-400 tw:text-xs tw:uppercase tw:tracking-wider">
                  👥 Colaboradores Conectados ({collabActiveUsers.length})
                </h5>
                <div className="tw:bg-white dark:tw:bg-slate-800/40 tw:border tw:border-slate-200 dark:tw:border-slate-800/80 tw:rounded-2xl tw:divide-y tw:divide-slate-100 dark:tw:divide-slate-800 tw:overflow-hidden">
                  {collabActiveUsers.length > 0 ? (
                    collabActiveUsers.map((user) => (
                      <div
                        key={user}
                        className="tw:flex tw:items-center tw:gap-3 tw:px-4 tw:py-3 hover:tw:bg-slate-50 dark:hover:tw:bg-slate-800/30 tw:transition-colors"
                      >
                        <Avatar name={user} className="tw:w-7 tw:h-7 tw:text-xs" />
                        <div className="tw:flex-1">
                          <span className="tw:font-medium tw:text-slate-700 dark:tw:text-slate-200">
                            {user}
                          </span>
                          {user === collabUsername && (
                            <span className="tw:text-[10px] tw:text-slate-400 tw:ml-1.5">(Tú)</span>
                          )}
                        </div>
                        <span className="tw:w-2 tw:h-2 tw:rounded-full tw:bg-green-500" />
                      </div>
                    ))
                  ) : (
                    <div className="tw:p-6 tw:text-center tw:text-slate-400 dark:tw:text-slate-500 tw:text-xs">
                      Esperando que se unan otros colaboradores...
                    </div>
                  )}
                </div>
              </div>

              {/* Disconnect action */}
              <div className="tw:pt-2">
                <button
                  type="button"
                  onClick={handleStopCollab}
                  className="tw:w-full tw:py-2.5 tw:bg-rose-50 hover:tw:bg-rose-100 dark:tw:bg-rose-950/20 dark:hover:tw:bg-rose-950/40 tw:text-rose-600 dark:tw:text-rose-400 tw:rounded-xl tw:font-semibold tw:transition-colors tw:cursor-pointer tw:border tw:border-rose-100 dark:tw:border-rose-900/55 tw:text-center font-semibold"
                >
                  🔴 Desconectarse / Detener Sesión
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="tw:px-6 tw:py-4 tw:bg-slate-50 dark:tw:bg-slate-900/50 tw:border-t tw:border-slate-100 dark:tw:border-slate-800 tw:flex tw:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="tw:px-4 tw:py-2 tw:bg-white hover:tw:bg-slate-50 dark:tw:bg-slate-800 dark:hover:tw:bg-slate-700 tw:border tw:border-slate-200 dark:tw:border-slate-700 tw:rounded-xl tw:text-slate-700 dark:tw:text-slate-200 tw:font-semibold tw:transition-colors tw:cursor-pointer tw:text-xs font-semibold"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
