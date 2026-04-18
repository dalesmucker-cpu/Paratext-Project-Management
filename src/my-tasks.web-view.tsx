import { WebViewProps } from '@papi/core';
import papi from '@papi/frontend';
import { useDialogCallback } from '@papi/frontend/react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ProjectTask, TaskStatus, StageConfig, TaskStore } from './types/task.types';
import {
  STATUS_LABELS,
  STATUS_COLORS,
  STATUS_SORT_ORDER,
  TEAM_MEMBERS,
  BIBLE_BOOKS,
  generateId,
  getStageLabel,
  getOrderedStages,
  deadlineColorClass,
} from './types/task.types';

// ---- Task Row ----

function TaskRow({
  task,
  stageConfig,
  orderedStages,
  onStatusChange,
  onAdvance,
}: {
  task: ProjectTask;
  stageConfig: Record<string, StageConfig>;
  orderedStages: string[];
  onStatusChange: (id: string, status: TaskStatus) => void;
  onAdvance: (task: ProjectTask, overrideStage?: string) => void;
}) {
  const currentIdx = orderedStages.indexOf(task.stage);
  const nextStageKey =
    currentIdx >= 0 && currentIdx < orderedStages.length - 1
      ? orderedStages[currentIdx + 1]
      : null;

  const [sendToEnabled, setSendToEnabled] = useState(false);
  const [sendToStage, setSendToStage] = useState<string>(nextStageKey ?? task.stage);

  const dlClass = deadlineColorClass(task.deadline);

  return (
    <div className="p-3 bg-white rounded shadow-sm border border-gray-100 space-y-2">
      {/* Main row */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">
              {task.book} {task.chapter}
            </span>
            <span className="text-xs text-gray-500">{getStageLabel(task.stage, stageConfig)}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${STATUS_COLORS[task.status]}`}>
              {STATUS_LABELS[task.status]}
            </span>
          </div>
          {task.notes && (
            <p className="text-xs text-gray-500 mt-1 truncate">{task.notes}</p>
          )}
          {/* Deadline */}
          {task.deadline && (
            <p className={`text-xs mt-0.5 ${dlClass}`}>
              ⏰ Fecha límite: {new Date(task.deadline).toLocaleDateString('es')}
            </p>
          )}
          {/* Hours */}
          {(task.estimatedHours !== undefined || task.loggedHours !== undefined) && (
            <p className="text-xs text-gray-400 mt-0.5">
              Horas: {task.loggedHours ?? 0} / {task.estimatedHours ?? '?'}
            </p>
          )}
          <p className="text-xs text-gray-400 mt-0.5">
            Actualizado: {new Date(task.updatedAt).toLocaleDateString('es')}
          </p>
        </div>
        {/* Status action buttons */}
        <div className="flex flex-col gap-1 flex-shrink-0">
          {task.status !== 'complete' && task.status !== 'flagged' ? (
            <>
              {/* Green advance button — available directly from Pending or In-Progress */}
              <button
                className="px-2 py-1 text-xs bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100 whitespace-nowrap"
                onClick={() => onAdvance(task, sendToEnabled ? sendToStage : undefined)}
              >
                → {nextStageKey
                    ? getStageLabel(sendToEnabled ? sendToStage : nextStageKey, stageConfig)
                    : 'Completar'}
              </button>
              {/* Mandar a override */}
              <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendToEnabled}
                  onChange={(e) => setSendToEnabled(e.target.checked)}
                />
                Mandar a:
              </label>
              {sendToEnabled && (
                <select
                  value={sendToStage}
                  onChange={(e) => setSendToStage(e.target.value)}
                  className="text-xs border rounded px-1 py-0.5 max-w-[120px]"
                >
                  {orderedStages.map((s) => (
                    <option key={s} value={s}>{getStageLabel(s, stageConfig)}</option>
                  ))}
                </select>
              )}
            </>
          ) : task.status === 'flagged' ? (
            <button
              className="px-2 py-1 text-xs bg-secondary text-secondary-foreground border border-border rounded hover:bg-secondary/80 whitespace-nowrap"
              onClick={() => onStatusChange(task.id, 'pending')}
            >
              ↩ Retomar
            </button>
          ) : null}
          {task.status !== 'flagged' && (
            <button
              className="px-2 py-1 text-xs bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100"
              onClick={() => onStatusChange(task.id, 'flagged')}
            >
              ⚑ Bandera
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Notification helpers ----

interface LastSeenData {
  taskIds: string[];
  taskStatuses: Record<string, string>;
}

function computeNotifications(
  myTasks: ProjectTask[],
  lastSeenRaw: string,
  opts: {
    notifEnabled: boolean;
    notifNewTasks: boolean;
    notifStatusChanges: boolean;
    notifDeadlineDays: number;
  },
): string[] {
  if (!opts.notifEnabled) return [];

  let lastSeen: LastSeenData = { taskIds: [], taskStatuses: {} };
  try {
    const parsed = JSON.parse(lastSeenRaw);
    // Guard against empty object or missing fields (e.g. initial value '{}')
    lastSeen = {
      taskIds: Array.isArray(parsed.taskIds) ? parsed.taskIds : [],
      taskStatuses:
        parsed.taskStatuses && typeof parsed.taskStatuses === 'object'
          ? parsed.taskStatuses
          : {},
    };
  } catch {
    // use defaults
  }

  const msgs: string[] = [];

  if (opts.notifNewTasks) {
    const newTasks = myTasks.filter((t) => !lastSeen.taskIds.includes(t.id));
    if (newTasks.length > 0) {
      const label = `${newTasks.length} tarea${newTasks.length > 1 ? 's' : ''} nueva${newTasks.length > 1 ? 's' : ''}`;
      msgs.push(`${label}: ${newTasks.map((t) => `${t.book} ${t.chapter} (${t.stage})`).join(', ')}`);
    }
  }

  if (opts.notifStatusChanges) {
    const changed = myTasks.filter(
      (t) => lastSeen.taskIds.includes(t.id) && lastSeen.taskStatuses[t.id] !== t.status,
    );
    if (changed.length > 0) {
      const label = `${changed.length} tarea${changed.length > 1 ? 's' : ''} cambió de estado`;
      msgs.push(`${label}: ${changed.map((t) => `${t.book} ${t.chapter}`).join(', ')}`);
    }
  }

  if (opts.notifDeadlineDays > 0) {
    const now = Date.now();
    const windowMs = opts.notifDeadlineDays * 24 * 60 * 60 * 1000;
    const approaching = myTasks.filter((t) => {
      if (!t.deadline || t.status === 'complete') return false;
      const dl = new Date(t.deadline).getTime();
      return dl > now && dl - now <= windowMs;
    });
    if (approaching.length > 0) {
      msgs.push(
        `Fecha límite próxima (${opts.notifDeadlineDays}d): ${approaching.map((t) => `${t.book} ${t.chapter}`).join(', ')}`,
      );
    }
    const overdue = myTasks.filter((t) => {
      if (!t.deadline || t.status === 'complete') return false;
      return new Date(t.deadline).getTime() < now;
    });
    if (overdue.length > 0) {
      msgs.push(
        `⚠ Vencida${overdue.length > 1 ? 's' : ''}: ${overdue.map((t) => `${t.book} ${t.chapter}`).join(', ')}`,
      );
    }
  }

  return msgs;
}

// ---- Main My Tasks Component ----

globalThis.webViewComponent = function MyTasksWebView({
  projectId,
  useWebViewState,
  updateWebViewDefinition,
}: WebViewProps) {
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [deletedTaskIds, setDeletedTaskIds] = useState<string[]>([]);
  const [stageConfig, setStageConfig] = useState<Record<string, StageConfig>>({});
  const [teamMembers, setTeamMembers] = useState<string[]>([...TEAM_MEMBERS]);
  // useWebViewState persists the name within the session (survives panel reloads without
  // a backend round-trip). The backend file gives cross-restart persistence.
  const [currentUser, persistCurrentUser] = useWebViewState<string>('currentUser', '');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useWebViewState<string>('filterStatus', 'active');
  const [searchText, setSearchText] = useState('');
  const [showUserPicker, setShowUserPicker] = useState(false);

  // Notification preferences (persisted per panel)
  const [lastSeenTaskData, setLastSeenTaskData] = useWebViewState<string>('lastSeenTaskData', '{}');
  const [notifEnabled, setNotifEnabled] = useWebViewState<boolean>('notifEnabled', true);
  const [notifDeadlineDays, setNotifDeadlineDays] = useWebViewState<number>('notifDeadlineDays', 3);
  const [notifNewTasks, setNotifNewTasks] = useWebViewState<boolean>('notifNewTasks', true);
  const [notifStatusChanges, setNotifStatusChanges] = useWebViewState<boolean>(
    'notifStatusChanges',
    true,
  );

  // Notification UI state
  const [notifications, setNotifications] = useState<string[]>([]);
  const [showNotifSettings, setShowNotifSettings] = useState(false);

  const selectProject = useDialogCallback(
    'platform.selectProject',
    useMemo(
      () => ({
        title: 'Seleccionar Proyecto',
        prompt: 'Elige un proyecto para administrar:',
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

  const loadData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    try {
      const [tasksResult, userResult, membersResult] = await Promise.all([
        papi.commands.sendCommand('paratextProjectManager.getTasks', projectId),
        papi.commands.sendCommand('paratextProjectManager.getCurrentUser'),
        papi.commands.sendCommand('paratextProjectManager.getTeamMembers'),
      ]);
      const store = JSON.parse(tasksResult) as TaskStore;
      setTasks(store.tasks ?? []);
      setDeletedTaskIds(store.deletedTaskIds ?? []);
      setStageConfig(store.stageConfig ?? {});
      if (userResult) persistCurrentUser(userResult);
      if (membersResult) setTeamMembers(JSON.parse(membersResult as string) as string[]);
    } catch (e) {
      setError(`Error al cargar: ${e}`);
    } finally {
      setLoading(false);
    }
  }, [projectId, persistCurrentUser]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Background auto-refresh — silently picks up changes saved by other computers
  const savingRef = useRef(false);
  useEffect(() => { savingRef.current = saving; }, [saving]);

  const lastRefreshRef = useRef(0);
  const refreshInProgressRef = useRef(false);

  const silentRefresh = useCallback(async () => {
    if (!projectId || savingRef.current || refreshInProgressRef.current) return;
    refreshInProgressRef.current = true;
    try {
      const result = await papi.commands.sendCommand('paratextProjectManager.getTasks', projectId);
      const store = JSON.parse(result as string) as TaskStore;
      lastRefreshRef.current = Date.now();
      const incomingDeleted = new Set(store.deletedTaskIds ?? []);
      setDeletedTaskIds(prev => {
        const merged = new Set([...prev, ...incomingDeleted]);
        return merged.size !== prev.length ? Array.from(merged) : prev;
      });
      setTasks(prev => {
        const merged = new Map(prev.map(t => [t.id, t]));
        for (const t of store.tasks ?? []) {
          if (incomingDeleted.has(t.id)) { merged.delete(t.id); continue; }
          const existing = merged.get(t.id);
          if (!existing || t.updatedAt >= existing.updatedAt) merged.set(t.id, t);
        }
        for (const id of incomingDeleted) merged.delete(id);
        return Array.from(merged.values());
      });
      if (store.stageConfig && Object.keys(store.stageConfig).length > 0) setStageConfig(store.stageConfig);
    } catch (_) { /* silent */ } finally { refreshInProgressRef.current = false; }
  }, [projectId]);

  // Periodic refresh every 60 s
  useEffect(() => {
    if (!projectId) return undefined;
    const interval = setInterval(silentRefresh, 60_000);
    return () => clearInterval(interval);
  }, [projectId, silentRefresh]);

  // Refresh on visibility change but no more than once every 2 minutes
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRefreshRef.current > 120_000) silentRefresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [silentRefresh]);

  const persistTasks = useCallback(
    async (updated: ProjectTask[], previousTasks?: ProjectTask[]) => {
      if (!projectId) return;
      setSaving(true);
      setTasks(updated); // optimistic update
      try {
        const store: TaskStore = {
          schemaVersion: 1,
          tasks: updated,
          stageConfig,
          ...(deletedTaskIds.length > 0 ? { deletedTaskIds } : {}),
        };
        await papi.commands.sendCommand(
          'paratextProjectManager.saveTasks',
          projectId,
          JSON.stringify(store),
        );
      } catch (e) {
        // Revert optimistic update on failure so the UI stays consistent with actual saved state
        if (previousTasks !== undefined) setTasks(previousTasks);
        setError(`Error al guardar: ${e}`);
      } finally {
        setSaving(false);
      }
    },
    [projectId, stageConfig, deletedTaskIds],
  );

  const updateStatus = useCallback(
    async (id: string, status: TaskStatus) => {
      await persistTasks(
        tasks.map((t) =>
          t.id === id ? { ...t, status, updatedAt: new Date().toISOString() } : t,
        ),
        tasks,
      );
    },
    [tasks, persistTasks],
  );

  const orderedStages = useMemo(() => getOrderedStages(stageConfig), [stageConfig]);

  const advanceTask = useCallback(
    async (task: ProjectTask, overrideStage?: string) => {
      const idx = orderedStages.indexOf(task.stage);
      const nextStage =
        overrideStage ??
        (idx >= 0 && idx < orderedStages.length - 1 ? orderedStages[idx + 1] : null);
      const now = new Date().toISOString();
      const completedTask: ProjectTask = { ...task, status: 'complete' as const, updatedAt: now };

      if (!nextStage) {
        // Last stage — just mark complete, no new task
        await persistTasks(tasks.map((t) => (t.id === task.id ? completedTask : t)), tasks);
        return;
      }

      // Assignee resolution: people with matching books + people with no book restriction
      const stageAssignees = stageConfig[nextStage]?.assignees ?? [];
      const assignees = stageAssignees
        .filter((sa) => sa.books.length === 0 || sa.books.includes(task.book))
        .map((sa) => sa.person);

      const newTask: ProjectTask = {
        id: generateId(),
        book: task.book,
        chapter: task.chapter,
        stage: nextStage,
        assignedTo: assignees,
        status: 'pending',
        notes: '',
        createdAt: now,
        updatedAt: now,
        deadline: task.deadline,
        estimatedHours: task.estimatedHours,
      };
      const updated = tasks.map((t) => (t.id === task.id ? completedTask : t));
      updated.push(newTask);
      await persistTasks(updated, tasks);
    },
    [tasks, stageConfig, orderedStages, persistTasks],
  );

  const setUser = useCallback(
    async (name: string) => {
      if (!name) return;
      persistCurrentUser(name);
      setShowUserPicker(false);
      try {
        // Persist to file-based config so the name survives Paratext restarts
        await papi.commands.sendCommand('paratextProjectManager.setCurrentUser', name);
      } catch {
        // Non-critical: panel state already updated, file persistence is best-effort
      }
    },
    [persistCurrentUser],
  );

  // Filter to current user's tasks (memoized so useEffect can depend on it)
  const myTasks = useMemo(
    () => (currentUser ? tasks.filter((t) => (t.assignedTo ?? []).includes(currentUser)) : tasks),
    [tasks, currentUser],
  );

  // Recompute notifications whenever tasks or preferences change
  useEffect(() => {
    if (!currentUser) return;
    const msgs = computeNotifications(myTasks, lastSeenTaskData, {
      notifEnabled,
      notifNewTasks,
      notifStatusChanges,
      notifDeadlineDays,
    });
    setNotifications(msgs);
  }, [myTasks, lastSeenTaskData, notifEnabled, notifNewTasks, notifStatusChanges, notifDeadlineDays, currentUser]);

  const markSeen = useCallback(() => {
    const snapshot = {
      taskIds: myTasks.map((t) => t.id),
      taskStatuses: Object.fromEntries(myTasks.map((t) => [t.id, t.status])),
    };
    setLastSeenTaskData(JSON.stringify(snapshot));
    setNotifications([]);
  }, [myTasks, setLastSeenTaskData]);

  const visibleTasks = myTasks
    .filter((t) => {
      if (filterStatus === 'active') return t.status !== 'complete';
      if (filterStatus === 'complete') return t.status === 'complete';
      if (filterStatus === 'flagged') return t.status === 'flagged';
      return true;
    })
    .filter((t) => {
      const q = searchText.trim().toLowerCase();
      if (!q) return true;
      return (
        t.book.toLowerCase().includes(q) ||
        String(t.chapter).includes(q) ||
        t.notes.toLowerCase().includes(q) ||
        (t.assignedTo ?? []).some((a) => a.toLowerCase().includes(q)) ||
        getStageLabel(t.stage, stageConfig).toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const statusDiff = STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status];
      if (statusDiff !== 0) return statusDiff;
      const bookDiff = BIBLE_BOOKS.indexOf(a.book as typeof BIBLE_BOOKS[number]) -
                       BIBLE_BOOKS.indexOf(b.book as typeof BIBLE_BOOKS[number]);
      if (bookDiff !== 0) return bookDiff;
      return (a.chapter ?? 0) - (b.chapter ?? 0);
    });

  const counts = {
    flagged: myTasks.filter((t) => t.status === 'flagged').length,
    'in-progress': myTasks.filter((t) => t.status === 'in-progress').length,
    pending: myTasks.filter((t) => t.status === 'pending').length,
    complete: myTasks.filter((t) => t.status === 'complete').length,
  };

  if (!projectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-4 text-sm">
        <p className="text-gray-600">Ningún proyecto seleccionado.</p>
        <button
          className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
          onClick={selectProject}
        >
          Seleccionar Proyecto
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 text-sm">
      {/* Header */}
      <div className="px-3 py-2 bg-white border-b shadow-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="font-semibold text-gray-700 flex items-center gap-1.5">
            Mis Tareas
            {(counts.flagged + counts['in-progress'] + counts.pending) > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-xs font-normal ${
                counts.flagged > 0
                  ? 'bg-red-100 text-red-700'
                  : 'bg-secondary text-secondary-foreground'
              }`}>
                {counts.flagged + counts['in-progress'] + counts.pending}
              </span>
            )}
          </span>
          <div className="flex gap-1 items-center">
            {saving && <span className="text-gray-400 text-xs">Guardando…</span>}
            <button
              className="relative p-1 rounded hover:bg-gray-100 text-sm"
              title="Configurar notificaciones"
              onClick={() => setShowNotifSettings((v) => !v)}
            >
              🔔
              {notifications.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                  {notifications.length}
                </span>
              )}
            </button>
            <button
              className="px-2 py-0.5 bg-gray-100 rounded text-xs hover:bg-gray-200"
              onClick={selectProject}
              title="Cambiar proyecto"
            >
              ⇄
            </button>
            <button
              className="px-2 py-0.5 bg-gray-100 rounded text-xs hover:bg-gray-200"
              onClick={loadData}
              title="Actualizar"
            >
              ↻
            </button>
          </div>
        </div>

        {/* User identity row */}
        {!loading && (
          <div className="mt-1.5">
            {currentUser && !showUserPicker ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-600">
                  Usuario: <strong>{currentUser}</strong>
                </span>
                <button
                  className="text-muted-foreground hover:underline text-xs"
                  onClick={() => setShowUserPicker(true)}
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <div className="bg-yellow-50 border border-yellow-200 rounded px-2 py-1.5 flex items-center gap-2">
                <span className="text-yellow-800 text-xs flex-shrink-0">¿Quién eres?</span>
                <select
                  className="flex-1 border rounded px-2 py-0.5 text-xs"
                  defaultValue=""
                  onChange={(e) => setUser(e.target.value)}
                >
                  <option value="" disabled>
                    Selecciona tu nombre…
                  </option>
                  {teamMembers.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                {showUserPicker && (
                  <button
                    className="text-xs text-gray-500 hover:text-gray-700 flex-shrink-0"
                    onClick={() => setShowUserPicker(false)}
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Summary counts */}
        <div className="flex gap-3 mt-1.5 text-xs flex-wrap">
          <span className="text-red-600">
            ⚑ {counts.flagged} bandera{counts.flagged !== 1 ? 's' : ''}
          </span>
          <span className="text-yellow-700">⟳ {counts['in-progress']} en progreso</span>
          <span className="text-gray-500">
            • {counts.pending} pendiente{counts.pending !== 1 ? 's' : ''}
          </span>
          <span className="text-green-600">
            ✓ {counts.complete} completo{counts.complete !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mt-2">
          {[
            { key: 'active', label: 'Activas' },
            { key: 'flagged', label: 'Banderas' },
            { key: 'complete', label: 'Completas' },
            { key: 'all', label: 'Todas' },
          ].map(({ key, label }) => (
            <button
              key={key}
              className={`px-2 py-0.5 rounded text-xs border ${
                filterStatus === key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
              onClick={() => setFilterStatus(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search box */}
        <div className="relative mt-1.5">
          <input
            type="text"
            placeholder="Buscar libro, cap., notas, etapa…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full border border-gray-200 rounded px-2 py-0.5 text-xs pr-6 focus:outline-none focus:border-primary"
          />
          {searchText && (
            <button
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 leading-none"
              onClick={() => setSearchText('')}
              title="Limpiar búsqueda"
            >
              ✕
            </button>
          )}
        </div>

        {/* Notification settings panel */}
        {showNotifSettings && (
          <div className="mt-2 p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs space-y-1.5">
            <div className="font-semibold text-gray-700">Configuración de notificaciones</div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={notifEnabled}
                onChange={(e) => setNotifEnabled(e.target.checked)}
              />
              Activar notificaciones
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={notifNewTasks}
                disabled={!notifEnabled}
                onChange={(e) => setNotifNewTasks(e.target.checked)}
              />
              Nuevas tareas asignadas a mí
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={notifStatusChanges}
                disabled={!notifEnabled}
                onChange={(e) => setNotifStatusChanges(e.target.checked)}
              />
              Cambios de estado
            </label>
            <label className="flex items-center gap-2 flex-wrap">
              <input
                type="checkbox"
                checked={notifDeadlineDays > 0}
                disabled={!notifEnabled}
                onChange={(e) => setNotifDeadlineDays(e.target.checked ? 3 : 0)}
              />
              Fecha límite próxima — avisar con
              <input
                type="number"
                min={1}
                max={30}
                value={notifDeadlineDays}
                disabled={!notifEnabled || notifDeadlineDays === 0}
                onChange={(e) => setNotifDeadlineDays(Number(e.target.value))}
                className="w-12 px-1 border border-gray-300 rounded text-center"
              />
              días de anticipación
            </label>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border-b border-red-200 px-3 py-1.5 text-red-700 text-xs">
          {error}
        </div>
      )}

      {/* Notification banner */}
      {notifications.length > 0 && (
        <div className="mx-2 mt-2 p-2.5 bg-background border border-border rounded-lg">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1">
              {notifications.map((msg, i) => (
                <p key={i} className="text-xs text-foreground">
                  🔔 {msg}
                </p>
              ))}
            </div>
            <button
              onClick={markSeen}
              className="text-xs text-foreground hover:text-foreground/80 whitespace-nowrap flex-shrink-0 border border-border rounded px-2 py-0.5"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Task list */}
      {loading ? (
        <div className="flex items-center justify-center flex-1 text-gray-400">Cargando…</div>
      ) : visibleTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-gray-400 gap-1">
          <span>
            {searchText.trim()
              ? `Sin resultados para "${searchText.trim()}".`
              : filterStatus === 'active'
              ? 'No hay tareas activas.'
              : 'No hay tareas.'}
          </span>
          {searchText.trim() && (
            <button
              className="text-xs text-slate-500 hover:underline"
              onClick={() => setSearchText('')}
            >
              Limpiar búsqueda
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {visibleTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              stageConfig={stageConfig}
              orderedStages={orderedStages}
              onStatusChange={updateStatus}
              onAdvance={advanceTask}
            />
          ))}
        </div>
      )}
    </div>
  );
};
