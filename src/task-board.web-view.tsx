import { WebViewProps } from '@papi/core';
import papi from '@papi/frontend';
import { useDialogCallback } from '@papi/frontend/react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ProjectTask, TranslationStage, TaskStatus, StageConfig, TaskStore, StageAssignee, ActivityLogEntry } from './types/task.types';
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
}: {
  task: ProjectTask;
  stageConfig: Record<string, StageConfig>;
  orderedStages: string[];
  teamMembers: string[];
  onClose: () => void;
  onSave: (updated: ProjectTask) => void;
}) {
  const [book, setBook] = useState(task.book);
  const [chapter, setChapter] = useState(task.chapter);
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

  const toggleAssignee = (name: string) => {
    setAssignees((prev) =>
      prev.includes(name) ? prev.filter((a) => a !== name) : [...prev, name],
    );
  };

  const handleSave = () => {
    const now = new Date().toISOString();
    const updated: ProjectTask = {
      ...task,
      book,
      chapter,
      stage,
      assignedTo: assignees,
      notes,
      updatedAt: now,
      deadline: deadline || undefined,
      estimatedHours: estimatedHours !== '' ? parseFloat(estimatedHours) : undefined,
      loggedHours: loggedHours !== '' ? parseFloat(loggedHours) : undefined,
    };
    onSave(updated);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl p-5 w-96 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold mb-3">Editar Tarea</h3>
        <div className="space-y-3 text-sm">
          <div>
            <label className="block font-medium mb-1">Libro</label>
            <select
              className="w-full border rounded px-2 py-1"
              value={book}
              onChange={(e) => setBook(e.target.value)}
            >
              {BIBLE_BOOKS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-medium mb-1">Capítulo</label>
            <input
              type="number"
              min={1}
              className="w-full border rounded px-2 py-1"
              value={chapter}
              onChange={(e) => setChapter(Math.max(1, parseInt(e.target.value) || 1))}
            />
          </div>
          <div>
            <label className="block font-medium mb-1">Etapa</label>
            <select
              className="w-full border rounded px-2 py-1"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
            >
              {orderedStages.map((s) => (
                <option key={s} value={s}>{getStageLabel(s, stageConfig)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-medium mb-1">Asignar a</label>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {teamMembers.map((m) => (
                <label key={m} className="flex items-center gap-1 cursor-pointer">
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
            <label className="block font-medium mb-1">Notas</label>
            <textarea
              className="w-full border rounded px-2 py-1"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div>
            <label className="block font-medium mb-1">Fecha Límite</label>
            <input
              type="date"
              className="w-full border rounded px-2 py-1"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block font-medium mb-1">Horas Estimadas</label>
              <input
                type="number"
                min={0}
                step={0.5}
                className="w-full border rounded px-2 py-1"
                value={estimatedHours}
                placeholder="0"
                onChange={(e) => setEstimatedHours(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <label className="block font-medium mb-1">Horas Registradas</label>
              <input
                type="number"
                min={0}
                step={0.5}
                className="w-full border rounded px-2 py-1"
                value={loggedHours}
                placeholder="0"
                onChange={(e) => setLoggedHours(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4 justify-end">
          <button
            className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className="px-3 py-1.5 bg-slate-600 text-white rounded text-sm hover:bg-slate-700"
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
  const [localConfig, setLocalConfig] = useState<Record<string, StageConfig>>(
    () => {
      const init: Record<string, StageConfig> = {};
      orderedStages.forEach((stage, idx) => {
        init[stage] = {
          ...stageConfig[stage],                     // preserve all existing fields
          label: getStageLabel(stage, stageConfig),  // display label
          order: stageConfig[stage]?.order ?? idx,   // stored order or fallback
        };
      });
      return init;
    },
  );
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
    const key = 'custom-' + generateId();
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
      return { ...prev, [stage]: { ...prev[stage], assignees: [...existing, { person, books: [] }] } };
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
    <div className="bg-slate-50 border-b border-slate-200 px-3 py-2 text-sm">
      <div className="flex justify-between items-center mb-2">
        <span className="font-semibold text-slate-700 text-xs">Configurar Etapas</span>
        <button className="text-xs text-gray-500 hover:text-gray-700" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {localOrdered.map((stage, idx) => (
          <div key={stage} className="space-y-0.5">
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-0.5">
                <button
                  className="text-xs leading-none px-1 py-0.5 bg-white border rounded hover:bg-gray-50 disabled:opacity-30"
                  disabled={idx === 0}
                  onClick={() => moveStage(stage, 'up')}
                >
                  ▲
                </button>
                <button
                  className="text-xs leading-none px-1 py-0.5 bg-white border rounded hover:bg-gray-50 disabled:opacity-30"
                  disabled={idx === localOrdered.length - 1}
                  onClick={() => moveStage(stage, 'down')}
                >
                  ▼
                </button>
              </div>
              <input
                className="flex-1 border rounded px-2 py-0.5 text-xs"
                value={localConfig[stage]?.label ?? getStageLabel(stage)}
                onChange={(e) => updateLabel(stage, e.target.value)}
              />
              {STAGES.includes(stage as TranslationStage) ? (
                <span className="text-xs text-gray-400 w-28 truncate" title={stage}>
                  {stage}
                </span>
              ) : (
                <button
                  className="text-red-400 hover:text-red-600 px-1 text-sm flex-shrink-0"
                  title="Eliminar etapa"
                  onClick={() => deleteStage(stage)}
                >
                  🗑
                </button>
              )}
            </div>
            {/* Person-centric assignees */}
            <div className="pl-7 mt-1 space-y-1">
              {(localConfig[stage]?.assignees ?? []).map((sa: StageAssignee) => (
                <div key={sa.person} className="border border-gray-200 rounded p-1.5 bg-white space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-700">{sa.person}</span>
                    <button
                      type="button"
                      onClick={() => removeAssignee(stage, sa.person)}
                      className="text-xs text-red-400 hover:text-red-600 leading-none"
                    >
                      × quitar
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 items-center">
                    {sa.books.length === 0 && (
                      <span className="text-xs text-gray-400 italic">todos los libros</span>
                    )}
                    {sa.books.map((b) => (
                      <span key={b} className="text-xs bg-slate-100 text-slate-700 px-1 rounded flex items-center gap-0.5">
                        {b}
                        <button
                          type="button"
                          onClick={() => removeAssigneeBook(stage, sa.person, b)}
                          className="text-slate-500 hover:text-red-500 leading-none ml-0.5"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <select
                      value=""
                      onChange={(e) => addAssigneeBook(stage, sa.person, e.target.value)}
                      className="text-xs border rounded px-1 py-0 leading-tight"
                    >
                      <option value="">+ libro</option>
                      {BIBLE_BOOKS.filter((b) => !sa.books.includes(b)).map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
              {/* Add a new person */}
              <select
                value=""
                onChange={(e) => addAssignee(stage, e.target.value)}
                className="text-xs border rounded px-1 py-0.5 leading-tight"
              >
                <option value="">+ Agregar persona</option>
                {teamMembers.filter(
                  (m) => !(localConfig[stage]?.assignees ?? []).some((sa) => sa.person === m),
                ).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>
      {/* Add new custom stage */}
      <div className="flex gap-2 mt-3 pt-3 border-t border-blue-200">
        <input
          type="text"
          placeholder="Nombre de nueva etapa..."
          value={newStageLabel}
          onChange={(e) => setNewStageLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addStage()}
          className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded"
        />
        <button
          onClick={addStage}
          className="px-3 py-1 text-xs bg-slate-500 text-white rounded hover:bg-slate-600 flex-shrink-0"
        >
          + Agregar
        </button>
      </div>
      <div className="flex gap-2 mt-2 justify-end">
        <button
          className="px-2 py-1 text-xs border rounded hover:bg-gray-50"
          onClick={onClose}
        >
          Cancelar
        </button>
        <button
          className="px-2 py-1 text-xs bg-slate-600 text-white rounded hover:bg-slate-700"
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
  deleted: '🗑',
  edited: '✎',
};

function ActivityLogPanel({
  log,
  onClose,
}: {
  log: ActivityLogEntry[];
  onClose: () => void;
}) {
  return (
    <div className="bg-slate-50 border-b border-slate-200 px-3 py-2 text-xs">
      <div className="flex justify-between items-center mb-2">
        <span className="font-semibold text-slate-700">Registro de Actividad</span>
        <button className="text-gray-500 hover:text-gray-700" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="max-h-52 overflow-y-auto space-y-1">
        {log.length === 0 ? (
          <p className="text-gray-400 italic">Sin actividad registrada todavía.</p>
        ) : (
          [...log].reverse().map((entry) => {
            const d = new Date(entry.timestamp);
            const dateStr = d.toLocaleDateString('es', { month: 'short', day: 'numeric' });
            const timeStr = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
            return (
              <div key={entry.id} className="flex gap-2 text-gray-600 leading-relaxed">
                <span className="text-gray-400 flex-shrink-0 w-24 text-right tabular-nums">
                  {dateStr} {timeStr}
                </span>
                <span className="text-gray-400 flex-shrink-0">{ACTION_ICONS[entry.action]}</span>
                <span>
                  <span className="font-medium text-gray-700">{entry.taskLabel}</span>
                  {entry.detail && (
                    <span className="text-gray-500"> — {entry.detail}</span>
                  )}
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
  stageConfig,
  orderedStages,
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
    !!task.deadline &&
    task.status !== 'complete' &&
    new Date(task.deadline).getTime() < Date.now();

  return (
    <div
      className={`rounded shadow-sm p-2 text-xs hover:shadow transition-all ${
        isDragging ? 'opacity-40 cursor-grabbing' : 'cursor-grab'
      } ${isOverdue ? 'bg-red-50 border-l-2 border-red-400' : 'bg-white'}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('taskId', task.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(task.id);
      }}
      onDragEnd={onDragEnd}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex justify-between items-start gap-1">
        <span className="font-semibold">
          {task.book} {task.chapter}
        </span>
        <span className={`px-1.5 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[task.status]}`}>
          {STATUS_LABELS[task.status]}
        </span>
      </div>
      {(task.assignedTo ?? []).length > 0 && (
        <div className="text-gray-500 mt-0.5 truncate">{(task.assignedTo ?? []).join(', ')}</div>
      )}
      {task.deadline && (
        <div className={`mt-0.5 ${dlClass}`}>
          ⏰ {new Date(task.deadline).toLocaleDateString('es')}
        </div>
      )}
      {(task.estimatedHours !== undefined || task.loggedHours !== undefined) && (
        <div className="text-gray-400 mt-0.5">
          {task.loggedHours ?? 0}h / {task.estimatedHours ?? '?'}h
        </div>
      )}
      {expanded && (
        <div className="mt-2 pt-2 border-t border-gray-100" onClick={(e) => e.stopPropagation()}>
          {task.notes && (
            <p className="text-gray-600 mb-2 whitespace-pre-wrap">{task.notes}</p>
          )}
          <div className="flex flex-wrap gap-1 mb-2">
            {statuses.map((s) => (
              <button
                key={s}
                className={`px-1.5 py-0.5 rounded border text-xs ${
                  task.status === s
                    ? `${STATUS_COLORS[s]} border-transparent font-semibold`
                    : 'bg-white border-gray-200 hover:bg-gray-50'
                }`}
                onClick={() => onStatusChange(task.id, s)}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <button
              className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 text-xs"
              onClick={() => onEdit(task)}
            >
              Editar
            </button>
            {confirmDelete ? (
              <div className="flex items-center gap-1 ml-auto">
                <span className="text-xs text-red-600">¿Borrar?</span>
                <button
                  className="px-1.5 py-0.5 rounded bg-red-600 text-white text-xs hover:bg-red-700"
                  onClick={() => onDelete(task.id)}
                >
                  Sí
                </button>
                <button
                  className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200 text-xs hover:bg-gray-200"
                  onClick={() => setConfirmDelete(false)}
                >
                  No
                </button>
              </div>
            ) : (
              <button
                className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 ml-auto text-xs"
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
  onAdd: (tasks: Omit<ProjectTask, 'id' | 'createdAt' | 'updatedAt' | 'status'>[], status: TaskStatus) => void;
}) {
  const [book, setBook] = useState<string>('GEN');
  const [chapterFrom, setChapterFrom] = useState(1);
  const [chapterTo, setChapterTo] = useState(1);
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

  const count = Math.max(1, chapterTo - chapterFrom + 1);

  const handleCreate = () => {
    const partials: Omit<ProjectTask, 'id' | 'createdAt' | 'updatedAt' | 'status'>[] = [];
    for (let ch = chapterFrom; ch <= chapterTo; ch++) {
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
      className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl p-5 w-80 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold mb-3">Nueva Tarea</h3>
        <div className="space-y-3 text-sm">
          <div>
            <label className="block font-medium mb-1">Libro</label>
            <select
              className="w-full border rounded px-2 py-1"
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
            <label className="block font-medium mb-1">Capítulo(s)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                className="w-full border rounded px-2 py-1"
                value={chapterFrom}
                onChange={(e) => {
                  const v = Math.max(1, parseInt(e.target.value) || 1);
                  setChapterFrom(v);
                  if (chapterTo < v) setChapterTo(v);
                }}
              />
              <span className="text-gray-500 flex-shrink-0 text-xs">al</span>
              <input
                type="number"
                min={chapterFrom}
                className="w-full border rounded px-2 py-1"
                value={chapterTo}
                onChange={(e) =>
                  setChapterTo(Math.max(chapterFrom, parseInt(e.target.value) || chapterFrom))
                }
              />
            </div>
            {count > 1 && (
              <p className="text-xs text-slate-500 mt-1">
                Se crearán {count} tareas (caps. {chapterFrom}–{chapterTo})
              </p>
            )}
          </div>
          <div>
            <label className="block font-medium mb-1">Etapa</label>
            <select
              className="w-full border rounded px-2 py-1"
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
            <label className="block font-medium mb-1">Asignar a</label>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {teamMembers.map((m) => (
                <label key={m} className="flex items-center gap-1 cursor-pointer">
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
            <label className="block font-medium mb-1">Notas</label>
            <textarea
              className="w-full border rounded px-2 py-1"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Instrucciones o contexto opcional..."
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block font-medium mb-1">Fecha Límite</label>
              <input
                type="date"
                className="w-full border rounded px-2 py-1"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <label className="block font-medium mb-1">Horas Estimadas</label>
              <input
                type="number"
                min={0}
                step={0.5}
                className="w-full border rounded px-2 py-1"
                value={estimatedHours}
                placeholder="0"
                onChange={(e) => setEstimatedHours(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block font-medium mb-1">Estado inicial</label>
            <div className="flex gap-2 flex-wrap">
              {(['pending', 'in-progress', 'flagged'] as TaskStatus[]).map((s) => (
                <label key={s} className="flex items-center gap-1 cursor-pointer text-xs">
                  <input
                    type="radio"
                    name="initialStatus"
                    checked={initialStatus === s}
                    onChange={() => setInitialStatus(s)}
                  />
                  <span className={`px-1.5 py-0.5 rounded-full ${STATUS_COLORS[s]}`}>
                    {STATUS_LABELS[s]}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4 justify-end">
          <button
            className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className="px-3 py-1.5 bg-slate-600 text-white rounded text-sm hover:bg-slate-700"
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
  const [filterAssignee, setFilterAssignee] = useWebViewState<string>('filterAssignee', 'all');
  const [filterBook, setFilterBook] = useWebViewState<string>('filterBook', 'all');
  const [showNewTask, setShowNewTask] = useState(false);
  const [showStageConfig, setShowStageConfig] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [hideCompleted, setHideCompleted] = useWebViewState<boolean>('hideCompleted', false);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

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

  const loadTasks = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    try {
      const [result, membersResult] = await Promise.all([
        papi.commands.sendCommand('paratextProjectManager.getTasks', projectId),
        papi.commands.sendCommand('paratextProjectManager.getTeamMembers'),
      ]);
      const store = JSON.parse(result) as TaskStore;
      const knownDeleted = store.deletedTaskIds ?? [];
      setDeletedTaskIds(knownDeleted);
      setTasks((store.tasks ?? []).filter(t => !knownDeleted.includes(t.id)));
      setStageConfig(store.stageConfig ?? {});
      setActivityLog(store.activityLog ?? []);
      if (membersResult) setTeamMembers(JSON.parse(membersResult as string) as string[]);
    } catch (e) {
      setError(`Error al cargar tareas: ${e}`);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Background auto-refresh — silently picks up changes saved by other computers
  const savingRef = useRef(false);
  useEffect(() => { savingRef.current = saving; }, [saving]);

  /** Silently merges Drive data into local state without showing a loading spinner. */
  const lastRefreshRef = useRef(0);

  const silentRefresh = useCallback(async () => {
    if (!projectId || savingRef.current) return;
    try {
      const result = await papi.commands.sendCommand('paratextProjectManager.getTasks', projectId);
      const store = JSON.parse(result as string) as TaskStore;
      lastRefreshRef.current = Date.now();
      const incomingDeleted = new Set(store.deletedTaskIds ?? []);
      // Merge tombstones: add any newly deleted IDs from Drive
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
        // Remove any locally-present tasks that Drive tombstoned
        for (const id of incomingDeleted) merged.delete(id);
        return Array.from(merged.values());
      });
      if (store.stageConfig && Object.keys(store.stageConfig).length > 0) setStageConfig(store.stageConfig);
      if (store.activityLog) setActivityLog(store.activityLog);
      // Check whether any pending syncs have been resolved by the background loop
      try {
        const pendingRaw = await papi.commands.sendCommand('paratextProjectManager.tasksDriveGetPendingSync');
        const pending = JSON.parse(pendingRaw as string) as string[];
        if (!pending.includes(projectId)) setSyncPending(false);
      } catch (_) { /* ignore */ }
    } catch (_) { /* silent */ }
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

  /**
   * Opens the edit modal — but first fetches the latest version of the task from Drive
   * so the modal never starts from a stale copy that could overwrite a team member's changes.
   */
  const openEditModal = useCallback(async (task: ProjectTask) => {
    if (!projectId) return;
    try {
      const result = await papi.commands.sendCommand('paratextProjectManager.getTasks', projectId);
      const store = JSON.parse(result as string) as TaskStore;
      const fresh = store.tasks?.find(t => t.id === task.id);
      setEditingTask(fresh ?? task);
      // Also update the board with the fresh data while we're here
      setTasks(prev => {
        const merged = new Map(prev.map(t => [t.id, t]));
        for (const t of store.tasks ?? []) {
          const existing = merged.get(t.id);
          if (!existing || t.updatedAt >= existing.updatedAt) merged.set(t.id, t);
        }
        return Array.from(merged.values());
      });
      if (store.stageConfig && Object.keys(store.stageConfig).length > 0) setStageConfig(store.stageConfig);
    } catch (_) {
      setEditingTask(task); // fall back to local copy on error
    }
  }, [projectId]);

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
        setError(`Error al guardar: ${e}`);
      } finally {
        setSaving(false);
      }
    },
    [projectId, stageConfig, activityLog, deletedTaskIds],
  );

  const addTask = useCallback(
    async (partials: Omit<ProjectTask, 'id' | 'createdAt' | 'updatedAt' | 'status'>[], status: TaskStatus = 'pending') => {
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
            ? { ...t, stage: targetStage, assignedTo, status: 'pending' as const, updatedAt: new Date().toISOString() }
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
        setError(`Error al guardar etapas: ${e}`);
      } finally {
        setSaving(false);
      }
    },
    [tasks, activityLog, projectId, deletedTaskIds],
  );

  const orderedStages = useMemo(() => getOrderedStages(stageConfig), [stageConfig]);

  const usedBooks = [...new Set(tasks.map((t) => t.book))].sort();

  const filteredTasks = tasks.filter((t) => {
    if (filterAssignee !== 'all' && !(t.assignedTo ?? []).includes(filterAssignee)) return false;
    if (filterBook !== 'all' && t.book !== filterBook) return false;
    if (hideCompleted && t.status === 'complete') return false;
    return true;
  });

  if (!projectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-4 text-sm">
        <p className="text-gray-600">Ningún proyecto seleccionado.</p>
        <button
          className="px-4 py-2 bg-slate-600 text-white rounded hover:bg-slate-700"
          onClick={selectProject}
        >
          Seleccionar Proyecto
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 text-sm select-none">
      {/* Header */}
      <div className="flex items-center flex-wrap gap-2 px-3 py-2 bg-white border-b shadow-sm">
        <span className="font-semibold text-gray-700">Tablero de Tareas</span>
        <div className="flex gap-1 items-center ml-auto flex-wrap">
          <button
            className="px-2 py-0.5 bg-gray-100 rounded text-xs hover:bg-gray-200"
            onClick={selectProject}
            title="Cambiar proyecto"
          >
            ⇄
          </button>
          {saving && <span className="text-gray-400 text-xs">Guardando…</span>}
          {!saving && syncPending && (
            <span className="text-amber-600 text-xs" title="Sin conexión a Drive — se sincronizará automáticamente cuando haya internet">
              ☁ Pendiente
            </span>
          )}
          <select
            className="border rounded px-2 py-0.5 text-xs"
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
            className="border rounded px-2 py-0.5 text-xs"
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
            className={`px-2 py-0.5 rounded text-xs border ${
              hideCompleted
                ? 'bg-slate-100 text-slate-700 border-slate-300'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 border-transparent'
            }`}
            onClick={() => setHideCompleted(!hideCompleted)}
            title={hideCompleted ? 'Mostrar completas' : 'Esconder completas'}
          >
            {hideCompleted ? '🙈 Completas' : '👁 Completas'}
          </button>
          <button
            className="px-2 py-0.5 bg-slate-600 text-white rounded text-xs hover:bg-slate-700"
            onClick={() => setShowNewTask(true)}
          >
            + Nueva
          </button>
          <button
            className={`px-2 py-0.5 rounded text-xs border ${
              showStageConfig
                ? 'bg-slate-100 text-slate-700 border-slate-300'
                : 'bg-gray-100 hover:bg-gray-200 border-transparent'
            }`}
            onClick={() => setShowStageConfig((v) => !v)}
            title="Configurar etapas"
          >
            ⚙ Etapas
          </button>
          <button
            className={`px-2 py-0.5 rounded text-xs border relative ${
              showActivityLog
                ? 'bg-slate-100 text-slate-700 border-slate-300'
                : 'bg-gray-100 hover:bg-gray-200 border-transparent'
            }`}
            onClick={() => setShowActivityLog((v) => !v)}
            title="Registro de actividad"
          >
            📋 Registro
            {activityLog.length > 0 && !showActivityLog && (
              <span className="absolute -top-1 -right-1 bg-slate-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none text-[10px]">
                {activityLog.length > 99 ? '99+' : activityLog.length}
              </span>
            )}
          </button>
          <button
            className="px-2 py-0.5 bg-gray-100 rounded text-xs hover:bg-gray-200"
            onClick={loadTasks}
            title="Actualizar"
          >
            ↻
          </button>
        </div>
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
        <div className="bg-red-50 border-b border-red-200 px-3 py-1.5 text-red-700 text-xs">
          {error}
        </div>
      )}

      {/* Board */}
      {loading ? (
        <div className="flex items-center justify-center flex-1 text-gray-400">Cargando…</div>
      ) : (
        <div className="flex gap-2 p-2 overflow-x-auto flex-1 items-start">
          {orderedStages.map((stage) => {
            const stageTasks = filteredTasks
              .filter((t) => t.stage === stage)
              .sort((a, b) => {
                const statusDiff = STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status];
                if (statusDiff !== 0) return statusDiff;
                const bookDiff = BIBLE_BOOKS.indexOf(a.book as typeof BIBLE_BOOKS[number]) -
                                 BIBLE_BOOKS.indexOf(b.book as typeof BIBLE_BOOKS[number]);
                if (bookDiff !== 0) return bookDiff;
                return (a.chapter ?? 0) - (b.chapter ?? 0);
              });
            const isOver = dragOverStage === stage && draggingTaskId !== null;
            const noAssignees = !stageConfig[stage]?.assignees || stageConfig[stage].assignees!.length === 0;
            return (
              <div
                key={stage}
                className={`flex-shrink-0 w-48 flex flex-col rounded transition-colors ${
                  isOver ? 'ring-2 ring-slate-400 ring-inset' : ''
                }`}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverStage(stage); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverStage(null); }}
                onDrop={(e) => {
                  e.preventDefault();
                  const taskId = e.dataTransfer.getData('taskId');
                  if (taskId) handleDrop(taskId, stage);
                  setDragOverStage(null);
                  setDraggingTaskId(null);
                }}
              >
                <div className={`rounded-t px-2 py-1.5 font-medium text-xs flex items-center justify-between transition-colors ${
                  isOver ? 'bg-slate-300 text-slate-700' : 'bg-gray-200 text-gray-700'
                }`}>
                  <span className="truncate">{getStageLabel(stage, stageConfig)}</span>
                  <div className="flex items-center gap-0.5 flex-shrink-0 ml-1">
                    {noAssignees && (
                      <span className="text-yellow-600" title="Sin responsables configurados">⚠</span>
                    )}
                    <span className="bg-white rounded-full px-1.5 text-gray-500">
                      {stageTasks.length}
                    </span>
                  </div>
                </div>
                <div className={`flex-1 rounded-b p-1.5 space-y-1.5 min-h-16 overflow-y-auto max-h-[calc(100vh-120px)] transition-colors ${
                  isOver ? 'bg-slate-200' : 'bg-gray-100'
                }`}>
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
        />
      )}
    </div>
  );
};
