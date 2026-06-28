import { WebViewProps } from '@papi/core';
import papi from '@papi/frontend';
import { useDialogCallback } from '@papi/frontend/react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { papiRetry, isPapiDisconnectedError } from './utils/papi-retry';
import { usePapiDisconnect } from './utils/use-papi-disconnect';
import { ReconnectBanner } from './components/reconnect-banner';
import { Avatar } from './components/avatar';
import { AvatarSettingsModal } from './components/avatar-settings-modal';
import type {
  ProjectTask,
  TaskStatus,
  StageConfig,
  TaskStore,
  TimeEntry,
} from './types/task.types';
import {
  BIBLE_BOOKS,
  getOrderedStages,
  getStageLabel,
  TEAM_MEMBERS,
  generateId,
  STATUS_COLORS,
  STATUS_LABELS,
} from './types/task.types';

function getTaskStageStatus(
  task: ProjectTask,
  stage: string,
  orderedStages: string[],
): TaskStatus | undefined {
  const currentIdx = orderedStages.indexOf(task.stage);
  const targetIdx = orderedStages.indexOf(stage);
  if (targetIdx === -1 || currentIdx === -1) return undefined;

  if (currentIdx === targetIdx) {
    return task.status;
  } else if (targetIdx < currentIdx) {
    // Stage came before current stage
    if (task.incompleteStages?.includes(stage)) {
      return 'pending';
    }
    return 'complete';
  } else {
    // Stage is after current stage
    return undefined;
  }
}

interface GcalStatus {
  connected: boolean;
  email: string;
  calendarId: string;
  lastSync: string;
  clientId?: string;
  hasCredentials?: boolean; // true when clientId + clientSecret are saved — enables one-click reconnect
}

interface GcalCalendar {
  id: string;
  summary: string;
  primary: boolean;
}

interface GcalEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  description: string;
  allDay: boolean;
}

interface DriveStatus {
  connected: boolean;
  hasCredentials: boolean;
  clientId: string;
  fileCount: number;
}

/** Aggregate cell status for a (book, stage) combination */
function aggregateStatus(tasks: ProjectTask[]): TaskStatus | null {
  if (tasks.length === 0) return null;
  if (tasks.every((t) => t.status === 'complete')) return 'complete';
  if (tasks.some((t) => t.status === 'flagged')) return 'flagged';
  if (tasks.some((t) => t.status === 'in-progress')) return 'in-progress';
  return 'pending';
}

const CELL_STYLES: Partial<Record<TaskStatus, string>> = {
  pending: 'tw:bg-gray-100 tw:text-gray-500',
  'in-progress': 'tw:bg-yellow-100 tw:text-yellow-700',
  complete: 'tw:bg-green-100 tw:text-green-700',
  flagged: 'tw:bg-red-100 tw:text-red-700',
};

const CELL_ICONS: Partial<Record<TaskStatus, string>> = {
  pending: '•',
  'in-progress': '⟳',
  complete: '✓',
  flagged: '⚑',
};

// ---- Calendar Tab Component ----

interface CalendarTabProps {
  tasks: ProjectTask[];
  stageConfig: Record<string, StageConfig>;
  projectId: string;
  calMonth: string;
  setCalMonth: (m: string) => void;
  selectedDay: string | null;
  setSelectedDay: (d: string | null) => void;
  gcalEvents: GcalEvent[];
  gcalEventsLoading: boolean;
  gcalConnected: boolean;
  calendarDays: Array<{ date: string; dayNum: number; inMonth: boolean }>;
  tasksByDeadline: Record<string, ProjectTask[]>;
  gcalEventsByDate: Record<string, GcalEvent[]>;
  timeEntriesByDate: Record<string, Array<TimeEntry & { taskId: string; taskLabel: string }>>;
  teamMembers: string[];
  logTimeUser: string;
  setLogTimeUser: (u: string) => void;
  logTimeTask: string;
  setLogTimeTask: (t: string) => void;
  logTimeHours: string;
  setLogTimeHours: (h: string) => void;
  logTimeNote: string;
  setLogTimeNote: (n: string) => void;
  logTimeCustomLabel: string;
  setLogTimeCustomLabel: (v: string) => void;
  logTimeSaving: boolean;
  logTimeError: string;
  logTimeSuccess: string;
  saveTimeEntry: () => void;
  deleteTimeEntry: (taskId: string, entryId: string) => void;
  deleteGcalEvent: (eventId: string) => void;
}

