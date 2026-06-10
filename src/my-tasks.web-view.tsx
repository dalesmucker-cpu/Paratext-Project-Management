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
import UnreadNotesWidget from './components/unread-notes-widget.web-view';

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
    currentIdx >= 0 && currentIdx < orderedStages.length - 1 ? orderedStages[currentIdx + 1] : null;

  const [sendToEnabled, setSendToEnabled] = useState(false);
  const [sendToStage, setSendToStage] = useState<string>(nextStageKey ?? task.stage);

  const dlClass = deadlineColorClass(task.deadline);

  return (
    <div className="tw:p-3 tw:bg-white tw:rounded tw:shadow-sm tw:border tw:border-gray-100 tw:space-y-2">
      {/* Main row */}
      <div className="tw:flex tw:items-start tw:gap-3">
        <div className="tw:flex-1 tw:min-w-0">
          <div className="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
            <span className="tw:font-semibold tw:text-sm">
              {task.book} {task.chapter}
            </span>
            <span className="tw:text-xs tw:text-gray-500">
              {getStageLabel(task.stage, stageConfig)}
            </span>
            <span
              className={`tw:text-xs tw:px-1.5 tw:py-0.5 tw:rounded-full ${STATUS_COLORS[task.status]}`}
            >
              {STATUS_LABELS[task.status]}
            </span>
          </div>
          {task.notes && (
            <p className="tw:text-xs tw:text-gray-500 tw:mt-1 tw:truncate">{task.notes}</p>
          )}
          {/* Deadline */}
          {task.deadline && (
            <p className={`tw:text-xs tw:mt-0.5 ${dlClass}`}>
              Fecha límite: {new Date(task.deadline).toLocaleDateString('es')}
            </p>
          )}
          {/* Hours */}
          {(task.estimatedHours !== undefined || task.loggedHours !== undefined) && (
            <p className="tw:text-xs tw:text-gray-400 tw:mt-0.5">
              Horas: {task.loggedHours ?? 0} / {task.estimatedHours ?? '?'}
            </p>
          )}
          <p className="tw:text-xs tw:text-gray-400 tw:mt-0.5">
            Actualizado: {new Date(task.updatedAt).toLocaleDateString('es')}
          </p>
        </div>
        {/* Status action buttons */}
        <div className="tw:flex tw:flex-col tw:gap-1 tw:flex-shrink-0">
          {task.status !== 'complete' && task.status !== 'flagged' ? (
            <>
              {/* Green advance button — available directly from Pending or In-Progress */}
              <button
                className="tw:px-2 tw:py-1 tw:text-xs tw:bg-green-50 tw:text-green-700 tw:border tw:border-green-200 tw:rounded tw:hover:bg-green-100 tw:whitespace-nowrap"
                onClick={() => onAdvance(task, sendToEnabled ? sendToStage : undefined)}
              >
                →{' '}
                {nextStageKey
                  ? getStageLabel(sendToEnabled ? sendToStage : nextStageKey, stageConfig)
                  : 'Completar'}
              </button>
              {/* Mandar a override */}
              <label className="tw:flex tw:items-center tw:gap-1 tw:text-xs tw:text-gray-500 tw:cursor-pointer">
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
                  className="tw:text-xs tw:border tw:rounded tw:px-1 tw:py-0.5 tw:max-w-[120px]"
                >
                  {orderedStages.map((s) => (
                    <option key={s} value={s}>
                      {getStageLabel(s, stageConfig)}
                    </option>
                  ))}
                </select>
              )}
            </>
          ) : task.status === 'flagged' ? (
            <button
              className="tw:px-2 tw:py-1 tw:text-xs tw:bg-slate-50 tw:text-slate-600 tw:border tw:border-slate-200 tw:rounded tw:hover:bg-slate-100 tw:whitespace-nowrap"
              onClick={() => onStatusChange(task.id, 'pending')}
            >
              Retomar
            </button>
          ) : null}
          {task.status !== 'flagged' && (
            <button
              className="tw:px-2 tw:py-1 tw:text-xs tw:bg-red-50 tw:text-red-600 tw:border tw:border-red-200 tw:rounded tw:hover:bg-red-100"
              onClick={() => onStatusChange(task.id, 'flagged')}
            >
              Bandera
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
        parsed.taskStatuses && typeof parsed.taskStatuses === 'object' ? parsed.taskStatuses : {},
    };
  } catch {
    // use defaults
  }

  const msgs: string[] = [];

  if (opts.notifNewTasks) {
    const newTasks = myTasks.filter((t) => !lastSeen.taskIds.includes(t.id));
    if (newTasks.length > 0) {
      const label = `${newTasks.length} tarea${newTasks.length > 1 ? 's' : ''} nueva${newTasks.length > 1 ? 's' : ''}`;
      msgs.push(
        `${label}: ${newTasks.map((t) => `${t.book} ${t.chapter} (${t.stage})`).join(', ')}`,
      );
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
        `Vencida${overdue.length > 1 ? 's' : ''}: ${overdue.map((t) => `${t.book} ${t.chapter}`).join(', ')}`,
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

  const [sidebarVisible, setSidebarVisible] = useState(() => {
    const saved = localStorage.getItem('my_tasks_sidebar_visible');
    return saved !== 'false';
  });

  const toggleSidebar = () => {
    setSidebarVisible((v) => {
      const next = !v;
      localStorage.setItem('my_tasks_sidebar_visible', String(next));
      return next;
    });
  };

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

  const loadDataRequestRef = useRef(0);

  const loadData = useCallback(async () => {
    if (!projectId) return;
    const requestId = ++loadDataRequestRef.current;
    const isCurrentRequest = () => requestId === loadDataRequestRef.current;
    setLoading(true);
    setError('');
    try {
      const [tasksResult, userResult, membersResult] = await Promise.all([
        papi.commands.sendCommand('paratextProjectManager.getTasks', projectId),
        papi.commands.sendCommand('paratextProjectManager.getCurrentUser'),
        papi.commands.sendCommand('paratextProjectManager.getTeamMembers'),
      ]);
      if (!isCurrentRequest()) return;
      const store = JSON.parse(tasksResult) as TaskStore;
      setTasks(store.tasks ?? []);
      setDeletedTaskIds(store.deletedTaskIds ?? []);
      setStageConfig(store.stageConfig ?? {});
      if (userResult) persistCurrentUser(userResult);
      if (membersResult) setTeamMembers(JSON.parse(membersResult as string) as string[]);
    } catch (e) {
      // Auto-retry once after 3s — handles papi timeouts after long idle
      try {
        await new Promise((r) => setTimeout(r, 3000));
        const [tasksResult, userResult, membersResult] = await Promise.all([
          papi.commands.sendCommand('paratextProjectManager.getTasks', projectId),
          papi.commands.sendCommand('paratextProjectManager.getCurrentUser'),
          papi.commands.sendCommand('paratextProjectManager.getTeamMembers'),
        ]);
        if (!isCurrentRequest()) return;
        const store = JSON.parse(tasksResult) as TaskStore;
        setTasks(store.tasks ?? []);
        setDeletedTaskIds(store.deletedTaskIds ?? []);
        setStageConfig(store.stageConfig ?? {});
        if (userResult) persistCurrentUser(userResult);
        if (membersResult) setTeamMembers(JSON.parse(membersResult as string) as string[]);
      } catch (retryErr) {
        setError(`Error al cargar: ${retryErr}`);
      }
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [projectId, persistCurrentUser]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Background auto-refresh — silently picks up changes saved by other computers
  const savingRef = useRef(false);
  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

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
      setDeletedTaskIds((prev) => {
        const merged = new Set([...prev, ...incomingDeleted]);
        return merged.size !== prev.length ? Array.from(merged) : prev;
      });
      setTasks((prev) => {
        const merged = new Map(prev.map((t) => [t.id, t]));
        for (const t of store.tasks ?? []) {
          if (incomingDeleted.has(t.id)) {
            merged.delete(t.id);
            continue;
          }
          const existing = merged.get(t.id);
          if (!existing || t.updatedAt >= existing.updatedAt) merged.set(t.id, t);
        }
        for (const id of incomingDeleted) merged.delete(id);
        return Array.from(merged.values());
      });
      if (store.stageConfig && Object.keys(store.stageConfig).length > 0)
        setStageConfig(store.stageConfig);
    } catch (_) {
      /* silent */
    } finally {
      refreshInProgressRef.current = false;
    }
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
        tasks.map((t) => (t.id === id ? { ...t, status, updatedAt: new Date().toISOString() } : t)),
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
        await persistTasks(
          tasks.map((t) => (t.id === task.id ? completedTask : t)),
          tasks,
        );
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
  }, [
    myTasks,
    lastSeenTaskData,
    notifEnabled,
    notifNewTasks,
    notifStatusChanges,
    notifDeadlineDays,
    currentUser,
  ]);

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
      const bookDiff =
        BIBLE_BOOKS.indexOf(a.book as (typeof BIBLE_BOOKS)[number]) -
        BIBLE_BOOKS.indexOf(b.book as (typeof BIBLE_BOOKS)[number]);
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
      <div className="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:p-8 tw:text-center tw:gap-4 tw:text-sm">
        <p className="tw:text-gray-600">Ningún proyecto seleccionado.</p>
        <button
          className="tw:px-4 tw:py-2 tw:bg-slate-600 tw:text-white tw:rounded tw:hover:bg-slate-700"
          onClick={() => selectProject()}
        >
          Seleccionar Proyecto
        </button>
      </div>
    );
  }

  return (
    <div className="tw:flex tw:flex-col tw:h-full tw:bg-gray-50 tw:text-sm">
      {/* Header */}
      <div className="tw:px-3 tw:py-2 tw:bg-white tw:border-b tw:shadow-sm">
        <div className="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:flex-wrap">
          <div className="tw:flex tw:items-center tw:gap-2">
            <button
              onClick={toggleSidebar}
              className="tw:p-1.5 tw:rounded-md tw:text-slate-600 tw:hover:bg-slate-100 tw:hover:text-slate-800 tw:transition-colors tw:cursor-pointer tw:flex tw:items-center tw:justify-center"
              title={sidebarVisible ? 'Ocultar filtros' : 'Mostrar filtros'}
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
            <span className="tw:font-semibold tw:text-gray-700 tw:flex tw:items-center tw:gap-1.5">
              Mis Tareas
              {counts.flagged + counts['in-progress'] + counts.pending > 0 && (
                <span
                  className={`tw:rounded-full tw:px-1.5 tw:py-0.5 tw:text-xs tw:font-normal ${
                    counts.flagged > 0
                      ? 'tw:bg-red-100 tw:text-red-700'
                      : 'tw:bg-slate-200 tw:text-slate-600'
                  }`}
                >
                  {counts.flagged + counts['in-progress'] + counts.pending}
                </span>
              )}
            </span>
          </div>
          <div className="tw:flex tw:gap-1.5 tw:items-center">
            {saving && <span className="tw:text-gray-400 tw:text-xs">Guardando…</span>}
            <button
              className="tw:relative tw:p-1.5 tw:rounded tw:hover:bg-gray-100 tw:text-slate-600 tw:cursor-pointer tw:flex tw:items-center tw:justify-center"
              title="Configurar notificaciones"
              onClick={() => setShowNotifSettings((v) => !v)}
            >
              <svg
                className="tw:w-4 tw:h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                ></path>
              </svg>
              {notifications.length > 0 && (
                <span className="tw:absolute tw:-top-0.5 tw:-right-0.5 tw:bg-red-500 tw:text-white tw:text-[10px] tw:rounded-full tw:w-4 tw:h-4 tw:flex tw:items-center tw:justify-center tw:leading-none">
                  {notifications.length}
                </span>
              )}
            </button>
            <button
              className="tw:px-2.5 tw:py-1 tw:bg-slate-100 tw:hover:bg-slate-200 tw:border tw:border-slate-200 tw:rounded tw:text-xs tw:font-medium tw:text-slate-700 tw:cursor-pointer"
              onClick={() => selectProject()}
              title="Cambiar proyecto"
            >
              Cambiar Proyecto
            </button>
            <button
              className="tw:px-2.5 tw:py-1 tw:bg-slate-100 tw:hover:bg-slate-200 tw:border tw:border-slate-200 tw:rounded tw:text-xs tw:font-medium tw:text-slate-700 tw:cursor-pointer"
              onClick={loadData}
              title="Actualizar"
            >
              Actualizar
            </button>
          </div>
        </div>

        {/* User identity row */}
        {sidebarVisible && !loading && (
          <div className="tw:mt-1.5">
            {currentUser && !showUserPicker ? (
              <div className="tw:flex tw:items-center tw:gap-2 tw:text-xs">
                <span className="tw:text-gray-600">
                  Usuario: <strong>{currentUser}</strong>
                </span>
                <button
                  className="tw:text-slate-500 tw:hover:underline tw:text-xs"
                  onClick={() => setShowUserPicker(true)}
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <div className="tw:bg-yellow-50 tw:border tw:border-yellow-200 tw:rounded tw:px-2 tw:py-1.5 tw:flex tw:items-center tw:gap-2">
                <span className="tw:text-yellow-800 tw:text-xs tw:flex-shrink-0">¿Quién eres?</span>
                <select
                  className="tw:flex-1 tw:border tw:rounded tw:px-2 tw:py-0.5 tw:text-xs"
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
                    className="tw:text-xs tw:text-gray-500 tw:hover:text-gray-700 tw:flex-shrink-0"
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
        {sidebarVisible && (
          <div className="tw:flex tw:gap-3 tw:mt-1.5 tw:text-xs tw:flex-wrap">
            <span className="tw:text-red-600">Banderas: {counts.flagged}</span>
            <span className="tw:text-yellow-700">En progreso: {counts['in-progress']}</span>
            <span className="tw:text-gray-500">Pendientes: {counts.pending}</span>
            <span className="tw:text-green-600">Completadas: {counts.complete}</span>
          </div>
        )}

        {/* Filter tabs */}
        {sidebarVisible && (
          <div className="tw:flex tw:gap-1 tw:mt-2">
            {[
              { key: 'active', label: 'Activas' },
              { key: 'flagged', label: 'Banderas' },
              { key: 'complete', label: 'Completas' },
              { key: 'all', label: 'Todas' },
            ].map(({ key, label }) => (
              <button
                key={key}
                className={`tw:px-2 tw:py-0.5 tw:rounded tw:text-xs tw:border ${
                  filterStatus === key
                    ? 'tw:bg-slate-600 tw:text-white tw:border-slate-600'
                    : 'tw:bg-white tw:text-gray-600 tw:border-gray-200 tw:hover:bg-gray-50'
                }`}
                onClick={() => setFilterStatus(key)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Search box */}
        {sidebarVisible && (
          <div className="tw:relative tw:mt-1.5">
            <input
              type="text"
              placeholder="Buscar libro, cap., notas, etapa…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="tw:w-full tw:border tw:border-gray-200 tw:rounded tw:px-2 tw:py-0.5 tw:text-xs tw:pr-6 tw:focus:outline-none tw:focus:border-slate-400"
            />
            {searchText && (
              <button
                className="tw:absolute tw:right-1.5 tw:top-1/2 tw:-translate-y-1/2 tw:text-gray-400 tw:hover:text-gray-600 tw:leading-none"
                onClick={() => setSearchText('')}
                title="Limpiar búsqueda"
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* Notification settings panel */}
        {sidebarVisible && showNotifSettings && (
          <div className="tw:mt-2 tw:p-2 tw:bg-gray-50 tw:border tw:border-gray-200 tw:rounded-lg tw:text-xs tw:space-y-1.5">
            <div className="tw:font-semibold tw:text-gray-700">Configuración de notificaciones</div>
            <label className="tw:flex tw:items-center tw:gap-2">
              <input
                type="checkbox"
                checked={notifEnabled}
                onChange={(e) => setNotifEnabled(e.target.checked)}
              />
              Activar notificaciones
            </label>
            <label className="tw:flex tw:items-center tw:gap-2">
              <input
                type="checkbox"
                checked={notifNewTasks}
                disabled={!notifEnabled}
                onChange={(e) => setNotifNewTasks(e.target.checked)}
              />
              Nuevas tareas asignadas a mí
            </label>
            <label className="tw:flex tw:items-center tw:gap-2">
              <input
                type="checkbox"
                checked={notifStatusChanges}
                disabled={!notifEnabled}
                onChange={(e) => setNotifStatusChanges(e.target.checked)}
              />
              Cambios de estado
            </label>
            <label className="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
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
                className="tw:w-12 tw:px-1 tw:border tw:border-gray-300 tw:rounded tw:text-center"
              />
              días de anticipación
            </label>
          </div>
        )}
      </div>

      {error && (
        <div className="tw:bg-red-50 tw:border-b tw:border-red-200 tw:px-3 tw:py-1.5 tw:text-red-700 tw:text-xs">
          {error}
        </div>
      )}

      {/* Notification banner */}
      {notifications.length > 0 && (
        <div className="tw:mx-2 tw:mt-2 tw:p-2.5 tw:bg-slate-50 tw:border tw:border-slate-300 tw:rounded-lg">
          <div className="tw:flex tw:items-start tw:justify-between tw:gap-2">
            <div className="tw:space-y-1">
              {notifications.map((msg, i) => (
                <p key={i} className="tw:text-xs tw:text-slate-700">
                  {msg}
                </p>
              ))}
            </div>
            <button
              onClick={markSeen}
              className="tw:text-xs tw:text-slate-600 tw:hover:text-slate-800 tw:whitespace-nowrap tw:flex-shrink-0 tw:border tw:border-slate-300 tw:rounded tw:px-2 tw:py-0.5"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      <div className="tw:mx-2 tw:mt-2 tw:flex-shrink-0">
        <UnreadNotesWidget
          projectId={projectId}
          currentUser={currentUser}
          onRefreshTrigger={loadData}
        />
      </div>

      {/* Task list */}
      {loading ? (
        <div className="tw:flex tw:items-center tw:justify-center tw:flex-1 tw:text-gray-400">
          Cargando…
        </div>
      ) : visibleTasks.length === 0 ? (
        <div className="tw:flex tw:flex-col tw:items-center tw:justify-center tw:flex-1 tw:text-gray-400 tw:gap-1">
          <span>
            {searchText.trim()
              ? `Sin resultados para "${searchText.trim()}".`
              : filterStatus === 'active'
                ? 'No hay tareas activas.'
                : 'No hay tareas.'}
          </span>
          {searchText.trim() && (
            <button
              className="tw:text-xs tw:text-slate-500 tw:hover:underline"
              onClick={() => setSearchText('')}
            >
              Limpiar búsqueda
            </button>
          )}
        </div>
      ) : (
        <div className="tw:flex-1 tw:overflow-y-auto tw:p-2 tw:space-y-1.5">
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
