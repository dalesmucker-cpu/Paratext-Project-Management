import { WebViewProps } from '@papi/core';
import papi from '@papi/frontend';
import { useDialogCallback } from '@papi/frontend/react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ProjectTask, TaskStatus, StageConfig, TaskStore, TimeEntry } from './types/task.types';
import {
  BIBLE_BOOKS,
  getOrderedStages,
  getStageLabel,
  TEAM_MEMBERS,
  generateId,
  STATUS_COLORS,
  STATUS_LABELS,
  STAGES,
} from './types/task.types';

/** Safely convert any caught value (including papi plain-object errors) to a readable string. */
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null) {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    return JSON.stringify(obj);
  }
  return String(e);
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
  pending: 'bg-gray-100 text-gray-500',
  'in-progress': 'bg-yellow-100 text-yellow-700',
  complete: 'bg-green-100 text-green-700',
  flagged: 'bg-red-100 text-red-700',
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
    <div className="flex flex-1 overflow-hidden">
      {/* Left: monthly grid */}
      <div className={`flex flex-col overflow-auto ${selectedDay ? 'w-3/5' : 'w-full'}`}>
        {/* Month navigation */}
        <div className="flex items-center gap-2 px-3 py-2 bg-white border-b sticky top-0 z-10">
          <button
            className="px-2 py-0.5 bg-gray-100 rounded hover:bg-gray-200 text-xs"
            onClick={prevMonth}
          >
            ‹ Ant
          </button>
          <span className="font-semibold text-sm text-gray-700 capitalize flex-1 text-center">
            {monthLabel}
          </span>
          <button
            className="px-2 py-0.5 bg-gray-100 rounded hover:bg-gray-200 text-xs"
            onClick={goToday}
          >
            Hoy
          </button>
          <button
            className="px-2 py-0.5 bg-gray-100 rounded hover:bg-gray-200 text-xs"
            onClick={nextMonth}
          >
            Sig ›
          </button>
          {gcalEventsLoading && (
            <span className="text-xs text-blue-500">⟳ GCal…</span>
          )}
        </div>

        {/* Day-of-week header */}
        <div className="grid grid-cols-7 border-b bg-gray-50">
          {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((d) => (
            <div key={d} className="text-center text-xs font-medium text-gray-500 py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 flex-1 auto-rows-min">
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
                className={`min-h-14 p-1 border-b border-r border-gray-100 cursor-pointer transition-colors ${
                  isOtherMonth ? 'bg-gray-50 opacity-50' : 'bg-white hover:bg-blue-50'
                } ${isSelected ? 'bg-blue-100 ring-1 ring-inset ring-blue-400' : ''} ${
                  isToday && !isSelected ? 'bg-yellow-50' : ''
                }`}
                onClick={() => setSelectedDay(isSelected ? null : cell.date)}
              >
                {/* Day number */}
                <div className={`text-xs font-medium mb-0.5 leading-none ${
                  isToday
                    ? 'bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center'
                    : isOtherMonth
                    ? 'text-gray-300'
                    : 'text-gray-700'
                }`}>
                  {cell.dayNum}
                </div>

                {/* Deadline task status dots */}
                {deadlineTasks.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 mb-0.5">
                    {deadlineTasks.slice(0, 3).map((t) => (
                      <span
                        key={t.id}
                        className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          t.status === 'complete' ? 'bg-green-500' :
                          t.status === 'flagged' ? 'bg-red-500' :
                          t.status === 'in-progress' ? 'bg-yellow-500' :
                          'bg-gray-400'
                        }`}
                        title={`${t.book} ${t.chapter} — ${getStageLabel(t.stage, stageConfig)} (${t.status})`}
                      />
                    ))}
                    {deadlineTasks.length > 3 && (
                      <span className="text-gray-400 leading-none" style={{ fontSize: '9px' }}>
                        +{deadlineTasks.length - 3}
                      </span>
                    )}
                  </div>
                )}

                {/* GCal event tags */}
                {eventsOnDay.slice(0, 2).map((ev) => (
                  <div
                    key={ev.id}
                    className="text-blue-700 bg-blue-100 rounded px-0.5 truncate mb-0.5"
                    style={{ fontSize: '9px' }}
                    title={ev.summary}
                  >
                    {ev.summary}
                  </div>
                ))}
                {eventsOnDay.length > 2 && (
                  <div className="text-blue-500" style={{ fontSize: '9px' }}>
                    +{eventsOnDay.length - 2} más
                  </div>
                )}

                {/* Hours-logged badge */}
                {hoursOnDay > 0 && (
                  <div
                    className="text-purple-700 bg-purple-100 rounded px-0.5 font-medium leading-none"
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
        <div className="flex gap-3 px-3 py-2 text-xs text-gray-500 border-t bg-white flex-wrap">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-gray-400 inline-block" /> Pendiente
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> En progreso
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Completo
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> ⚑ Bandera
          </span>
          {gcalConnected && (
            <span className="flex items-center gap-1">
              <span className="bg-blue-100 text-blue-700 rounded px-1 leading-none" style={{ fontSize: '9px' }}>ev</span> GCal
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="bg-purple-100 text-purple-700 rounded px-1 leading-none" style={{ fontSize: '9px' }}>2h</span> Horas
          </span>
          {!gcalConnected && (
            <span className="text-orange-500 text-xs">
              (Conecta Google Calendar en la pestaña Resumen para ver eventos)
            </span>
          )}
        </div>
      </div>

      {/* Right: day detail panel */}
      {selectedDay && (
        <div className="w-2/5 border-l border-gray-200 flex flex-col overflow-auto bg-white">
          {/* Panel header */}
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b sticky top-0 z-10">
            <span className="font-semibold text-xs text-gray-700 capitalize">
              {new Date(selectedDay + 'T12:00:00').toLocaleDateString('es', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
            <button
              className="text-gray-400 hover:text-gray-600 text-sm leading-none"
              onClick={() => setSelectedDay(null)}
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-auto p-3 space-y-4">
            {/* Tasks due this day */}
            <section>
              <h4 className="font-semibold text-xs text-gray-500 mb-1 uppercase tracking-wide">
                Tareas con fecha límite
              </h4>
              {dayDeadlineTasks.length === 0 ? (
                <p className="text-xs text-gray-400">Ninguna tarea con fecha límite este día.</p>
              ) : (
                <ul className="space-y-1">
                  {dayDeadlineTasks.map((task) => (
                    <li
                      key={task.id}
                      className={`text-xs px-2 py-1 rounded border-l-2 ${
                        task.status === 'complete' ? 'border-green-400 bg-green-50' :
                        task.status === 'flagged' ? 'border-red-400 bg-red-50' :
                        task.status === 'in-progress' ? 'border-yellow-400 bg-yellow-50' :
                        'border-gray-300 bg-gray-50'
                      }`}
                    >
                      <span className="font-medium">{task.book} {task.chapter}</span>
                      {' — '}
                      <span className="text-gray-600">{getStageLabel(task.stage, stageConfig)}</span>
                      <span className={`ml-1.5 px-1 rounded text-xs ${STATUS_COLORS[task.status]}`}>
                        {STATUS_LABELS[task.status]}
                      </span>
                      {(task.assignedTo ?? []).length > 0 && (
                        <span className="text-gray-400 ml-1">({(task.assignedTo ?? []).join(', ')})</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* GCal events (only if connected) */}
            {gcalConnected && (
              <section>
                <h4 className="font-semibold text-xs text-gray-500 mb-1 uppercase tracking-wide">
                  Eventos de Google Calendar
                </h4>
                {gcalEventsLoading ? (
                  <p className="text-xs text-gray-400">⟳ Cargando…</p>
                ) : dayGcalEvents.length === 0 ? (
                  <p className="text-xs text-gray-400">Ningún evento este día.</p>
                ) : (
                  <ul className="space-y-1">
                    {dayGcalEvents.map((ev) => (
                      <li
                        key={ev.id}
                        className="text-xs bg-blue-50 border border-blue-100 rounded px-2 py-1"
                      >
                        <div className="flex items-start justify-between gap-1">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-blue-800">{ev.summary}</div>
                            {!ev.allDay && ev.start && (
                              <div className="text-blue-600">
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
                            {ev.allDay && (
                              <div className="text-blue-500">Todo el día</div>
                            )}
                            {ev.description && (
                              <div className="text-gray-500 truncate">{ev.description}</div>
                            )}
                          </div>
                          <button
                            className="flex-shrink-0 text-gray-300 hover:text-red-500 transition-colors leading-none"
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
            <section className="border border-gray-200 rounded-lg p-3 bg-gray-50">
              <h4 className="font-semibold text-xs text-gray-700 mb-2">Registrar tiempo</h4>
              <div className="space-y-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Tarea</label>
                  <select
                    className="w-full border border-gray-300 rounded px-2 py-1 text-xs bg-white"
                    value={logTimeTask}
                    onChange={(e) => setLogTimeTask(e.target.value)}
                  >
                    <option value="">— Selecciona una tarea —</option>
                    {tasks.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.book} {task.chapter} — {getStageLabel(task.stage, stageConfig)}
                        {(task.assignedTo ?? []).length > 0 ? ` (${(task.assignedTo ?? []).join(', ')})` : ''}
                      </option>
                    ))}
                    <option value="__otro__">─── Otro… ───</option>
                  </select>
                </div>

                {/* Free-text label when "Otro" is selected */}
                {logTimeTask === '__otro__' && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Descripción</label>
                    <input
                      type="text"
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                      value={logTimeCustomLabel}
                      onChange={(e) => setLogTimeCustomLabel(e.target.value)}
                      placeholder="Ej: Reunión de equipo, Capacitación…"
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Usuario</label>
                  <select
                    className="w-full border border-gray-300 rounded px-2 py-1 text-xs bg-white"
                    value={logTimeUser}
                    onChange={(e) => setLogTimeUser(e.target.value)}
                  >
                    <option value="">— Selecciona —</option>
                    {teamMembers.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Horas</label>
                  <input
                    type="number"
                    min="0.25"
                    step="0.25"
                    className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                    value={logTimeHours}
                    onChange={(e) => setLogTimeHours(e.target.value)}
                    placeholder="1.5"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Nota (opcional)</label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                    value={logTimeNote}
                    onChange={(e) => setLogTimeNote(e.target.value)}
                    placeholder="Descripción del trabajo realizado…"
                    onKeyDown={(e) => { if (e.key === 'Enter') saveTimeEntry(); }}
                  />
                </div>

                {logTimeError && (
                  <p className="text-xs text-red-600">{logTimeError}</p>
                )}
                {logTimeSuccess && (
                  <p className="text-xs text-green-600">{logTimeSuccess}</p>
                )}

                <button
                  className="w-full text-xs px-3 py-1.5 bg-slate-600 text-white rounded hover:bg-slate-700 disabled:opacity-50"
                  onClick={saveTimeEntry}
                  disabled={logTimeSaving}
                >
                  {logTimeSaving ? '⟳ Guardando…' : '+ Registrar horas'}
                </button>
              </div>
            </section>

            {/* Hours logged this day */}
            <section>
              <h4 className="font-semibold text-xs text-gray-500 mb-1 uppercase tracking-wide">
                Horas del día
                {dayTotalHours > 0 && (
                  <span className="ml-2 font-normal text-purple-700 normal-case">
                    {dayTotalHours}h total
                  </span>
                )}
              </h4>
              {dayTimeEntries.length === 0 ? (
                <p className="text-xs text-gray-400">No se han registrado horas este día.</p>
              ) : (
                <ul className="space-y-1">
                  {dayTimeEntries.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-start justify-between gap-1 text-xs bg-purple-50 border border-purple-100 rounded px-2 py-1"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-purple-800">{entry.hours}h</span>
                          <span className="text-gray-700">{entry.user}</span>
                        </div>
                        <div className="text-gray-500 truncate">{entry.taskLabel}</div>
                        {entry.note && (
                          <div className="text-gray-400 italic truncate">{entry.note}</div>
                        )}
                      </div>
                      <button
                        className="text-red-400 hover:text-red-600 flex-shrink-0 mt-0.5 leading-none"
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
  useWebViewState,
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
  const [currentUser, setCurrentUser] = useState('');

  // --- Tab state ---
  const [currentTab, setCurrentTab] = useState<'summary' | 'calendar'>('summary');

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
  const [driveStatus, setDriveStatus] = useState<DriveStatus>({
    connected: false, hasCredentials: false, clientId: '', fileCount: 0,
  });
  const [showDriveSection, setShowDriveSection] = useState(false);
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

  const loadTasks = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    try {
      const [result, membersResult, userResult] = await Promise.all([
        papi.commands.sendCommand('paratextProjectManager.getTasks', projectId),
        papi.commands.sendCommand('paratextProjectManager.getTeamMembers'),
        papi.commands.sendCommand('paratextProjectManager.getCurrentUser'),
      ]);
      const store = JSON.parse(result) as TaskStore;
      setTasks(store.tasks ?? []);
      setStageConfig(store.stageConfig ?? {});
      extrasRef.current = { activityLog: store.activityLog, deletedTaskIds: store.deletedTaskIds };
      if (membersResult) setTeamMembers(JSON.parse(membersResult as string) as string[]);
      if (userResult && typeof userResult === 'string' && userResult.length > 0) setCurrentUser(userResult);
    } catch (e) {
      // Auto-retry once after 3s — handles papi timeouts after long idle
      try {
        await new Promise((r) => setTimeout(r, 3000));
        const [result, membersResult, userResult] = await Promise.all([
          papi.commands.sendCommand('paratextProjectManager.getTasks', projectId),
          papi.commands.sendCommand('paratextProjectManager.getTeamMembers'),
          papi.commands.sendCommand('paratextProjectManager.getCurrentUser'),
        ]);
        const store = JSON.parse(result) as TaskStore;
        setTasks(store.tasks ?? []);
        setStageConfig(store.stageConfig ?? {});
        extrasRef.current = { activityLog: store.activityLog, deletedTaskIds: store.deletedTaskIds };
        if (membersResult) setTeamMembers(JSON.parse(membersResult as string) as string[]);
        if (userResult && typeof userResult === 'string' && userResult.length > 0) setCurrentUser(userResult);
      } catch (e2) {
        setError(`Error al cargar: ${errMsg(e2)}`);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Carries activityLog + deletedTaskIds through time-entry saves without causing re-renders
  const extrasRef = useRef<{ activityLog?: unknown[]; deletedTaskIds?: string[] }>({});

  // Background auto-refresh — silently picks up changes saved by other computers
  const lastRefreshRef = useRef(0);
  const refreshInProgressRef = useRef(false);

  const silentRefresh = useCallback(async () => {
    if (!projectId || refreshInProgressRef.current) return;
    refreshInProgressRef.current = true;
    try {
      const result = await papi.commands.sendCommand('paratextProjectManager.getTasks', projectId);
      const store = JSON.parse(result as string) as TaskStore;
      lastRefreshRef.current = Date.now();
      const incomingDeleted = new Set(store.deletedTaskIds ?? []);
      extrasRef.current = {
        activityLog: store.activityLog ?? extrasRef.current.activityLog,
        deletedTaskIds: Array.from(new Set([...(extrasRef.current.deletedTaskIds ?? []), ...incomingDeleted])),
      };
      const incoming = store.tasks ?? [];
      setTasks(prev => {
        const merged = new Map(prev.map(t => [t.id, t]));
        for (const id of incomingDeleted) merged.delete(id);
        for (const t of incoming) {
          if (incomingDeleted.has(t.id)) continue;
          const existing = merged.get(t.id);
          if (!existing || t.updatedAt >= existing.updatedAt) merged.set(t.id, t);
        }
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

  // --- persistTasks helper ---

  const persistTasks = useCallback(async (
    updatedTasks: ProjectTask[],
    newStageConfig?: Record<string, StageConfig>,
  ) => {
    const sc = newStageConfig ?? stageConfig;
    const store = { schemaVersion: 1 as const, tasks: updatedTasks, stageConfig: sc };
    await papi.commands.sendCommand('paratextProjectManager.saveTasks', projectId, JSON.stringify(store));
  }, [stageConfig, projectId]);

  // --- Google Calendar callbacks ---

  const loadGcalStatus = useCallback(async () => {
    try {
      const result = await papi.commands.sendCommand('paratextProjectManager.gcalGetStatus');
      const status = JSON.parse(result as string) as GcalStatus;
      setGcalStatus(status);
      // Pre-populate clientId field if previously saved
      if (status.clientId) setGcalClientId(status.clientId);
      // If already connected, load calendar list automatically
      if (status.connected) {
        try {
          const calsResult = await papi.commands.sendCommand('paratextProjectManager.gcalListCalendars');
          setGcalCalendars(JSON.parse(calsResult as string));
        } catch (_) { /* non-critical */ }
      }
    } catch (_) { /* non-critical */ }
  }, []);

  useEffect(() => { loadGcalStatus(); }, [loadGcalStatus]);

  // --- Drive task sync callbacks ---

  const loadDriveStatus = useCallback(async () => {
    try {
      const result = await papi.commands.sendCommand('paratextProjectManager.tasksDriveGetStatus');
      const status = JSON.parse(result as string) as DriveStatus;
      setDriveStatus(status);
      if (status.clientId) setDriveClientId(status.clientId);
    } catch (_) { /* non-critical */ }
  }, []);

  useEffect(() => { loadDriveStatus(); }, [loadDriveStatus]);

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
      setDriveError(`Error al iniciar: ${errMsg(e)}`);
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

      papi.commands.sendCommand('paratextProjectManager.tasksDrivePollAuth')
        .then((res) => {
          const { status, error } = JSON.parse(res as string) as { status: string; error?: string };
          if (status === 'pending') {
            driveAuthPollRef.current = setTimeout(doPoll, 4000);
          } else if (status === 'success') {
            setDriveMessage('✓ Drive conectado. Guarda una tarea para crear el archivo compartido.');
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
        .catch(() => {
          driveAuthPollRef.current = setTimeout(doPoll, 4000); // retry on transient error
        });
    };

    driveAuthPollRef.current = setTimeout(doPoll, 3000); // first check after 3s
  }, [driveClientId, driveClientSecret, loadDriveStatus]);

  const driveExportConfig = useCallback(async () => {
    try {
      const result = await papi.commands.sendCommand('paratextProjectManager.tasksDriveExportConfig');
      const data = JSON.parse(result as string) as { success: boolean; config?: string; error?: string };
      if (data.success && data.config) {
        setDriveExportedConfig(data.config);
      } else {
        setDriveError(data.error ?? 'No se pudo exportar la configuración');
      }
    } catch (e) {
      setDriveError(String(e));
    }
  }, []);

  const driveForceSync = useCallback(async () => {
    if (!projectId) { setDriveSyncResult('✗ No hay proyecto seleccionado'); return; }
    setDriveSyncing(true);
    setDriveSyncResult('Sincronizando…');
    try {
      const res = await papi.commands.sendCommand(
        'paratextProjectManager.tasksDriveForceSyncProject', projectId,
      );
      const data = JSON.parse(res as string) as {
        success: boolean; step?: string; error?: string; fileId?: string; wasNew?: boolean;
      };
      if (data.success) {
        setDriveSyncResult(`✓ Sincronizado. fileId: ${data.fileId}${data.wasNew ? ' (archivo nuevo creado)' : ' (actualizado)'}`);
        loadDriveStatus(); // refresh project count
      } else {
        setDriveSyncResult(`✗ Error en paso "${data.step}": ${data.error}`);
      }
    } catch (e) {
      setDriveSyncResult(`✗ Error: ${String(e)}`);
    } finally {
      setDriveSyncing(false);
    }
  }, [projectId, loadDriveStatus]);

  const driveTest = useCallback(async () => {
    setDriveTesting(true);
    setDriveTestResult('Probando…');
    try {
      const res = await papi.commands.sendCommand('paratextProjectManager.tasksDriveTest');
      const data = JSON.parse(res as string) as { success: boolean; step?: string; error?: string; fileId?: string };
      if (data.success) {
        setDriveTestResult(`✓ Escritura exitosa en Drive (fileId: ${data.fileId}). La API de Drive funciona correctamente.`);
      } else {
        setDriveTestResult(`✗ Error en paso "${data.step}": ${data.error}`);
      }
    } catch (e) {
      setDriveTestResult(`✗ Error: ${String(e)}`);
    } finally {
      setDriveTesting(false);
    }
  }, []);

  const driveImportConfig = useCallback(async () => {
    if (!driveImportJson.trim()) { setDriveError('Pega la configuración JSON'); return; }
    try {
      const result = await papi.commands.sendCommand(
        'paratextProjectManager.tasksDriveImportConfig', driveImportJson.trim(),
      );
      const data = JSON.parse(result as string) as { success: boolean; error?: string };
      if (data.success) {
        setDriveMessage('✓ Configuración importada. Recarga el proyecto para ver las tareas.');
        setShowDriveImport(false);
        setDriveImportJson('');
        await loadDriveStatus();
      } else {
        setDriveError(data.error ?? 'Error al importar');
      }
    } catch (e) {
      setDriveError(String(e));
    }
  }, [driveImportJson, loadDriveStatus]);

  // Pre-fill logTimeUser from getCurrentUser
  useEffect(() => {
    papi.commands.sendCommand('paratextProjectManager.getCurrentUser')
      .then((u) => { if (u && typeof u === 'string' && u.length > 0) setLogTimeUser(u as string); })
      .catch(() => {});
  }, []);

  // Shared polling logic: call after gcalConnect or gcalReconnect returns { status: 'started' }
  const pollGcalAuth = useCallback(async (onSuccess?: () => void) => {
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
        const state = JSON.parse(raw as string) as { status: string; email?: string; error?: string };
        if (state.status === 'success') {
          setGcalMessage(`Conectado como ${state.email ?? ''}`);
          setGcalError('');
          setShowGcalSetup(false);
          setGcalClientSecret('');
          await loadGcalStatus();
          try {
            const calsResult = await papi.commands.sendCommand('paratextProjectManager.gcalListCalendars');
            setGcalCalendars(JSON.parse(calsResult as string));
          } catch (_) { /* non-critical */ }
          setGcalConnecting(false);
          onSuccess?.();
        } else if (state.status === 'error') {
          setGcalError(state.error ?? 'Error desconocido');
          setGcalMessage('');
          setGcalConnecting(false);
        } else {
          // still pending — check again in 2s
          setTimeout(() => { poll().catch(() => {}); }, 2000);
        }
      } catch (_) {
        setTimeout(() => { poll().catch(() => {}); }, 2000);
      }
    };
    await poll();
  }, [loadGcalStatus]);

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
      setGcalError(`Error: ${errMsg(e)}`);
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
      const data = JSON.parse(result as string);
      if (data.status === 'started') {
        await pollGcalAuth();
      } else {
        // returned an error before starting (e.g. no credentials stored)
        setGcalError(data.error ?? 'Error desconocido');
        setGcalMessage('');
        setGcalConnecting(false);
      }
    } catch (e) {
      setGcalError(`Error: ${errMsg(e)}`);
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
      setGcalError(`Error al desconectar: ${errMsg(e)}`);
    }
  }, []);

  const gcalLoadCalendars = useCallback(async () => {
    try {
      const result = await papi.commands.sendCommand('paratextProjectManager.gcalListCalendars');
      const cals = JSON.parse(result as string) as GcalCalendar[];
      setGcalCalendars(cals);
    } catch (_) { /* non-critical */ }
  }, []);

  const gcalChangeCalendar = useCallback(async (calId: string) => {
    try {
      await papi.commands.sendCommand('paratextProjectManager.gcalSetCalendarId', calId);
      setGcalStatus((prev) => ({ ...prev, calendarId: calId }));
    } catch (e) {
      setGcalError(`Error: ${errMsg(e)}`);
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
      const data = JSON.parse(result as string);
      if (data.errors && data.errors.length > 0) {
        setGcalError(`${data.errors.length} error(es): ${data.errors[0]}`);
      }
      setGcalMessage(
        `Sincronizado: ${data.synced}/${data.total} tareas${data.total === 0 ? ' (ninguna tiene fecha límite)' : ''}`,
      );
      await loadGcalStatus();
    } catch (e) {
      setGcalError(`Error al sincronizar: ${errMsg(e)}`);
    } finally {
      setGcalSyncing(false);
    }
  }, [projectId, loadGcalStatus]);

  const flushPendingTime = useCallback(async () => {
    try {
      const res = await papi.commands.sendCommand('paratextProjectManager.gcalFlushPendingTime');
      const { synced, remaining } = JSON.parse(res as string) as { synced: number; remaining: number };
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
    } catch { /* ignore */ }
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
      setGcalEvents(JSON.parse(res as string) as GcalEvent[]);
    } catch (_) {
      setGcalEvents([]);
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
        map[book][stage] = tasks.filter((t) => t.book === book && t.stage === stage);
      }
    }
    return map;
  }, [tasks, booksInUse, orderedStages]);

  const stageSummary = useMemo(() => {
    const summary: Record<string, { total: number; complete: number; flagged: number }> = {};
    for (const stage of orderedStages) {
      const stageTasks = tasks.filter((t) => t.stage === stage);
      summary[stage] = {
        total: stageTasks.length,
        complete: stageTasks.filter((t) => t.status === 'complete').length,
        flagged: stageTasks.filter((t) => t.status === 'flagged').length,
      };
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
    const hours = parseFloat(logTimeHours);
    const isOtro = logTimeTask === '__otro__';
    if (!isOtro && !logTimeTask) { setLogTimeError('Selecciona una tarea'); return; }
    if (isOtro && !logTimeCustomLabel.trim()) { setLogTimeError('Ingresa una descripción'); return; }
    if (!logTimeUser) { setLogTimeError('Selecciona un usuario'); return; }
    if (!selectedDay) { setLogTimeError('No hay día seleccionado'); return; }
    if (isNaN(hours) || hours <= 0) { setLogTimeError('Las horas deben ser un número positivo'); return; }

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
        setTimeout(() => setLogTimeSuccess(''), 5000);
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
          .catch(() => setLogTimeSuccess('✓ Horas registradas (sin GCal)'));
        return;
      }

      // Normal task update flow
      const updatedTasks = tasks.map((task): ProjectTask => {
        if (task.id !== logTimeTask) return task;
        const updatedEntries = [...(task.timeEntries ?? []), newEntry];
        const totalLogged = updatedEntries.reduce((sum, e) => sum + e.hours, 0);
        return { ...task, timeEntries: updatedEntries, loggedHours: totalLogged, updatedAt: new Date().toISOString() };
      });

      const { activityLog: savedLog, deletedTaskIds: savedDeleted } = extrasRef.current;
      const store = {
        schemaVersion: 1 as const,
        tasks: updatedTasks,
        stageConfig,
        ...(savedLog ? { activityLog: savedLog } : {}),
        ...(savedDeleted?.length ? { deletedTaskIds: savedDeleted } : {}),
      };
      await papi.commands.sendCommand('paratextProjectManager.saveTasks', projectId, JSON.stringify(store));

      setTasks(updatedTasks);
      setLogTimeHours('1');
      setLogTimeNote('');
      setLogTimeSuccess('✓ Horas registradas');
      setTimeout(() => setLogTimeSuccess(''), 5000);

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
            .catch(() => setLogTimeSuccess('✓ Horas registradas (sin conexión GCal)'));
        }
      }
    } catch (e) {
      setLogTimeError(`Error al guardar: ${e}`);
    } finally {
      setLogTimeSaving(false);
    }
  }, [logTimeTask, logTimeCustomLabel, logTimeUser, logTimeHours, logTimeNote, selectedDay, tasks, stageConfig, projectId, gcalStatus]);

  const deleteTimeEntry = useCallback(async (taskId: string, entryId: string) => {
    try {
      const updatedTasks = tasks.map((task): ProjectTask => {
        if (task.id !== taskId) return task;
        const updatedEntries = (task.timeEntries ?? []).filter((e) => e.id !== entryId);
        const totalLogged = updatedEntries.reduce((sum, e) => sum + e.hours, 0);
        return { ...task, timeEntries: updatedEntries, loggedHours: totalLogged, updatedAt: new Date().toISOString() };
      });
      const { activityLog: savedLog2, deletedTaskIds: savedDeleted2 } = extrasRef.current;
      const store = {
        schemaVersion: 1 as const,
        tasks: updatedTasks,
        stageConfig,
        ...(savedLog2 ? { activityLog: savedLog2 } : {}),
        ...(savedDeleted2?.length ? { deletedTaskIds: savedDeleted2 } : {}),
      };
      await papi.commands.sendCommand('paratextProjectManager.saveTasks', projectId, JSON.stringify(store));
      setTasks(updatedTasks);
    } catch (e) {
      setLogTimeError(`Error al eliminar: ${e}`);
    }
  }, [tasks, stageConfig, projectId]);

  const deleteGcalEvent = useCallback(async (eventId: string) => {
    if (!gcalStatus.calendarId) return;
    // Optimistic: remove from local state immediately
    setGcalEvents((prev) => prev.filter((ev) => ev.id !== eventId));
    try {
      const result = JSON.parse(
        await papi.commands.sendCommand('paratextProjectManager.gcalDeleteEvent', gcalStatus.calendarId, eventId),
      );
      if (result.status !== 'ok') {
        // Revert on failure — re-fetch events
        setGcalEventsLoading(true);
        try {
          const evJson = await papi.commands.sendCommand(
            'paratextProjectManager.gcalGetEvents',
            gcalStatus.calendarId,
            new Date(calMonth + '-01').toISOString(),
            new Date(new Date(calMonth + '-01').getFullYear(), new Date(calMonth + '-01').getMonth() + 1, 1).toISOString(),
          );
          setGcalEvents(JSON.parse(evJson));
        } finally {
          setGcalEventsLoading(false);
        }
      }
    } catch (_) {
      // Silent — event already removed from UI; a manual refresh will restore if needed
    }
  }, [gcalStatus.calendarId, calMonth]);

  // --- CSV / PDF export ---
  const buildCsvContent = useCallback((): string => {
    const header = ['Libro', ...orderedStages.map((s) => getStageLabel(s, stageConfig))];
    const icons: Record<string, string> = { complete: '✓', 'in-progress': '⟳', pending: '•', flagged: '⚑' };
    const rows = booksInUse.map((book) => [
      book,
      ...orderedStages.map((stage) => {
        const cellTasks = grid[book]?.[stage] ?? [];
        if (cellTasks.length === 0) return '';
        const s = aggregateStatus(cellTasks);
        return s ? `${icons[s] ?? ''}${cellTasks.length > 1 ? ` (${cellTasks.length})` : ''}` : '';
      }),
    ]);
    return '\uFEFF' + [header, ...rows].map((row) => row.map((c) => `"${c}"`).join(',')).join('\r\n');
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
      const data = JSON.parse(result as string);
      if (data.success) {
        setExportStatus(`✓ CSV guardado en Descargas`);
      } else {
        setExportError(`Error al guardar CSV: ${data.error}`);
        setExportStatus('');
      }
    } catch (e) {
      setExportError(`Error: ${e}`);
      setExportStatus('');
    }
    setTimeout(() => { setExportStatus(''); setExportError(''); }, 5000);
  }, [buildCsvContent]);

  const buildHtmlContent = useCallback((): string => {
    const stageHeaders = orderedStages.map((s) => `<th>${getStageLabel(s, stageConfig)}</th>`).join('');
    const icons: Record<string, string> = { complete: '✓', 'in-progress': '⟳', pending: '•', flagged: '⚑' };
    const statusColors: Record<string, string> = {
      complete: '#d1fae5', 'in-progress': '#fef3c7', pending: '#f3f4f6', flagged: '#fee2e2',
    };
    const rows = booksInUse.map((book) => {
      const cells = orderedStages.map((stage) => {
        const cellTasks = grid[book]?.[stage] ?? [];
        const s = cellTasks.length > 0 ? aggregateStatus(cellTasks) : null;
        const bg = s ? statusColors[s] ?? '#f3f4f6' : '#fff';
        const text = s ? `${icons[s] ?? ''}${cellTasks.length > 1 ? ` (${cellTasks.length})` : ''}` : '';
        return `<td style="background:${bg};text-align:center;padding:4px 8px;">${text}</td>`;
      }).join('');
      return `<tr><td style="font-weight:bold;padding:4px 8px;">${book}</td>${cells}</tr>`;
    }).join('');

    const date = new Date().toLocaleDateString('es');
    const datetime = new Date().toLocaleString('es');
    return (
      '<!DOCTYPE html>' +
      '<html lang="es"><head><meta charset="utf-8">' +
      `<title>Resumen del Proyecto \u2014 ${date}</title>` +
      '<style>' +
      'body{font-family:sans-serif;padding:24px;font-size:12px}' +
      'h1{font-size:16px;margin-bottom:12px}' +
      'table{border-collapse:collapse;width:100%}' +
      'th{background:#1d4ed8;color:white;padding:6px 8px;text-align:left;font-size:11px}' +
      'td{border:1px solid #e5e7eb}' +
      '@media print{body{padding:8px}}' +
      '</style>' +
      `</head><body onload="window.print()">` +
      `<h1>Resumen del Proyecto \u2014 ${date}</h1>` +
      '<table><thead><tr><th>Libro</th>' + stageHeaders + '</tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      `<p style="margin-top:16px;color:#666;font-size:11px;">Generado por Paratext Project Manager \u00b7 ${datetime}</p>` +
      '</body></html>'
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
      const data = JSON.parse(result as string);
      if (data.success) {
        setExportStatus('✓ Abierto en navegador — usa Ctrl+P para imprimir/PDF');
      } else {
        setExportError(`Error: ${data.error}`);
        setExportStatus('');
      }
    } catch (e) {
      setExportError(`Error: ${e}`);
      setExportStatus('');
    }
    setTimeout(() => { setExportStatus(''); setExportError(''); }, 7000);
  }, [buildHtmlContent]);

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
    <div className="flex flex-col h-full bg-gray-50 text-xs">
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

      {/* Header */}
      <div className="px-3 py-2 bg-white border-b shadow-sm flex items-center justify-between no-print">
        <span className="font-semibold text-sm text-gray-700">Resumen del Proyecto</span>
        <div className="flex items-center gap-2 text-xs text-gray-600 flex-wrap">
          <span className="text-green-600 font-medium">{pctComplete}% completo</span>
          <span>{completedTasks}/{totalTasks} tareas</span>
          {inProgressTasks > 0 && (
            <span className="text-yellow-700">⟳ {inProgressTasks} en progreso</span>
          )}
          {flaggedTasks > 0 && <span className="text-red-600">⚑ {flaggedTasks} banderas</span>}
          <button
            className="px-2 py-0.5 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
            onClick={downloadCsv}
            title="Guardar CSV en Descargas"
          >
            ↓ CSV
          </button>
          <button
            className="px-2 py-0.5 bg-slate-600 text-white rounded hover:bg-slate-700 disabled:opacity-50"
            onClick={exportPdf}
            title="Abrir tabla en navegador para imprimir/PDF"
          >
            🖨 PDF
          </button>
          {(exportStatus || exportError) && (
            <span className={`text-xs px-1.5 ${exportError ? 'text-red-600' : 'text-green-700'}`}>
              {exportStatus || exportError}
            </span>
          )}
          <button
            className="px-2 py-0.5 bg-gray-100 rounded hover:bg-gray-200"
            onClick={selectProject}
            title="Cambiar proyecto"
          >
            ⇄
          </button>
          <button
            className="px-2 py-0.5 bg-gray-100 rounded hover:bg-gray-200"
            onClick={loadTasks}
            title="Actualizar"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Print-only title */}
      <div className="print-only px-3 py-2 text-sm font-bold">
        Resumen del Proyecto — {pctComplete}% completo ({completedTasks}/{totalTasks} tareas)
      </div>

      {error && (
        <div className="bg-red-50 border-b border-red-200 px-3 py-1 text-red-700">
          {error}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 bg-white no-print">
        {(['summary', 'calendar'] as const).map((tab) => (
          <button
            key={tab}
            className={`px-4 py-1.5 text-xs font-medium border-b-2 transition-colors ${
              currentTab === tab
                ? 'border-slate-600 text-slate-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            onClick={() => setCurrentTab(tab)}
          >
            {tab === 'summary' ? 'Resumen' : '📅 Calendario'}
          </button>
        ))}
      </div>

      {/* Team Members — always visible, outside scrollable area */}
      <div className="border-b border-gray-200 bg-white no-print">
        <button
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-gray-50 text-left"
          onClick={() => setShowTeamSection((s) => !s)}
        >
          <span className="font-semibold text-xs text-gray-700">
            👥 Equipo ({teamMembers.length} miembros)
          </span>
          <span className="text-gray-400 text-xs">{showTeamSection ? '▲' : '▼'}</span>
        </button>

        {showTeamSection && (
          <div className="px-3 pb-3 space-y-2">
            {/* Current members */}
            <div className="flex flex-wrap gap-1.5">
              {teamMembers.map((m) => (
                <span
                  key={m}
                  className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 text-xs px-2 py-0.5 rounded-full"
                >
                  {m}
                  <button
                    type="button"
                    className="text-slate-400 hover:text-red-500 leading-none font-bold"
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
                        setTimeout(() => setTeamMessage(''), 3000);
                      } catch (e) {
                        setTeamMessage(`Error: ${e}`);
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
            {/* Add new member */}
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
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
                  setTimeout(() => setTeamMessage(''), 3000);
                } catch (e) {
                  setTeamMessage(`Error: ${e}`);
                } finally {
                  setTeamSaving(false);
                }
              }}
            >
              <input
                className="flex-1 border rounded px-2 py-1 text-xs"
                placeholder="Nombre del nuevo miembro…"
                value={teamInput}
                onChange={(e) => setTeamInput(e.target.value)}
                disabled={teamSaving}
              />
              <button
                type="submit"
                className="px-3 py-1 bg-slate-600 text-white text-xs rounded hover:bg-slate-700 disabled:opacity-50"
                disabled={teamSaving || !teamInput.trim()}
              >
                + Agregar
              </button>
            </form>
            {teamMessage && (
              <p className={`text-xs ${teamMessage.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
                {teamMessage}
              </p>
            )}
            <p className="text-xs text-gray-400">
              Los cambios se reflejan en el Tablero y Mis Tareas al recargar esos paneles.
            </p>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1 text-gray-400">Cargando…</div>
      ) : currentTab === 'summary' ? (
        <div className="flex-1 overflow-auto p-2">
          {totalTasks === 0 ? (
            <div className="flex items-center justify-center py-8 text-gray-400">
              No hay tareas creadas todavía. Abre el Tablero de Tareas para crear tareas.
            </div>
          ) : (
          <>
          <table className="border-collapse w-full">
            <thead>
              <tr>
                <th className="border border-gray-200 bg-gray-100 px-2 py-1 text-left font-semibold sticky left-0 z-10">
                  Libro
                </th>
                {orderedStages.map((stage) => (
                  <th
                    key={stage}
                    className="border border-gray-200 bg-gray-100 px-1 py-1 font-medium whitespace-nowrap max-w-20"
                    title={getStageLabel(stage, stageConfig)}
                  >
                    <div className="truncate max-w-16">{getStageLabel(stage, stageConfig)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {booksInUse.map((book) => (
                <tr key={book} className="hover:bg-gray-50">
                  <td className="border border-gray-200 px-2 py-1 font-semibold bg-white sticky left-0">
                    {book}
                  </td>
                  {orderedStages.map((stage) => {
                    const cellTasks = grid[book]?.[stage] ?? [];
                    const status = aggregateStatus(cellTasks);
                    return (
                      <td
                        key={stage}
                        className={`border border-gray-200 px-1 py-1 text-center ${
                          status ? CELL_STYLES[status] : 'bg-white'
                        }`}
                        title={
                          cellTasks.length > 0
                            ? `${cellTasks.length} tarea${cellTasks.length !== 1 ? 's' : ''}`
                            : ''
                        }
                      >
                        {status ? (
                          <span className="font-medium">
                            {CELL_ICONS[status]}
                            {cellTasks.length > 1 && (
                              <sup className="text-gray-500">{cellTasks.length}</sup>
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
              <tr className="bg-gray-100 font-medium">
                <td className="border border-gray-200 px-2 py-1 sticky left-0 bg-gray-100">
                  Total
                </td>
                {orderedStages.map((stage) => {
                  const s = stageSummary[stage];
                  return (
                    <td key={stage} className="border border-gray-200 px-1 py-1 text-center">
                      {s.total > 0 ? (
                        <span
                          className={s.complete === s.total ? 'text-green-600' : 'text-gray-600'}
                          title={`${s.complete}/${s.total} completas${s.flagged > 0 ? `, ${s.flagged} banderas` : ''}`}
                        >
                          {s.complete}/{s.total}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>

          {/* Legend */}
          <div className="flex gap-4 mt-3 px-1 text-xs text-gray-500 flex-wrap">
            <span>✓ Completo</span>
            <span>⟳ En Progreso</span>
            <span>• Pendiente</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />⚑ Bandera</span>
          </div>
          </>
          )}

          {/* Google Calendar Section */}
          <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden no-print">
            <button
              className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-left"
              onClick={() => setShowGcalSection((s) => !s)}
            >
              <span className="font-semibold text-xs text-gray-700">
                📅 Google Calendar
                {gcalStatus.connected && (
                  <span className="ml-2 text-green-600 font-normal">● Conectado</span>
                )}
              </span>
              <span className="text-gray-400 text-xs">{showGcalSection ? '▲' : '▼'}</span>
            </button>

            {showGcalSection && (
              <div className="p-3 space-y-3">
                {gcalStatus.connected ? (
                  <>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="text-xs text-gray-600 space-y-0.5">
                        <div>
                          <span className="text-green-600 font-medium">● Conectado</span>
                          {gcalStatus.email && (
                            <span className="ml-1 text-gray-500">({gcalStatus.email})</span>
                          )}
                        </div>
                        {gcalStatus.lastSync && (
                          <div className="text-gray-400">
                            Última sync:{' '}
                            {new Date(gcalStatus.lastSync).toLocaleString('es', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <button
                          className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                          onClick={gcalSync}
                          disabled={gcalSyncing || !projectId}
                        >
                          {gcalSyncing ? '⟳ Sincronizando…' : '↑ Sincronizar Fechas'}
                        </button>
                        <button
                          className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200"
                          onClick={flushPendingTime}
                        >
                          ⟳ Sincronizar horas pendientes
                        </button>
                        <button
                          className="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                          onClick={gcalDisconnect}
                        >
                          Desconectar
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-gray-500 flex-shrink-0">Calendario:</span>
                      {gcalCalendars.length > 0 ? (
                        <select
                          className="flex-1 border border-gray-300 rounded px-1.5 py-0.5 text-xs max-w-xs"
                          value={gcalStatus.calendarId}
                          onChange={(e) => gcalChangeCalendar(e.target.value)}
                        >
                          {gcalCalendars.map((cal) => (
                            <option key={cal.id} value={cal.id}>
                              {cal.summary}{cal.primary ? ' (principal)' : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-gray-400">
                          {gcalStatus.calendarId}
                          <button
                            className="ml-2 text-blue-500 hover:text-blue-700 underline"
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
                    <p className="text-xs text-gray-500">
                      Conecta Google Calendar para sincronizar fechas límite de tareas como eventos y ver el calendario del equipo.
                    </p>

                    {/* One-click reconnect — shown when credentials are already saved */}
                    {gcalStatus.hasCredentials && !showGcalSetup && (
                      <div className="space-y-1.5">
                        <button
                          className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                          onClick={gcalReconnect}
                          disabled={gcalConnecting}
                        >
                          {gcalConnecting ? '⟳ Esperando autorización…' : '🔑 Reconectar Google Calendar'}
                        </button>
                        <p className="text-xs text-gray-400">
                          Se usarán las credenciales guardadas. El navegador se abrirá para aprobar el acceso.{' '}
                          <button
                            className="underline hover:text-gray-600"
                            onClick={() => setShowGcalSetup(true)}
                          >
                            Usar otras credenciales
                          </button>
                        </p>
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                          💡 Si tienes que reconectar frecuentemente: en Google Cloud Console cambia la app de <strong>«En prueba»</strong> a <strong>«En producción»</strong> (no requiere verificación de Google). Esto evita que el token expire cada 7 días.
                        </p>
                      </div>
                    )}

                    {/* First-time connect or "use other credentials" */}
                    {(!gcalStatus.hasCredentials || showGcalSetup) && (
                      <div className="space-y-2">
                        {!showGcalSetup && (
                          <button
                            className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700"
                            onClick={() => setShowGcalSetup(true)}
                          >
                            Conectar Google Calendar
                          </button>
                        )}
                        {showGcalSetup && (
                          <>
                            <div className="text-xs bg-blue-50 border border-blue-200 rounded p-2 space-y-1.5">
                              <p className="font-semibold text-blue-700">Configuración en Google Cloud Console:</p>
                              <ol className="list-decimal list-inside space-y-1 text-blue-800">
                                <li>Ve a <span className="font-mono bg-blue-100 px-0.5 rounded">console.cloud.google.com</span></li>
                                <li>Crea o selecciona un proyecto</li>
                                <li><strong>APIs y servicios → Biblioteca</strong> → busca <em>Google Calendar API</em> → Habilitar</li>
                                <li><strong>APIs y servicios → Pantalla de consentimiento OAuth</strong> → Tipo: <strong>Externo</strong> → crea, llena nombre y correo → agrega tu correo en &quot;Usuarios de prueba&quot;</li>
                                <li><strong>APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth 2.0</strong></li>
                                <li>Tipo de aplicación: <strong>Aplicación de escritorio</strong> (no &quot;Aplicación web&quot;)</li>
                                <li>Copia el <strong>ID de cliente</strong> y <strong>Secreto de cliente</strong></li>
                              </ol>
                              <p className="text-orange-700 font-medium mt-1">
                                ⚠ Error 400 = elegiste &quot;Aplicación web&quot; en vez de &quot;Aplicación de escritorio&quot;, o falta configurar la pantalla de consentimiento.
                              </p>
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <input
                                type="text"
                                placeholder="Client ID (termina en .apps.googleusercontent.com)"
                                value={gcalClientId}
                                onChange={(e) => setGcalClientId(e.target.value)}
                                className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                              />
                              <input
                                type="password"
                                placeholder="Client Secret"
                                value={gcalClientSecret}
                                onChange={(e) => setGcalClientSecret(e.target.value)}
                                className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                                onKeyDown={(e) => e.key === 'Enter' && gcalConnect()}
                              />
                            </div>

                            <div className="flex gap-2">
                              <button
                                className="text-xs px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                                onClick={gcalConnect}
                                disabled={gcalConnecting}
                              >
                                {gcalConnecting ? '⟳ Esperando…' : 'Autorizar con Google'}
                              </button>
                              <button
                                className="text-xs px-3 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                                onClick={() => { setShowGcalSetup(false); setGcalError(''); setGcalMessage(''); }}
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
                  <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
                    {gcalMessage}
                  </p>
                )}
                {gcalError && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                    {gcalError}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Drive Task Sync Section */}
          <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden no-print">
            <button
              className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-left"
              onClick={() => setShowDriveSection((s) => !s)}
            >
              <span className="font-semibold text-xs text-gray-700">
                ☁ Sincronización de Tareas (Drive)
                {driveStatus.connected
                  ? <span className="ml-2 text-green-600 font-normal">● Conectado</span>
                  : <span className="ml-2 text-gray-400 font-normal">○ No configurado</span>
                }
              </span>
              <span className="text-gray-400 text-xs">{showDriveSection ? '▲' : '▼'}</span>
            </button>

            {showDriveSection && (
              <div className="p-3 space-y-3 text-xs">
                {driveStatus.connected ? (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1 flex-1">
                        ✓ Drive conectado · {driveStatus.fileCount} proyecto(s) sincronizado(s)
                      </p>
                      <button
                        className="px-2 py-1 bg-gray-100 border border-gray-300 text-gray-700 rounded text-xs hover:bg-gray-200 disabled:opacity-50 whitespace-nowrap"
                        onClick={driveTest}
                        disabled={driveTesting}
                      >
                        {driveTesting ? '⟳ Probando…' : '🔍 Probar'}
                      </button>
                    </div>
                    {driveTestResult && (
                      <p className={`text-xs rounded px-2 py-1 font-mono whitespace-pre-wrap break-all ${
                        driveTestResult.startsWith('✓')
                          ? 'text-green-700 bg-green-50 border border-green-200'
                          : 'text-red-700 bg-red-50 border border-red-200'
                      }`}>
                        {driveTestResult}
                      </p>
                    )}

                    {/* Force sync button */}
                    <div className="flex items-center gap-2">
                      <button
                        className="px-3 py-1.5 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-50"
                        onClick={driveForceSync}
                        disabled={driveSyncing}
                      >
                        {driveSyncing ? '⟳ Sincronizando…' : '↑ Sincronizar proyecto ahora'}
                      </button>
                    </div>
                    {driveSyncResult && (
                      <p className={`text-xs rounded px-2 py-1 font-mono whitespace-pre-wrap break-all ${
                        driveSyncResult.startsWith('✓')
                          ? 'text-green-700 bg-green-50 border border-green-200'
                          : driveSyncResult === 'Sincronizando…'
                          ? 'text-blue-700 bg-blue-50 border border-blue-200'
                          : 'text-red-700 bg-red-50 border border-red-200'
                      }`}>
                        {driveSyncResult}
                      </p>
                    )}

                    {/* Re-import form (shown when user clicks "Actualizar config") */}
                    {showDriveImport ? (
                      <div className="space-y-2 border border-blue-200 rounded p-2 bg-blue-50">
                        <p className="font-medium text-blue-800">Pega la nueva configuración del admin:</p>
                        <textarea
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs font-mono h-20 resize-none"
                          value={driveImportJson}
                          onChange={(e) => setDriveImportJson(e.target.value)}
                          placeholder='Pega aquí el JSON actualizado…'
                        />
                        <div className="flex gap-2">
                          <button
                            className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                            onClick={driveImportConfig}
                          >
                            ✓ Actualizar
                          </button>
                          <button
                            className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300"
                            onClick={() => { setShowDriveImport(false); setDriveImportJson(''); setDriveError(''); }}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="bg-blue-50 border border-blue-200 rounded p-2 space-y-1">
                          <p className="font-medium text-blue-800">Comparte con el equipo:</p>
                          <p className="text-blue-700">
                            1. Haz clic en "Exportar config" para copiar la configuración.<br />
                            2. Envía el texto a cada compañero.<br />
                            3. Ellos pegan el texto con el botón "Actualizar config".
                          </p>
                        </div>
                        {driveExportedConfig ? (
                          <div className="space-y-1">
                            <p className="font-medium text-gray-700">Configuración para compartir:</p>
                            <textarea
                              className="w-full border border-gray-300 rounded px-2 py-1 text-xs font-mono h-20 resize-none"
                              readOnly
                              value={driveExportedConfig}
                              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                            />
                            <p className="text-gray-500">Haz clic en el texto para seleccionar todo, luego copia (Ctrl+C).</p>
                          </div>
                        ) : (
                          <button
                            className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                            onClick={driveExportConfig}
                          >
                            📋 Exportar config para el equipo
                          </button>
                        )}
                        <button
                          className="block text-blue-600 underline text-xs"
                          onClick={() => { setShowDriveImport(true); setDriveError(''); }}
                        >
                          ↺ Actualizar config (pegar nueva versión del admin)
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-gray-600">
                      Las tareas se guardarán en Google Drive y se sincronizarán automáticamente con todo el equipo.
                    </p>

                    {/* Setup for admin */}
                    {!showDriveImport && (
                      <>
                        {(!driveStatus.hasCredentials || showDriveSetup) ? (
                          <div className="space-y-2 border border-gray-200 rounded p-2">
                            <p className="font-medium text-gray-700">Conectar Drive (admin):</p>
                            <div>
                              <label className="block text-gray-500 mb-0.5">Client ID</label>
                              <input
                                type="text"
                                className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                                value={driveClientId}
                                onChange={(e) => setDriveClientId(e.target.value)}
                                placeholder="xxxxxx.apps.googleusercontent.com"
                              />
                            </div>
                            <div>
                              <label className="block text-gray-500 mb-0.5">Client Secret</label>
                              <input
                                type="password"
                                className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                                value={driveClientSecret}
                                onChange={(e) => setDriveClientSecret(e.target.value)}
                                placeholder="GOCSPX-…"
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50"
                                onClick={driveConnect}
                                disabled={driveConnecting}
                              >
                                {driveConnecting ? '⟳ Esperando…' : '🔑 Autorizar con Google'}
                              </button>
                              {showDriveSetup && (
                                <button
                                  className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300"
                                  onClick={() => setShowDriveSetup(false)}
                                >
                                  Cancelar
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <button
                            className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300"
                            onClick={() => setShowDriveSetup(true)}
                          >
                            🔑 Conectar Drive (admin)
                          </button>
                        )}
                        <button
                          className="block text-blue-600 underline text-xs"
                          onClick={() => { setShowDriveImport(true); setDriveError(''); }}
                        >
                          ¿Eres compañero de equipo? Importar configuración del admin →
                        </button>
                      </>
                    )}

                    {/* Import for team members */}
                    {showDriveImport && (
                      <div className="space-y-2 border border-blue-200 rounded p-2 bg-blue-50">
                        <p className="font-medium text-blue-800">Importar configuración del admin:</p>
                        <textarea
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs font-mono h-20 resize-none"
                          value={driveImportJson}
                          onChange={(e) => setDriveImportJson(e.target.value)}
                          placeholder='Pega aquí el JSON que te dio el administrador…'
                        />
                        <div className="flex gap-2">
                          <button
                            className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                            onClick={driveImportConfig}
                          >
                            ✓ Importar
                          </button>
                          <button
                            className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300"
                            onClick={() => { setShowDriveImport(false); setDriveImportJson(''); setDriveError(''); }}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {driveMessage && (
                  <p className="text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
                    {driveMessage}
                  </p>
                )}
                {driveError && (
                  <p className="text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                    {driveError}
                  </p>
                )}
              </div>
            )}
          </div>

        </div>
      ) : (
        /* Calendar tab */
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
      )}
    </div>
  );
};