function CalendarTabContent({
  tasks,
  stageConfig,
  calMonth,
  setCalMonth,
  selectedDay,
  setSelectedDay,
  gcalEvents: _gcalEvents,
  gcalEventsLoading,
  gcalConnected,
  calendarDays,
  tasksByDeadline,
  gcalEventsByDate,
  timeEntriesByDate,
  teamMembers,
  logTimeUser,
  setLogTimeUser,
  logTimeTask,
  setLogTimeTask,
  logTimeHours,
  setLogTimeHours,
  logTimeNote,
  setLogTimeNote,
  logTimeCustomLabel,
  setLogTimeCustomLabel,
  logTimeSaving,
  logTimeError,
  logTimeSuccess,
  saveTimeEntry,
  deleteTimeEntry,
  deleteGcalEvent,
}: CalendarTabProps) {
  const [year, month] = calMonth.split('-').map(Number);
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('es', {
    month: 'long',
    year: 'numeric',
  });

  function prevMonth() {
    const d = new Date(year, month - 2, 1);
    setCalMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    setSelectedDay(null);
  }

  function nextMonth() {
    const d = new Date(year, month, 1);
    setCalMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    setSelectedDay(null);
  }

  function goToday() {
    const now = new Date();
    setCalMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    setSelectedDay(now.toISOString().slice(0, 10));
  }

  const today = new Date().toISOString().slice(0, 10);

  const dayDeadlineTasks = selectedDay ? (tasksByDeadline[selectedDay] ?? []) : [];
  const dayGcalEvents = selectedDay ? (gcalEventsByDate[selectedDay] ?? []) : [];
  const dayTimeEntries = selectedDay ? (timeEntriesByDate[selectedDay] ?? []) : [];
  const dayTotalHours = dayTimeEntries.reduce((s, e) => s + e.hours, 0);

  return (
    <div className="tw:flex tw:flex-1 tw:overflow-hidden">
      {/* Left: monthly grid */}
      <div
        className={`tw:flex tw:flex-col tw:overflow-auto ${selectedDay ? 'tw:w-3/5' : 'tw:w-full'}`}
      >
        {/* Month navigation */}
        <div className="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:bg-white tw:border-b tw:sticky tw:top-0 tw:z-10">
          <button
            className="tw:px-2 tw:py-0.5 tw:bg-gray-100 tw:rounded tw:hover:bg-gray-200 tw:text-xs"
            onClick={prevMonth}
          >
            ‹ Ant
          </button>
          <span className="tw:font-semibold tw:text-sm tw:text-gray-700 tw:capitalize tw:flex-1 tw:text-center">
            {monthLabel}
          </span>
          <button
            className="tw:px-2 tw:py-0.5 tw:bg-gray-100 tw:rounded tw:hover:bg-gray-200 tw:text-xs"
            onClick={goToday}
          >
            Hoy
          </button>
          <button
            className="tw:px-2 tw:py-0.5 tw:bg-gray-100 tw:rounded tw:hover:bg-gray-200 tw:text-xs"
            onClick={nextMonth}
          >
            Sig ›
          </button>
          {gcalEventsLoading && <span className="tw:text-xs tw:text-blue-500">⟳ GCal…</span>}
        </div>

        {/* Day-of-week header */}
        <div className="tw:grid tw:grid-cols-7 tw:border-b tw:bg-gray-50">
          {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((d) => (
            <div
              key={d}
              className="tw:text-center tw:text-xs tw:font-medium tw:text-gray-500 tw:py-1"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="tw:grid tw:grid-cols-7 tw:flex-1 tw:auto-rows-min">
          {calendarDays.map((cell) => {
            const deadlineTasks = tasksByDeadline[cell.date] ?? [];
            const eventsOnDay = gcalEventsByDate[cell.date] ?? [];
            const entriesOnDay = timeEntriesByDate[cell.date] ?? [];
            const hoursOnDay = entriesOnDay.reduce((s, e) => s + e.hours, 0);
            const isToday = cell.date === today;
            const isSelected = cell.date === selectedDay;
            const isOtherMonth = !cell.inMonth;

            return (
              <div
                key={cell.date}
                className={`tw:min-h-14 tw:p-1 tw:border-b tw:border-r tw:border-gray-100 tw:cursor-pointer tw:transition-colors ${
                  isOtherMonth ? 'tw:bg-gray-50 tw:opacity-50' : 'tw:bg-white tw:hover:bg-blue-50'
                } ${isSelected ? 'tw:bg-blue-100 tw:ring-1 tw:ring-inset tw:ring-blue-400' : ''} ${
                  isToday && !isSelected ? 'tw:bg-yellow-50' : ''
                }`}
                onClick={() => setSelectedDay(isSelected ? null : cell.date)}
              >
                {/* Day number */}
                <div
                  className={`tw:text-xs tw:font-medium tw:mb-0.5 tw:leading-none ${
                    isToday
                      ? 'tw:bg-blue-600 tw:text-white tw:rounded-full tw:w-5 tw:h-5 tw:flex tw:items-center tw:justify-center'
                      : isOtherMonth
                        ? 'tw:text-gray-300'
                        : 'tw:text-gray-700'
                  }`}
                >
                  {cell.dayNum}
                </div>

                {/* Deadline task status dots */}
                {deadlineTasks.length > 0 && (
                  <div className="tw:flex tw:flex-wrap tw:gap-0.5 tw:mb-0.5">
                    {deadlineTasks.slice(0, 3).map((t) => (
                      <span
                        key={t.id}
                        className={`tw:inline-block tw:w-1.5 tw:h-1.5 tw:rounded-full tw:flex-shrink-0 ${
                          t.status === 'complete'
                            ? 'tw:bg-green-500'
                            : t.status === 'flagged'
                              ? 'tw:bg-red-500'
                              : t.status === 'in-progress'
                                ? 'tw:bg-yellow-500'
                                : 'tw:bg-gray-400'
                        }`}
                        title={`${t.book} ${t.chapter} — ${getStageLabel(t.stage, stageConfig)} (${t.status})`}
                      />
                    ))}
                    {deadlineTasks.length > 3 && (
                      <span
                        className="tw:text-gray-400 tw:leading-none"
                        style={{ fontSize: '9px' }}
                      >
                        +{deadlineTasks.length - 3}
                      </span>
                    )}
                  </div>
                )}

                {/* GCal event tags */}
                {eventsOnDay.slice(0, 2).map((ev) => (
                  <div
                    key={ev.id}
                    className="tw:text-blue-700 tw:bg-blue-100 tw:rounded tw:px-0.5 tw:truncate tw:mb-0.5"
                    style={{ fontSize: '9px' }}
                    title={ev.summary}
                  >
                    {ev.summary}
                  </div>
                ))}
                {eventsOnDay.length > 2 && (
                  <div className="tw:text-blue-500" style={{ fontSize: '9px' }}>
                    +{eventsOnDay.length - 2} más
                  </div>
                )}

                {/* Hours-logged badge */}
                {hoursOnDay > 0 && (
                  <div
                    className="tw:text-purple-700 tw:bg-purple-100 tw:rounded tw:px-0.5 tw:font-medium tw:leading-none"
                    style={{ fontSize: '9px' }}
                  >
                    {hoursOnDay}h
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="tw:flex tw:gap-3 tw:px-3 tw:py-2 tw:text-xs tw:text-gray-500 tw:border-t tw:bg-white tw:flex-wrap">
          <span className="tw:flex tw:items-center tw:gap-1">
            <span className="tw:w-2 tw:h-2 tw:rounded-full tw:bg-gray-400 tw:inline-block" />{' '}
            Pendiente
          </span>
          <span className="tw:flex tw:items-center tw:gap-1">
            <span className="tw:w-2 tw:h-2 tw:rounded-full tw:bg-yellow-500 tw:inline-block" /> En
            progreso
          </span>
          <span className="tw:flex tw:items-center tw:gap-1">
            <span className="tw:w-2 tw:h-2 tw:rounded-full tw:bg-green-500 tw:inline-block" />{' '}
            Completo
          </span>
          <span className="tw:flex tw:items-center tw:gap-1">
            <span className="tw:w-2 tw:h-2 tw:rounded-full tw:bg-red-500 tw:inline-block" /> ⚑
            Bandera
          </span>
          {gcalConnected && (
            <span className="tw:flex tw:items-center tw:gap-1">
              <span
                className="tw:bg-blue-100 tw:text-blue-700 tw:rounded tw:px-1 tw:leading-none"
                style={{ fontSize: '9px' }}
              >
                ev
              </span>{' '}
              GCal
            </span>
          )}
          <span className="tw:flex tw:items-center tw:gap-1">
            <span
              className="tw:bg-purple-100 tw:text-purple-700 tw:rounded tw:px-1 tw:leading-none"
              style={{ fontSize: '9px' }}
            >
              2h
            </span>{' '}
            Horas
          </span>
          {!gcalConnected && (
            <span className="tw:text-orange-500 tw:text-xs">
              (Conecta Google Calendar en la pestaña Resumen para ver eventos)
            </span>
          )}
        </div>
      </div>

      {/* Right: day detail panel */}
      {selectedDay && (
        <div className="tw:w-2/5 tw:border-l tw:border-gray-200 tw:flex tw:flex-col tw:overflow-auto tw:bg-white">
          {/* Panel header */}
          <div className="tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-2 tw:bg-gray-50 tw:border-b tw:sticky tw:top-0 tw:z-10">
            <span className="tw:font-semibold tw:text-xs tw:text-gray-700 tw:capitalize">
              {new Date(`${selectedDay}T12:00:00`).toLocaleDateString('es', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
            <button
              className="tw:text-gray-400 tw:hover:text-gray-600 tw:text-sm tw:leading-none"
              onClick={() => setSelectedDay(null)}
            >
              ✕
            </button>
          </div>

          <div className="tw:flex-1 tw:overflow-auto tw:p-3 tw:space-y-4">
            {/* Tasks due this day */}
            <section>
              <h4 className="tw:font-semibold tw:text-xs tw:text-gray-500 tw:mb-1 tw:uppercase tw:tracking-wide">
                Tareas con fecha límite
              </h4>
              {dayDeadlineTasks.length === 0 ? (
                <p className="tw:text-xs tw:text-gray-400">
                  Ninguna tarea con fecha límite este día.
                </p>
              ) : (
                <ul className="tw:space-y-1">
                  {dayDeadlineTasks.map((task) => (
                    <li
                      key={task.id}
                      className={`tw:text-xs tw:px-2 tw:py-1 tw:rounded tw:border-l-2 ${
                        task.status === 'complete'
                          ? 'tw:border-green-400 tw:bg-green-50'
                          : task.status === 'flagged'
                            ? 'tw:border-red-400 tw:bg-red-50'
                            : task.status === 'in-progress'
                              ? 'tw:border-yellow-400 tw:bg-yellow-50'
                              : 'tw:border-gray-300 tw:bg-gray-50'
                      }`}
                    >
                      <span className="tw:font-medium">
                        {task.book} {task.chapter}
                      </span>
                      {' — '}
                      <span className="tw:text-gray-600">
                        {getStageLabel(task.stage, stageConfig)}
                      </span>
                      <span
                        className={`tw:ml-1.5 tw:px-1 tw:rounded tw:text-xs ${STATUS_COLORS[task.status]}`}
                      >
                        {STATUS_LABELS[task.status]}
                      </span>
                      {(task.assignedTo ?? []).length > 0 && (
                        <span className="tw:text-gray-400 tw:ml-1">
                          ({(task.assignedTo ?? []).join(', ')})
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* GCal events (only if connected) */}
            {gcalConnected && (
              <section>
                <h4 className="tw:font-semibold tw:text-xs tw:text-gray-500 tw:mb-1 tw:uppercase tw:tracking-wide">
                  Eventos de Google Calendar
                </h4>
                {gcalEventsLoading ? (
                  <p className="tw:text-xs tw:text-gray-400">⟳ Cargando…</p>
                ) : dayGcalEvents.length === 0 ? (
                  <p className="tw:text-xs tw:text-gray-400">Ningún evento este día.</p>
                ) : (
                  <ul className="tw:space-y-1">
                    {dayGcalEvents.map((ev) => (
                      <li
                        key={ev.id}
                        className="tw:text-xs tw:bg-blue-50 tw:border tw:border-blue-100 tw:rounded tw:px-2 tw:py-1"
                      >
                        <div className="tw:flex tw:items-start tw:justify-between tw:gap-1">
                          <div className="tw:flex-1 tw:min-w-0">
                            <div className="tw:font-medium tw:text-blue-800">{ev.summary}</div>
                            {!ev.allDay && ev.start && (
                              <div className="tw:text-blue-600">
                                {new Date(ev.start).toLocaleTimeString('es', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                                {ev.end && (
                                  <>
                                    {' – '}
                                    {new Date(ev.end).toLocaleTimeString('es', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </>
                                )}
                              </div>
                            )}
                            {ev.allDay && <div className="tw:text-blue-500">Todo el día</div>}
                            {ev.description && (
                              <div className="tw:text-gray-500 tw:truncate">{ev.description}</div>
                            )}
                          </div>
                          <button
                            className="tw:flex-shrink-0 tw:text-gray-300 tw:hover:text-red-500 tw:transition-colors tw:leading-none"
                            title="Eliminar evento"
                            onClick={() => deleteGcalEvent(ev.id)}
                          >
                            ×
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {/* Log time form */}
            <section className="tw:border tw:border-gray-200 tw:rounded-lg tw:p-3 tw:bg-gray-50">
              <h4 className="tw:font-semibold tw:text-xs tw:text-gray-700 tw:mb-2">
                Registrar tiempo
              </h4>
              <div className="tw:space-y-2">
                <div>
                  <label className="tw:block tw:text-xs tw:text-gray-500 tw:mb-0.5">Tarea</label>
                  <select
                    className="tw:w-full tw:border tw:border-gray-300 tw:rounded tw:px-2 tw:py-1 tw:text-xs tw:bg-white"
                    value={logTimeTask}
                    onChange={(e) => setLogTimeTask(e.target.value)}
                  >
                    <option value="">— Selecciona una tarea —</option>
                    {tasks.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.book} {task.chapter} — {getStageLabel(task.stage, stageConfig)}
                        {(task.assignedTo ?? []).length > 0
                          ? ` (${(task.assignedTo ?? []).join(', ')})`
                          : ''}
                      </option>
                    ))}
                    <option value="__otro__">─── Otro… ───</option>
                  </select>
                </div>

                {/* Free-text label when "Otro" is selected */}
                {logTimeTask === '__otro__' && (
                  <div>
                    <label className="tw:block tw:text-xs tw:text-gray-500 tw:mb-0.5">
                      Descripción
                    </label>
                    <input
                      type="text"
                      className="tw:w-full tw:border tw:border-gray-300 tw:rounded tw:px-2 tw:py-1 tw:text-xs"
                      value={logTimeCustomLabel}
                      onChange={(e) => setLogTimeCustomLabel(e.target.value)}
                      placeholder="Ej: Reunión de equipo, Capacitación…"
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                    />
                  </div>
                )}

                <div>
                  <label className="tw:block tw:text-xs tw:text-gray-500 tw:mb-0.5">Usuario</label>
                  <select
                    className="tw:w-full tw:border tw:border-gray-300 tw:rounded tw:px-2 tw:py-1 tw:text-xs tw:bg-white"
                    value={logTimeUser}
                    onChange={(e) => setLogTimeUser(e.target.value)}
                  >
                    <option value="">— Selecciona —</option>
                    {teamMembers.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="tw:block tw:text-xs tw:text-gray-500 tw:mb-0.5">Horas</label>
                  <input
                    type="number"
                    min="0.25"
                    step="0.25"
                    className="tw:w-full tw:border tw:border-gray-300 tw:rounded tw:px-2 tw:py-1 tw:text-xs"
                    value={logTimeHours}
                    onChange={(e) => setLogTimeHours(e.target.value)}
                    placeholder="1.5"
                  />
                </div>

                <div>
                  <label className="tw:block tw:text-xs tw:text-gray-500 tw:mb-0.5">
                    Nota (opcional)
                  </label>
                  <input
                    type="text"
                    className="tw:w-full tw:border tw:border-gray-300 tw:rounded tw:px-2 tw:py-1 tw:text-xs"
                    value={logTimeNote}
                    onChange={(e) => setLogTimeNote(e.target.value)}
                    placeholder="Descripción del trabajo realizado…"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveTimeEntry();
                    }}
                  />
                </div>

                {logTimeError && <p className="tw:text-xs tw:text-red-600">{logTimeError}</p>}
                {logTimeSuccess && <p className="tw:text-xs tw:text-green-600">{logTimeSuccess}</p>}

                <button
                  className="tw:w-full tw:text-xs tw:px-3 tw:py-1.5 tw:bg-slate-600 tw:text-white tw:rounded tw:hover:bg-slate-700 tw:disabled:opacity-50"
                  onClick={saveTimeEntry}
                  disabled={logTimeSaving}
                >
                  {logTimeSaving ? '⟳ Guardando…' : '+ Registrar horas'}
                </button>
              </div>
            </section>

            {/* Hours logged this day */}
            <section>
              <h4 className="tw:font-semibold tw:text-xs tw:text-gray-500 tw:mb-1 tw:uppercase tw:tracking-wide">
                Horas del día
                {dayTotalHours > 0 && (
                  <span className="tw:ml-2 tw:font-normal tw:text-purple-700 tw:normal-case">
                    {dayTotalHours}h total
                  </span>
                )}
              </h4>
              {dayTimeEntries.length === 0 ? (
                <p className="tw:text-xs tw:text-gray-400">No se han registrado horas este día.</p>
              ) : (
                <ul className="tw:space-y-1">
                  {dayTimeEntries.map((entry) => (
                    <li
                      key={entry.id}
                      className="tw:flex tw:items-start tw:justify-between tw:gap-1 tw:text-xs tw:bg-purple-50 tw:border tw:border-purple-100 tw:rounded tw:px-2 tw:py-1"
                    >
                      <div className="tw:flex-1 tw:min-w-0">
                        <div className="tw:flex tw:items-center tw:gap-1.5">
                          <span className="tw:font-semibold tw:text-purple-800">
                            {entry.hours}h
                          </span>
                          <span className="tw:text-gray-700">{entry.user}</span>
                        </div>
                        <div className="tw:text-gray-500 tw:truncate">{entry.taskLabel}</div>
                        {entry.note && (
                          <div className="tw:text-gray-400 tw:italic tw:truncate">{entry.note}</div>
                        )}
                      </div>
                      <button
                        className="tw:text-red-400 tw:hover:text-red-600 tw:flex-shrink-0 tw:mt-0.5 tw:leading-none"
                        title="Eliminar registro"
                        onClick={() => deleteTimeEntry(entry.taskId, entry.id)}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Main Component ----

globalThis.webViewComponent = function ProjectOverviewWebView({
  projectId,
  updateWebViewDefinition,
}: WebViewProps) {
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [stageConfig, setStageConfig] = useState<Record<string, StageConfig>>({});
  const [teamMembers, setTeamMembers] = useState<string[]>([...TEAM_MEMBERS]);
  const [teamInput, setTeamInput] = useState('');
  const [teamSaving, setTeamSaving] = useState(false);
  const [teamMessage, setTeamMessage] = useState('');
  const [showTeamSection, setShowTeamSection] = useState(false);
  const [loading, setLoading] = useState(false);
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
  const [currentUser, setCurrentUser] = useState('');
  const [showAvatarSettings, setShowAvatarSettings] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Click outside menu detection
  useEffect(() => {
    if (!menuOpen) return;
    const handleGlobalClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('click', handleGlobalClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('click', handleGlobalClick, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [menuOpen]);
  const [updateMessage, setUpdateMessage] = useState('');

  // --- Collaboration state ---
  const [collabRole, setCollabRole] = useState<'host' | 'client' | 'none'>('none');
  const [collabType, setCollabType] = useState<'local' | 'online'>('local');
  const [collabRoomId, setCollabRoomId] = useState('');
  const [collabServerUrl, setCollabServerUrl] = useState('wss://paratext-pm-collab.onrender.com');
  const [collabUsername, setCollabUsername] = useState('');
  const [collabPort, setCollabPort] = useState(49885);
  const [collabHostIp, setCollabHostIp] = useState('127.0.0.1');
  const [collabActiveUsers, setCollabActiveUsers] = useState<string[]>([]);
  const [collabIps, setCollabIps] = useState<string[]>([]);
  const [collabChatMessages, setCollabChatMessages] = useState<
    { user: string; message: string; timestamp: number }[]
  >([]);
  const [collabStatusMsg, setCollabStatusMsg] = useState('');
  const [collabErrorMsg, setCollabErrorMsg] = useState('');
  const [collabConnecting, setCollabConnecting] = useState(false);
  const [showCollabSection, setShowCollabSection] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatContextMenu, setChatContextMenu] = useState<{
    x: number;
    y: number;
    user: string;
  } | null>(null);

  useEffect(() => {
    const handleGlobalClick = () => setChatContextMenu(null);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  useEffect(() => {
    if (!collabRoomId && projectId) {
      const cleanId = projectId
        .replace(/[^a-zA-Z0-9]/g, '')
        .substring(0, 6)
        .toUpperCase();
      // Generate a stronger random suffix (8 hex chars = 32 bits of entropy)
      const arr = new Uint8Array(4);
      if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
        globalThis.crypto.getRandomValues(arr);
      } else {
        for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
      }
      const randHex = Array.from(arr, (b) => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
      setCollabRoomId(`PM-${cleanId || 'ROOM'}-${randHex}`);
    }
  }, [projectId, collabRoomId]);

  // --- Tab state ---
  const [currentTab, setCurrentTab] = useState<'summary' | 'calendar'>('summary');

  const [sidebarVisible, setSidebarVisible] = useState(() => {
    const saved = localStorage.getItem('project_overview_sidebar_visible');
    return saved !== 'false';
  });

  const toggleSidebar = () => {
    setSidebarVisible((v) => {
      const next = !v;
      localStorage.setItem('project_overview_sidebar_visible', String(next));
      return next;
    });
  };

  // --- Google Calendar state ---
  const [gcalStatus, setGcalStatus] = useState<GcalStatus>({
    connected: false,
    email: '',
    calendarId: 'primary',
    lastSync: '',
  });
  const [gcalCalendars, setGcalCalendars] = useState<GcalCalendar[]>([]);
  const [showGcalSetup, setShowGcalSetup] = useState(false);
  const [showGcalSection, setShowGcalSection] = useState(true);
  const [gcalClientId, setGcalClientId] = useState('');
  const [gcalClientSecret, setGcalClientSecret] = useState('');
  const [gcalConnecting, setGcalConnecting] = useState(false);
  const [gcalSyncing, setGcalSyncing] = useState(false);
  const [gcalMessage, setGcalMessage] = useState('');
  const [gcalError, setGcalError] = useState('');

  // --- Drive task sync state ---
  const driveAuthPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logTimeSuccessRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const teamMessageRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [driveStatus, setDriveStatus] = useState<DriveStatus>({
    connected: false,
    hasCredentials: false,
    clientId: '',
    fileCount: 0,
  });
  const [showDriveSection, setShowDriveSection] = useState(false);

  // Cleanup fire-and-forget timeouts on unmount
  useEffect(() => {
    return () => {
      if (logTimeSuccessRef.current) clearTimeout(logTimeSuccessRef.current);
      if (teamMessageRef.current) clearTimeout(teamMessageRef.current);
    };
  }, []);
  const [showDriveSetup, setShowDriveSetup] = useState(false);
  const [showDriveImport, setShowDriveImport] = useState(false);
  const [driveClientId, setDriveClientId] = useState('');
  const [driveClientSecret, setDriveClientSecret] = useState('');
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [driveMessage, setDriveMessage] = useState('');
  const [driveError, setDriveError] = useState('');
  const [driveImportJson, setDriveImportJson] = useState('');
  const [driveExportedConfig, setDriveExportedConfig] = useState('');
  const [driveTestResult, setDriveTestResult] = useState('');
  const [driveTesting, setDriveTesting] = useState(false);
  const [driveSyncResult, setDriveSyncResult] = useState('');
  const [driveSyncing, setDriveSyncing] = useState(false);

  // --- Export state ---
  const [exportStatus, setExportStatus] = useState('');
  const [exportError, setExportError] = useState('');

  // --- Calendar state ---
  const [calMonth, setCalMonth] = useState<string>(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [gcalEvents, setGcalEvents] = useState<GcalEvent[]>([]);
  const [gcalEventsLoading, setGcalEventsLoading] = useState(false);

  // --- Time entry form state ---
  const [logTimeUser, setLogTimeUser] = useState('');
  const [logTimeTask, setLogTimeTask] = useState('');
  const [logTimeHours, setLogTimeHours] = useState('1');
  const [logTimeNote, setLogTimeNote] = useState('');
  const [logTimeCustomLabel, setLogTimeCustomLabel] = useState('');
  const [logTimeSaving, setLogTimeSaving] = useState(false);
  const [logTimeError, setLogTimeError] = useState('');
  const [logTimeSuccess, setLogTimeSuccess] = useState('');

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
      const [result, membersResult, userResult] = await papiRetry(
        () =>
          Promise.all([
            papi.commands.sendCommand('paratextProjectManager.getTasks', projectId),
            papi.commands.sendCommand('paratextProjectManager.getTeamMembers'),
            papi.commands.sendCommand('paratextProjectManager.getCurrentUser'),
          ]),
        { isCancelled: () => !isCurrentRequest() },
      );
      if (!isCurrentRequest()) return;
      const store = JSON.parse(result) as TaskStore;
      setTasks(store.tasks ?? []);
      setStageConfig(store.stageConfig ?? {});
      extrasRef.current = { activityLog: store.activityLog, deletedTaskIds: store.deletedTaskIds };
      if (membersResult) setTeamMembers(JSON.parse(membersResult) as string[]);
      if (userResult && typeof userResult === 'string' && userResult.length > 0)
        setCurrentUser(userResult);
    } catch (e2) {
      if (isCurrentRequest()) setError(handleCatch(e2, 'Error al cargar: '));
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [projectId, clearDisconnected, handleCatch]);

  useEffect(() => {
    if (ready) loadTasks();
  }, [ready, loadTasks]);

  // Carries activityLog + deletedTaskIds through time-entry saves without causing re-renders
  const extrasRef = useRef<{ activityLog?: unknown[]; deletedTaskIds?: string[] }>({});

  // Background auto-refresh — silently picks up changes saved by other computers
  const lastRefreshRef = useRef(0);
  const refreshInProgressRef = useRef(false);

  const silentRefresh = useCallback(async () => {
    if (!projectId || refreshInProgressRef.current) return;
    if (disconnectedRef.current) return; // skip PAPI calls while disconnected
    refreshInProgressRef.current = true;
    try {
      const result = await papiRetry(() =>
        papi.commands.sendCommand('paratextProjectManager.getTasks', projectId),
      );
      const store = JSON.parse(result) as TaskStore;
      lastRefreshRef.current = Date.now();
      const incomingDeleted = new Set(store.deletedTaskIds ?? []);
      extrasRef.current = {
        activityLog: store.activityLog ?? extrasRef.current.activityLog,
        deletedTaskIds: Array.from(
          new Set([...(extrasRef.current.deletedTaskIds ?? []), ...incomingDeleted]),
        ),
      };
      const incoming = store.tasks ?? [];
      setTasks((prev) => {
        const merged = new Map(prev.map((t) => [t.id, t]));
        for (const id of incomingDeleted) merged.delete(id);
        for (const t of incoming) {
          if (incomingDeleted.has(t.id)) continue;
          const existing = merged.get(t.id);
          if (!existing || t.updatedAt >= existing.updatedAt) merged.set(t.id, t);
        }
        return Array.from(merged.values());
      });
      if (store.stageConfig && Object.keys(store.stageConfig).length > 0)
        setStageConfig(store.stageConfig);
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
  }, [projectId, silentRefresh]);

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

  // --- Google Calendar callbacks ---

  const loadGcalStatus = useCallback(async () => {
    try {
      const result = await papi.commands.sendCommand('paratextProjectManager.gcalGetStatus');
      const status = JSON.parse(result) as GcalStatus;
      setGcalStatus(status);
      // Pre-populate clientId field if previously saved
      if (status.clientId) setGcalClientId(status.clientId);
      // If already connected, load calendar list automatically
      if (status.connected) {
        try {
          const calsResult = await papi.commands.sendCommand(
            'paratextProjectManager.gcalListCalendars',
          );
          setGcalCalendars(JSON.parse(calsResult));
        } catch (e) {
          if (isPapiDisconnectedError(e)) handleCatch(e);
        }
      }
    } catch (e) {
      if (isPapiDisconnectedError(e)) handleCatch(e);
    }
  }, [handleCatch]);

  // --- Collaboration callbacks & subscription ---

  const loadCollabStatus = useCallback(async () => {
    try {
      const status: any = await papi.commands.sendCommand('paratextProjectManager.getCollabStatus');
      if (status) {
        setCollabRole(status.role);
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
      if (isPapiDisconnectedError(e)) handleCatch(e);
      else console.error('Failed to load collab status:', e);
    }
  }, [handleCatch]);

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
        const errMsg = res?.error || 'Error desconocido al iniciar colaboración.';
        if (/EADDRINUSE|address already in use/i.test(errMsg)) {
          setCollabErrorMsg(
            `${errMsg}\n\nSi el puerto ${collabPort} está ocupado, cambia el puerto o cierra la otra sesión.`,
          );
        } else {
          setCollabErrorMsg(errMsg);
        }
      }
    } catch (e: any) {
      setCollabErrorMsg(handleCatch(e, ''));
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
      setCollabErrorMsg(handleCatch(e, ''));
    } finally {
      setCollabConnecting(false);
    }
  };

  const handleStopCollab = async () => {
    try {
      await papi.commands.sendCommand('paratextProjectManager.stopCollab');
      setCollabRole('none');
      setCollabActiveUsers([]);
      setCollabChatMessages([]);
      setCollabStatusMsg('');
      setCollabErrorMsg('');
    } catch (e) {
      if (isPapiDisconnectedError(e)) handleCatch(e);
      else console.error('Failed to stop collab:', e);
    }
  };

  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [hasEverConnected, setHasEverConnected] = useState(false);

  const handleReconnectCollab = async () => {
    setCollabErrorMsg('');
    setCollabStatusMsg('Intentando reconectar...');
    try {
      const res: any = await papi.commands.sendCommand('paratextProjectManager.reconnectCollab');
      if (res && res.status === 'ok') {
        setCollabStatusMsg(res.message || 'Reconectando...');
      } else {
        setCollabErrorMsg(res?.error || 'No se pudo iniciar la reconexión.');
      }
    } catch (e: any) {
      setCollabErrorMsg(handleCatch(e, ''));
    }
  };

  const handleSendChat = async (e?: React.FormEvent | React.KeyboardEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim()) return;
    try {
      const sender = collabUsername || currentUser || 'Usuario';
      await papi.commands.sendCommand(
        'paratextProjectManager.sendCollabChat',
        sender,
        chatInput.trim(),
      );
      setChatInput('');
    } catch (e) {
      if (isPapiDisconnectedError(e)) handleCatch(e);
    }
  };

  const handleAddMember = async () => {
    const name = teamInput.trim();
    if (!name || teamMembers.includes(name)) return;
    const updated = [...teamMembers, name];
    setTeamSaving(true);
    setTeamMessage('');
    try {
      await papi.commands.sendCommand(
        'paratextProjectManager.setTeamMembers',
        JSON.stringify(updated),
      );
      setTeamMembers(updated);
      setTeamInput('');
      setTeamMessage('Guardado ✓');
      if (teamMessageRef.current) clearTimeout(teamMessageRef.current);
      teamMessageRef.current = setTimeout(() => setTeamMessage(''), 3000);
    } catch (e) {
      setTeamMessage(handleCatch(e, 'Error: '));
    } finally {
      setTeamSaving(false);
    }
  };

  useEffect(() => {
    loadCollabStatus();
  }, [loadCollabStatus]);

  useEffect(() => {
    if (currentUser && !collabUsername) {
      setCollabUsername(currentUser);
    }
  }, [currentUser, collabUsername]);

  useEffect(() => {
    let unsub: any;
    try {
      unsub = papi.network.getNetworkEvent<any>('paratextProjectManager.onCollabEvent')(
        (event: any) => {
          if (!event) return;
          const { type, payload } = event;
          if (type === 'user_list') {
            setCollabActiveUsers(payload.users || []);
          } else if (type === 'chat_message') {
            setCollabChatMessages((prev) => [...prev, payload]);
          } else if (type === 'tasks_update') {
            silentRefresh();
          } else if (type === 'status_update') {
            if (payload.role) {
              setCollabRole(payload.role);
              // If we just connected, clear the reconnect banner
              if (payload.role !== 'none') {
                setReconnecting(false);
                setReconnectAttempts(0);
                setHasEverConnected(true);
              }
            }
            if (payload.reconnecting) {
              setReconnecting(true);
              setReconnectAttempts(payload.attempt || 0);
              setCollabStatusMsg(
                `Reconectando al anfitrión (intento #${payload.attempt || 1}, en ${Math.round((payload.delayMs || 0) / 1000)}s)...`,
              );
              setCollabErrorMsg('');
            } else if (payload.error) {
              setCollabErrorMsg(payload.error);
              setCollabStatusMsg('');
              setReconnecting(false);
            }
          }
        },
      );
    } catch (err) {
      if (isPapiDisconnectedError(err)) handleCatch(err);
      else console.warn('Error subscribing to collab event:', err);
    }
    return () => {
      if (unsub) unsub();
    };
  }, [silentRefresh, handleCatch]);

  useEffect(() => {
    const checkUpdateStatus = async () => {
      try {
        const msg = await papi.commands.sendCommand('paratextProjectManager.getUpdateStatus');
        if (msg) {
          setUpdateMessage(msg);
        }
      } catch (e) {
        if (isPapiDisconnectedError(e)) handleCatch(e);
      }
    };
    checkUpdateStatus();
  }, [handleCatch]);

  useEffect(() => {
    loadGcalStatus();
  }, [loadGcalStatus]);

  // --- Drive task sync callbacks ---

  const loadDriveStatus = useCallback(async () => {
    try {
      const result = await papi.commands.sendCommand('paratextProjectManager.tasksDriveGetStatus');
      const status = JSON.parse(result) as DriveStatus;
      setDriveStatus(status);
      if (status.clientId) setDriveClientId(status.clientId);
    } catch (_) {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    loadDriveStatus();
  }, [loadDriveStatus]);

  const driveConnect = useCallback(async () => {
    if (!driveClientId.trim() || !driveClientSecret.trim()) {
      setDriveError('Ingresa el Client ID y Client Secret');
      return;
    }

    // Clear any previous poll
    if (driveAuthPollRef.current) clearTimeout(driveAuthPollRef.current);

    setDriveConnecting(true);
    setDriveError('');
    setDriveMessage('Abriendo el navegador para autorización… (puede tardar hasta 5 min)');

    try {
      // Start auth in background — returns immediately, doesn't wait for browser
      await papi.commands.sendCommand(
        'paratextProjectManager.tasksDriveStartAuth',
        driveClientId.trim(),
        driveClientSecret.trim(),
      );
    } catch (e) {
      setDriveError(handleCatch(e, 'Error al iniciar: '));
      setDriveMessage('');
      setDriveConnecting(false);
      return;
    }

    // Poll backend every 4 seconds until auth succeeds, fails, or times out
    let attempts = 0;
    const maxAttempts = 75; // 75 × 4s = 5 minutes

    const doPoll = () => {
      attempts++;
      if (attempts > maxAttempts) {
        setDriveError('Tiempo de espera agotado. Vuelve a intentar.');
        setDriveMessage('');
        setDriveConnecting(false);
        driveAuthPollRef.current = null;
        return;
      }

      papi.commands
        .sendCommand('paratextProjectManager.tasksDrivePollAuth')
        .then((res) => {
          const { status, error } = JSON.parse(res) as { status: string; error?: string };
          if (status === 'pending') {
            driveAuthPollRef.current = setTimeout(doPoll, 4000);
          } else if (status === 'success') {
            setDriveMessage(
              '✓ Drive conectado. Guarda una tarea para crear el archivo compartido.',
            );
            setShowDriveSetup(false);
            setDriveClientSecret('');
            setDriveConnecting(false);
            driveAuthPollRef.current = null;
            loadDriveStatus();
          } else {
            setDriveError(`Error: ${error ?? 'Error desconocido'}`);
            setDriveMessage('');
            setDriveConnecting(false);
            driveAuthPollRef.current = null;
          }
        })
        .catch((e) => {
          if (isPapiDisconnectedError(e)) {
            handleCatch(e);
            driveAuthPollRef.current = null;
            return;
          }
          driveAuthPollRef.current = setTimeout(doPoll, 4000); // retry on transient error
        });
    };

    driveAuthPollRef.current = setTimeout(doPoll, 3000); // first check after 3s
  }, [driveClientId, driveClientSecret, loadDriveStatus]);

  const driveExportConfig = useCallback(async () => {
    try {
      const result = await papi.commands.sendCommand(
        'paratextProjectManager.tasksDriveExportConfig',
      );
      const data = JSON.parse(result) as {
        success: boolean;
        config?: string;
        error?: string;
      };
      if (data.success && data.config) {
        setDriveExportedConfig(data.config);
      } else {
        setDriveError(data.error ?? 'No se pudo exportar la configuración');
      }
    } catch (e) {
      setDriveError(handleCatch(e, ''));
    }
  }, []);

  const driveForceSync = useCallback(async () => {
    if (!projectId) {
      setDriveSyncResult('✗ No hay proyecto seleccionado');
      return;
    }
    setDriveSyncing(true);
    setDriveSyncResult('Sincronizando…');
    try {
      const res = await papi.commands.sendCommand(
        'paratextProjectManager.tasksDriveForceSyncProject',
        projectId,
      );
      const data = JSON.parse(res) as {
        success: boolean;
        step?: string;
        error?: string;
        fileId?: string;
        wasNew?: boolean;
      };
      if (data.success) {
        setDriveSyncResult(
          `✓ Sincronizado. fileId: ${data.fileId}${data.wasNew ? ' (archivo nuevo creado)' : ' (actualizado)'}`,
        );
        loadDriveStatus(); // refresh project count
      } else {
        setDriveSyncResult(`✗ Error en paso "${data.step}": ${data.error}`);
      }
    } catch (e) {
      setDriveSyncResult(`✗ ${handleCatch(e, 'Error: ')}`);
    } finally {
      setDriveSyncing(false);
    }
  }, [projectId, loadDriveStatus]);

  const driveTest = useCallback(async () => {
    setDriveTesting(true);
    setDriveTestResult('Probando…');
    try {
      const res = await papi.commands.sendCommand('paratextProjectManager.tasksDriveTest');
      const data = JSON.parse(res) as {
        success: boolean;
        step?: string;
        error?: string;
        fileId?: string;
      };
      if (data.success) {
        setDriveTestResult(
          `✓ Escritura exitosa en Drive (fileId: ${data.fileId}). La API de Drive funciona correctamente.`,
        );
      } else {
        setDriveTestResult(`✗ Error en paso "${data.step}": ${data.error}`);
      }
    } catch (e) {
      setDriveTestResult(`✗ ${handleCatch(e, 'Error: ')}`);
    } finally {
      setDriveTesting(false);
    }
  }, []);

  const driveImportConfig = useCallback(async () => {
    if (!driveImportJson.trim()) {
      setDriveError('Pega la configuración JSON');
      return;
    }
    try {
      const result = await papi.commands.sendCommand(
        'paratextProjectManager.tasksDriveImportConfig',
        driveImportJson.trim(),
      );
      const data = JSON.parse(result) as { success: boolean; error?: string };
      if (data.success) {
        setDriveMessage('✓ Configuración importada. Recarga el proyecto para ver las tareas.');
        setShowDriveImport(false);
        setDriveImportJson('');
        await loadDriveStatus();
      } else {
        setDriveError(data.error ?? 'Error al importar');
      }
    } catch (e) {
      setDriveError(handleCatch(e, ''));
    }
  }, [driveImportJson, loadDriveStatus]);

  // Pre-fill logTimeUser from getCurrentUser
  useEffect(() => {
    papi.commands
      .sendCommand('paratextProjectManager.getCurrentUser')
      .then((u) => {
        if (u && typeof u === 'string' && u.length > 0) setLogTimeUser(u);
      })
      .catch((e) => {
        if (isPapiDisconnectedError(e)) handleCatch(e);
        else console.error('Failed to get current user:', e);
      });
  }, [handleCatch]);

  // Shared polling logic: call after gcalConnect or gcalReconnect returns { status: 'started' }
  const pollGcalAuth = useCallback(
    async (onSuccess?: () => void) => {
      const startMs = Date.now();
      const maxMs = 6 * 60 * 1000;
      const poll = async (): Promise<void> => {
        if (Date.now() - startMs > maxMs) {
          setGcalError('Tiempo de espera agotado. El navegador tardó demasiado. Intenta de nuevo.');
          setGcalMessage('');
          setGcalConnecting(false);
          return;
        }
        try {
          const raw = await papi.commands.sendCommand('paratextProjectManager.gcalPollAuth');
          const state = JSON.parse(raw) as {
            status: string;
            email?: string;
            error?: string;
          };
          if (state.status === 'success') {
            setGcalMessage(`Conectado como ${state.email ?? ''}`);
            setGcalError('');
            setShowGcalSetup(false);
            setGcalClientSecret('');
            await loadGcalStatus();
            try {
              const calsResult = await papi.commands.sendCommand(
                'paratextProjectManager.gcalListCalendars',
              );
              setGcalCalendars(JSON.parse(calsResult));
            } catch (e) {
              if (isPapiDisconnectedError(e)) handleCatch(e);
            }
            setGcalConnecting(false);
            onSuccess?.();
          } else if (state.status === 'error') {
            setGcalError(state.error ?? 'Error desconocido');
            setGcalMessage('');
            setGcalConnecting(false);
          } else {
            // still pending — check again in 2s
            setTimeout(() => {
              poll().catch((e) => {
                if (isPapiDisconnectedError(e)) {
                  handleCatch(e);
                  return;
                }
                console.error('GCal auth poll failed:', e);
              });
            }, 2000);
          }
        } catch (e) {
          if (isPapiDisconnectedError(e)) {
            handleCatch(e);
            return;
          }
          console.error('GCal auth poll error:', e);
          setTimeout(() => {
            poll().catch((pollErr) => {
              if (isPapiDisconnectedError(pollErr)) {
                handleCatch(pollErr);
                return;
              }
              console.error('GCal auth retry poll failed:', pollErr);
            });
          }, 2000);
        }
      };
      await poll();
    },
    [loadGcalStatus],
  );

  const gcalConnect = useCallback(async () => {
    if (!gcalClientId.trim() || !gcalClientSecret.trim()) {
      setGcalError('Ingresa el Client ID y Client Secret');
      return;
    }
    setGcalConnecting(true);
    setGcalError('');
    setGcalMessage('Abriendo el navegador para autorización… (puede tardar hasta 5 min)');
    try {
      await papi.commands.sendCommand(
        'paratextProjectManager.gcalConnect',
        gcalClientId.trim(),
        gcalClientSecret.trim(),
      );
      await pollGcalAuth();
    } catch (e) {
      setGcalError(handleCatch(e, 'Error: '));
      setGcalMessage('');
      setGcalConnecting(false);
    }
  }, [gcalClientId, gcalClientSecret, pollGcalAuth]);

  // One-click reconnect using stored credentials — no need to retype Client ID / Secret
  const gcalReconnect = useCallback(async () => {
    setGcalConnecting(true);
    setGcalError('');
    setGcalMessage('Abriendo el navegador para autorización… (puede tardar hasta 5 min)');
    try {
      const result = await papi.commands.sendCommand('paratextProjectManager.gcalReconnect');
      const data = JSON.parse(result);
      if (data.status === 'started') {
        await pollGcalAuth();
      } else {
        // returned an error before starting (e.g. no credentials stored)
        setGcalError(data.error ?? 'Error desconocido');
        setGcalMessage('');
        setGcalConnecting(false);
      }
    } catch (e) {
      setGcalError(handleCatch(e, 'Error: '));
      setGcalMessage('');
      setGcalConnecting(false);
    }
  }, [pollGcalAuth]);

  const gcalDisconnect = useCallback(async () => {
    try {
      await papi.commands.sendCommand('paratextProjectManager.gcalDisconnect');
      setGcalStatus({ connected: false, email: '', calendarId: 'primary', lastSync: '' });
      setGcalCalendars([]);
      setGcalMessage('');
      setGcalError('');
    } catch (e) {
      setGcalError(handleCatch(e, 'Error al desconectar: '));
    }
  }, []);

  const gcalLoadCalendars = useCallback(async () => {
    try {
      const result = await papi.commands.sendCommand('paratextProjectManager.gcalListCalendars');
      const cals = JSON.parse(result) as GcalCalendar[];
      setGcalCalendars(cals);
    } catch (_) {
      /* non-critical */
    }
  }, []);

  const gcalChangeCalendar = useCallback(async (calId: string) => {
    try {
      await papi.commands.sendCommand('paratextProjectManager.gcalSetCalendarId', calId);
      setGcalStatus((prev) => ({ ...prev, calendarId: calId }));
    } catch (e) {
      setGcalError(handleCatch(e, 'Error: '));
    }
  }, []);

  const gcalSync = useCallback(async () => {
    if (!projectId) return;
    setGcalSyncing(true);
    setGcalMessage('');
    setGcalError('');
    try {
      const result = await papi.commands.sendCommand(
        'paratextProjectManager.gcalSyncDeadlines',
        projectId,
      );
      const data = JSON.parse(result);
      if (data.errors && data.errors.length > 0) {
        setGcalError(`${data.errors.length} error(es): ${data.errors[0]}`);
      }
      setGcalMessage(
        `Sincronizado: ${data.synced}/${data.total} tareas${data.total === 0 ? ' (ninguna tiene fecha límite)' : ''}`,
      );
      await loadGcalStatus();
    } catch (e) {
      setGcalError(handleCatch(e, 'Error al sincronizar: '));
    } finally {
      setGcalSyncing(false);
    }
  }, [projectId, loadGcalStatus]);

  const flushPendingTime = useCallback(async () => {
    try {
      const res = await papi.commands.sendCommand('paratextProjectManager.gcalFlushPendingTime');
      const { synced, remaining } = JSON.parse(res) as {
        synced: number;
        remaining: number;
      };
      if (synced === 0 && remaining === 0) {
        // eslint-disable-next-line no-alert
        alert('No hay registros de tiempo pendientes.');
      } else {
        if (synced > 0) {
          // eslint-disable-next-line no-alert
          alert(`Sincronizados ${synced} registro(s) de tiempo con Google Calendar.`);
        }
        if (remaining > 0) {
          // eslint-disable-next-line no-alert
          alert(`${remaining} registro(s) aún pendientes (sin conexión).`);
        }
      }
    } catch (e) {
      if (isPapiDisconnectedError(e)) handleCatch(e);
    }
  }, []);

  // --- Load GCal events when calendar tab is active or month changes ---
  const loadGcalEvents = useCallback(async () => {
    if (!gcalStatus.connected) return;
    setGcalEventsLoading(true);
    try {
      const [yr, mo] = calMonth.split('-').map(Number);
      const timeMin = new Date(yr, mo - 1, 1).toISOString();
      const lastDay = new Date(yr, mo, 0).getDate();
      const timeMax = new Date(yr, mo - 1, lastDay, 23, 59, 59).toISOString();
      const res = await papi.commands.sendCommand(
        'paratextProjectManager.gcalGetEvents',
        gcalStatus.calendarId || 'primary',
        timeMin,
        timeMax,
      );
      setGcalEvents(JSON.parse(res) as GcalEvent[]);
    } catch (e) {
      if (isPapiDisconnectedError(e)) handleCatch(e);
      else setGcalEvents([]);
    } finally {
      setGcalEventsLoading(false);
    }
  }, [gcalStatus.connected, gcalStatus.calendarId, calMonth]);

  useEffect(() => {
    if (currentTab === 'calendar') loadGcalEvents();
  }, [currentTab, loadGcalEvents]);

  // --- Grid / summary data ---
  const orderedStages = useMemo(() => getOrderedStages(stageConfig), [stageConfig]);

  const booksInUse = useMemo(
    () => BIBLE_BOOKS.filter((b) => tasks.some((t) => t.book === b)),
    [tasks],
  );

  const grid = useMemo(() => {
    const map: Record<string, Record<string, ProjectTask[]>> = {};
    for (const book of booksInUse) {
      map[book] = {};
      for (const stage of orderedStages) {
        const cellTasks: ProjectTask[] = [];
        for (const t of tasks.filter((task) => task.book === book)) {
          const status = getTaskStageStatus(t, stage, orderedStages);
          if (status !== undefined) {
            cellTasks.push({
              ...t,
              stage,
              status,
            });
          }
        }
        map[book][stage] = cellTasks;
      }
    }
    return map;
  }, [tasks, booksInUse, orderedStages]);

  const stageSummary = useMemo(() => {
    const summary: Record<string, { total: number; complete: number; flagged: number }> = {};
    for (const stage of orderedStages) {
      let total = 0;
      let complete = 0;
      let flagged = 0;
      for (const t of tasks) {
        const status = getTaskStageStatus(t, stage, orderedStages);
        if (status !== undefined) {
          total++;
          if (status === 'complete') complete++;
          if (status === 'flagged') flagged++;
        }
      }
      summary[stage] = { total, complete, flagged };
    }
    return summary;
  }, [tasks, orderedStages]);

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'complete').length;
  const inProgressTasks = tasks.filter((t) => t.status === 'in-progress').length;
  const flaggedTasks = tasks.filter((t) => t.status === 'flagged').length;
  const pctComplete = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // --- Calendar computed data ---
  const tasksByDeadline = useMemo(() => {
    const map: Record<string, ProjectTask[]> = {};
    for (const task of tasks) {
      if (!task.deadline) continue;
      if (!map[task.deadline]) map[task.deadline] = [];
      map[task.deadline].push(task);
    }
    return map;
  }, [tasks]);

  const gcalEventsByDate = useMemo(() => {
    const map: Record<string, GcalEvent[]> = {};
    for (const ev of gcalEvents) {
      const dateKey = ev.start.slice(0, 10);
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(ev);
    }
    return map;
  }, [gcalEvents]);

  const timeEntriesByDate = useMemo(() => {
    const map: Record<string, Array<TimeEntry & { taskId: string; taskLabel: string }>> = {};
    for (const task of tasks) {
      if (!task.timeEntries || task.timeEntries.length === 0) continue;
      const label = `${task.book} ${task.chapter} — ${getStageLabel(task.stage, stageConfig)}`;
      for (const entry of task.timeEntries) {
        if (!map[entry.date]) map[entry.date] = [];
        map[entry.date].push({ ...entry, taskId: task.id, taskLabel: label });
      }
    }
    return map;
  }, [tasks, stageConfig]);

  const calendarDays = useMemo(() => {
    const [yr, mo] = calMonth.split('-').map(Number);
    const firstOfMonth = new Date(yr, mo - 1, 1);
    const lastOfMonth = new Date(yr, mo, 0);
    const startPad = firstOfMonth.getDay(); // 0=Sun ... 6=Sat

    const days: Array<{ date: string; dayNum: number; inMonth: boolean }> = [];

    // Leading cells from previous month
    for (let i = 0; i < startPad; i++) {
      const d = new Date(yr, mo - 1, i - startPad + 1);
      const dy = d.getFullYear();
      const dm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      days.push({ date: `${dy}-${dm}-${dd}`, dayNum: d.getDate(), inMonth: false });
    }

    // Current month days
    for (let d = 1; d <= lastOfMonth.getDate(); d++) {
      const moStr = String(mo).padStart(2, '0');
      const dStr = String(d).padStart(2, '0');
      days.push({ date: `${yr}-${moStr}-${dStr}`, dayNum: d, inMonth: true });
    }

    // Trailing cells to fill last row
    const trailing = (7 - (days.length % 7)) % 7;
    for (let i = 1; i <= trailing; i++) {
      const d = new Date(yr, mo, i);
      const dy = d.getFullYear();
      const dm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      days.push({ date: `${dy}-${dm}-${dd}`, dayNum: d.getDate(), inMonth: false });
    }

    return days;
  }, [calMonth]);

  // --- Time entry save/delete ---
  const saveTimeEntry = useCallback(async () => {
    if (!projectId) return;
    const hours = parseFloat(logTimeHours);
    const isOtro = logTimeTask === '__otro__';
    if (!isOtro && !logTimeTask) {
      setLogTimeError('Selecciona una tarea');
      return;
    }
    if (isOtro && !logTimeCustomLabel.trim()) {
      setLogTimeError('Ingresa una descripción');
      return;
    }
    if (!logTimeUser) {
      setLogTimeError('Selecciona un usuario');
      return;
    }
    if (!selectedDay) {
      setLogTimeError('No hay día seleccionado');
      return;
    }
    if (isNaN(hours) || hours <= 0) {
      setLogTimeError('Las horas deben ser un número positivo');
      return;
    }

    setLogTimeSaving(true);
    setLogTimeError('');
    setLogTimeSuccess('');

    try {
      const newEntry: TimeEntry = {
        id: generateId(),
        user: logTimeUser,
        hours,
        date: selectedDay,
        note: logTimeNote.trim() || undefined,
      };

      if (isOtro) {
        // "Otro" — no task file update; sync to GCal with custom label (queued if offline)
        const label = logTimeCustomLabel.trim();
        setLogTimeHours('1');
        setLogTimeNote('');
        setLogTimeCustomLabel('');
        setLogTimeSuccess('✓ Horas registradas');
        if (logTimeSuccessRef.current) clearTimeout(logTimeSuccessRef.current);
        logTimeSuccessRef.current = setTimeout(() => setLogTimeSuccess(''), 5000);
        papi.commands
          .sendCommand(
            'paratextProjectManager.gcalSyncTimeEntry',
            JSON.stringify(newEntry),
            label,
            gcalStatus.calendarId || 'primary',
          )
          .then((res: unknown) => {
            const result = JSON.parse(res as string) as { status: string };
            setLogTimeSuccess(
              result.status === 'queued'
                ? '✓ Horas registradas (pendiente GCal ⟳)'
                : '✓ Horas registradas + ☁ GCal',
            );
          })
          .catch((e) => {
            if (isPapiDisconnectedError(e)) handleCatch(e);
            else setLogTimeSuccess('✓ Horas registradas (sin GCal)');
          });
        return;
      }

      // Normal task update flow
      const updatedTasks = tasks.map((task): ProjectTask => {
        if (task.id !== logTimeTask) return task;
        const updatedEntries = [...(task.timeEntries ?? []), newEntry];
        const totalLogged = updatedEntries.reduce((sum, e) => sum + e.hours, 0);
        return {
          ...task,
          timeEntries: updatedEntries,
          loggedHours: totalLogged,
          updatedAt: new Date().toISOString(),
        };
      });

      const { activityLog: savedLog, deletedTaskIds: savedDeleted } = extrasRef.current;
      const store = {
        schemaVersion: 1 as const,
        tasks: updatedTasks,
        stageConfig,
        ...(savedLog ? { activityLog: savedLog } : {}),
        ...(savedDeleted?.length ? { deletedTaskIds: savedDeleted } : {}),
      };
      await papi.commands.sendCommand(
        'paratextProjectManager.saveTasks',
        projectId,
        JSON.stringify(store),
      );

      setTasks(updatedTasks);
      setLogTimeHours('1');
      setLogTimeNote('');
      setLogTimeSuccess('✓ Horas registradas');
      if (logTimeSuccessRef.current) clearTimeout(logTimeSuccessRef.current);
      logTimeSuccessRef.current = setTimeout(() => setLogTimeSuccess(''), 5000);

      // Async GCal sync — fire-and-forget; update success message on result
      if (gcalStatus.connected) {
        const taskForSync = updatedTasks.find((t) => t.id === logTimeTask);
        if (taskForSync) {
          const label = `${taskForSync.book} ${taskForSync.chapter} \u2014 ${getStageLabel(taskForSync.stage, stageConfig)}`;
          papi.commands
            .sendCommand(
              'paratextProjectManager.gcalSyncTimeEntry',
              JSON.stringify(newEntry),
              label,
              gcalStatus.calendarId || 'primary',
            )
            .then((res: unknown) => {
              const result = JSON.parse(res as string) as { status: string };
              setLogTimeSuccess(
                result.status === 'queued'
                  ? '✓ Horas registradas (pendiente GCal ⟳)'
                  : '✓ Horas registradas + ☁ GCal',
              );
            })
            .catch((e) => {
              if (isPapiDisconnectedError(e)) handleCatch(e);
              else setLogTimeSuccess('✓ Horas registradas (sin conexión GCal)');
            });
        }
      }
    } catch (e) {
      setLogTimeError(handleCatch(e, 'Error al guardar: '));
    } finally {
      setLogTimeSaving(false);
    }
  }, [
    logTimeTask,
    logTimeCustomLabel,
    logTimeUser,
    logTimeHours,
    logTimeNote,
    selectedDay,
    tasks,
    stageConfig,
    projectId,
    gcalStatus,
  ]);

  const deleteTimeEntry = useCallback(
    async (taskId: string, entryId: string) => {
      if (!projectId) return;
      try {
        const updatedTasks = tasks.map((task): ProjectTask => {
          if (task.id !== taskId) return task;
          const updatedEntries = (task.timeEntries ?? []).filter((e) => e.id !== entryId);
          const totalLogged = updatedEntries.reduce((sum, e) => sum + e.hours, 0);
          return {
            ...task,
            timeEntries: updatedEntries,
            loggedHours: totalLogged,
            updatedAt: new Date().toISOString(),
          };
        });
        const { activityLog: savedLog2, deletedTaskIds: savedDeleted2 } = extrasRef.current;
        const store = {
          schemaVersion: 1 as const,
          tasks: updatedTasks,
          stageConfig,
          ...(savedLog2 ? { activityLog: savedLog2 } : {}),
          ...(savedDeleted2?.length ? { deletedTaskIds: savedDeleted2 } : {}),
        };
        await papi.commands.sendCommand(
          'paratextProjectManager.saveTasks',
          projectId,
          JSON.stringify(store),
        );
        setTasks(updatedTasks);
      } catch (e) {
        setLogTimeError(handleCatch(e, 'Error al eliminar: '));
      }
    },
    [tasks, stageConfig, projectId],
  );

  const deleteGcalEvent = useCallback(
    async (eventId: string) => {
      if (!gcalStatus.calendarId) return;
      // Optimistic: remove from local state immediately
      setGcalEvents((prev) => prev.filter((ev) => ev.id !== eventId));
      try {
        const result = JSON.parse(
          await papi.commands.sendCommand(
            'paratextProjectManager.gcalDeleteEvent',
            gcalStatus.calendarId,
            eventId,
          ),
        );
        if (result.status !== 'ok') {
          // Revert on failure — re-fetch events
          setGcalEventsLoading(true);
          try {
            const evJson = await papi.commands.sendCommand(
              'paratextProjectManager.gcalGetEvents',
              gcalStatus.calendarId,
              new Date(`${calMonth}-01`).toISOString(),
              new Date(
                new Date(`${calMonth}-01`).getFullYear(),
                new Date(`${calMonth}-01`).getMonth() + 1,
                1,
              ).toISOString(),
            );
            setGcalEvents(JSON.parse(evJson));
          } finally {
            setGcalEventsLoading(false);
          }
        }
      } catch (e) {
        // Event already removed from UI; a manual refresh will restore if needed.
        if (isPapiDisconnectedError(e)) handleCatch(e);
      }
    },
    [gcalStatus.calendarId, calMonth],
  );

  // --- CSV / PDF export ---
  const buildCsvContent = useCallback((): string => {
    const header = ['Libro', ...orderedStages.map((s) => getStageLabel(s, stageConfig))];
    const icons: Record<string, string> = {
      complete: '✓',
      'in-progress': '⟳',
      pending: '•',
      flagged: '⚑',
    };
    const rows = booksInUse.map((book) => [
      book,
      ...orderedStages.map((stage) => {
        const cellTasks = grid[book]?.[stage] ?? [];
        if (cellTasks.length === 0) return '';
        const s = aggregateStatus(cellTasks);
        return s ? `${icons[s] ?? ''}${cellTasks.length > 1 ? ` (${cellTasks.length})` : ''}` : '';
      }),
    ]);
    return `\uFEFF${[header, ...rows].map((row) => row.map((c) => `"${c}"`).join(',')).join('\r\n')}`;
  }, [orderedStages, stageConfig, booksInUse, grid]);

  const downloadCsv = useCallback(async () => {
    setExportStatus('Guardando CSV…');
    setExportError('');
    try {
      const content = buildCsvContent();
      const result = await papi.commands.sendCommand(
        'paratextProjectManager.saveToDownloads',
        'resumen-proyecto.csv',
        content,
      );
      const data = JSON.parse(result);
      if (data.success) {
        setExportStatus(`✓ CSV guardado en Descargas`);
      } else {
        setExportError(`Error al guardar CSV: ${data.error}`);
        setExportStatus('');
      }
    } catch (e) {
      setExportError(handleCatch(e, 'Error: '));
      setExportStatus('');
    }
    setTimeout(() => {
      setExportStatus('');
      setExportError('');
    }, 5000);
  }, [buildCsvContent]);

  const buildHtmlContent = useCallback((): string => {
    const stageHeaders = orderedStages
      .map((s) => `<th>${getStageLabel(s, stageConfig)}</th>`)
      .join('');
    const icons: Record<string, string> = {
      complete: '✓',
      'in-progress': '⟳',
      pending: '•',
      flagged: '⚑',
    };
    const statusColors: Record<string, string> = {
      complete: '#d1fae5',
      'in-progress': '#fef3c7',
      pending: '#f3f4f6',
      flagged: '#fee2e2',
    };
    const rows = booksInUse
      .map((book) => {
        const cells = orderedStages
          .map((stage) => {
            const cellTasks = grid[book]?.[stage] ?? [];
            const s = cellTasks.length > 0 ? aggregateStatus(cellTasks) : null;
            const bg = s ? (statusColors[s] ?? '#f3f4f6') : '#fff';
            const text = s
              ? `${icons[s] ?? ''}${cellTasks.length > 1 ? ` (${cellTasks.length})` : ''}`
              : '';
            return `<td style="background:${bg};text-align:center;padding:4px 8px;">${text}</td>`;
          })
          .join('');
        return `<tr><td style="font-weight:bold;padding:4px 8px;">${book}</td>${cells}</tr>`;
      })
      .join('');

    const date = new Date().toLocaleDateString('es');
    const datetime = new Date().toLocaleString('es');
    return (
      `<!DOCTYPE html>` +
      `<html lang="es"><head><meta charset="utf-8">` +
      `<title>Resumen del Proyecto \u2014 ${date}</title>` +
      `<style>` +
      `body{font-family:sans-serif;padding:24px;font-size:12px}` +
      `h1{font-size:16px;margin-bottom:12px}` +
      `table{border-collapse:collapse;width:100%}` +
      `th{background:#1d4ed8;color:white;padding:6px 8px;text-align:left;font-size:11px}` +
      `td{border:1px solid #e5e7eb}` +
      `@media print{body{padding:8px}}` +
      `</style>` +
      `</head><body onload="window.print()">` +
      `<h1>Resumen del Proyecto \u2014 ${date}</h1>` +
      `<table><thead><tr><th>Libro</th>${stageHeaders}</tr></thead>` +
      `<tbody>${rows}</tbody></table>` +
      `<p style="margin-top:16px;color:#666;font-size:11px;">Generado por Paratext Project Manager \u00b7 ${datetime}</p>` +
      `</body></html>`
    );
  }, [orderedStages, stageConfig, booksInUse, grid]);

  const exportPdf = useCallback(async () => {
    setExportStatus('Guardando HTML para impresión…');
    setExportError('');
    try {
      const content = buildHtmlContent();
      const result = await papi.commands.sendCommand(
        'paratextProjectManager.saveToDownloads',
        'resumen-proyecto.html',
        content,
      );
      const data = JSON.parse(result);
      if (data.success) {
        setExportStatus('✓ Abierto en navegador — usa Ctrl+P para imprimir/PDF');
      } else {
        setExportError(`Error: ${data.error}`);
        setExportStatus('');
      }
    } catch (e) {
      setExportError(handleCatch(e, 'Error: '));
      setExportStatus('');
    }
    setTimeout(() => {
      setExportStatus('');
      setExportError('');
    }, 7000);
  }, [buildHtmlContent]);

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
    <div className="tw:flex tw:flex-col tw:h-full tw:bg-gray-50 tw:text-xs">
      {/* Print-only styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body, html { background: white !important; }
          .print-container {
            height: auto !important;
            overflow: visible !important;
            padding: 8px !important;
          }
          .print-container table { font-size: 9pt; }
          .print-container th, .print-container td { padding: 3px 5px !important; }
        }
        .print-only { display: none; }
      `}</style>

      {/* Update notification banner */}
      {updateMessage && (
        <div className="tw:bg-gradient-to-r tw:from-emerald-500 tw:to-teal-600 tw:text-white tw:px-4 tw:py-2.5 tw:flex tw:items-center tw:justify-between tw:shadow-md tw:no-print">
          <div className="tw:flex tw:items-center tw:gap-2">
            <span className="tw:text-sm">✨</span>
            <span className="tw:font-medium">{updateMessage}</span>
          </div>
          <button
            className="tw:text-xs tw:bg-white/20 tw:backdrop-blur-sm tw:text-white tw:border tw:border-white/30 tw:px-2.5 tw:py-1 tw:rounded-md tw:hover:bg-white/30 tw:transition-all"
            onClick={() => setUpdateMessage('')}
          >
            Entendido
          </button>
        </div>
      )}

      {/* Header */}
      <div className="tw:px-3 tw:py-2 tw:bg-white tw:border-b tw:shadow-sm tw:flex tw:items-center tw:justify-between tw:no-print">
        <div className="tw:flex tw:items-center tw:gap-2">
          <div className="tw:flex tw:items-center tw:gap-2 tw:relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className={`tw:p-1.5 tw:rounded-md tw:transition-colors tw:cursor-pointer tw:flex tw:items-center tw:justify-center tw:border ${
                menuOpen
                  ? 'tw:bg-indigo-50 tw:text-indigo-600 tw:border-indigo-100'
                  : 'tw:text-slate-600 tw:hover:bg-slate-100 tw:hover:text-slate-800 tw:border-transparent'
              }`}
              title="Menú de opciones"
              aria-label="Menú de opciones"
              aria-expanded={menuOpen}
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

            {menuOpen && (
              <div
                className="tw:absolute tw:left-0 tw:top-full tw:mt-1.5 tw:w-72 tw:bg-white tw:border tw:border-slate-200 tw:rounded-xl tw:shadow-2xl tw:overflow-hidden tw:text-sm"
                style={{ zIndex: 10000 }}
              >
                {/* Adjustments section */}
                <div className="tw:px-4 tw:pt-3.5 tw:pb-2">
                  <div className="tw:text-[10px] tw:font-bold tw:uppercase tw:tracking-wider tw:text-slate-400 tw:mb-1.5">
                    Filtros / Ajustes
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      toggleSidebar();
                      setMenuOpen(false);
                    }}
                    className="tw:w-full tw:flex tw:items-center tw:gap-2.5 tw:px-2.5 tw:py-2 tw:rounded-lg tw:text-slate-700 tw:hover:bg-slate-50 tw:transition-colors tw:cursor-pointer tw:text-left"
                  >
                    <span className="tw:text-base">🎛️</span>
                    <span className="tw:flex-1 tw:font-medium">
                      {sidebarVisible ? 'Ocultar ajustes' : 'Mostrar ajustes'}
                    </span>
                  </button>
                </div>

                <div className="tw:h-px tw:bg-slate-100" />

                {/* Settings section */}
                <div className="tw:px-4 tw:pt-3.5 tw:pb-3.5">
                  <div className="tw:text-[10px] tw:font-bold tw:uppercase tw:tracking-wider tw:text-slate-400 tw:mb-1.5">
                    Configuración
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAvatarSettings(true);
                      setMenuOpen(false);
                    }}
                    className="tw:w-full tw:flex tw:items-center tw:gap-2.5 tw:px-2.5 tw:py-2 tw:rounded-lg tw:text-slate-700 tw:hover:bg-slate-50 tw:transition-colors tw:cursor-pointer tw:text-left"
                  >
                    <span className="tw:text-base">🖼️</span>
                    <span className="tw:flex-1 tw:font-medium">Configurar Avatar</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          <span className="tw:font-semibold tw:text-sm tw:text-gray-700">Resumen del Proyecto</span>
        </div>
        <div className="tw:flex tw:items-center tw:gap-2 tw:text-xs tw:text-gray-600 tw:flex-wrap">
          <span className="tw:text-green-600 tw:font-medium">{pctComplete}% completo</span>
          <span>
            {completedTasks}/{totalTasks} tareas
          </span>
          {inProgressTasks > 0 && (
            <span className="tw:text-yellow-700">⟳ {inProgressTasks} en progreso</span>
          )}
          {flaggedTasks > 0 && <span className="tw:text-red-600">⚑ {flaggedTasks} banderas</span>}
          <button
            className="tw:px-2 tw:py-0.5 tw:bg-gray-100 tw:rounded tw:hover:bg-gray-200 tw:disabled:opacity-50"
            onClick={downloadCsv}
            title="Guardar CSV en Descargas"
          >
            ↓ CSV
          </button>
          <button
            className="tw:px-2 tw:py-0.5 tw:bg-slate-600 tw:text-white tw:rounded tw:hover:bg-slate-700 tw:disabled:opacity-50"
            onClick={exportPdf}
            title="Abrir tabla en navegador para imprimir/PDF"
          >
            🖨 PDF
          </button>
          {(exportStatus || exportError) && (
            <span
              className={`tw:text-xs tw:px-1.5 ${exportError ? 'tw:text-red-600' : 'tw:text-green-700'}`}
            >
              {exportStatus || exportError}
            </span>
          )}
          <button
            className="tw:px-2 tw:py-0.5 tw:bg-gray-100 tw:rounded tw:hover:bg-gray-200"
            onClick={() => selectProject()}
            title="Cambiar proyecto"
          >
            ⇄
          </button>
          <button
            className="tw:px-2 tw:py-0.5 tw:bg-gray-100 tw:rounded tw:hover:bg-gray-200"
            onClick={loadTasks}
            title="Actualizar"
          >
            ↻
          </button>

          <Avatar
            name={currentUser}
            onClick={() => setShowAvatarSettings(true)}
            className="tw:ml-1"
          />
        </div>
      </div>

      {/* Print-only title */}
      <div className="tw:print-only tw:px-3 tw:py-2 tw:text-sm tw:font-bold">
        Resumen del Proyecto — {pctComplete}% completo ({completedTasks}/{totalTasks} tareas)
      </div>

      {error && (
        <ReconnectBanner
          error={error}
          disconnected={disconnected}
          onRetry={loadTasks}
          variant="bar"
        />
      )}

      {/* Tab bar */}
      <div className="tw:flex tw:border-b tw:border-gray-200 tw:bg-white tw:no-print">
        {(['summary', 'calendar'] as const).map((tab) => (
          <button
            key={tab}
            className={`tw:px-4 tw:py-1.5 tw:text-xs tw:font-medium tw:border-b-2 tw:transition-colors ${
              currentTab === tab
                ? 'tw:border-slate-600 tw:text-slate-700'
                : 'tw:border-transparent tw:text-gray-500 tw:hover:text-gray-700 tw:hover:border-gray-300'
            }`}
            onClick={() => setCurrentTab(tab)}
          >
            {tab === 'summary' ? 'Resumen' : '📅 Calendario'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="tw:flex tw:items-center tw:justify-center tw:flex-1 tw:text-gray-400">
          Cargando…
        </div>
      ) : (
        <div className="tw:flex tw:flex-1 tw:overflow-hidden">
          {/* Left Sidebar */}
          {sidebarVisible && (
            <div className="tw:w-80 tw:border-r tw:border-gray-200 tw:bg-white tw:p-3 tw:overflow-y-auto tw:flex tw:flex-col tw:gap-3 tw:no-print">
              {/* Team Members */}
              <div className="tw:border tw:border-gray-200 tw:rounded-lg tw:bg-white tw:no-print">
                <button
                  type="button"
                  className="tw:w-full tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-1.5 tw:hover:bg-gray-50 tw:text-left tw:rounded-t-lg"
                  onClick={() => setShowTeamSection((s) => !s)}
                >
                  <span className="tw:font-semibold tw:text-xs tw:text-gray-700">
                    👥 Equipo ({teamMembers.length} miembros)
                  </span>
                  <span className="tw:text-gray-400 tw:text-xs">{showTeamSection ? '▲' : '▼'}</span>
                </button>

                {showTeamSection && (
                  <div className="tw:px-3 tw:pb-3 tw:pt-2 tw:space-y-2">
                    {/* Current members */}
                    <div className="tw:flex tw:flex-wrap tw:gap-1.5">
                      {teamMembers.map((m) => (
                        <span
                          key={m}
                          className="tw:inline-flex tw:items-center tw:gap-1 tw:bg-slate-100 tw:text-slate-700 tw:text-xs tw:px-2 tw:py-0.5 tw:rounded-full"
                        >
                          {m}
                          <button
                            type="button"
                            className="tw:text-slate-400 tw:hover:text-red-500 tw:leading-none tw:font-bold"
                            title={`Quitar a ${m}`}
                            onClick={async () => {
                              const updated = teamMembers.filter((x) => x !== m);
                              setTeamSaving(true);
                              setTeamMessage('');
                              try {
                                await papi.commands.sendCommand(
                                  'paratextProjectManager.setTeamMembers',
                                  JSON.stringify(updated),
                                );
                                setTeamMembers(updated);
                                setTeamMessage('Guardado ✓');
                                if (teamMessageRef.current) clearTimeout(teamMessageRef.current);
                                teamMessageRef.current = setTimeout(() => setTeamMessage(''), 3000);
                              } catch (e) {
                                setTeamMessage(handleCatch(e, 'Error: '));
                              } finally {
                                setTeamSaving(false);
                              }
                            }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="tw:flex tw:gap-2">
                      <input
                        className="tw:flex-1 tw:border tw:rounded tw:px-2 tw:py-1 tw:text-xs"
                        placeholder="Nombre del nuevo miembro…"
                        value={teamInput}
                        onChange={(e) => setTeamInput(e.target.value)}
                        disabled={teamSaving}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddMember();
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleAddMember}
                        className="tw:px-3 tw:py-1 tw:bg-slate-600 tw:text-white tw:text-xs tw:rounded tw:hover:bg-slate-700 tw:disabled:opacity-50"
                        disabled={teamSaving || !teamInput.trim()}
                      >
                        + Agregar
                      </button>
                    </div>
                    {teamMessage && (
                      <p
                        className={`tw:text-xs ${teamMessage.startsWith('tw:Error') ? 'tw:text-red-600' : 'tw:text-green-600'}`}
                      >
                        {teamMessage}
                      </p>
                    )}
                    <p className="tw:text-xs tw:text-gray-400">
                      Los cambios se reflejan en el Tablero y Mis Tareas al recargar esos paneles.
                    </p>
                  </div>
                )}
              </div>

              {/* Collaboration */}
              <div className="tw:border tw:border-gray-200 tw:rounded-lg tw:bg-white tw:no-print">
                <button
                  type="button"
                  className="tw:w-full tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-1.5 tw:hover:bg-gray-50 tw:text-left tw:rounded-t-lg"
                  onClick={() => setShowCollabSection((s) => !s)}
                >
                  <span className="tw:font-semibold tw:text-xs tw:text-gray-700 tw:flex tw:items-center tw:gap-1.5">
                    🌐 Colaboración en Tiempo Real
                    {collabRole !== 'none' && (
                      <span className="tw:w-2 tw:h-2 tw:rounded-full tw:bg-green-500 tw:animate-pulse" />
                    )}
                  </span>
                  <span className="tw:text-gray-400 tw:text-xs">
                    {showCollabSection ? '▲' : '▼'}
                  </span>
                </button>

                {showCollabSection && (
                  <div className="tw:px-3 tw:pb-3 tw:pt-2 tw:space-y-3 tw:text-xs">
                    {collabStatusMsg && (
                      <div className="tw:bg-green-50 tw:border tw:border-green-200 tw:text-green-700 tw:p-2 tw:rounded">
                        {collabStatusMsg}
                      </div>
                    )}
                    {collabErrorMsg && (
                      <div className="tw:bg-red-50 tw:border tw:border-red-200 tw:text-red-700 tw:p-2 tw:rounded tw:whitespace-pre-line">
                        {collabErrorMsg}
                        {(collabErrorMsg.includes('timeout') ||
                          collabErrorMsg.includes('ECONNREFUSED') ||
                          collabErrorMsg.includes('ETIMEDOUT') ||
                          collabErrorMsg.includes('No se pudo')) && (
                          <div className="tw:mt-2 tw:pt-2 tw:border-t tw:border-red-200 tw:text-[11px]">
                            💡 <strong>Si la conexión con el anfitrión falla:</strong>
                            <ul className="tw:list-disc tw:pl-5 tw:mt-1 tw:space-y-0.5">
                              <li>
                                Verifica que el Firewall de Windows permite{' '}
                                <code>paratext-project-manager</code> o el puerto{' '}
                                <code>{collabPort}</code>.
                              </li>
                              <li>Confirma que ambos equipos están en la misma red.</li>
                              <li>Prueba hacer ping a la IP del anfitrión.</li>
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {collabRole === 'none' && (
                      <div className="tw:flex tw:border tw:rounded tw:overflow-hidden tw:bg-white">
                        <button
                          type="button"
                          onClick={() => setCollabType('local')}
                          className={`tw:flex-1 tw:py-1.5 tw:text-[10px] tw:font-semibold tw:transition-colors ${
                            collabType === 'local'
                              ? 'tw:bg-slate-600 tw:text-white'
                              : 'tw:bg-white tw:text-slate-600 tw:hover:bg-slate-50'
                          }`}
                        >
                          🌐 Red Local (LAN)
                        </button>
                        <button
                          type="button"
                          onClick={() => setCollabType('online')}
                          className={`tw:flex-1 tw:py-1.5 tw:text-[10px] tw:font-semibold tw:transition-colors ${
                            collabType === 'online'
                              ? 'tw:bg-slate-600 tw:text-white'
                              : 'tw:bg-white tw:text-slate-600 tw:hover:bg-slate-50'
                          }`}
                        >
                          ☁️ En Línea (Internet)
                        </button>
                      </div>
                    )}

                    {collabRole === 'none' && !reconnecting && hasEverConnected && (
                      <div className="tw:bg-orange-50 tw:border tw:border-orange-300 tw:text-orange-800 tw:p-2 tw:rounded tw:text-xs tw:flex tw:justify-between tw:items-center">
                        <span>⚠️ Sesión desconectada</span>
                        <button
                          type="button"
                          onClick={handleReconnectCollab}
                          className="tw:ml-2 tw:px-2 tw:py-0.5 tw:bg-orange-200 hover:tw:bg-orange-300 tw:rounded tw:text-[10px] tw:font-semibold"
                        >
                          🔌 Reconectar
                        </button>
                      </div>
                    )}

                    {collabRole === 'none' ? (
                      <div className="tw:grid tw:grid-cols-1 md:tw:grid-cols-2 tw:gap-4 tw:border tw:p-3 tw:rounded tw:bg-gray-50">
                        {/* Host Mode */}
                        <div className="tw:space-y-2">
                          <h4 className="tw:font-semibold tw:text-slate-800">
                            Modo Anfitrión (Host) {collabType === 'online' ? 'Online' : ''}
                          </h4>
                          <p className="tw:text-[10px] tw:text-gray-500">
                            {collabType === 'online'
                              ? 'Inicia una sala online en internet para que tu equipo se conecte desde cualquier lugar.'
                              : 'Inicia un servidor local para que otros se conecten a tu proyecto a través de la red local.'}
                          </p>
                          <div>
                            <label className="tw:block tw:text-[10px] tw:text-gray-400">
                              Nombre de Usuario
                            </label>
                            <input
                              className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1 tw:bg-white"
                              value={collabUsername}
                              onChange={(e) => setCollabUsername(e.target.value)}
                              placeholder="Tu nombre…"
                            />
                          </div>
                          {collabType === 'online' ? (
                            <>
                              <div>
                                <label className="tw:block tw:text-[10px] tw:text-gray-400">
                                  ID de la Sala
                                </label>
                                <input
                                  className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1 tw:bg-white tw:font-mono"
                                  value={collabRoomId}
                                  onChange={(e) => setCollabRoomId(e.target.value.toUpperCase())}
                                  placeholder="e.g. MI-SALA-12"
                                />
                              </div>
                              <div>
                                <label className="tw:block tw:text-[10px] tw:text-gray-400">
                                  Servidor Relay (Opcional)
                                </label>
                                <input
                                  className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1 tw:bg-white tw:font-mono tw:text-[10px]"
                                  value={collabServerUrl}
                                  onChange={(e) => setCollabServerUrl(e.target.value)}
                                  placeholder="wss://..."
                                />
                              </div>
                            </>
                          ) : (
                            <div>
                              <label className="tw:block tw:text-[10px] tw:text-gray-400">
                                Puerto (Opcional)
                              </label>
                              <input
                                type="number"
                                className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1 tw:bg-white"
                                value={collabPort}
                                onChange={(e) =>
                                  setCollabPort(parseInt(e.target.value, 10) || 49885)
                                }
                              />
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={handleStartCollabHost}
                            disabled={collabConnecting}
                            className="tw:w-full tw:py-1.5 tw:bg-slate-600 tw:hover:bg-slate-700 tw:text-white tw:rounded tw:font-semibold disabled:tw:opacity-50"
                          >
                            {collabConnecting ? 'Iniciando...' : 'Iniciar Colaboración'}
                          </button>
                        </div>

                        {/* Client Mode */}
                        <div className="tw:space-y-2 tw:border-t md:tw:border-t-0 md:tw:border-l tw:pt-3 md:tw:pt-0 md:tw:pl-4">
                          <h4 className="tw:font-semibold tw:text-slate-800">
                            Modo Invitado (Cliente) {collabType === 'online' ? 'Online' : ''}
                          </h4>
                          <p className="tw:text-[10px] tw:text-gray-500">
                            {collabType === 'online'
                              ? 'Conéctate a una sala online existente compartida por un anfitrión.'
                              : 'Conéctate al servidor de un anfitrión local para sincronizar en tiempo real.'}
                          </p>
                          <div>
                            <label className="tw:block tw:text-[10px] tw:text-gray-400">
                              Nombre de Usuario
                            </label>
                            <input
                              className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1 tw:bg-white"
                              value={collabUsername}
                              onChange={(e) => setCollabUsername(e.target.value)}
                              placeholder="Tu nombre…"
                            />
                          </div>
                          {collabType === 'online' ? (
                            <>
                              <div>
                                <label className="tw:block tw:text-[10px] tw:text-gray-400">
                                  ID de la Sala
                                </label>
                                <input
                                  className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1 tw:bg-white tw:font-mono"
                                  value={collabRoomId}
                                  onChange={(e) => setCollabRoomId(e.target.value.toUpperCase())}
                                  placeholder="ID de la sala del anfitrión…"
                                />
                              </div>
                              <div>
                                <label className="tw:block tw:text-[10px] tw:text-gray-400">
                                  Servidor Relay (Opcional)
                                </label>
                                <input
                                  className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1 tw:bg-white tw:font-mono tw:text-[10px]"
                                  value={collabServerUrl}
                                  onChange={(e) => setCollabServerUrl(e.target.value)}
                                  placeholder="wss://..."
                                />
                              </div>
                            </>
                          ) : (
                            <>
                              <div>
                                <label className="tw:block tw:text-[10px] tw:text-gray-400">
                                  IP del Anfitrión
                                </label>
                                <input
                                  className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1 tw:bg-white"
                                  value={collabHostIp}
                                  onChange={(e) => setCollabHostIp(e.target.value)}
                                  placeholder="e.g. 192.168.1.15"
                                />
                              </div>
                              <div>
                                <label className="tw:block tw:text-[10px] tw:text-gray-400">
                                  Puerto
                                </label>
                                <input
                                  type="number"
                                  className="tw:w-full tw:border tw:rounded tw:px-2 tw:py-1 tw:bg-white"
                                  value={collabPort}
                                  onChange={(e) =>
                                    setCollabPort(parseInt(e.target.value, 10) || 49885)
                                  }
                                />
                              </div>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={handleConnectCollabClient}
                            disabled={collabConnecting}
                            className="tw:w-full tw:py-1.5 tw:bg-slate-600 tw:hover:bg-slate-700 tw:text-white tw:rounded tw:font-semibold disabled:tw:opacity-50"
                          >
                            {collabConnecting ? 'Conectando...' : 'Conectarse'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="tw:space-y-3">
                        {/* Active Session Info */}
                        <div className="tw:flex tw:justify-between tw:items-start tw:bg-slate-50 tw:border tw:p-3 tw:rounded">
                          <div className="tw:space-y-1 tw:flex-1 tw:mr-2">
                            <p className="tw:font-semibold tw:text-slate-800">
                              Sesión {collabType === 'online' ? 'Online' : 'Local'} Activa:{' '}
                              {collabRole === 'host' ? 'Anfitrión' : 'Invitado'}
                            </p>
                            {collabType === 'online' ? (
                              <div>
                                <p className="tw:text-[10px] tw:text-gray-500">
                                  {collabRole === 'host'
                                    ? 'Comparte el ID de la Sala con tu equipo para que se unan:'
                                    : 'Conectado a la sala online:'}
                                </p>
                                <div className="tw:flex tw:items-center tw:flex-wrap tw:gap-2 tw:mt-1">
                                  <span className="tw:bg-slate-200 tw:text-slate-700 tw:px-2 tw:py-0.5 tw:rounded tw:text-xs tw:font-mono tw:font-bold">
                                    {collabRoomId}
                                  </span>
                                  <span className="tw:text-[9px] tw:text-gray-400 tw:font-mono">
                                    Relay: {collabServerUrl.replace(/^wss?:\/\//, '')}
                                  </span>
                                </div>
                              </div>
                            ) : collabRole === 'host' ? (
                              <div>
                                <p className="tw:text-[10px] tw:text-gray-500">
                                  Comparte tu IP con el equipo para que se conecten:
                                </p>
                                <div className="tw:flex tw:flex-wrap tw:gap-1 tw:mt-1">
                                  {collabIps.length > 0 ? (
                                    collabIps.map((ip) => (
                                      <span
                                        key={ip}
                                        className="tw:bg-slate-200 tw:text-slate-700 tw:px-1.5 tw:py-0.5 tw:rounded tw:text-[10px] tw:font-mono"
                                      >
                                        {ip}:{collabPort}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="tw:text-red-500 tw:text-[10px]">
                                      No se detectaron IPs locales. Verifica tu conexión de red.
                                    </span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <p className="tw:text-[10px] tw:text-gray-500">
                                Conectado a:{' '}
                                <span className="tw:font-mono">
                                  {collabHostIp}:{collabPort}
                                </span>
                              </p>
                            )}
                            <div className="tw:pt-1">
                              <span className="tw:text-[10px] tw:text-gray-400">
                                Usuarios en línea:
                              </span>
                              <div className="tw:flex tw:flex-wrap tw:gap-1.5 tw:mt-1">
                                {collabActiveUsers.map((user) => (
                                  <span
                                    key={user}
                                    className="tw:inline-flex tw:items-center tw:gap-1 tw:bg-green-50 tw:border tw:border-green-100 tw:text-green-800 tw:text-[10px] tw:px-2 tw:py-0.5 tw:rounded-full"
                                  >
                                    <span className="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-green-500" />
                                    {user}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={handleStopCollab}
                            className="tw:px-3 tw:py-1 tw:bg-red-600 tw:hover:bg-red-700 tw:text-white tw:rounded tw:font-semibold"
                          >
                            Salir
                          </button>
                        </div>

                        {/* Reconnecting banner */}
                        {reconnecting && (
                          <div className="tw:bg-amber-50 tw:border tw:border-amber-300 tw:text-amber-800 tw:p-2 tw:rounded tw:text-xs tw:flex tw:justify-between tw:items-center">
                            <span>🔄 Reconectando... (intento #{reconnectAttempts})</span>
                            <button
                              type="button"
                              onClick={handleReconnectCollab}
                              className="tw:ml-2 tw:px-2 tw:py-0.5 tw:bg-amber-200 hover:tw:bg-amber-300 tw:rounded tw:text-[10px] tw:font-semibold"
                            >
                              Reintentar ahora
                            </button>
                          </div>
                        )}

                        {/* Group Chat */}
                        <div className="tw:border tw:rounded tw:bg-white">
                          <div className="tw:bg-slate-50 tw:border-b tw:px-2 tw:py-1.5 tw:font-semibold tw:text-slate-700">
                            💬 Chat de Coordinación
                          </div>
                          <div className="tw:h-32 tw:overflow-y-auto tw:p-2 tw:space-y-1.5 tw:bg-slate-50/50">
                            {collabChatMessages.length === 0 ? (
                              <p className="tw:text-gray-400 tw:italic tw:text-center tw:pt-8 tw:text-[10px]">
                                No hay mensajes. Envía un mensaje para coordinar con el equipo.
                              </p>
                            ) : (
                              collabChatMessages.map((msg, idx) => (
                                <div
                                  key={idx}
                                  className="tw:text-[11px] tw:bg-white tw:p-1.5 tw:rounded tw:border tw:shadow-sm tw:cursor-context-menu hover:tw:bg-slate-50/50 tw:transition-colors"
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    setChatContextMenu({
                                      x: e.clientX,
                                      y: e.clientY,
                                      user: msg.user,
                                    });
                                  }}
                                  title="Clic derecho para responder"
                                >
                                  <div className="tw:flex tw:justify-between tw:mb-0.5">
                                    <span className="tw:font-bold tw:text-slate-700">
                                      {msg.user}
                                    </span>
                                    <span className="tw:text-[9px] tw:text-gray-400">
                                      {new Date(msg.timestamp).toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}
                                    </span>
                                  </div>
                                  <p className="tw:text-gray-600">{msg.message}</p>
                                </div>
                              ))
                            )}
                          </div>
                          <div className="tw:flex tw:border-t">
                            <input
                              id="coordination-chat-input"
                              className="tw:flex-1 tw:px-2 tw:py-1.5 tw:text-xs tw:outline-none"
                              placeholder="Escribe un mensaje para el equipo…"
                              value={chatInput}
                              onChange={(e) => setChatInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSendChat();
                                }
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => handleSendChat()}
                              disabled={!chatInput.trim()}
                              className="tw:px-3 tw:py-1.5 tw:bg-slate-600 tw:hover:bg-slate-700 tw:text-white tw:font-semibold disabled:tw:opacity-50"
                            >
                              Enviar
                            </button>
                          </div>
                        </div>

                        {chatContextMenu && (
                          <div
                            className="tw:fixed tw:z-[10000] tw:bg-white tw:border tw:border-slate-200 tw:shadow-lg tw:rounded-lg tw:py-1 tw:w-40 tw:text-xs"
                            style={{ top: chatContextMenu.y, left: chatContextMenu.x }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => {
                                const replyPrefix = `@${chatContextMenu.user} `;
                                setChatInput((prev) =>
                                  prev.startsWith(replyPrefix) ? prev : replyPrefix + prev,
                                );
                                setChatContextMenu(null);
                                const inputEl = document.getElementById('coordination-chat-input');
                                if (inputEl) inputEl.focus();
                              }}
                              className="tw:w-full tw:text-left tw:px-3 tw:py-2 tw:hover:bg-slate-100 tw:text-slate-700 tw:font-semibold tw:flex tw:items-center tw:gap-1.5 tw:cursor-pointer tw:border-none tw:bg-white"
                            >
                              💬 Responder a {chatContextMenu.user}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Google Calendar Section */}
              <div className="tw:border tw:border-gray-200 tw:rounded-lg tw:overflow-hidden tw:no-print">
                <button
                  className="tw:w-full tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-2 tw:bg-gray-50 tw:hover:bg-gray-100 tw:text-left"
                  onClick={() => setShowGcalSection((s) => !s)}
                >
                  <span className="tw:font-semibold tw:text-xs tw:text-gray-700">
                    📅 Google Calendar
                    {gcalStatus.connected && (
                      <span className="tw:ml-2 tw:text-green-600 tw:font-normal">● Conectado</span>
                    )}
                  </span>
                  <span className="tw:text-gray-400 tw:text-xs">{showGcalSection ? '▲' : '▼'}</span>
                </button>

                {showGcalSection && (
                  <div className="tw:p-3 tw:space-y-3">
                    {gcalStatus.connected ? (
                      <>
                        <div className="tw:flex tw:items-center tw:justify-between tw:flex-wrap tw:gap-2">
                          <div className="tw:text-xs tw:text-gray-600 tw:space-y-0.5">
                            <div>
                              <span className="tw:text-green-600 tw:font-medium">● Conectado</span>
                              {gcalStatus.email && (
                                <span className="tw:ml-1 tw:text-gray-500">
                                  ({gcalStatus.email})
                                </span>
                              )}
                            </div>
                            {gcalStatus.lastSync && (
                              <div className="tw:text-gray-400">
                                Última sync:{' '}
                                {new Date(gcalStatus.lastSync).toLocaleString('es', {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                })}
                              </div>
                            )}
                          </div>
                          <div className="tw:flex tw:gap-2 tw:flex-wrap">
                            <button
                              className="tw:text-xs tw:px-2 tw:py-1 tw:bg-blue-600 tw:text-white tw:rounded tw:hover:bg-blue-700 tw:disabled:opacity-50"
                              onClick={gcalSync}
                              disabled={gcalSyncing || !projectId}
                            >
                              {gcalSyncing ? '⟳ Sincronizando…' : '↑ Sincronizar Fechas'}
                            </button>
                            <button
                              className="tw:text-xs tw:px-2 tw:py-1 tw:rounded tw:bg-slate-100 tw:text-slate-700 tw:hover:bg-slate-200"
                              onClick={flushPendingTime}
                            >
                              ⟳ Sincronizar horas pendientes
                            </button>
                            <button
                              className="tw:text-xs tw:px-2 tw:py-1 tw:bg-gray-200 tw:text-gray-700 tw:rounded tw:hover:bg-gray-300"
                              onClick={gcalDisconnect}
                            >
                              Desconectar
                            </button>
                          </div>
                        </div>

                        <div className="tw:flex tw:items-center tw:gap-2 tw:text-xs">
                          <span className="tw:text-gray-500 tw:flex-shrink-0">Calendario:</span>
                          {gcalCalendars.length > 0 ? (
                            <select
                              className="tw:flex-1 tw:border tw:border-gray-300 tw:rounded tw:px-1.5 tw:py-0.5 tw:text-xs tw:max-w-xs"
                              value={gcalStatus.calendarId}
                              onChange={(e) => gcalChangeCalendar(e.target.value)}
                            >
                              {gcalCalendars.map((cal) => (
                                <option key={cal.id} value={cal.id}>
                                  {cal.summary}
                                  {cal.primary ? ' (principal)' : ''}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="tw:text-gray-400">
                              {gcalStatus.calendarId}
                              <button
                                className="tw:ml-2 tw:text-blue-500 tw:hover:text-blue-700 tw:underline"
                                onClick={gcalLoadCalendars}
                              >
                                Cargar calendarios
                              </button>
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="tw:text-xs tw:text-gray-500">
                          Conecta Google Calendar para sincronizar fechas límite de tareas como
                          eventos y ver el calendario del equipo.
                        </p>

                        {/* One-click reconnect — shown when credentials are already saved */}
                        {gcalStatus.hasCredentials && !showGcalSetup && (
                          <div className="tw:space-y-1.5">
                            <button
                              className="tw:text-xs tw:px-3 tw:py-1.5 tw:bg-blue-600 tw:text-white tw:rounded tw:hover:bg-blue-700 tw:disabled:opacity-50"
                              onClick={gcalReconnect}
                              disabled={gcalConnecting}
                            >
                              {gcalConnecting
                                ? '⟳ Esperando autorización…'
                                : '🔑 Reconectar Google Calendar'}
                            </button>
                            <p className="tw:text-xs tw:text-gray-400">
                              Se usarán las credenciales guardadas. El navegador se abrirá para
                              aprobar el acceso.{' '}
                              <button
                                className="tw:underline tw:hover:text-gray-600"
                                onClick={() => setShowGcalSetup(true)}
                              >
                                Usar otras credenciales
                              </button>
                            </p>
                            <p className="tw:text-xs tw:text-amber-700 tw:bg-amber-50 tw:border tw:border-amber-200 tw:rounded tw:px-2 tw:py-1">
                              💡 Si tienes que reconectar frecuentemente: en Google Cloud Console
                              cambia la app de <strong>«En prueba»</strong> a{' '}
                              <strong>«En producción»</strong> (no requiere verificación de Google).
                              Esto evita que el token expire cada 7 días.
                            </p>
                          </div>
                        )}

                        {/* First-time connect or "use other credentials" */}
                        {(!gcalStatus.hasCredentials || showGcalSetup) && (
                          <div className="tw:space-y-2">
                            {!showGcalSetup && (
                              <button
                                className="tw:text-xs tw:px-3 tw:py-1.5 tw:bg-blue-600 tw:text-white tw:rounded tw:hover:bg-blue-700"
                                onClick={() => setShowGcalSetup(true)}
                              >
                                Conectar Google Calendar
                              </button>
                            )}
                            {showGcalSetup && (
                              <>
                                <div className="tw:text-xs tw:bg-blue-50 tw:border tw:border-blue-200 tw:rounded tw:p-2 tw:space-y-1.5">
                                  <p className="tw:font-semibold tw:text-blue-700">
                                    Configuración en Google Cloud Console:
                                  </p>
                                  <ol className="tw:list-decimal tw:list-inside tw:space-y-1 tw:text-blue-800">
                                    <li>
                                      Ve a{' '}
                                      <span className="tw:font-mono tw:bg-blue-100 tw:px-0.5 tw:rounded">
                                        console.cloud.google.com
                                      </span>
                                    </li>
                                    <li>Crea o selecciona un proyecto</li>
                                    <li>
                                      <strong>APIs y servicios → Biblioteca</strong> → busca{' '}
                                      <em>Google Calendar API</em> → Habilitar
                                    </li>
                                    <li>
                                      <strong>
                                        APIs y servicios → Pantalla de consentimiento OAuth
                                      </strong>{' '}
                                      → Tipo: <strong>Externo</strong> → crea, llena nombre y correo
                                      → agrega tu correo en &quot;Usuarios de prueba&quot;
                                    </li>
                                    <li>
                                      <strong>
                                        APIs y servicios → Credenciales → Crear credenciales → ID de
                                        cliente de OAuth 2.0
                                      </strong>
                                    </li>
                                    <li>
                                      Tipo de aplicación: <strong>Aplicación de escritorio</strong>{' '}
                                      (no &quot;Aplicación web&quot;)
                                    </li>
                                    <li>
                                      Copia el <strong>ID de cliente</strong> y{' '}
                                      <strong>Secreto de cliente</strong>
                                    </li>
                                  </ol>
                                  <p className="tw:text-orange-700 tw:font-medium tw:mt-1">
                                    ⚠ Error 400 = elegiste &quot;Aplicación web&quot; en vez de
                                    &quot;Aplicación de escritorio&quot;, o falta configurar la
                                    pantalla de consentimiento.
                                  </p>
                                </div>

                                <div className="tw:flex tw:flex-col tw:gap-1.5">
                                  <input
                                    type="text"
                                    placeholder="Client ID (termina en .apps.googleusercontent.com)"
                                    value={gcalClientId}
                                    onChange={(e) => setGcalClientId(e.target.value)}
                                    className="tw:w-full tw:border tw:border-gray-300 tw:rounded tw:px-2 tw:py-1 tw:text-xs"
                                  />
                                  <input
                                    type="password"
                                    placeholder="Client Secret"
                                    value={gcalClientSecret}
                                    onChange={(e) => setGcalClientSecret(e.target.value)}
                                    className="tw:w-full tw:border tw:border-gray-300 tw:rounded tw:px-2 tw:py-1 tw:text-xs"
                                    onKeyDown={(e) => e.key === 'Enter' && gcalConnect()}
                                  />
                                </div>

                                <div className="tw:flex tw:gap-2">
                                  <button
                                    className="tw:text-xs tw:px-3 tw:py-1.5 tw:bg-green-600 tw:text-white tw:rounded tw:hover:bg-green-700 tw:disabled:opacity-50"
                                    onClick={gcalConnect}
                                    disabled={gcalConnecting}
                                  >
                                    {gcalConnecting ? '⟳ Esperando…' : 'Autorizar con Google'}
                                  </button>
                                  <button
                                    className="tw:text-xs tw:px-3 tw:py-1.5 tw:bg-gray-200 tw:text-gray-700 tw:rounded tw:hover:bg-gray-300"
                                    onClick={() => {
                                      setShowGcalSetup(false);
                                      setGcalError('');
                                      setGcalMessage('');
                                    }}
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </>
                    )}

                    {gcalMessage && (
                      <p className="tw:text-xs tw:text-green-700 tw:bg-green-50 tw:border tw:border-green-200 tw:rounded tw:px-2 tw:py-1">
                        {gcalMessage}
                      </p>
                    )}
                    {gcalError && (
                      <p className="tw:text-xs tw:text-red-700 tw:bg-red-50 tw:border tw:border-red-200 tw:rounded tw:px-2 tw:py-1">
                        {gcalError}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Drive Task Sync Section */}
              <div className="tw:border tw:border-gray-200 tw:rounded-lg tw:overflow-hidden tw:no-print">
                <button
                  className="tw:w-full tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-2 tw:bg-gray-50 tw:hover:bg-gray-100 tw:text-left"
                  onClick={() => setShowDriveSection((s) => !s)}
                >
                  <span className="tw:font-semibold tw:text-xs tw:text-gray-700">
                    ☁ Sincronización de Tareas (Drive)
                    {driveStatus.connected ? (
                      <span className="tw:ml-2 tw:text-green-600 tw:font-normal">● Conectado</span>
                    ) : (
                      <span className="tw:ml-2 tw:text-gray-400 tw:font-normal">
                        ○ No configurado
                      </span>
                    )}
                  </span>
                  <span className="tw:text-gray-400 tw:text-xs">
                    {showDriveSection ? '▲' : '▼'}
                  </span>
                </button>

                {showDriveSection && (
                  <div className="tw:p-3 tw:space-y-3 tw:text-xs">
                    {driveStatus.connected ? (
                      <>
                        <div className="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
                          <p className="tw:text-green-700 tw:bg-green-50 tw:border tw:border-green-200 tw:rounded tw:px-2 tw:py-1 tw:flex-1">
                            ✓ Drive conectado · {driveStatus.fileCount} proyecto(s) sincronizado(s)
                          </p>
                          <button
                            className="tw:px-2 tw:py-1 tw:bg-gray-100 tw:border tw:border-gray-300 tw:text-gray-700 tw:rounded tw:text-xs tw:hover:bg-gray-200 tw:disabled:opacity-50 tw:whitespace-nowrap"
                            onClick={driveTest}
                            disabled={driveTesting}
                          >
                            {driveTesting ? '⟳ Probando…' : '🔍 Probar'}
                          </button>
                        </div>
                        {driveTestResult && (
                          <p
                            className={`tw:text-xs tw:rounded tw:px-2 tw:py-1 tw:font-mono tw:whitespace-pre-wrap tw:break-all ${
                              driveTestResult.startsWith('tw:✓')
                                ? 'tw:text-green-700 tw:bg-green-50 tw:border tw:border-green-200'
                                : 'tw:text-red-700 tw:bg-red-50 tw:border tw:border-red-200'
                            }`}
                          >
                            {driveTestResult}
                          </p>
                        )}

                        {/* Force sync button */}
                        <div className="tw:flex tw:items-center tw:gap-2">
                          <button
                            className="tw:px-3 tw:py-1.5 tw:bg-green-600 tw:text-white tw:rounded tw:text-xs tw:hover:bg-green-700 tw:disabled:opacity-50"
                            onClick={driveForceSync}
                            disabled={driveSyncing}
                          >
                            {driveSyncing ? '⟳ Sincronizando…' : '↑ Sincronizar proyecto ahora'}
                          </button>
                        </div>
                        {driveSyncResult && (
                          <p
                            className={`tw:text-xs tw:rounded tw:px-2 tw:py-1 tw:font-mono tw:whitespace-pre-wrap tw:break-all ${
                              driveSyncResult.startsWith('tw:✓')
                                ? 'tw:text-green-700 tw:bg-green-50 tw:border tw:border-green-200'
                                : driveSyncResult === 'tw:Sincronizando…'
                                  ? 'tw:text-blue-700 tw:bg-blue-50 tw:border tw:border-blue-200'
                                  : 'tw:text-red-700 tw:bg-red-50 tw:border tw:border-red-200'
                            }`}
                          >
                            {driveSyncResult}
                          </p>
                        )}

                        {/* Re-import form (shown when user clicks "Actualizar config") */}
                        {showDriveImport ? (
                          <div className="tw:space-y-2 tw:border tw:border-blue-200 tw:rounded tw:p-2 tw:bg-blue-50">
                            <p className="tw:font-medium tw:text-blue-800">
                              Pega la nueva configuración del admin:
                            </p>
                            <textarea
                              className="tw:w-full tw:border tw:border-gray-300 tw:rounded tw:px-2 tw:py-1 tw:text-xs tw:font-mono tw:h-20 tw:resize-none"
                              value={driveImportJson}
                              onChange={(e) => setDriveImportJson(e.target.value)}
                              placeholder="Pega aquí el JSON actualizado…"
                            />
                            <div className="tw:flex tw:gap-2">
                              <button
                                className="tw:px-3 tw:py-1.5 tw:bg-blue-600 tw:text-white tw:rounded tw:text-xs tw:hover:bg-blue-700"
                                onClick={driveImportConfig}
                              >
                                ✓ Actualizar
                              </button>
                              <button
                                className="tw:px-3 tw:py-1.5 tw:bg-gray-200 tw:text-gray-700 tw:rounded tw:text-xs tw:hover:bg-gray-300"
                                onClick={() => {
                                  setShowDriveImport(false);
                                  setDriveImportJson('');
                                  setDriveError('');
                                }}
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="tw:bg-blue-50 tw:border tw:border-blue-200 tw:rounded tw:p-2 tw:space-y-1">
                              <p className="tw:font-medium tw:text-blue-800">
                                Comparte con el equipo:
                              </p>
                              <p className="tw:text-blue-700">
                                1. Haz clic en "Exportar config" para copiar la configuración.
                                <br />
                                2. Envía el texto a cada compañero.
                                <br />
                                3. Ellos pegan el texto con el botón "Actualizar config".
                              </p>
                            </div>
                            {driveExportedConfig ? (
                              <div className="tw:space-y-1">
                                <p className="tw:font-medium tw:text-gray-700">
                                  Configuración para compartir:
                                </p>
                                <textarea
                                  className="tw:w-full tw:border tw:border-gray-300 tw:rounded tw:px-2 tw:py-1 tw:text-xs tw:font-mono tw:h-20 tw:resize-none"
                                  readOnly
                                  value={driveExportedConfig}
                                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                                />
                                <p className="tw:text-gray-500">
                                  Haz clic en el texto para seleccionar todo, luego copia (Ctrl+C).
                                </p>
                              </div>
                            ) : (
                              <button
                                className="tw:px-3 tw:py-1.5 tw:bg-blue-600 tw:text-white tw:rounded tw:text-xs tw:hover:bg-blue-700"
                                onClick={driveExportConfig}
                              >
                                📋 Exportar config para el equipo
                              </button>
                            )}
                            <button
                              className="tw:block tw:text-blue-600 tw:underline tw:text-xs"
                              onClick={() => {
                                setShowDriveImport(true);
                                setDriveError('');
                              }}
                            >
                              ↺ Actualizar config (pegar nueva versión del admin)
                            </button>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="tw:text-gray-600">
                          Las tareas se guardarán en Google Drive y se sincronizarán automáticamente
                          con todo el equipo.
                        </p>

                        {/* Setup for admin */}
                        {!showDriveImport && (
                          <>
                            {!driveStatus.hasCredentials || showDriveSetup ? (
                              <div className="tw:space-y-2 tw:border tw:border-gray-200 tw:rounded tw:p-2">
                                <p className="tw:font-medium tw:text-gray-700">
                                  Conectar Drive (admin):
                                </p>
                                <div>
                                  <label className="tw:block tw:text-gray-500 tw:mb-0.5">
                                    Client ID
                                  </label>
                                  <input
                                    type="text"
                                    className="tw:w-full tw:border tw:border-gray-300 tw:rounded tw:px-2 tw:py-1 tw:text-xs"
                                    value={driveClientId}
                                    onChange={(e) => setDriveClientId(e.target.value)}
                                    placeholder="xxxxxx.apps.googleusercontent.com"
                                  />
                                </div>
                                <div>
                                  <label className="tw:block tw:text-gray-500 tw:mb-0.5">
                                    Client Secret
                                  </label>
                                  <input
                                    type="password"
                                    className="tw:w-full tw:border tw:border-gray-300 tw:rounded tw:px-2 tw:py-1 tw:text-xs"
                                    value={driveClientSecret}
                                    onChange={(e) => setDriveClientSecret(e.target.value)}
                                    placeholder="GOCSPX-…"
                                  />
                                </div>
                                <div className="tw:flex tw:gap-2">
                                  <button
                                    className="tw:px-3 tw:py-1.5 tw:bg-blue-600 tw:text-white tw:rounded tw:text-xs tw:hover:bg-blue-700 tw:disabled:opacity-50"
                                    onClick={driveConnect}
                                    disabled={driveConnecting}
                                  >
                                    {driveConnecting ? '⟳ Esperando…' : '🔑 Autorizar con Google'}
                                  </button>
                                  {showDriveSetup && (
                                    <button
                                      className="tw:px-3 tw:py-1.5 tw:bg-gray-200 tw:text-gray-700 tw:rounded tw:text-xs tw:hover:bg-gray-300"
                                      onClick={() => setShowDriveSetup(false)}
                                    >
                                      Cancelar
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <button
                                className="tw:px-3 tw:py-1.5 tw:bg-gray-200 tw:text-gray-700 tw:rounded tw:text-xs tw:hover:bg-gray-300"
                                onClick={() => setShowDriveSetup(true)}
                              >
                                🔑 Conectar Drive (admin)
                              </button>
                            )}
                            <button
                              className="tw:block tw:text-blue-600 tw:underline tw:text-xs"
                              onClick={() => {
                                setShowDriveImport(true);
                                setDriveError('');
                              }}
                            >
                              ¿Eres compañero de equipo? Importar configuración del admin →
                            </button>
                          </>
                        )}

                        {/* Import for team members */}
                        {showDriveImport && (
                          <div className="tw:space-y-2 tw:border tw:border-blue-200 tw:rounded tw:p-2 tw:bg-blue-50">
                            <p className="tw:font-medium tw:text-blue-800">
                              Importar configuración del admin:
                            </p>
                            <textarea
                              className="tw:w-full tw:border tw:border-gray-300 tw:rounded tw:px-2 tw:py-1 tw:text-xs tw:font-mono tw:h-20 tw:resize-none"
                              value={driveImportJson}
                              onChange={(e) => setDriveImportJson(e.target.value)}
                              placeholder="Pega aquí el JSON que te dio el administrador…"
                            />
                            <div className="tw:flex tw:gap-2">
                              <button
                                className="tw:px-3 tw:py-1.5 tw:bg-blue-600 tw:text-white tw:rounded tw:text-xs tw:hover:bg-blue-700"
                                onClick={driveImportConfig}
                              >
                                ✓ Importar
                              </button>
                              <button
                                className="tw:px-3 tw:py-1.5 tw:bg-gray-200 tw:text-gray-700 tw:rounded tw:text-xs tw:hover:bg-gray-300"
                                onClick={() => {
                                  setShowDriveImport(false);
                                  setDriveImportJson('');
                                  setDriveError('');
                                }}
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {driveMessage && (
                      <p className="tw:text-green-700 tw:bg-green-50 tw:border tw:border-green-200 tw:rounded tw:px-2 tw:py-1">
                        {driveMessage}
                      </p>
                    )}
                    {driveError && (
                      <p className="tw:text-red-700 tw:bg-red-50 tw:border tw:border-red-200 tw:rounded tw:px-2 tw:py-1">
                        {driveError}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Right Main Content */}
          {currentTab === 'summary' ? (
            <div className="tw:flex-1 tw:overflow-auto tw:p-3 tw:space-y-3">
              {totalTasks === 0 ? (
                <div className="tw:flex tw:items-center tw:justify-center tw:py-8 tw:text-gray-400">
                  No hay tareas creadas todavía. Abre el Tablero de Tareas para crear tareas.
                </div>
              ) : (
                <>
                  <table className="tw:border-collapse tw:w-full">
                    <thead>
                      <tr>
                        <th className="tw:border tw:border-gray-200 tw:bg-gray-100 tw:px-2 tw:py-1 tw:text-left tw:font-semibold tw:sticky tw:left-0 tw:z-10">
                          Libro
                        </th>
                        {orderedStages.map((stage) => (
                          <th
                            key={stage}
                            className="tw:border tw:border-gray-200 tw:bg-gray-100 tw:px-1 tw:py-1 tw:font-medium tw:whitespace-nowrap tw:max-w-20"
                            title={getStageLabel(stage, stageConfig)}
                          >
                            <div className="tw:truncate tw:max-w-16">
                              {getStageLabel(stage, stageConfig)}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {booksInUse.map((book) => (
                        <tr key={book} className="tw:hover:bg-gray-50">
                          <td className="tw:border tw:border-gray-200 tw:px-2 tw:py-1 tw:font-semibold tw:bg-white tw:sticky tw:left-0">
                            {book}
                          </td>
                          {orderedStages.map((stage) => {
                            const cellTasks = grid[book]?.[stage] ?? [];
                            const status = aggregateStatus(cellTasks);
                            return (
                              <td
                                key={stage}
                                className={`tw:border tw:border-gray-200 tw:px-1 tw:py-1 tw:text-center ${
                                  status ? CELL_STYLES[status] : 'tw:bg-white'
                                }`}
                                title={
                                  cellTasks.length > 0
                                    ? `${cellTasks.length} tarea${cellTasks.length !== 1 ? 's' : ''}`
                                    : ''
                                }
                              >
                                {status ? (
                                  <span className="tw:font-medium">
                                    {CELL_ICONS[status]}
                                    {cellTasks.length > 1 && (
                                      <sup className="tw:text-gray-500">{cellTasks.length}</sup>
                                    )}
                                  </span>
                                ) : null}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="tw:bg-gray-100 tw:font-medium">
                        <td className="tw:border tw:border-gray-200 tw:px-2 tw:py-1 tw:sticky tw:left-0 tw:bg-gray-100">
                          Total
                        </td>
                        {orderedStages.map((stage) => {
                          const s = stageSummary[stage];
                          return (
                            <td
                              key={stage}
                              className="tw:border tw:border-gray-200 tw:px-1 tw:py-1 tw:text-center"
                            >
                              {s.total > 0 ? (
                                <span
                                  className={
                                    s.complete === s.total
                                      ? 'tw:text-green-600'
                                      : 'tw:text-gray-600'
                                  }
                                  title={`${s.complete}/${s.total} completas${s.flagged > 0 ? `, ${s.flagged} banderas` : ''}`}
                                >
                                  {s.complete}/{s.total}
                                </span>
                              ) : (
                                <span className="tw:text-gray-300">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    </tfoot>
                  </table>

                  {/* Legend */}
                  <div className="tw:flex tw:gap-4 tw:mt-3 tw:px-1 tw:text-xs tw:text-gray-500 tw:flex-wrap">
                    <span>✓ Completo</span>
                    <span>⟳ En Progreso</span>
                    <span>• Pendiente</span>
                    <span className="tw:flex tw:items-center tw:gap-1">
                      <span className="tw:w-2 tw:h-2 tw:rounded-full tw:bg-red-500 tw:inline-block" />
                      ⚑ Bandera
                    </span>
                  </div>
                </>
              )}
            </div>
          ) : (
            /* Calendar tab */
            <div className="tw:flex-1 tw:flex tw:flex-col tw:overflow-hidden">
              <CalendarTabContent
                tasks={tasks}
                stageConfig={stageConfig}
                projectId={projectId}
                calMonth={calMonth}
                setCalMonth={setCalMonth}
                selectedDay={selectedDay}
                setSelectedDay={setSelectedDay}
                gcalEvents={gcalEvents}
                gcalEventsLoading={gcalEventsLoading}
                gcalConnected={gcalStatus.connected}
                calendarDays={calendarDays}
                tasksByDeadline={tasksByDeadline}
                gcalEventsByDate={gcalEventsByDate}
                timeEntriesByDate={timeEntriesByDate}
                teamMembers={teamMembers}
                logTimeUser={logTimeUser}
                setLogTimeUser={setLogTimeUser}
                logTimeTask={logTimeTask}
                setLogTimeTask={setLogTimeTask}
                logTimeHours={logTimeHours}
                setLogTimeHours={setLogTimeHours}
                logTimeNote={logTimeNote}
                setLogTimeNote={setLogTimeNote}
                logTimeCustomLabel={logTimeCustomLabel}
                setLogTimeCustomLabel={setLogTimeCustomLabel}
                logTimeSaving={logTimeSaving}
                logTimeError={logTimeError}
                logTimeSuccess={logTimeSuccess}
                saveTimeEntry={saveTimeEntry}
                deleteTimeEntry={deleteTimeEntry}
                deleteGcalEvent={deleteGcalEvent}
              />
            </div>
          )}
        </div>
      )}

      {showAvatarSettings && (
        <AvatarSettingsModal
          currentUser={currentUser}
          onClose={() => setShowAvatarSettings(false)}
        />
      )}
    </div>
  );
};
