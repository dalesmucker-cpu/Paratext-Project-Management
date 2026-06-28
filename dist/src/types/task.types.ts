/** Current status of a translation task */
export type TaskStatus = 'pending' | 'in-progress' | 'complete' | 'flagged';

/** Translation workflow stage from the Mayangna project workflow */
export type TranslationStage =
  | 'primer-borrador'
  | 'revision1'
  | 'revision2'
  | 'community-review'
  | 'back-translation'
  | 'back-translation-review'
  | 'answer-flags'
  | 'translator-training'
  | 'consultant-review';

/** A project management task */
export interface ProjectTask {
  id: string;
  book: string; // e.g. "GEN", "MAT"
  chapter: number;
  stage: string; // TranslationStage for built-ins; 'custom-<id>' for user-defined
  assignedTo: string[]; // team member names
  status: TaskStatus;
  notes: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  // Optional deadline & hours tracking
  deadline?: string; // ISO date string e.g. "2026-03-15"
  estimatedHours?: number;
  loggedHours?: number; // recomputed as sum of timeEntries[].hours
  timeEntries?: TimeEntry[];
  path?: TaskPathStep[]; // ordered workflow route defined at task creation
  currentPathIndex?: number; // 0-based index of the current step in path[]
  incompleteStages?: string[]; // list of stages before current stage marked as not complete
}

/** A single time log entry on a task */
export interface TimeEntry {
  id: string; // generateId()
  user: string; // team member name
  hours: number; // positive, fractions allowed (0.5, 1.5…)
  date: string; // YYYY-MM-DD local date
  note?: string;
}

/** One step in a task's workflow path */
export interface TaskPathStep {
  stage: string; // stage key
  assignees: string[]; // team members who handle this step
}

/** A person assigned to a stage, optionally limited to specific Bible books */
export interface StageAssignee {
  person: string; // team member name
  books: string[]; // specific books they handle; empty = all books
}

/** An entry queued for GCal sync when offline */
export interface PendingTimeSyncEntry {
  timeEntryJson: string; // JSON-serialized TimeEntry
  taskLabel: string; // e.g. "GEN 1 — Primer Borrador"
  calendarId: string; // GCal calendar ID
}

/** An entry in the project activity log */
export interface ActivityLogEntry {
  id: string;
  timestamp: string; // ISO 8601
  action: 'created' | 'status-changed' | 'stage-moved' | 'deleted' | 'edited';
  taskId: string;
  taskLabel: string; // e.g. "GEN 1" or "28 tareas en GEN"
  detail?: string; // e.g. "Pendiente → En Progreso" or "Primer Borrador → Revisión 1"
}

/** Per-stage configuration stored per project in project-tasks.json */
export interface StageConfig {
  label: string; // custom display label
  order: number; // 0-based sort order
  assignees?: StageAssignee[]; // people responsible; each may optionally be limited to specific books
}

/** Root structure stored in project-tasks.json */
export interface TaskStore {
  schemaVersion: 1;
  tasks: ProjectTask[];
  stageConfig?: Record<string, StageConfig>; // custom stage labels/order (string keys for custom stages)
  activityLog?: ActivityLogEntry[]; // append-only, capped at 200 entries
  deletedTaskIds?: string[]; // tombstone list so merges don't resurrect deleted tasks
}

/** Stage display labels (Spanish) */
export const STAGE_LABELS: Record<TranslationStage, string> = {
  'primer-borrador': 'Primer Borrador',
  revision1: 'Revisión 1',
  revision2: 'Revisión 2',
  'community-review': 'Revisión en Comunidad',
  'back-translation': 'Retrotraducción',
  'back-translation-review': 'Rev. Retrotraducción',
  'answer-flags': 'Contestar Banderas',
  'translator-training': 'Capacitación',
  'consultant-review': 'Revisión Consultor',
};

/** Ordered list of stages */
export const STAGES: TranslationStage[] = [
  'primer-borrador',
  'revision1',
  'revision2',
  'community-review',
  'back-translation',
  'back-translation-review',
  'answer-flags',
  'translator-training',
  'consultant-review',
];

/** Team members for the Mayangna project */
export const TEAM_MEMBERS = [
  'Noel',
  'Jhoan',
  'Anysa',
  'Benjamín',
  'Patricio',
  'Nilska',
  'Dale',
  'Betsy',
  'Familia',
] as const;

export type TeamMember = (typeof TEAM_MEMBERS)[number];

/** Status display labels (Spanish) */
export const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pendiente',
  'in-progress': 'En Progreso',
  complete: 'Completo',
  flagged: 'Bandera',
};

/** Tailwind CSS color classes per status */
export const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: 'tw:bg-gray-200 tw:text-gray-700',
  'in-progress': 'tw:bg-yellow-200 tw:text-yellow-800',
  complete: 'tw:bg-green-200 tw:text-green-800',
  flagged: 'tw:bg-red-200 tw:text-red-800',
};

export { BIBLE_BOOKS, type BibleBook, generateId } from './shared.constants';

/** Sort key for tasks: flagged first, then in-progress, then pending, then complete */
export const STATUS_SORT_ORDER: Record<TaskStatus, number> = {
  flagged: 0,
  'in-progress': 1,
  pending: 2,
  complete: 3,
};

// --- Helper functions used by both web views ---

/**
 * Returns the display label for a stage. Prefers custom label from stageConfig; falls back to the
 * built-in STAGE_LABELS constant. For unknown custom stages, falls back to the raw key string.
 */
export function getStageLabel(stage: string, stageConfig?: Record<string, StageConfig>): string {
  if (stageConfig?.[stage]?.label) return stageConfig[stage].label;
  return STAGE_LABELS[stage as TranslationStage] ?? stage;
}

/**
 * Returns all stages sorted by their custom order in stageConfig. Includes built-in STAGES plus any
 * custom keys not in STAGES. Falls back to the default STAGES order when no config is present.
 */
export function getOrderedStages(stageConfig?: Record<string, StageConfig>): string[] {
  if (!stageConfig || Object.keys(stageConfig).length === 0) return [...STAGES];
  // Include built-ins + any custom keys not already in STAGES
  const customKeys = Object.keys(stageConfig).filter(
    (k) => !STAGES.includes(k as TranslationStage),
  );
  const allStages = [...STAGES, ...customKeys];
  return allStages.sort((a, b) => {
    const orderA = stageConfig[a]?.order ?? STAGES.indexOf(a as TranslationStage);
    const orderB = stageConfig[b]?.order ?? STAGES.indexOf(b as TranslationStage);
    return orderA - orderB;
  });
}

/**
 * Returns a Tailwind text color class based on deadline urgency:
 *
 * - Past due → red + bold
 * - Within 7 days → yellow + bold
 * - Future → gray
 * - No deadline → empty string
 */
export function deadlineColorClass(deadline?: string): string {
  if (!deadline) return '';
  const due = new Date(deadline);
  const now = new Date();
  const diffDays = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return 'tw:text-red-600 tw:font-semibold';
  if (diffDays <= 7) return 'tw:text-yellow-700 tw:font-semibold';
  return 'tw:text-gray-500';
}
