import { WebViewProps } from '@papi/core';
import papi from '@papi/frontend';
import { useDialogCallback } from '@papi/frontend/react';
import { useState, useEffect, useCallback, useMemo, useRef, type ChangeEvent } from 'react';
import { papiRetry, isPapiDisconnectedError } from './utils/papi-retry';
import { usePapiDisconnect } from './utils/use-papi-disconnect';
import { ReconnectBanner } from './components/reconnect-banner';
import type {
  ProjectTask,
  TranslationStage,
  TaskStatus,
  StageConfig,
  TaskStore,
  StageAssignee,
  ActivityLogEntry,
} from './types/task.types';
import {
  STAGES,
  TEAM_MEMBERS,
  STATUS_LABELS,
  STATUS_COLORS,
  STATUS_SORT_ORDER,
  BIBLE_BOOKS,
  generateId,
  getStageLabel,
  getOrderedStages,
  deadlineColorClass,
} from './types/task.types';

// ---- Edit Task Modal ----

function EditTaskModal({
  task,
  stageConfig,
  orderedStages,
  teamMembers,
  onClose,
  onSave,
  onLiveChange,
}: {
  task: ProjectTask;
  stageConfig: Record<string, StageConfig>;
  orderedStages: string[];
  teamMembers: string[];
  onClose: () => void;
  onSave: (updated: ProjectTask) => void;
  /** Called with the current draft whenever any field changes (debounced, for real-time LAN sync) */
  onLiveChange?: (draft: ProjectTask) => void;
}) {
  const [book, setBook] = useState(task.book);
  const [chapter, setChapter] = useState(String(task.chapter));
  const [stage, setStage] = useState<string>(task.stage);
  const [assignees, setAssignees] = useState<string[]>(task.assignedTo);
  const [notes, setNotes] = useState(task.notes);
  const [deadline, setDeadline] = useState(task.deadline ?? '');
  const [estimatedHours, setEstimatedHours] = useState(
    task.estimatedHours !== undefined ? String(task.estimatedHours) : '',
  );
  const [loggedHours, setLoggedHours] = useState(
    task.loggedHours !== undefined ? String(task.loggedHours) : '',
  );

  // Debounce timer ref for live broadcasting (600 ms after last change)
  const liveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build the current draft from local state values
  const buildDraft = useCallback(
    (
      b: string,
      ch: string,
      st: string,
      asgn: string[],
      n: string,
      dl: string,
      eh: string,
      lh: string,
    ): ProjectTask => ({
      ...task,
      book: b,
      chapter: parseInt(ch) || 1,
      stage: st,
      assignedTo: asgn,
      notes: n,
      updatedAt: new Date().toISOString(),
      deadline: dl || undefined,
      estimatedHours: eh !== '' ? parseFloat(eh) : undefined,
      loggedHours: lh !== '' ? parseFloat(lh) : undefined,
    }),
    [task],
  );

  /** Schedules a live-sync broadcast after a short debounce */
  const scheduleLive = useCallback(
    (
      b: string,
      ch: string,
      st: string,
      asgn: string[],
      n: string,
      dl: string,
      eh: string,
      lh: string,
    ) => {
      if (!onLiveChange) return;
      if (liveDebounceRef.current) clearTimeout(liveDebounceRef.current);
      liveDebounceRef.current = setTimeout(() => {
        onLiveChange(buildDraft(b, ch, st, asgn, n, dl, eh, lh));
      }, 600);
    },
    [onLiveChange, buildDraft],
  );

  // Clean up debounce timer on unmount
  useEffect(
    () => () => {
      if (liveDebounceRef.current) clearTimeout(liveDebounceRef.current);
    },
    [],
  );

  const toggleAssignee = (name: string) => {
    const next = assignees.includes(name)
      ? assignees.filter((a) => a !== name)
      : [...assignees, name];
    setAssignees(next);
    scheduleLive(book, chapter, stage, next, notes, deadline, estimatedHours, loggedHours);
  };

  const handleBookChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setBook(e.target.value);
    scheduleLive(
      e.target.value,
      chapter,
      stage,
      assignees,
      notes,
      deadline,
      estimatedHours,
      loggedHours,
    );
  };
  const handleChapterChange = (e: ChangeEvent<HTMLInputElement>) => {
    setChapter(e.target.value);
    scheduleLive(
      book,
      e.target.value,
      stage,
      assignees,
      notes,
      deadline,
      estimatedHours,
      loggedHours,
    );
  };
  const handleStageChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setStage(e.target.value);
    scheduleLive(
      book,
      chapter,
      e.target.value,
      assignees,
      notes,
      deadline,
      estimatedHours,
      loggedHours,
    );
  };
  const handleNotesChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setNotes(e.target.value);
    scheduleLive(
      book,
      chapter,
      stage,
      assignees,
      e.target.value,
      deadline,
      estimatedHours,
      loggedHours,
    );
  };
  const handleDeadlineChange = (e: ChangeEvent<HTMLInputElement>) => {
    setDeadline(e.target.value);
    scheduleLive(
      book,
      chapter,
      stage,
      assignees,
      notes,
      e.target.value,
      estimatedHours,
      loggedHours,
    );
  };
  const handleEstimatedHoursChange = (e: ChangeEvent<HTMLInputElement>) => {
    setEstimatedHours(e.target.value);
    scheduleLive(book, chapter, stage, assignees, notes, deadline, e.target.value, loggedHours);
  };
  const handleLoggedHoursChange = (e: ChangeEvent<HTMLInputElement>) => {
    setLoggedHours(e.target.value);
    scheduleLive(book, chapter, stage, assignees, notes, deadline, estimatedHours, e.target.value);
  };

  const handleSave = () => {
    if (liveDebounceRef.current) {
      clearTimeout(liveDebounceRef.current);
      liveDebounceRef.current = null;
    }
    onSave(
      buildDraft(book, chapter, stage, assignees, notes, deadline, estimatedHours, loggedHours),
    );
    onClose();
  };

  return (
    <div
      className="tw:fixed tw:inset-0 tw:bg-black tw:bg-opacity-40 tw:flex tw:items-center tw:justify-center tw:z-50"
      onClick={onClose}
    >
      <div
        className="tw:bg-white tw:rounded-lg tw:shadow-xl tw:p-5 tw:w-96 tw:max-h-[90vh] tw:overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="tw:text-base tw:font-semibold tw:mb-3">Editar Tarea</h3>
        <div className="tw:space-y-3 tw:text-sm">
          <div>
            <label className="tw:block tw:font-medium tw:mb-1">Libro</label>
            <select
              className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1"
              value={book}
              onChange={handleBookChange}
            >
              {BIBLE_BOOKS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="tw:block tw:font-medium tw:mb-1">Capítulo</label>
            <input
              type="number"
              min={1}
              className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1"
              value={chapter}
              onChange={handleChapterChange}
            />
          </div>
          <div>
            <label className="tw:block tw:font-medium tw:mb-1">Etapa</label>
            <select
              className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1"
              value={stage}
              onChange={handleStageChange}
            >
              {orderedStages.map((s) => (
                <option key={s} value={s}>
                  {getStageLabel(s, stageConfig)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="tw:block tw:font-medium tw:mb-1">Asignar a</label>
            <div className="tw:flex tw:flex-wrap tw:gap-x-3 tw:gap-y-1">
              {teamMembers.map((m) => (
                <label key={m} className="tw:flex tw:items-center tw:gap-1 tw:cursor-pointer">
                  <input
                    type="checkbox"
                    checked={assignees.includes(m)}
                    onChange={() => toggleAssignee(m)}
                  />
                  {m}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="tw:block tw:font-medium tw:mb-1">Notas</label>
            <textarea
              className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1 tw:select-text"
              rows={3}
              value={notes}
              onChange={handleNotesChange}
            />
          </div>
          <div>
            <label className="tw:block tw:font-medium tw:mb-1">Fecha Límite</label>
            <input
              type="date"
              className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1"
              value={deadline}
              onChange={handleDeadlineChange}
            />
          </div>
          <div className="tw:flex tw:gap-3">
            <div className="tw:flex-1">
              <label className="tw:block tw:font-medium tw:mb-1">Horas Estimadas</label>
              <input
                type="number"
                min={0}
                step={0.5}
                className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1"
                value={estimatedHours}
                placeholder="0"
                onChange={handleEstimatedHoursChange}
              />
            </div>
            <div className="tw:flex-1">
              <label className="tw:block tw:font-medium tw:mb-1">Horas Registradas</label>
              <input
                type="number"
                min={0}
                step={0.5}
                className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1"
                value={loggedHours}
                placeholder="0"
                onChange={handleLoggedHoursChange}
              />
            </div>
          </div>
        </div>
        <div className="tw:flex tw:gap-2 tw:mt-4 tw:justify-end">
          <button
            className="tw:px-3 tw:py-1.5 tw:border tw:rounded tw:text-sm tw:hover:bg-gray-50"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className="tw:px-3 tw:py-1.5 tw:bg-slate-600 tw:text-white tw:rounded tw:text-sm tw:hover:bg-slate-700"
            onClick={handleSave}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Stage Config Panel ----

function StageConfigPanel({
  orderedStages,
  stageConfig,
  teamMembers,
  onUpdateConfig,
  onClose,
}: {
  orderedStages: string[];
  stageConfig: Record<string, StageConfig>;
  teamMembers: string[];
  onUpdateConfig: (updated: Record<string, StageConfig>) => void;
  onClose: () => void;
}) {
  const [localConfig, setLocalConfig] = useState<Record<string, StageConfig>>(() => {
    const init: Record<string, StageConfig> = {};
    orderedStages.forEach((stage, idx) => {
      init[stage] = {
        ...stageConfig[stage], // preserve all existing fields
        label: getStageLabel(stage, stageConfig), // display label
        order: stageConfig[stage]?.order ?? idx, // stored order or fallback
      };
    });
    return init;
  });
  const [newStageLabel, setNewStageLabel] = useState('');

  // All stages sorted by their explicit order value
  const localOrdered = useMemo(
    () =>
      Object.keys(localConfig).sort(
        (a, b) => (localConfig[a]?.order ?? 999) - (localConfig[b]?.order ?? 999),
      ),
    [localConfig],
  );

  const moveStage = (stage: string, direction: 'up' | 'down') => {
    const idx = localOrdered.indexOf(stage);
    if (direction === 'up' && idx <= 0) return;
    if (direction === 'down' && idx >= localOrdered.length - 1) return;
    const swapStage = localOrdered[direction === 'up' ? idx - 1 : idx + 1];
    setLocalConfig((prev) => {
      const currentOrder = prev[stage]?.order ?? idx;
      const swapOrder = prev[swapStage]?.order ?? (direction === 'up' ? idx - 1 : idx + 1);
      const next = { ...prev };
      next[stage] = { ...next[stage], order: swapOrder };
      next[swapStage] = { ...next[swapStage], order: currentOrder };
      return next;
    });
  };

  const updateLabel = (stage: string, label: string) => {
    setLocalConfig((prev) => ({
      ...prev,
      [stage]: { ...(prev[stage] ?? { order: STAGES.indexOf(stage as TranslationStage) }), label },
    }));
  };

  const addStage = () => {
    const label = newStageLabel.trim();
    if (!label) return;
    const key = `custom-${generateId()}`;
    const nextOrder = localOrdered.length;
    setLocalConfig((prev) => ({ ...prev, [key]: { label, order: nextOrder } }));
    setNewStageLabel('');
  };

  const deleteStage = (stage: string) => {
    if (STAGES.includes(stage as TranslationStage)) return; // never delete built-ins
    setLocalConfig((prev) => {
      const next = { ...prev };
      delete next[stage];
      return next;
    });
  };

  const addAssignee = (stage: string, person: string) => {
    if (!person) return;
    setLocalConfig((prev) => {
      const existing = prev[stage]?.assignees ?? [];
      if (existing.some((sa) => sa.person === person)) return prev;
      return {
        ...prev,
        [stage]: { ...prev[stage], assignees: [...existing, { person, books: [] }] },
      };
    });
  };

  const removeAssignee = (stage: string, person: string) => {
    setLocalConfig((prev) => ({
      ...prev,
      [stage]: {
        ...prev[stage],
        assignees: (prev[stage]?.assignees ?? []).filter((sa) => sa.person !== person),
      },
    }));
  };

  const addAssigneeBook = (stage: string, person: string, book: string) => {
    if (!book) return;
    setLocalConfig((prev) => ({
      ...prev,
      [stage]: {
        ...prev[stage],
        assignees: (prev[stage]?.assignees ?? []).map((sa) =>
          sa.person === person ? { ...sa, books: [...sa.books, book] } : sa,
        ),
      },
    }));
  };

  const removeAssigneeBook = (stage: string, person: string, book: string) => {
    setLocalConfig((prev) => ({
      ...prev,
      [stage]: {
        ...prev[stage],
        assignees: (prev[stage]?.assignees ?? []).map((sa) =>
          sa.person === person ? { ...sa, books: sa.books.filter((b) => b !== book) } : sa,
        ),
      },
    }));
  };

  return (
    <div className="tw:bg-slate-50 tw:border-b tw:border-slate-200 tw:px-3 tw:py-2 tw:text-sm">
      <div className="tw:flex tw:justify-between tw:items-center tw:mb-2">
        <span className="tw:font-semibold tw:text-slate-700 tw:text-xs">Configurar Etapas</span>
        <button className="tw:text-xs tw:text-gray-500 tw:hover:text-gray-700" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="tw:space-y-2 tw:max-h-96 tw:overflow-y-auto">
        {localOrdered.map((stage, idx) => (
          <div key={stage} className="tw:space-y-0.5">
            <div className="tw:flex tw:items-center tw:gap-2">
              <div className="tw:flex tw:flex-col tw:gap-0.5">
                <button
                  className="tw:text-xs tw:leading-none tw:px-1 tw:py-0.5 tw:bg-white tw:border tw:rounded tw:hover:bg-gray-50 tw:disabled:opacity-30"
                  disabled={idx === 0}
                  onClick={() => moveStage(stage, 'up')}
                >
                  ▲
                </button>
                <button
                  className="tw:text-xs tw:leading-none tw:px-1 tw:py-0.5 tw:bg-white tw:border tw:rounded tw:hover:bg-gray-50 tw:disabled:opacity-30"
                  disabled={idx === localOrdered.length - 1}
                  onClick={() => moveStage(stage, 'down')}
                >
                  ▼
                </button>
              </div>
              <input
                className="tw:flex-1 tw:border tw:rounded tw:px-2 tw:py-0.5 tw:text-xs"
                value={localConfig[stage]?.label ?? getStageLabel(stage)}
                onChange={(e) => updateLabel(stage, e.target.value)}
              />
              {STAGES.includes(stage as TranslationStage) ? (
                <span className="tw:text-xs tw:text-gray-400 tw:w-28 tw:truncate" title={stage}>
                  {stage}
                </span>
              ) : (
                <button
                  className="tw:text-red-500 tw:hover:text-red-650 tw:px-1.5 tw:py-0.5 tw:border tw:border-red-200 tw:bg-red-50 tw:rounded tw:text-[10px] tw:font-semibold tw:flex-shrink-0 tw:cursor-pointer"
                  title="Eliminar etapa"
                  onClick={() => deleteStage(stage)}
                >
                  Eliminar
                </button>
              )}
            </div>
            {/* Person-centric assignees */}
            <div className="tw:pl-7 tw:mt-1 tw:space-y-1">
              {(localConfig[stage]?.assignees ?? []).map((sa: StageAssignee) => (
                <div
                  key={sa.person}
                  className="tw:border tw:border-gray-200 tw:rounded tw:p-1.5 tw:bg-white tw:space-y-0.5"
                >
                  <div className="tw:flex tw:items-center tw:justify-between">
                    <span className="tw:text-xs tw:font-semibold tw:text-gray-700">
                      {sa.person}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAssignee(stage, sa.person)}
                      className="tw:text-xs tw:text-red-400 tw:hover:text-red-600 tw:leading-none"
                    >
                      × quitar
                    </button>
                  </div>
                  <div className="tw:flex tw:flex-wrap tw:gap-1 tw:items-center">
                    {sa.books.length === 0 && (
                      <span className="tw:text-xs tw:text-gray-400 tw:italic">
                        todos los libros
                      </span>
                    )}
                    {sa.books.map((b) => (
                      <span
                        key={b}
                        className="tw:text-xs tw:bg-slate-100 tw:text-slate-700 tw:px-1 tw:rounded tw:flex tw:items-center tw:gap-0.5"
                      >
                        {b}
                        <button
                          type="button"
                          onClick={() => removeAssigneeBook(stage, sa.person, b)}
                          className="tw:text-slate-500 tw:hover:text-red-500 tw:leading-none tw:ml-0.5"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <select
                      value=""
                      onChange={(e) => addAssigneeBook(stage, sa.person, e.target.value)}
                      className="tw:text-xs tw:border tw:rounded tw:px-1 tw:py-0 tw:leading-tight"
                    >
                      <option value="">+ libro</option>
                      {BIBLE_BOOKS.filter((b) => !sa.books.includes(b)).map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
              {/* Add a new person */}
              <select
                value=""
                onChange={(e) => addAssignee(stage, e.target.value)}
                className="tw:text-xs tw:border tw:rounded tw:px-1 tw:py-0.5 tw:leading-tight"
              >
                <option value="">+ Agregar persona</option>
                {teamMembers
                  .filter(
                    (m) => !(localConfig[stage]?.assignees ?? []).some((sa) => sa.person === m),
                  )
                  .map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        ))}
      </div>
      {/* Add new custom stage */}
      <div className="tw:flex tw:gap-2 tw:mt-3 tw:pt-3 tw:border-t tw:border-blue-200">
        <input
          type="text"
          placeholder="Nombre de nueva etapa..."
          value={newStageLabel}
          onChange={(e) => setNewStageLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addStage()}
          className="tw:flex-1 tw:px-2 tw:py-1 tw:text-xs tw:border tw:border-gray-300 tw:rounded"
        />
        <button
          onClick={addStage}
          className="tw:px-3 tw:py-1 tw:text-xs tw:bg-slate-500 tw:text-white tw:rounded tw:hover:bg-slate-600 tw:flex-shrink-0"
        >
          + Agregar
        </button>
      </div>
      <div className="tw:flex tw:gap-2 tw:mt-2 tw:justify-end">
        <button
          className="tw:px-2 tw:py-1 tw:text-xs tw:border tw:rounded tw:hover:bg-gray-50"
          onClick={onClose}
        >
          Cancelar
        </button>
        <button
          className="tw:px-2 tw:py-1 tw:text-xs tw:bg-slate-600 tw:text-white tw:rounded tw:hover:bg-slate-700"
          onClick={() => {
            onUpdateConfig(localConfig);
            onClose();
          }}
        >
          Guardar
        </button>
      </div>
    </div>
  );
}

// ---- Activity Log Panel ----

const ACTION_ICONS: Record<ActivityLogEntry['action'], string> = {
  created: '✚',
  'status-changed': '⟳',
  'stage-moved': '→',
  deleted: '✖',
  edited: '✎',
};

function ActivityLogPanel({ log, onClose }: { log: ActivityLogEntry[]; onClose: () => void }) {
  return (
    <div className="tw:bg-slate-50 tw:border-b tw:border-slate-200 tw:px-3 tw:py-2 tw:text-xs">
      <div className="tw:flex tw:justify-between tw:items-center tw:mb-2">
        <span className="tw:font-semibold tw:text-slate-700">Registro de Actividad</span>
        <button className="tw:text-gray-500 tw:hover:text-gray-700" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="tw:max-h-52 tw:overflow-y-auto tw:space-y-1">
        {log.length === 0 ? (
          <p className="tw:text-gray-400 tw:italic">Sin actividad registrada todavía.</p>
        ) : (
          [...log].reverse().map((entry) => {
            const d = new Date(entry.timestamp);
            const dateStr = d.toLocaleDateString('es', { month: 'short', day: 'numeric' });
            const timeStr = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
            return (
              <div key={entry.id} className="tw:flex tw:gap-2 tw:text-gray-600 tw:leading-relaxed">
                <span className="tw:text-gray-400 tw:flex-shrink-0 tw:w-24 tw:text-right tw:tabular-nums">
                  {dateStr} {timeStr}
                </span>
                <span className="tw:text-gray-400 tw:flex-shrink-0">
                  {ACTION_ICONS[entry.action]}
                </span>
                <span>
                  <span className="tw:font-medium tw:text-gray-700">{entry.taskLabel}</span>
                  {entry.detail && <span className="tw:text-gray-500"> — {entry.detail}</span>}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ---- Task Card ----

function TaskCard({
  task,
  stageConfig: _stageConfig,
  orderedStages: _orderedStages,
  onStatusChange,
  onDelete,
  onEdit,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  task: ProjectTask;
  stageConfig: Record<string, StageConfig>;
  orderedStages: string[];
  onStatusChange: (id: string, status: TaskStatus) => void;
  onDelete: (id: string) => void;
  onEdit: (task: ProjectTask) => void;
  isDragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const statuses: TaskStatus[] = ['pending', 'in-progress', 'complete', 'flagged'];
  const dlClass = deadlineColorClass(task.deadline);
  const isOverdue =
    !!task.deadline && task.status !== 'complete' && new Date(task.deadline).getTime() < Date.now();

  return (
    <div
      className={`tw:rounded tw:shadow-sm tw:p-2 tw:text-xs tw:hover:shadow tw:transition-all ${
        isDragging ? 'tw:opacity-40 tw:cursor-grabbing' : 'tw:cursor-grab'
      } ${isOverdue ? 'tw:bg-red-50 tw:border-l-2 tw:border-red-400' : 'tw:bg-white'}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('taskId', task.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(task.id);
      }}
      onDragEnd={onDragEnd}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="tw:flex tw:justify-between tw:items-start tw:gap-1">
        <span className="tw:font-semibold">
          {task.book} {task.chapter}
        </span>
        <span
          className={`tw:px-1.5 tw:py-0.5 tw:rounded-full tw:whitespace-nowrap ${STATUS_COLORS[task.status]}`}
        >
          {STATUS_LABELS[task.status]}
        </span>
      </div>
      {(task.assignedTo ?? []).length > 0 && (
        <div className="tw:text-gray-500 tw:mt-0.5 tw:truncate">
          {(task.assignedTo ?? []).join(', ')}
        </div>
      )}
      {task.deadline && (
        <div className={`tw:mt-0.5 ${dlClass}`}>
          Plazo: {new Date(task.deadline).toLocaleDateString('es')}
        </div>
      )}
      {(task.estimatedHours !== undefined || task.loggedHours !== undefined) && (
        <div className="tw:text-gray-400 tw:mt-0.5">
          {task.loggedHours ?? 0}h / {task.estimatedHours ?? '?'}h
        </div>
      )}
      {expanded && (
        <div
          className="tw:mt-2 tw:pt-2 tw:border-t tw:border-gray-100"
          onClick={(e) => e.stopPropagation()}
        >
          {task.notes && (
            <p className="tw:text-gray-600 tw:mb-2 tw:whitespace-pre-wrap">{task.notes}</p>
          )}
          <div className="tw:flex tw:flex-wrap tw:gap-1 tw:mb-2">
            {statuses.map((s) => (
              <button
                key={s}
                className={`tw:px-1.5 tw:py-0.5 tw:rounded tw:border tw:text-xs ${
                  task.status === s
                    ? `${STATUS_COLORS[s]} tw:border-transparent tw:font-semibold`
                    : 'tw:bg-white tw:border-gray-200 tw:hover:bg-gray-50'
                }`}
                onClick={() => onStatusChange(task.id, s)}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          <div className="tw:flex tw:gap-1">
            <button
              className="tw:px-1.5 tw:py-0.5 tw:rounded tw:bg-slate-50 tw:text-slate-600 tw:border tw:border-slate-200 tw:hover:bg-slate-100 tw:text-xs"
              onClick={() => onEdit(task)}
            >
              Editar
            </button>
            {confirmDelete ? (
              <div className="tw:flex tw:items-center tw:gap-1 tw:ml-auto">
                <span className="tw:text-xs tw:text-red-600">¿Borrar?</span>
                <button
                  className="tw:px-1.5 tw:py-0.5 tw:rounded tw:bg-red-600 tw:text-white tw:text-xs tw:hover:bg-red-700"
                  onClick={() => onDelete(task.id)}
                >
                  Sí
                </button>
                <button
                  className="tw:px-1.5 tw:py-0.5 tw:rounded tw:bg-gray-100 tw:text-gray-600 tw:border tw:border-gray-200 tw:text-xs tw:hover:bg-gray-200"
                  onClick={() => setConfirmDelete(false)}
                >
                  No
                </button>
              </div>
            ) : (
              <button
                className="tw:px-1.5 tw:py-0.5 tw:rounded tw:bg-red-50 tw:text-red-600 tw:border tw:border-red-200 tw:hover:bg-red-100 tw:ml-auto tw:text-xs"
                onClick={() => setConfirmDelete(true)}
              >
                Borrar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- New Task Modal ----

function NewTaskModal({
  orderedStages,
  stageConfig,
  teamMembers,
  onClose,
  onAdd,
}: {
  orderedStages: string[];
  stageConfig: Record<string, StageConfig>;
  teamMembers: string[];
  onClose: () => void;
  onAdd: (
    tasks: Omit<ProjectTask, 'id' | 'createdAt' | 'updatedAt' | 'status'>[],
    status: TaskStatus,
  ) => void;
}) {
  const [book, setBook] = useState<string>('GEN');
  const [chapterFrom, setChapterFrom] = useState('1');
  const [chapterTo, setChapterTo] = useState('1');
  const [stage, setStage] = useState<string>(orderedStages[0] ?? 'primer-borrador');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [deadline, setDeadline] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [initialStatus, setInitialStatus] = useState<TaskStatus>('pending');
  // Track whether user has manually overridden the auto-filled assignees
  const userEditedAssignees = useRef(false);

  // Auto-fill assignees from stage config when stage or book changes
  useEffect(() => {
    if (userEditedAssignees.current) return;
    const stageAssignees = stageConfig[stage]?.assignees ?? [];
    const resolved = stageAssignees
      .filter((sa) => sa.books.length === 0 || sa.books.includes(book))
      .map((sa) => sa.person);
    setAssignees(resolved);
  }, [stage, book, stageConfig]);

  const toggleAssignee = (name: string) => {
    userEditedAssignees.current = true;
    setAssignees((prev) =>
      prev.includes(name) ? prev.filter((a) => a !== name) : [...prev, name],
    );
  };

  const chFromParsed = Math.max(1, parseInt(chapterFrom) || 1);
  const chToParsed = Math.max(chFromParsed, parseInt(chapterTo) || chFromParsed);
  const count = chToParsed - chFromParsed + 1;

  const handleCreate = () => {
    const chFrom = chFromParsed;
    const chTo = chToParsed;

    const partials: Omit<ProjectTask, 'id' | 'createdAt' | 'updatedAt' | 'status'>[] = [];
    for (let ch = chFrom; ch <= chTo; ch++) {
      partials.push({
        book,
        chapter: ch,
        stage,
        assignedTo: assignees,
        notes,
        deadline: deadline || undefined,
        estimatedHours: estimatedHours !== '' ? parseFloat(estimatedHours) : undefined,
      });
    }
    onAdd(partials, initialStatus);
    onClose();
  };

  return (
    <div
      className="tw:fixed tw:inset-0 tw:bg-black tw:bg-opacity-40 tw:flex tw:items-center tw:justify-center tw:z-50"
      onClick={onClose}
    >
      <div
        className="tw:bg-white tw:rounded-lg tw:shadow-xl tw:p-5 tw:w-80 tw:max-h-[90vh] tw:overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="tw:text-base tw:font-semibold tw:mb-3">Nueva Tarea</h3>
        <div className="tw:space-y-3 tw:text-sm">
          <div>
            <label className="tw:block tw:font-medium tw:mb-1">Libro</label>
            <select
              className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1"
              value={book}
              onChange={(e) => setBook(e.target.value)}
            >
              {BIBLE_BOOKS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="tw:block tw:font-medium tw:mb-1">Capítulo(s)</label>
            <div className="tw:flex tw:items-center tw:gap-2">
              <input
                type="number"
                min={1}
                className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1"
                value={chapterFrom}
                onChange={(e) => {
                  setChapterFrom(e.target.value);
                  const v = parseInt(e.target.value);
                  if (!isNaN(v)) {
                    const toVal = parseInt(chapterTo);
                    if (isNaN(toVal) || toVal < v) {
                      setChapterTo(String(v));
                    }
                  }
                }}
              />
              <span className="tw:text-gray-500 tw:flex-shrink-0 tw:text-xs">al</span>
              <input
                type="number"
                min={1}
                className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1"
                value={chapterTo}
                onChange={(e) => setChapterTo(e.target.value)}
              />
            </div>
            {count > 1 && (
              <p className="tw:text-xs tw:text-slate-500 tw:mt-1">
                Se crearán {count} tareas (caps. {chFromParsed}–{chToParsed})
              </p>
            )}
          </div>
          <div>
            <label className="tw:block tw:font-medium tw:mb-1">Etapa</label>
            <select
              className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
            >
              {orderedStages.map((s) => (
                <option key={s} value={s}>
                  {getStageLabel(s, stageConfig)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="tw:block tw:font-medium tw:mb-1">Asignar a</label>
            <div className="tw:flex tw:flex-wrap tw:gap-x-3 tw:gap-y-1">
              {teamMembers.map((m) => (
                <label key={m} className="tw:flex tw:items-center tw:gap-1 tw:cursor-pointer">
                  <input
                    type="checkbox"
                    checked={assignees.includes(m)}
                    onChange={() => toggleAssignee(m)}
                  />
                  {m}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="tw:block tw:font-medium tw:mb-1">Notas</label>
            <textarea
              className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Instrucciones o contexto opcional..."
            />
          </div>
          <div className="tw:flex tw:gap-3">
            <div className="tw:flex-1">
              <label className="tw:block tw:font-medium tw:mb-1">Fecha Límite</label>
              <input
                type="date"
                className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>
            <div className="tw:flex-1">
              <label className="tw:block tw:font-medium tw:mb-1">Horas Estimadas</label>
              <input
                type="number"
                min={0}
                step={0.5}
                className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1"
                value={estimatedHours}
                placeholder="0"
                onChange={(e) => setEstimatedHours(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="tw:block tw:font-medium tw:mb-1">Estado inicial</label>
            <div className="tw:flex tw:gap-2 tw:flex-wrap">
              {(['pending', 'in-progress', 'flagged'] as TaskStatus[]).map((s) => (
                <label
                  key={s}
                  className="tw:flex tw:items-center tw:gap-1 tw:cursor-pointer tw:text-xs"
                >
                  <input
                    type="radio"
                    name="initialStatus"
                    checked={initialStatus === s}
                    onChange={() => setInitialStatus(s)}
                  />
                  <span className={`tw:px-1.5 tw:py-0.5 tw:rounded-full ${STATUS_COLORS[s]}`}>
                    {STATUS_LABELS[s]}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="tw:flex tw:gap-2 tw:mt-4 tw:justify-end">
          <button
            className="tw:px-3 tw:py-1.5 tw:border tw:rounded tw:text-sm tw:hover:bg-gray-50"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className="tw:px-3 tw:py-1.5 tw:bg-slate-600 tw:text-white tw:rounded tw:text-sm tw:hover:bg-slate-700"
            onClick={handleCreate}
          >
            {count > 1 ? `Crear ${count} Tareas` : 'Crear Tarea'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Main Task Board Component ----

globalThis.webViewComponent = function TaskBoardWebView({
  projectId,
  useWebViewState,
  updateWebViewDefinition,
}: WebViewProps) {
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [deletedTaskIds, setDeletedTaskIds] = useState<string[]>([]);
  const [teamMembers, setTeamMembers] = useState<string[]>([...TEAM_MEMBERS]);
  const [stageConfig, setStageConfig] = useState<Record<string, StageConfig>>({});
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncPending, setSyncPending] = useState(false);
  const [error, setError] = useState('');
  const { ready, disconnected, disconnectedRef, clearDisconnected, handleCatch } =
    usePapiDisconnect();

  // Auto-dismiss error after 15 seconds
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => {
      setError('');
    }, 15000);
    return () => clearTimeout(timer);
  }, [error]);
  const [filterAssignee, setFilterAssignee] = useWebViewState<string>('filterAssignee', 'all');
  const [filterBook, setFilterBook] = useWebViewState<string>('filterBook', 'all');
  const [showNewTask, setShowNewTask] = useState(false);
  const [showStageConfig, setShowStageConfig] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [hideCompleted, setHideCompleted] = useWebViewState<boolean>('hideCompleted', false);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const [sidebarVisible, setSidebarVisible] = useState(() => {
    const saved = localStorage.getItem('task_board_sidebar_visible');
    return saved !== 'false';
  });

  const toggleSidebar = () => {
    setSidebarVisible((v) => {
      const next = !v;
      localStorage.setItem('task_board_sidebar_visible', String(next));
      return next;
    });
  };

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

  const loadTasksRequestRef = useRef(0);

  const loadTasks = useCallback(async () => {
    if (!projectId) return;
    const requestId = ++loadTasksRequestRef.current;
    const isCurrentRequest = () => requestId === loadTasksRequestRef.current;
    setLoading(true);
    setError('');
    clearDisconnected();
    try {
      const [result, membersResult] = await papiRetry(
        () =>
          Promise.all([
            papi.commands.sendCommand('paratextProjectManager.getTasks', projectId),
            papi.commands.sendCommand('paratextProjectManager.getTeamMembers'),
          ]),
        { isCancelled: () => !isCurrentRequest() },
      );
      if (!isCurrentRequest()) return;
      const store = JSON.parse(result) as TaskStore;
      const knownDeleted = store.deletedTaskIds ?? [];
      setDeletedTaskIds(knownDeleted);
      setTasks((store.tasks ?? []).filter((t) => !knownDeleted.includes(t.id)));
      setStageConfig(store.stageConfig ?? {});
      setActivityLog(store.activityLog ?? []);
      if (membersResult) setTeamMembers(JSON.parse(membersResult) as string[]);
    } catch (retryErr) {
      if (isCurrentRequest()) setError(handleCatch(retryErr, 'Error al cargar tareas: '));
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [projectId, clearDisconnected, handleCatch]);

  useEffect(() => {
    if (ready) loadTasks();
  }, [ready, loadTasks]);

  // Background auto-refresh — silently picks up changes saved by other computers
  const savingRef = useRef(false);
  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  /** Silently merges Drive data into local state without showing a loading spinner. */
  const lastRefreshRef = useRef(0);
  const refreshInProgressRef = useRef(false);

  const silentRefresh = useCallback(async () => {
    if (!projectId || savingRef.current || refreshInProgressRef.current) return;
    if (disconnectedRef.current) return; // skip PAPI calls while disconnected
    refreshInProgressRef.current = true;
    try {
      const result = await papiRetry(() =>
        papi.commands.sendCommand('paratextProjectManager.getTasks', projectId),
      );
      const store = JSON.parse(result) as TaskStore;
      lastRefreshRef.current = Date.now();
      const incomingDeleted = new Set(store.deletedTaskIds ?? []);
      // Merge tombstones: add any newly deleted IDs from Drive
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
        // Remove any locally-present tasks that Drive tombstoned
        for (const id of incomingDeleted) merged.delete(id);
        return Array.from(merged.values());
      });
      if (store.stageConfig && Object.keys(store.stageConfig).length > 0)
        setStageConfig(store.stageConfig);
      if (store.activityLog) setActivityLog(store.activityLog);
      // Check whether any pending syncs have been resolved by the background loop
      try {
        const pendingRaw = await papiRetry(() =>
          papi.commands.sendCommand('paratextProjectManager.tasksDriveGetPendingSync'),
        );
        const pending = JSON.parse(pendingRaw) as string[];
        if (!pending.includes(projectId)) setSyncPending(false);
      } catch (e) {
        if (isPapiDisconnectedError(e)) handleCatch(e);
      }
    } catch (e) {
      // Surface disconnects so the reconnect banner + auto-reload engage;
      // other background-refresh errors stay silent.
      if (isPapiDisconnectedError(e)) setError(handleCatch(e));
    } finally {
      refreshInProgressRef.current = false;
    }
  }, [projectId, handleCatch]);

  // Periodic refresh every 60 s
  useEffect(() => {
    if (!projectId) return undefined;
    const interval = setInterval(silentRefresh, 60_000);
    return () => clearInterval(interval);
  }, [projectId, silentRefresh, handleCatch]);

  // Refresh on visibility change but no more than once every 30 seconds.
  // (Disconnect detection and recovery is handled by usePapiDisconnect.)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (disconnected) return;
      if (Date.now() - lastRefreshRef.current > 30_000) silentRefresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [silentRefresh, disconnected]);

  /**
   * Opens the edit modal — but first fetches the latest version of the task from Drive so the modal
   * never starts from a stale copy that could overwrite a team member's changes.
   */
  const openEditModal = useCallback(
    async (task: ProjectTask) => {
      if (!projectId) return;
      try {
        const result = await papi.commands.sendCommand(
          'paratextProjectManager.getTasks',
          projectId,
        );
        const store = JSON.parse(result) as TaskStore;
        const fresh = store.tasks?.find((t) => t.id === task.id);
        setEditingTask(fresh ?? task);
        // Also update the board with the fresh data while we're here
        setTasks((prev) => {
          const merged = new Map(prev.map((t) => [t.id, t]));
          for (const t of store.tasks ?? []) {
            const existing = merged.get(t.id);
            if (!existing || t.updatedAt >= existing.updatedAt) merged.set(t.id, t);
          }
          return Array.from(merged.values());
        });
        if (store.stageConfig && Object.keys(store.stageConfig).length > 0)
          setStageConfig(store.stageConfig);
      } catch (e) {
        if (isPapiDisconnectedError(e)) handleCatch(e);
        else setEditingTask(task); // fall back to local copy on error
      }
    },
    [projectId],
  );

  const persistTasks = useCallback(
    async (
      updated: ProjectTask[],
      updatedStageConfig?: Record<string, StageConfig>,
      logEntry?: Omit<ActivityLogEntry, 'id' | 'timestamp'>,
      // Pass explicitly to avoid React state-batching: setDeletedTaskIds schedules an
      // async update, so the closure's deletedTaskIds may not yet include a just-deleted ID.
      explicitDeletedIds?: string[],
    ) => {
      if (!projectId) return;
      setSaving(true);
      let newLog = activityLog;
      if (logEntry) {
        const entry: ActivityLogEntry = {
          ...logEntry,
          id: generateId(),
          timestamp: new Date().toISOString(),
        };
        newLog = [...activityLog, entry];
        if (newLog.length > 200) newLog = newLog.slice(-200);
      }
      // Optimistic update — reflect changes immediately, save in background
      setTasks(updated);
      if (updatedStageConfig) setStageConfig(updatedStageConfig);
      if (logEntry) setActivityLog(newLog);
      try {
        const effectiveDeletedIds = explicitDeletedIds ?? deletedTaskIds;
        const store: TaskStore = {
          schemaVersion: 1,
          tasks: updated,
          stageConfig: updatedStageConfig ?? stageConfig,
          activityLog: newLog,
          ...(effectiveDeletedIds.length > 0 ? { deletedTaskIds: effectiveDeletedIds } : {}),
        };
        const saveResult = await papi.commands.sendCommand(
          'paratextProjectManager.saveTasks',
          projectId,
          JSON.stringify(store),
        );
        if (saveResult === 'queued') setSyncPending(true);
        else if (saveResult === 'ok') setSyncPending(false);
      } catch (e) {
        setError(handleCatch(e, 'Error al guardar: '));
      } finally {
        setSaving(false);
      }
    },
    [projectId, stageConfig, activityLog, deletedTaskIds, handleCatch],
  );

  const addTask = useCallback(
    async (
      partials: Omit<ProjectTask, 'id' | 'createdAt' | 'updatedAt' | 'status'>[],
      status: TaskStatus = 'pending',
    ) => {
      const now = new Date().toISOString();
      const newTasks: ProjectTask[] = partials.map((partial) => ({
        ...partial,
        id: generateId(),
        status,
        createdAt: now,
        updatedAt: now,
      }));
      const first = partials[0];
      const taskLabel =
        partials.length === 1
          ? `${first.book} ${first.chapter}`
          : `${partials.length} tareas en ${first.book}`;
      await persistTasks([...tasks, ...newTasks], undefined, {
        action: 'created' as const,
        taskId: newTasks[0]?.id ?? '',
        taskLabel,
        detail: first ? getStageLabel(first.stage, stageConfig) : undefined,
      });
    },
    [tasks, stageConfig, persistTasks],
  );

  const editTask = useCallback(
    async (updated: ProjectTask) => {
      await persistTasks(
        tasks.map((t) => (t.id === updated.id ? updated : t)),
        undefined,
        {
          action: 'edited' as const,
          taskId: updated.id,
          taskLabel: `${updated.book} ${updated.chapter}`,
        },
      );
    },
    [tasks, persistTasks],
  );

  const updateStatus = useCallback(
    async (id: string, status: TaskStatus) => {
      const task = tasks.find((t) => t.id === id);
      const taskLabel = task ? `${task.book} ${task.chapter}` : id;
      const prevLabel = task ? STATUS_LABELS[task.status] : '';
      await persistTasks(
        tasks.map((t) => (t.id === id ? { ...t, status, updatedAt: new Date().toISOString() } : t)),
        undefined,
        {
          action: 'status-changed' as const,
          taskId: id,
          taskLabel,
          detail: `${prevLabel} → ${STATUS_LABELS[status]}`,
        },
      );
    },
    [tasks, persistTasks],
  );

  const deleteTask = useCallback(
    async (id: string) => {
      const task = tasks.find((t) => t.id === id);
      const taskLabel = task ? `${task.book} ${task.chapter}` : id;
      // Compute new IDs synchronously so persistTasks can include the tombstone right away.
      // (setDeletedTaskIds is async — React batches it — so the closure value would be stale.)
      const newDeletedIds = deletedTaskIds.includes(id) ? deletedTaskIds : [...deletedTaskIds, id];
      setDeletedTaskIds(newDeletedIds);
      await persistTasks(
        tasks.filter((t) => t.id !== id),
        undefined,
        { action: 'deleted' as const, taskId: id, taskLabel },
        newDeletedIds,
      );
    },
    [tasks, deletedTaskIds, persistTasks],
  );

  const handleDrop = useCallback(
    async (taskId: string, targetStage: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task || task.stage === targetStage) return;
      // Resolve assignees for the target stage — same logic as advanceTask
      const stageAssignees = stageConfig[targetStage]?.assignees ?? [];
      const assignedTo = stageAssignees
        .filter((sa) => sa.books.length === 0 || sa.books.includes(task.book))
        .map((sa) => sa.person);
      const fromLabel = getStageLabel(task.stage, stageConfig);
      const toLabel = getStageLabel(targetStage, stageConfig);
      await persistTasks(
        tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                stage: targetStage,
                assignedTo,
                status: 'pending' as const,
                updatedAt: new Date().toISOString(),
              }
            : t,
        ),
        undefined,
        {
          action: 'stage-moved' as const,
          taskId,
          taskLabel: `${task.book} ${task.chapter}`,
          detail: `${fromLabel} → ${toLabel}`,
        },
      );
    },
    [tasks, stageConfig, persistTasks],
  );

  const updateStageConfig = useCallback(
    async (newConfig: Record<string, StageConfig>) => {
      if (!projectId) return;
      setSaving(true);
      try {
        const store: TaskStore = {
          schemaVersion: 1,
          tasks,
          stageConfig: newConfig,
          activityLog,
          ...(deletedTaskIds.length > 0 ? { deletedTaskIds } : {}),
        };
        const saveResult = await papi.commands.sendCommand(
          'paratextProjectManager.saveTasks',
          projectId,
          JSON.stringify(store),
        );
        if (saveResult === 'queued') setSyncPending(true);
        else if (saveResult === 'ok') setSyncPending(false);
        setStageConfig(newConfig);
      } catch (e) {
        setError(handleCatch(e, 'Error al guardar etapas: '));
      } finally {
        setSaving(false);
      }
    },
    [tasks, activityLog, projectId, deletedTaskIds, handleCatch],
  );

  const orderedStages = useMemo(() => getOrderedStages(stageConfig), [stageConfig]);

  // --- Real-time collab: subscribe to tasks_update events from teammates ---
  useEffect(() => {
    if (!projectId) return undefined;
    let unsub: any;
    try {
      unsub = papi.network.getNetworkEvent<any>('paratextProjectManager.onCollabEvent')(
        (event: any) => {
          if (!event) return;
          if (event.type === 'tasks_update' && event.payload?.projectId === projectId) {
            silentRefresh();
          }
        },
      );
    } catch (err) {
      if (isPapiDisconnectedError(err)) handleCatch(err);
      else console.warn('[TaskBoard] Error subscribing to collab event:', err);
    }
    return () => {
      if (unsub) unsub();
    };
  }, [projectId, silentRefresh, handleCatch]);

  /** Live-update a task without adding an activity log entry — used for real-time typing sync */
  const liveEditTask = useCallback(
    async (draft: ProjectTask) => {
      if (!projectId) return;
      const updated = tasks.map((t) => (t.id === draft.id ? draft : t));
      // Optimistic UI update
      setTasks(updated);
      // Persist (and broadcast via LAN collab)
      try {
        const store: TaskStore = {
          schemaVersion: 1,
          tasks: updated,
          stageConfig,
          activityLog,
          ...(deletedTaskIds.length > 0 ? { deletedTaskIds } : {}),
        };
        await papi.commands.sendCommand(
          'paratextProjectManager.saveTasks',
          projectId,
          JSON.stringify(store),
        );
      } catch (e) {
        /* Live sync failure is non-critical, the final Save click will still succeed. */
        if (isPapiDisconnectedError(e)) handleCatch(e);
      }
    },
    [projectId, tasks, stageConfig, activityLog, deletedTaskIds],
  );

  const usedBooks = [...new Set(tasks.map((t) => t.book))].sort();

  const filteredTasks = tasks.filter((t) => {
    if (filterAssignee !== 'all' && !(t.assignedTo ?? []).includes(filterAssignee)) return false;
    if (filterBook !== 'all' && t.book !== filterBook) return false;
    if (hideCompleted && t.status === 'complete') return false;
    return true;
  });

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
      <div className="tw:flex tw:items-center tw:flex-wrap tw:gap-2 tw:px-3 tw:py-2 tw:bg-white tw:border-b tw:shadow-sm">
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
            />
          </svg>
        </button>
        <span className="tw:font-semibold tw:text-gray-700">Tablero de Tareas</span>
        {saving && <span className="tw:text-gray-400 tw:text-xs tw:ml-2">Guardando…</span>}
        {!saving && syncPending && (
          <span
            className="tw:text-amber-600 tw:text-xs tw:ml-2"
            title="Sin conexión a Drive — se sincronizará automáticamente cuando haya internet"
          >
            Pendiente de sincronizar
          </span>
        )}

        {sidebarVisible && (
          <div className="tw:flex tw:gap-1.5 tw:items-center tw:ml-auto tw:flex-wrap">
            <button
              className="tw:px-2.5 tw:py-1 tw:bg-slate-100 tw:hover:bg-slate-200 tw:border tw:border-slate-200 tw:rounded tw:text-xs tw:font-medium tw:text-slate-700 tw:cursor-pointer"
              onClick={() => selectProject()}
              title="Cambiar proyecto"
            >
              Cambiar Proyecto
            </button>
            <select
              className="tw:border tw:rounded tw:px-2 tw:py-0.5 tw:text-xs"
              value={filterAssignee}
              onChange={(e) => setFilterAssignee(e.target.value)}
            >
              <option value="all">Todos los miembros</option>
              {teamMembers.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <select
              className="tw:border tw:rounded tw:px-2 tw:py-0.5 tw:text-xs"
              value={filterBook}
              onChange={(e) => setFilterBook(e.target.value)}
            >
              <option value="all">Todos los libros</option>
              {usedBooks.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <button
              className={`tw:px-2.5 tw:py-1 tw:rounded tw:text-xs tw:font-medium tw:border tw:cursor-pointer ${
                hideCompleted
                  ? 'tw:bg-slate-100 tw:text-slate-700 tw:border-slate-300'
                  : 'tw:bg-gray-100 tw:text-gray-500 tw:hover:bg-gray-200 tw:border-transparent'
              }`}
              onClick={() => setHideCompleted(!hideCompleted)}
              title={hideCompleted ? 'Mostrar completas' : 'Esconder completas'}
            >
              {hideCompleted ? 'Mostrar completadas' : 'Ocultar completadas'}
            </button>
            <button
              className="tw:px-2.5 tw:py-1 tw:bg-slate-600 tw:text-white tw:rounded tw:text-xs tw:font-medium tw:hover:bg-slate-700 tw:cursor-pointer"
              onClick={() => setShowNewTask(true)}
            >
              + Nueva Tarea
            </button>
            <button
              className={`tw:px-2.5 tw:py-1 tw:rounded tw:text-xs tw:font-medium tw:border tw:cursor-pointer ${
                showStageConfig
                  ? 'tw:bg-slate-100 tw:text-slate-700 tw:border-slate-300'
                  : 'tw:bg-gray-100 tw:hover:bg-gray-200 tw:border-transparent'
              }`}
              onClick={() => setShowStageConfig((v) => !v)}
              title="Configurar etapas"
            >
              Etapas
            </button>
            <button
              className={`tw:px-2.5 tw:py-1 tw:rounded tw:text-xs tw:font-medium tw:border tw:relative tw:cursor-pointer ${
                showActivityLog
                  ? 'tw:bg-slate-100 tw:text-slate-700 tw:border-slate-300'
                  : 'tw:bg-gray-100 tw:hover:bg-gray-200 tw:border-transparent'
              }`}
              onClick={() => setShowActivityLog((v) => !v)}
              title="Registro de actividad"
            >
              Registro
              {activityLog.length > 0 && !showActivityLog && (
                <span className="tw:absolute tw:-top-1 tw:-right-1 tw:bg-slate-500 tw:text-white tw:text-[10px] tw:rounded-full tw:w-4 tw:h-4 tw:flex tw:items-center tw:justify-center tw:leading-none">
                  {activityLog.length > 99 ? '99+' : activityLog.length}
                </span>
              )}
            </button>
            <button
              className="tw:px-2.5 tw:py-1 tw:bg-slate-100 tw:hover:bg-slate-200 tw:border tw:border-slate-200 tw:rounded tw:text-xs tw:font-medium tw:text-slate-700 tw:cursor-pointer"
              onClick={loadTasks}
              title="Actualizar"
            >
              Actualizar
            </button>
          </div>
        )}
      </div>

      {/* Stage config panel */}
      {showStageConfig && (
        <StageConfigPanel
          orderedStages={orderedStages}
          stageConfig={stageConfig}
          teamMembers={teamMembers}
          onUpdateConfig={updateStageConfig}
          onClose={() => setShowStageConfig(false)}
        />
      )}

      {/* Activity log panel */}
      {showActivityLog && (
        <ActivityLogPanel log={activityLog} onClose={() => setShowActivityLog(false)} />
      )}

      {error && (
        <ReconnectBanner
          error={error}
          disconnected={disconnected}
          onRetry={loadTasks}
          variant="bar"
        />
      )}

      {/* Board */}
      {loading ? (
        <div className="tw:flex tw:items-center tw:justify-center tw:flex-1 tw:text-gray-400">
          Cargando…
        </div>
      ) : (
        <div className="tw:flex tw:gap-2 tw:p-2 tw:overflow-x-auto tw:flex-1 tw:items-start">
          {orderedStages.map((stage) => {
            const stageTasks = filteredTasks
              .filter((t) => t.stage === stage)
              .sort((a, b) => {
                const statusDiff = STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status];
                if (statusDiff !== 0) return statusDiff;
                const bookDiff =
                  BIBLE_BOOKS.indexOf(a.book as (typeof BIBLE_BOOKS)[number]) -
                  BIBLE_BOOKS.indexOf(b.book as (typeof BIBLE_BOOKS)[number]);
                if (bookDiff !== 0) return bookDiff;
                return (a.chapter ?? 0) - (b.chapter ?? 0);
              });
            const isOver = dragOverStage === stage && draggingTaskId !== null;
            const noAssignees =
              !stageConfig[stage]?.assignees || stageConfig[stage].assignees.length === 0;
            return (
              <div
                key={stage}
                className={`tw:flex-shrink-0 tw:w-48 tw:flex tw:flex-col tw:rounded tw:transition-colors ${
                  isOver ? 'tw:ring-2 tw:ring-slate-400 tw:ring-inset' : ''
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDragOverStage(stage);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverStage(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const taskId = e.dataTransfer.getData('taskId');
                  if (taskId) handleDrop(taskId, stage);
                  setDragOverStage(null);
                  setDraggingTaskId(null);
                }}
              >
                <div
                  className={`tw:rounded-t tw:px-2 tw:py-1.5 tw:font-medium tw:text-xs tw:flex tw:items-center tw:justify-between tw:transition-colors ${
                    isOver ? 'tw:bg-slate-300 tw:text-slate-700' : 'tw:bg-gray-200 tw:text-gray-700'
                  }`}
                >
                  <span className="tw:truncate">{getStageLabel(stage, stageConfig)}</span>
                  <div className="tw:flex tw:items-center tw:gap-0.5 tw:flex-shrink-0 tw:ml-1">
                    {noAssignees && (
                      <span
                        className="tw:text-yellow-600 tw:font-bold"
                        title="Sin responsables configurados"
                      >
                        (!)
                      </span>
                    )}
                    <span className="tw:bg-white tw:rounded-full tw:px-1.5 tw:text-gray-500">
                      {stageTasks.length}
                    </span>
                  </div>
                </div>
                <div
                  className={`tw:flex-1 tw:rounded-b tw:p-1.5 tw:space-y-1.5 tw:min-h-16 tw:overflow-y-auto tw:max-h-[calc(100vh-120px)] tw:transition-colors ${
                    isOver ? 'tw:bg-slate-200' : 'tw:bg-gray-100'
                  }`}
                >
                  {stageTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      stageConfig={stageConfig}
                      orderedStages={orderedStages}
                      onStatusChange={updateStatus}
                      onDelete={deleteTask}
                      onEdit={openEditModal}
                      isDragging={draggingTaskId === task.id}
                      onDragStart={setDraggingTaskId}
                      onDragEnd={() => setDraggingTaskId(null)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showNewTask && (
        <NewTaskModal
          orderedStages={orderedStages}
          stageConfig={stageConfig}
          teamMembers={teamMembers}
          onClose={() => setShowNewTask(false)}
          onAdd={addTask}
        />
      )}

      {editingTask && (
        <EditTaskModal
          task={editingTask}
          stageConfig={stageConfig}
          orderedStages={orderedStages}
          teamMembers={teamMembers}
          onClose={() => setEditingTask(null)}
          onSave={editTask}
          onLiveChange={liveEditTask}
        />
      )}
    </div>
  );
};
