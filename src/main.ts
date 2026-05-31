import papi, { logger } from '@papi/backend';
import type {
  ExecutionActivationContext,
  ElevatedPrivileges,
  IWebViewProvider,
  SavedWebViewDefinition,
  WebViewDefinition,
  ExecutionToken,
} from '@papi/core';

import type { ChildProcess } from 'child_process';

// Import bundled web views and their styles
import taskBoardWebView from './task-board.web-view?inline';
import taskBoardStyles from './task-board.web-view.scss?inline';
import myTasksWebView from './my-tasks.web-view?inline';
import myTasksStyles from './my-tasks.web-view.scss?inline';
import projectOverviewWebView from './project-overview.web-view?inline';
import projectOverviewStyles from './project-overview.web-view.scss?inline';
import notesViewerWebView from './notes-viewer.web-view?inline';
import notesViewerStyles from './notes-viewer.web-view.scss?inline';
import scriptureViewerWebView from './scripture-viewer.web-view?inline';
import scriptureViewerStyles from './scripture-viewer.web-view.scss?inline';
import type { PendingTimeSyncEntry } from './types/task.types';

const TASK_BOARD_TYPE = 'paratextProjectManager.taskBoard';
const MY_TASKS_TYPE = 'paratextProjectManager.myTasks';
const PROJECT_OVERVIEW_TYPE = 'paratextProjectManager.projectOverview';
const NOTES_VIEWER_TYPE = 'paratextProjectManager.notesViewer';
const SCRIPTURE_VIEWER_TYPE = 'paratextProjectManager.scriptureViewer';
const TASKS_FILENAME = 'project-tasks.json';

// Resolve the current user's home directory from the environment.
// USERPROFILE is set on Windows (e.g. "C:\Users\Dale").
// HOME is the fallback for macOS/Linux (e.g. "/home/dale").
// The path separator adapts accordingly so the extension works on any machine.
const USER_HOME_DIR: string = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\User';
const SEP = USER_HOME_DIR.includes('/') ? '/' : '\\';

// Paratext 10 Studio root — always lives at {home}/.paratext-10-studio
const PARATEXT_STUDIO_DIR = `${USER_HOME_DIR}${SEP}.paratext-10-studio`;

// Default projects base path — overridable per-machine via the
// paratextProjectManager.projectsBasePath setting in Paratext 10 Studio
const DEFAULT_PROJECTS_BASE = `${PARATEXT_STUDIO_DIR}${SEP}projects${SEP}Paratext 9 Projects`;

// File-based Google Calendar config (avoids papi.settings schema requirement)
const GCAL_CONFIG_PATH = `${PARATEXT_STUDIO_DIR}${SEP}pm-gcal-config.json`;
// File-based user config (more reliable than papi.settings for cross-restart persistence)
const PM_USER_CONFIG_PATH = `${PARATEXT_STUDIO_DIR}${SEP}pm-user-config.json`;
// Shared Drive config — same file distributed to all team machines
const PM_TASKS_CONFIG_PATH = `${PARATEXT_STUDIO_DIR}${SEP}pm-tasks-config.json`;
// File-based notes read log
const PM_NOTES_READ_LOG_PATH = `${PARATEXT_STUDIO_DIR}${SEP}pm-notes-read-log.json`;
// User Downloads folder for CSV/HTML export
const USER_DOWNLOADS_DIR = `${USER_HOME_DIR}${SEP}Downloads`;

interface GcalConfig {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  userEmail: string;
  calendarId: string;
  lastSync: string;
  pendingTimeSync?: PendingTimeSyncEntry[];
}

interface TasksDriveConfig {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  /** Maps projectId → Google Drive file ID for that project's task data */
  fileIds: Record<string, string>;
  /** Project IDs with local-only changes that need to be uploaded when Drive is reachable */
  pendingSyncProjects?: string[];
}

const TASKS_DRIVE_DEFAULTS: TasksDriveConfig = {
  clientId: '',
  clientSecret: '',
  accessToken: '',
  refreshToken: '',
  expiryDate: 0,
  fileIds: {},
  pendingSyncProjects: [],
};

// Module-level references set during activate()
let processApi: NonNullable<ElevatedPrivileges['createProcess']> | undefined;
let execToken: ExecutionToken;

let notesHelperProcess: ChildProcess | undefined;
let collabEventEmitter: any;
let lastNavigatedVerse: { projectId: string; bookCode: string; chapter: number; verse: number } | null = null;
const pendingNotesRequests = new Map<
  string,
  { resolve: (val: any) => void; reject: (err: any) => void }
>();
let notesRequestIdCounter = 0;

function sendToNotesHelper(action: string, args: any[]): Promise<any> {
  if (!notesHelperProcess) return Promise.reject(new Error('Notes helper not running'));
  const id = String(notesRequestIdCounter++);
  return new Promise((resolve, reject) => {
    pendingNotesRequests.set(id, { resolve, reject });
    try {
      notesHelperProcess!.send({ id, action, args });
    } catch (e) {
      pendingNotesRequests.delete(id);
      reject(e);
    }
  });
}

function startNotesHelper(createProcess: ElevatedPrivileges['createProcess']): void {
  if (notesHelperProcess) return;
  try {
    notesHelperProcess = createProcess.fork(execToken, 'assets/notes-helper.js', [], { silent: true });

    notesHelperProcess.on('message', (message: any) => {
      if (message.event === 'collab') {
        if (collabEventEmitter) {
          collabEventEmitter.emit(message.data);
        }
        return;
      }
      const { id, result, error } = message;
      const pending = pendingNotesRequests.get(id);
      if (pending) {
        pendingNotesRequests.delete(id);
        if (error) pending.reject(new Error(error));
        else pending.resolve(result);
      }
    });

    notesHelperProcess.on('error', (err) => {
      logger.warn(`Notes helper error: ${err}`);
    });

    notesHelperProcess.on('close', (code) => {
      logger.info(`Notes helper exited with code ${code}`);
      notesHelperProcess = undefined;
      for (const pending of pendingNotesRequests.values()) {
        pending.reject(new Error('Notes helper terminated'));
      }
      pendingNotesRequests.clear();
    });
  } catch (e) {
    logger.warn(`Failed to start Notes helper: ${e}`);
  }
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function isSameUser(userA: string, userB: string): boolean {
  if (!userA || !userB) return false;
  const normA = normalizeName(userA);
  const normB = normalizeName(userB);
  return normA.includes(normB) || normB.includes(normA);
}

// Drive auth state — shared between tasksDriveStartAuth and tasksDrivePollAuth
let driveAuthPending = false;
let driveAuthResult: { success: boolean; error?: string } | null = null;

// GCal auth state — shared between gcalConnect/gcalReconnect and gcalPollAuth
let gcalAuthState: {
  status: 'idle' | 'pending' | 'success' | 'error';
  email?: string;
  error?: string;
} = { status: 'idle' };

function startGcalAuthInBackground(
  clientId: string,
  clientSecret: string,
  existingRefreshToken?: string,
): void {
  gcalAuthState = { status: 'pending' };
  runGcalHelper('full-auth-flow', [clientId, clientSecret], undefined, 6 * 60 * 1000)
    .then(async (result) => {
      const tokens = JSON.parse(result);
      await writeGcalConfig({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || existingRefreshToken || '',
        expiryDate: tokens.expiry_date,
      });
      let email = '';
      try {
        const userInfo = await runGcalHelper('get-userinfo', [tokens.access_token]);
        email = JSON.parse(userInfo).email || '';
        await writeGcalConfig({ userEmail: email, connected: true });
      } catch (_) {
        /* non-critical */
      }
      logger.info(`Google Calendar: auth completed as ${email}`);
      gcalAuthState = { status: 'success', email };
    })
    .catch((e) => {
      logger.warn(`gcalAuth background failed: ${e}`);
      gcalAuthState = { status: 'error', error: String(e) };
    });
}

// --- Generic script runner (file-helper.js, gcal-helper.js, etc.) ---

function runScript(
  scriptPath: string,
  args: string[],
  stdinData?: string,
  timeoutMs?: number,
): Promise<string> {
  const api = processApi;
  if (!api) return Promise.reject(new Error('createProcess not available'));

  return new Promise((resolve, reject) => {
    const child = api.fork(execToken, scriptPath, args, { silent: true });

    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
    }

    child.on('close', (code: number | undefined) => {
      if (code && code !== 0) {
        reject(new Error(`${scriptPath} failed: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });
    child.on('error', (err: Error) => reject(err));

    if (stdinData !== undefined && child.stdin) {
      child.stdin.write(stdinData, 'utf8', () => {
        child.stdin.end();
      });
    }

    if (timeoutMs) {
      setTimeout(() => {
        try {
          child.kill();
        } catch (_) {
          /* ignore */
        }
        reject(new Error(`Script timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
    }
  });
}

// --- File I/O via file-helper.js child process ---

function runFileHelper(action: string, targetPath: string, stdinData?: string): Promise<string> {
  return runScript('assets/file-helper.js', [action, targetPath], stdinData);
}

// --- Google Calendar helper via gcal-helper.js ---

function runGcalHelper(
  action: string,
  args: string[],
  stdinData?: string,
  timeoutMs?: number,
): Promise<string> {
  return runScript('assets/gcal-helper.js', [action, ...args], stdinData, timeoutMs);
}

// --- File-based gcal config (avoids papi.settings schema caching issues) ---

const GCAL_DEFAULTS: GcalConfig = {
  clientId: '',
  clientSecret: '',
  accessToken: '',
  refreshToken: '',
  expiryDate: 0,
  userEmail: '',
  calendarId: 'primary',
  lastSync: '',
};

async function readGcalConfig(): Promise<GcalConfig> {
  try {
    const exists = await runFileHelper('exists', GCAL_CONFIG_PATH);
    if (exists.trim() !== 'true') return { ...GCAL_DEFAULTS };
    const content = await runFileHelper('read', GCAL_CONFIG_PATH);
    return { ...GCAL_DEFAULTS, ...JSON.parse(content) };
  } catch (_) {
    return { ...GCAL_DEFAULTS };
  }
}

async function writeGcalConfig(updates: Partial<GcalConfig>): Promise<void> {
  const current = await readGcalConfig();
  const updated = { ...current, ...updates };
  await runFileHelper('write', GCAL_CONFIG_PATH, JSON.stringify(updated, null, 2));
}

/** Load the full GCal config (all fields, including pendingTimeSync). */
async function loadGcalConfig(): Promise<GcalConfig> {
  try {
    const exists = await runFileHelper('exists', GCAL_CONFIG_PATH);
    if (exists.trim() !== 'true') return { ...GCAL_DEFAULTS };
    const content = await runFileHelper('read', GCAL_CONFIG_PATH);
    return { ...GCAL_DEFAULTS, ...JSON.parse(content) };
  } catch (_) {
    return { ...GCAL_DEFAULTS };
  }
}

/** Persist the full GCal config. */
async function saveGcalConfig(config: GcalConfig): Promise<void> {
  await runFileHelper('write', GCAL_CONFIG_PATH, JSON.stringify(config, null, 2));
}

// --- Drive task config helpers ---

async function readTasksDriveConfig(): Promise<TasksDriveConfig> {
  try {
    const exists = await runFileHelper('exists', PM_TASKS_CONFIG_PATH);
    if (exists.trim() !== 'true') return { ...TASKS_DRIVE_DEFAULTS };
    const content = await runFileHelper('read', PM_TASKS_CONFIG_PATH);
    const parsed = JSON.parse(content) as Partial<TasksDriveConfig>;
    return { ...TASKS_DRIVE_DEFAULTS, ...parsed, fileIds: parsed.fileIds ?? {} };
  } catch (_) {
    return { ...TASKS_DRIVE_DEFAULTS };
  }
}

async function writeTasksDriveConfig(updates: Partial<TasksDriveConfig>): Promise<void> {
  const current = await readTasksDriveConfig();
  const updated = { ...current, ...updates };
  await runFileHelper('write', PM_TASKS_CONFIG_PATH, JSON.stringify(updated, null, 2));
}

/**
 * Merges two TaskStore JSON strings so that no edits from either computer are lost.
 *
 * - Tasks: per-task ID, keep whichever copy has the newer `updatedAt` timestamp. Tasks present on
 *   only one side are always kept.
 * - StageConfig: local (in-memory) copy wins — admin controls stage configuration.
 * - ActivityLog: union by entry id, sorted newest-first, capped at 200.
 */
function mergeTaskStores(localJson: string, driveJson: string): string {
  type MinimalTask = { id: string; updatedAt: string; [key: string]: unknown };
  type MinimalEntry = { id: string; timestamp: string; [key: string]: unknown };
  type MinimalStore = {
    schemaVersion: 1;
    tasks: MinimalTask[];
    stageConfig?: Record<string, unknown>;
    activityLog?: MinimalEntry[];
    deletedTaskIds?: string[];
  };

  let local: MinimalStore;
  let remote: MinimalStore;
  try {
    local = JSON.parse(localJson) as MinimalStore;
    remote = JSON.parse(driveJson) as MinimalStore;
  } catch {
    return localJson; // parse failed — fall back to local
  }

  // Merge tombstones: union of both sides
  const deletedIds = new Set<string>([
    ...(local.deletedTaskIds ?? []),
    ...(remote.deletedTaskIds ?? []),
  ]);

  // Merge tasks: newest updatedAt wins; tasks only on one side are kept
  // UNLESS the task ID appears in deletedIds — those are never resurrected
  const taskMap = new Map<string, MinimalTask>();
  for (const t of remote.tasks ?? []) if (!deletedIds.has(t.id)) taskMap.set(t.id, t);
  for (const t of local.tasks ?? []) {
    if (deletedIds.has(t.id)) continue;
    const existing = taskMap.get(t.id);
    if (!existing || t.updatedAt >= existing.updatedAt) taskMap.set(t.id, t);
  }

  // Merge activityLog: union by id, newest-first, cap at 200
  const logMap = new Map<string, MinimalEntry>();
  for (const e of remote.activityLog ?? []) logMap.set(e.id, e);
  for (const e of local.activityLog ?? []) logMap.set(e.id, e);
  const mergedLog = Array.from(logMap.values())
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 200);

  const merged: MinimalStore = {
    schemaVersion: 1,
    tasks: Array.from(taskMap.values()),
    stageConfig: local.stageConfig ?? remote.stageConfig,
    ...(mergedLog.length > 0 ? { activityLog: mergedLog } : {}),
    ...(deletedIds.size > 0 ? { deletedTaskIds: Array.from(deletedIds) } : {}),
  };
  return JSON.stringify(merged, null, 2);
}

// Concurrency locks — prevent multiple simultaneous token refreshes
let driveTokenRefreshing: Promise<void> | null = null;
let gcalTokenRefreshing: Promise<void> | null = null;

/** Returns a valid Drive access token, refreshing if expired. Empty string if not configured. */
async function getValidDriveToken(): Promise<string> {
  try {
    const config = await readTasksDriveConfig();
    if (!config.refreshToken || !config.clientId) return '';
    if (Date.now() < config.expiryDate - 5 * 60 * 1000) return config.accessToken;
    // Token expired — only one refresh at a time
    if (!driveTokenRefreshing) {
      driveTokenRefreshing = (async () => {
        const result = await runGcalHelper(
          'refresh',
          [config.clientId, config.clientSecret, config.refreshToken],
          undefined,
          15_000,
        );
        const data = JSON.parse(result);
        await writeTasksDriveConfig({
          accessToken: data.access_token,
          expiryDate: data.expiry_date,
        });
      })().finally(() => {
        driveTokenRefreshing = null;
      });
    }
    await driveTokenRefreshing;
    return (await readTasksDriveConfig()).accessToken;
  } catch (_) {
    return '';
  }
}

/** Add a time entry to the offline sync queue (deduplicated by entry ID). */
async function queuePendingTimeSync(entry: PendingTimeSyncEntry): Promise<void> {
  const config = await loadGcalConfig();
  if (!config.pendingTimeSync) config.pendingTimeSync = [];
  // Deduplicate: remove any existing entry with the same ID before appending
  const parsed = JSON.parse(entry.timeEntryJson) as { id: string };
  config.pendingTimeSync = config.pendingTimeSync.filter(
    (p) => (JSON.parse(p.timeEntryJson) as { id: string }).id !== parsed.id,
  );
  config.pendingTimeSync.push(entry);
  await saveGcalConfig(config);
}

/** Get access token, refreshing if expired. Returns empty string if not connected. */
async function getValidAccessToken(): Promise<string> {
  try {
    const config = await readGcalConfig();
    if (!config.accessToken || !config.refreshToken) return '';

    // Still valid (with 5-minute buffer)?
    if (Date.now() < config.expiryDate - 5 * 60 * 1000) return config.accessToken;

    // Token expired — only one refresh at a time
    if (!gcalTokenRefreshing) {
      gcalTokenRefreshing = (async () => {
        const result = await runGcalHelper(
          'refresh',
          [config.clientId, config.clientSecret, config.refreshToken],
          undefined,
          15_000,
        );
        const data = JSON.parse(result);
        await writeGcalConfig({ accessToken: data.access_token, expiryDate: data.expiry_date });
      })().finally(() => {
        gcalTokenRefreshing = null;
      });
    }
    await gcalTokenRefreshing;
    return (await readGcalConfig()).accessToken;
  } catch (_) {
    return '';
  }
}

// --- Project directory resolution ---

/** Cache of projectId -> { projectDir } */
const projectCache: Record<string, { projectDir: string }> = {};

async function resolveProjectDir(projectId: string): Promise<string> {
  if (projectCache[projectId]) return projectCache[projectId].projectDir;

  // Build ordered list of candidate paths to search.
  // Explicit setting (if set) comes first; then the computed default;
  // then the classic Paratext 9 locations that many team machines still use.
  const candidates: string[] = [];

  try {
    const settingVal = await papi.settings.get('paratextProjectManager.projectsBasePath');
    if (settingVal && typeof settingVal === 'string' && settingVal.trim()) {
      candidates.push(settingVal.trim());
    }
  } catch (_) {
    /* ignore */
  }

  // Classic Paratext 9 location — most common on team machines
  candidates.push(`C:${SEP}My Paratext 9 Projects`);
  candidates.push(`${USER_HOME_DIR}${SEP}My Paratext 9 Projects`);

  // Paratext 10 Studio default location
  candidates.push(DEFAULT_PROJECTS_BASE);

  // Other common variations
  candidates.push(`C:${SEP}My Paratext Projects`);
  candidates.push(`${USER_HOME_DIR}${SEP}My Paratext Projects`);

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const searchPaths = candidates.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });

  const normalizeGuid = (g: string): string => g.toLowerCase().replace(/[{}-]/g, '');

  // Strip known prefixes/suffixes from the projectId
  const idParts = projectId.split('|');
  let rawId = idParts.length > 1 ? idParts[idParts.length - 1] : projectId;
  rawId = rawId.replace(/-slingshot-.*$/, '');
  const normalizedId = normalizeGuid(rawId);

  let foundDir: string | undefined;

  for (const base of searchPaths) {
    if (foundDir) break;
    let projects: { dir: string; guid: string; name: string; fileNamePostPart: string }[];
    try {
      const raw = await runFileHelper('scanprojects', base);
      projects = JSON.parse(raw);
    } catch (_) {
      continue; // path doesn't exist or unreadable — try next
    }

    for (const proj of projects) {
      if (foundDir) break;
      if (normalizeGuid(proj.guid) === normalizedId || proj.name === projectId) {
        foundDir = proj.dir;
      }
    }

    // Fallback: match by directory basename
    if (!foundDir) {
      for (const proj of projects) {
        if (foundDir) break;
        const dirName = proj.dir.split(/[\\/]/).pop() || '';
        if (dirName === projectId) {
          foundDir = proj.dir;
        }
      }
    }

    if (foundDir) logger.info(`Project Manager: found project in "${base}"`);
  }

  if (!foundDir) {
    throw new Error(
      `Could not find project directory for projectId: ${projectId}. ` +
        `Searched: ${searchPaths.join(', ')}`,
    );
  }

  logger.info(`Project Manager: resolved "${projectId}" → "${foundDir}"`);
  projectCache[projectId] = { projectDir: foundDir };
  return foundDir;
}

// --- WebView Providers ---

/**
 * OpenWebViewOptions does NOT include projectId (confirmed in papi.d.ts lines 612-640). We use this
 * registry to pass the selected projectId from open commands into getWebView, which CAN set
 * projectId on the returned WebViewDefinition.
 */
const pendingProjectId: Record<string, string | undefined> = {};

const taskBoardProvider: IWebViewProvider = {
  async getWebView(savedWebView: SavedWebViewDefinition): Promise<WebViewDefinition | undefined> {
    if (savedWebView.webViewType !== TASK_BOARD_TYPE)
      throw new Error(`Wrong webview type: ${savedWebView.webViewType}`);
    // savedWebView.projectId is set on re-open (persisted); pendingProjectId is set on first open
    const projectId = savedWebView.projectId ?? pendingProjectId[TASK_BOARD_TYPE];
    pendingProjectId[TASK_BOARD_TYPE] = undefined;
    return {
      ...savedWebView,
      projectId,
      title: 'Tablero de Tareas',
      content: taskBoardWebView,
      styles: taskBoardStyles,
    };
  },
};

const myTasksProvider: IWebViewProvider = {
  async getWebView(savedWebView: SavedWebViewDefinition): Promise<WebViewDefinition | undefined> {
    if (savedWebView.webViewType !== MY_TASKS_TYPE)
      throw new Error(`Wrong webview type: ${savedWebView.webViewType}`);
    const projectId = savedWebView.projectId ?? pendingProjectId[MY_TASKS_TYPE];
    pendingProjectId[MY_TASKS_TYPE] = undefined;
    return {
      ...savedWebView,
      projectId,
      title: 'Mis Tareas',
      content: myTasksWebView,
      styles: myTasksStyles,
    };
  },
};

const projectOverviewProvider: IWebViewProvider = {
  async getWebView(savedWebView: SavedWebViewDefinition): Promise<WebViewDefinition | undefined> {
    if (savedWebView.webViewType !== PROJECT_OVERVIEW_TYPE)
      throw new Error(`Wrong webview type: ${savedWebView.webViewType}`);
    const projectId = savedWebView.projectId ?? pendingProjectId[PROJECT_OVERVIEW_TYPE];
    pendingProjectId[PROJECT_OVERVIEW_TYPE] = undefined;
    return {
      ...savedWebView,
      projectId,
      title: 'Resumen del Proyecto',
      content: projectOverviewWebView,
      styles: projectOverviewStyles,
    };
  },
};

const notesViewerProvider: IWebViewProvider = {
  async getWebView(savedWebView: SavedWebViewDefinition): Promise<WebViewDefinition | undefined> {
    if (savedWebView.webViewType !== NOTES_VIEWER_TYPE)
      throw new Error(`Wrong webview type: ${savedWebView.webViewType}`);
    const projectId = savedWebView.projectId ?? pendingProjectId[NOTES_VIEWER_TYPE];
    pendingProjectId[NOTES_VIEWER_TYPE] = undefined;
    return {
      ...savedWebView,
      projectId,
      title: 'Notas de Paratext',
      content: notesViewerWebView,
      styles: notesViewerStyles,
    };
  },
};

const scriptureViewerProvider: IWebViewProvider = {
  async getWebView(savedWebView: SavedWebViewDefinition): Promise<WebViewDefinition | undefined> {
    if (savedWebView.webViewType !== SCRIPTURE_VIEWER_TYPE)
      throw new Error(`Wrong webview type: ${savedWebView.webViewType}`);
    const projectId = savedWebView.projectId ?? pendingProjectId[SCRIPTURE_VIEWER_TYPE];
    pendingProjectId[SCRIPTURE_VIEWER_TYPE] = undefined;
    return {
      ...savedWebView,
      projectId,
      title: 'Lector de Escritura',
      content: scriptureViewerWebView,
      styles: scriptureViewerStyles,
    };
  },
};

// --- Extension Lifecycle ---

export async function activate(context: ExecutionActivationContext): Promise<void> {
  logger.info('Project Manager extension is activating!');

  // eslint-disable-next-line no-type-assertion/no-type-assertion
  execToken = context.executionToken as ExecutionToken;
  const { createProcess } = context.elevatedPrivileges;
  if (!createProcess) {
    throw new Error(
      'createProcess privilege not available. Ensure "createProcess" is in manifest.json elevatedPrivileges.',
    );
  }
  processApi = createProcess;
  startNotesHelper(createProcess);

  context.registrations.add({
    dispose: () => {
      if (notesHelperProcess) {
        try {
          notesHelperProcess.kill();
        } catch (_) {}
        notesHelperProcess = undefined;
      }
    },
  });

  // Register WebView providers
  const taskBoardProviderPromise = papi.webViewProviders.registerWebViewProvider(
    TASK_BOARD_TYPE,
    taskBoardProvider,
  );
  const myTasksProviderPromise = papi.webViewProviders.registerWebViewProvider(
    MY_TASKS_TYPE,
    myTasksProvider,
  );
  const projectOverviewProviderPromise = papi.webViewProviders.registerWebViewProvider(
    PROJECT_OVERVIEW_TYPE,
    projectOverviewProvider,
  );
  const notesViewerProviderPromise = papi.webViewProviders.registerWebViewProvider(
    NOTES_VIEWER_TYPE,
    notesViewerProvider,
  );
  const scriptureViewerProviderPromise = papi.webViewProviders.registerWebViewProvider(
    SCRIPTURE_VIEWER_TYPE,
    scriptureViewerProvider,
  );

  // --- Open commands ---

  const openTaskBoardPromise = papi.commands.registerCommand(
    'paratextProjectManager.openTaskBoard',
    async (projectId?: string) => {
      let pid = projectId;
      if (!pid) {
        pid = await papi.dialogs.selectProject({
          title: 'Abrir Tablero de Tareas',
          prompt: 'Selecciona un proyecto:',
          includeProjectInterfaces: 'platformScripture.USJ_Chapter',
        });
      }
      if (!pid) return undefined;
      pendingProjectId[TASK_BOARD_TYPE] = pid;
      return papi.webViews.openWebView(TASK_BOARD_TYPE, undefined, { existingId: `task-board-${pid}` });
    },
  );

  const openMyTasksPromise = papi.commands.registerCommand(
    'paratextProjectManager.openMyTasks',
    async (projectId?: string) => {
      let pid = projectId;
      if (!pid) {
        pid = await papi.dialogs.selectProject({
          title: 'Abrir Mis Tareas',
          prompt: 'Selecciona un proyecto:',
          includeProjectInterfaces: 'platformScripture.USJ_Chapter',
        });
      }
      if (!pid) return undefined;
      pendingProjectId[MY_TASKS_TYPE] = pid;
      return papi.webViews.openWebView(MY_TASKS_TYPE, undefined, { existingId: `my-tasks-${pid}` });
    },
  );

  const openProjectOverviewPromise = papi.commands.registerCommand(
    'paratextProjectManager.openProjectOverview',
    async (projectId?: string) => {
      let pid = projectId;
      if (!pid) {
        pid = await papi.dialogs.selectProject({
          title: 'Abrir Resumen del Proyecto',
          prompt: 'Selecciona un proyecto:',
          includeProjectInterfaces: 'platformScripture.USJ_Chapter',
        });
      }
      if (!pid) return undefined;
      pendingProjectId[PROJECT_OVERVIEW_TYPE] = pid;
      return papi.webViews.openWebView(PROJECT_OVERVIEW_TYPE, undefined, { existingId: `project-overview-${pid}` });
    },
  );

  // --- Data commands ---

  const getTasksPromise = papi.commands.registerCommand(
    'paratextProjectManager.getTasks',
    async (projectId: string): Promise<string> => {
      const empty = JSON.stringify({ schemaVersion: 1, tasks: [] });

      // --- Always read local file first ---
      let localContent: string | null = null;
      let tasksPath = '';
      try {
        const projectDir = await resolveProjectDir(projectId);
        tasksPath = `${projectDir}${SEP}${TASKS_FILENAME}`;
        const exists = await runFileHelper('exists', tasksPath);
        if (exists.trim() !== 'false') {
          const content = await runFileHelper('read', tasksPath);
          JSON.parse(content); // validate
          localContent = content;
        }
      } catch (e) {
        logger.warn(`getTasks local read failed for "${projectId}": ${e}`);
      }

      // --- If local file is cached, return immediately and sync Drive in background ---
      if (localContent) {
        (async () => {
          try {
            const token = await getValidDriveToken();
            if (token) {
              const driveConfig = await readTasksDriveConfig();
              let fileId = driveConfig.fileIds[projectId];

              if (!fileId) {
                const safeName = projectId.replace(/[^a-zA-Z0-9-]/g, '_');
                const fileName = `paratext-tasks-${safeName}.json`;
                try {
                  const searchResult = JSON.parse(
                    await runGcalHelper('drive-search', [token, fileName], undefined, 10_000),
                  ) as { fileId: string | null };
                  if (searchResult.fileId) {
                    fileId = searchResult.fileId;
                    const updatedIds = { ...driveConfig.fileIds, [projectId]: fileId };
                    await writeTasksDriveConfig({ fileIds: updatedIds });
                  }
                } catch (searchErr) {
                  logger.warn(`Drive file search failed for "${projectId}": ${searchErr}`);
                }
              }

              if (fileId) {
                const driveContent = await runGcalHelper(
                  'drive-read',
                  [token, fileId],
                  undefined,
                  15_000,
                );
                JSON.parse(driveContent); // validate
                const merged = mergeTaskStores(localContent!, driveContent);
                if (merged !== localContent && tasksPath) {
                  await runFileHelper('write', tasksPath, merged);
                  logger.info(`Project Manager: getTasks background merged local+Drive for "${projectId}"`);
                }
              }
            }
          } catch (driveErr) {
            logger.warn(`Background Drive getTasks failed: ${driveErr}`);
          }
        })();

        return localContent;
      }

      // --- First-time run (no local content) -> must wait for Drive sync ---
      try {
        const token = await getValidDriveToken();
        if (token) {
          const driveConfig = await readTasksDriveConfig();
          let fileId = driveConfig.fileIds[projectId];

          if (!fileId) {
            const safeName = projectId.replace(/[^a-zA-Z0-9-]/g, '_');
            const fileName = `paratext-tasks-${safeName}.json`;
            try {
              const searchResult = JSON.parse(
                await runGcalHelper('drive-search', [token, fileName], undefined, 10_000),
              ) as { fileId: string | null };
              if (searchResult.fileId) {
                fileId = searchResult.fileId;
                const updatedIds = { ...driveConfig.fileIds, [projectId]: fileId };
                await writeTasksDriveConfig({ fileIds: updatedIds });
              }
            } catch (searchErr) {
              logger.warn(`Drive file search failed for "${projectId}": ${searchErr}`);
            }
          }

          if (fileId) {
            const driveContent = await runGcalHelper(
              'drive-read',
              [token, fileId],
              undefined,
              15_000,
            );
            JSON.parse(driveContent); // validate
            logger.info(`Project Manager: getTasks from Drive only (no local file yet) for "${projectId}"`);
            return driveContent;
          }
        }
      } catch (driveErr) {
        logger.warn(`Drive getTasks failed: ${driveErr}`);
      }

      return empty;
    },
  );

  const saveTasksPromise = papi.commands.registerCommand(
    'paratextProjectManager.saveTasks',
    async (projectId: string, tasksJson: string): Promise<string> => {
      // --- Always save to local file ---
      try {
        const projectDir = await resolveProjectDir(projectId);
        const tasksPath = `${projectDir}${SEP}${TASKS_FILENAME}`;
        await runFileHelper('write', tasksPath, tasksJson);
        logger.info(`Project Manager: saved tasks locally to ${tasksPath}`);
      } catch (e) {
        logger.warn(`saveTasks local write failed for "${projectId}": ${e}`);
        return `error: ${e}`;
      }

      // --- Also sync to Drive if configured (non-blocking in background) ---
      (async () => {
        try {
          const token = await getValidDriveToken();
          if (token) {
            const driveConfig = await readTasksDriveConfig();
            const existingFileId = driveConfig.fileIds[projectId] || '';
            const safeName = projectId.replace(/[^a-zA-Z0-9-]/g, '_');
            const fileName = `paratext-tasks-${safeName}.json`;

            // Read Drive version first and merge so neither computer's edits are lost
            let contentToWrite = tasksJson;
            if (existingFileId) {
              try {
                const driveContent = await runGcalHelper(
                  'drive-read',
                  [token, existingFileId],
                  undefined,
                  15_000,
                );
                contentToWrite = mergeTaskStores(tasksJson, driveContent);
                logger.info(`Project Manager: merged local + Drive tasks for "${projectId}"`);
              } catch (readErr) {
                logger.warn(`Drive read-before-merge failed, writing local only: ${readErr}`);
              }
            }

            const result = await runGcalHelper(
              'drive-write',
              [token, existingFileId, fileName],
              contentToWrite,
              30_000,
            );
            const { fileId: newFileId } = JSON.parse(result) as { fileId: string };
            if (newFileId && newFileId !== existingFileId) {
              const updatedIds = { ...driveConfig.fileIds, [projectId]: newFileId };
              await writeTasksDriveConfig({ fileIds: updatedIds });
              logger.info(`Project Manager: Drive task file ${newFileId} created for "${projectId}"`);
            }
          }
        } catch (driveErr) {
          logger.warn(`Drive saveTasks failed (local save OK): ${driveErr}`);
          // Queue for retry when internet is available
          try {
            const cfg = await readTasksDriveConfig();
            const pending = new Set(cfg.pendingSyncProjects ?? []);
            pending.add(projectId);
            await writeTasksDriveConfig({ pendingSyncProjects: Array.from(pending) });
          } catch (_) {
            /* ignore — main save already succeeded */
          }
        }
      })();

      // --- Broadcast via LAN Collaboration if active ---
      try {
        const status = await sendToNotesHelper('getCollabStatus', []);
        if (status && status.role !== 'none') {
          await sendToNotesHelper('broadcastCollab', [{
            type: 'tasks_update',
            payload: { projectId, tasksJson }
          }]);
        }
      } catch (_) {}

      return 'ok';
    },
  );

  const getCurrentUserPromise = papi.commands.registerCommand(
    'paratextProjectManager.getCurrentUser',
    async (): Promise<string> => {
      try {
        const exists = await runFileHelper('exists', PM_USER_CONFIG_PATH);
        if (exists.trim() !== 'true') return '';
        const content = await runFileHelper('read', PM_USER_CONFIG_PATH);
        const config = JSON.parse(content) as { currentUser?: string };
        return config.currentUser || '';
      } catch (_) {
        return '';
      }
    },
  );

  const setCurrentUserPromise = papi.commands.registerCommand(
    'paratextProjectManager.setCurrentUser',
    async (userName: string): Promise<string> => {
      try {
        // Read existing config so we don't clobber other keys added in future
        let config: Record<string, unknown> = {};
        try {
          const exists = await runFileHelper('exists', PM_USER_CONFIG_PATH);
          if (exists.trim() === 'true') {
            const content = await runFileHelper('read', PM_USER_CONFIG_PATH);
            config = JSON.parse(content) as Record<string, unknown>;
          }
        } catch (_) {
          /* use empty config */
        }
        config.currentUser = userName;
        await runFileHelper('write', PM_USER_CONFIG_PATH, JSON.stringify(config, null, 2));
        logger.info(`Project Manager: currentUser set to "${userName}"`);
        return 'ok';
      } catch (e) {
        logger.warn(`setCurrentUser failed: ${e}`);
        return `error: ${e}`;
      }
    },
  );

  // --- Team member commands ---

  const DEFAULT_TEAM_MEMBERS = [
    'Noel',
    'Jhoan',
    'Anysa',
    'Benjamín',
    'Patricio',
    'Nilska',
    'Dale',
    'Betsy',
    'Familia',
  ];

  const getTeamMembersPromise = papi.commands.registerCommand(
    'paratextProjectManager.getTeamMembers',
    async (): Promise<string> => {
      try {
        const exists = await runFileHelper('exists', PM_USER_CONFIG_PATH);
        if (exists.trim() === 'true') {
          const content = await runFileHelper('read', PM_USER_CONFIG_PATH);
          const config = JSON.parse(content) as { teamMembers?: string[] };
          if (Array.isArray(config.teamMembers) && config.teamMembers.length > 0)
            return JSON.stringify(config.teamMembers);
        }
      } catch (_) {
        /* fall through */
      }
      return JSON.stringify(DEFAULT_TEAM_MEMBERS);
    },
  );

  const setTeamMembersPromise = papi.commands.registerCommand(
    'paratextProjectManager.setTeamMembers',
    async (membersJson: string): Promise<string> => {
      try {
        const members = JSON.parse(membersJson) as unknown;
        if (!Array.isArray(members)) throw new Error('Expected array');
        let config: Record<string, unknown> = {};
        try {
          const exists = await runFileHelper('exists', PM_USER_CONFIG_PATH);
          if (exists.trim() === 'true') {
            const content = await runFileHelper('read', PM_USER_CONFIG_PATH);
            config = JSON.parse(content) as Record<string, unknown>;
          }
        } catch (_) {
          /* start fresh */
        }
        config.teamMembers = members;
        await runFileHelper('write', PM_USER_CONFIG_PATH, JSON.stringify(config, null, 2));
        logger.info(
          `Project Manager: team members updated (${(members as string[]).length} members)`,
        );
        return 'ok';
      } catch (e) {
        logger.warn(`setTeamMembers failed: ${e}`);
        return `error: ${e}`;
      }
    },
  );

  // --- Scripture & Notes Commands ---

  // --- LAN Collaboration Event Emitter & Commands ---

  collabEventEmitter = papi.network.createNetworkEventEmitter<{
    type: string;
    payload: any;
  }>('paratextProjectManager.onCollabEvent');

  const startCollabHostPromise = papi.commands.registerCommand(
    'paratextProjectManager.startCollabHost',
    async (
      portOrRoomId: number | string,
      username: string,
      projectId: string,
      collabType?: 'local' | 'online',
      serverUrl?: string,
    ): Promise<any> => {
      try {
        const projectDir = await resolveProjectDir(projectId);
        return await sendToNotesHelper('startCollabHost', [
          portOrRoomId,
          username,
          projectId,
          projectDir,
          collabType || 'local',
          serverUrl || '',
        ]);
      } catch (e: any) {
        logger.warn(`startCollabHost failed: ${e}`);
        return { status: 'error', error: e.message || String(e) };
      }
    },
  );

  const connectCollabClientPromise = papi.commands.registerCommand(
    'paratextProjectManager.connectCollabClient',
    async (
      ipOrRoomId: string,
      portOrNull: number | null,
      username: string,
      projectId: string,
      collabType?: 'local' | 'online',
      serverUrl?: string,
    ): Promise<any> => {
      try {
        const projectDir = await resolveProjectDir(projectId);
        return await sendToNotesHelper('connectCollabClient', [
          ipOrRoomId,
          portOrNull,
          username,
          projectId,
          projectDir,
          collabType || 'local',
          serverUrl || '',
        ]);
      } catch (e: any) {
        logger.warn(`connectCollabClient failed: ${e}`);
        return { status: 'error', error: e.message || String(e) };
      }
    },
  );

  const stopCollabPromise = papi.commands.registerCommand(
    'paratextProjectManager.stopCollab',
    async (): Promise<string> => {
      try {
        return await sendToNotesHelper('stopCollab', []);
      } catch (e) {
        return 'error';
      }
    },
  );

  const getCollabStatusPromise = papi.commands.registerCommand(
    'paratextProjectManager.getCollabStatus',
    async (): Promise<any> => {
      try {
        return await sendToNotesHelper('getCollabStatus', []);
      } catch (e) {
        return {
          role: 'none',
          type: 'local',
          username: '',
          port: 49885,
          hostIp: '',
          roomId: '',
          serverUrl: '',
          activeUsers: [],
          ips: [],
        };
      }
    },
  );

  const sendCollabChatPromise = papi.commands.registerCommand(
    'paratextProjectManager.sendCollabChat',
    async (username: string, message: string): Promise<string> => {
      try {
        const payload = { user: username, message, timestamp: Date.now() };
        // Emit locally first so it shows up instantly in the sender's UI
        collabEventEmitter.emit({ type: 'chat_message', payload });
        // Then try to broadcast via helper process
        try {
          await sendToNotesHelper('broadcastCollab', [{ type: 'chat_message', payload }]);
        } catch (helperErr) {
          logger.warn(`Failed to broadcast chat to helper: ${helperErr}`);
        }
        return 'ok';
      } catch (e) {
        return 'error';
      }
    },
  );

  const broadcastCursorPromise = papi.commands.registerCommand(
    'paratextProjectManager.broadcastCursor',
    async (
      username: string,
      projectId: string,
      book: string,
      chapter: number,
      verse: number | null,
      offset?: number | null,
    ): Promise<string> => {
      try {
        const payload = {
          user: username,
          projectId,
          book,
          chapter,
          verse,
          offset: offset ?? null,
          timestamp: Date.now(),
        };
        // Emit locally first
        collabEventEmitter.emit({ type: 'cursor_update', payload });
        // Then try to broadcast via helper process
        try {
          await sendToNotesHelper('broadcastCollab', [{ type: 'cursor_update', payload }]);
        } catch (helperErr) {
          logger.warn(`Failed to broadcast cursor update to helper: ${helperErr}`);
        }
        return 'ok';
      } catch (e) {
        return 'error';
      }
    },
  );

  // Network Event Emitter for verse navigation
  const navigateToVerseEmitter = papi.network.createNetworkEventEmitter<{
    projectId: string;
    bookCode: string;
    chapter: number;
    verse: number;
  }>('paratextProjectManager.onNavigateToVerse');

  const navigateToVersePromise = papi.commands.registerCommand(
    'paratextProjectManager.navigateToVerse',
    async (
      projectId: string,
      bookCode: string,
      chapter: number,
      verse: number,
    ): Promise<string> => {
      lastNavigatedVerse = { projectId, bookCode, chapter, verse };
      navigateToVerseEmitter.emit({ projectId, bookCode, chapter, verse });
      return 'ok';
    },
  );

  const getLastNavigatedVersePromise = papi.commands.registerCommand(
    'paratextProjectManager.getLastNavigatedVerse',
    async (
      projectId: string,
    ): Promise<{ projectId: string; bookCode: string; chapter: number; verse: number } | null> => {
      if (lastNavigatedVerse && lastNavigatedVerse.projectId === projectId) {
        const val = lastNavigatedVerse;
        lastNavigatedVerse = null;
        return val;
      }
      return null;
    },
  );

  const openNotesViewerPromise = papi.commands.registerCommand(
    'paratextProjectManager.openNotesViewer',
    async (projectId?: string) => {
      let pid = projectId;
      if (!pid) {
        pid = await papi.dialogs.selectProject({
          title: 'Abrir Visor de Notas',
          prompt: 'Selecciona un proyecto:',
          includeProjectInterfaces: 'platformScripture.USJ_Chapter',
        });
      }
      if (!pid) return undefined;
      pendingProjectId[NOTES_VIEWER_TYPE] = pid;
      return papi.webViews.openWebView(NOTES_VIEWER_TYPE, undefined, { existingId: `notes-viewer-${pid}` });
    },
  );

  const openScriptureViewerPromise = papi.commands.registerCommand(
    'paratextProjectManager.openScriptureViewer',
    async (projectId?: string) => {
      let pid = projectId;
      if (!pid) {
        pid = await papi.dialogs.selectProject({
          title: 'Abrir Lector de Escritura',
          prompt: 'Selecciona un proyecto:',
          includeProjectInterfaces: 'platformScripture.USJ_Chapter',
        });
      }
      if (!pid) return undefined;
      pendingProjectId[SCRIPTURE_VIEWER_TYPE] = pid;
      return papi.webViews.openWebView(SCRIPTURE_VIEWER_TYPE, undefined, { existingId: `scripture-viewer-${pid}` });
    },
  );

  const getProjectNotesPromise = papi.commands.registerCommand(
    'paratextProjectManager.getProjectNotes',
    async (projectId: string, currentUser: string): Promise<string> => {
      try {
        const projectDir = await resolveProjectDir(projectId);
        await sendToNotesHelper('registerProjectDir', [projectId, projectDir]);
        const res = await sendToNotesHelper('getProjectNotes', [
          projectId,
          projectDir,
          currentUser,
          PM_NOTES_READ_LOG_PATH,
        ]);
        return JSON.stringify(res);
      } catch (e) {
        logger.warn(`getProjectNotes failed: ${e}`);
        return JSON.stringify({ threads: [], authors: [], error: String(e) });
      }
    },
  );

  const saveProjectNotePromise = papi.commands.registerCommand(
    'paratextProjectManager.saveProjectNote',
    async (
      projectId: string,
      authorName: string,
      threadId: string,
      commentDate: string,
      newContents: string,
    ): Promise<string> => {
      try {
        const projectDir = await resolveProjectDir(projectId);
        await sendToNotesHelper('registerProjectDir', [projectId, projectDir]);
        await sendToNotesHelper('saveProjectNote', [
          projectId,
          projectDir,
          authorName,
          threadId,
          commentDate,
          newContents,
        ]);
        return 'ok';
      } catch (e) {
        logger.warn(`saveProjectNote failed: ${e}`);
        return `error: ${e}`;
      }
    },
  );

  const deleteProjectNotePromise = papi.commands.registerCommand(
    'paratextProjectManager.deleteProjectNote',
    async (
      projectId: string,
      authorName: string,
      threadId: string,
      commentDate: string,
    ): Promise<string> => {
      try {
        const projectDir = await resolveProjectDir(projectId);
        await sendToNotesHelper('registerProjectDir', [projectId, projectDir]);
        await sendToNotesHelper('deleteProjectNote', [
          projectId,
          projectDir,
          authorName,
          threadId,
          commentDate,
        ]);
        return 'ok';
      } catch (e) {
        logger.warn(`deleteProjectNote failed: ${e}`);
        return `error: ${e}`;
      }
    },
  );

  const addNoteReplyPromise = papi.commands.registerCommand(
    'paratextProjectManager.addNoteReply',
    async (projectId: string, currentUser: string, replyDataJson: string): Promise<string> => {
      try {
        const replyData = JSON.parse(replyDataJson);
        const projectDir = await resolveProjectDir(projectId);
        await sendToNotesHelper('registerProjectDir', [projectId, projectDir]);

        const res = (await sendToNotesHelper('addNoteReply', [
          projectId,
          projectDir,
          currentUser,
          replyData,
        ])) as { status: string; fullName: string };

        // Auto mark read for replying user
        try {
          const threadId = replyData.threadId;
          const authorFullName = res.fullName || currentUser;

          let readLog: Record<string, Record<string, string>> = {};
          const exists = await runFileHelper('exists', PM_NOTES_READ_LOG_PATH);
          if (exists.trim() === 'true') {
            const content = await runFileHelper('read', PM_NOTES_READ_LOG_PATH);
            readLog = JSON.parse(content);
          }
          const userKeys = Object.keys(readLog);
          const matchedKey = userKeys.find((k) => isSameUser(k, authorFullName)) || authorFullName;
          if (!readLog[matchedKey]) readLog[matchedKey] = {};
          readLog[matchedKey][threadId] = new Date().toISOString();
          await runFileHelper('write', PM_NOTES_READ_LOG_PATH, JSON.stringify(readLog, null, 2));
        } catch (err) {
          logger.warn(`addNoteReply auto-mark-read failed: ${err}`);
        }

        // --- Broadcast via LAN Collaboration if active ---
        try {
          const status = await sendToNotesHelper('getCollabStatus', []);
          if (status && status.role !== 'none') {
            await sendToNotesHelper('broadcastCollab', [{
              type: 'note_update',
              payload: {
                projectId,
                senderUser: currentUser,
                replyData
              }
            }]);
          }
        } catch (_) {}

        return 'ok';
      } catch (e) {
        logger.warn(`addNoteReply failed: ${e}`);
        return `error: ${e}`;
      }
    },
  );

  const markNoteAsReadPromise = papi.commands.registerCommand(
    'paratextProjectManager.markNoteAsRead',
    async (currentUser: string, threadId: string, latestCommentDate: string): Promise<string> => {
      try {
        let readLog: Record<string, Record<string, string>> = {};
        const exists = await runFileHelper('exists', PM_NOTES_READ_LOG_PATH);
        if (exists.trim() === 'true') {
          const content = await runFileHelper('read', PM_NOTES_READ_LOG_PATH);
          readLog = JSON.parse(content);
        }
        const userKeys = Object.keys(readLog);
        const matchedKey = userKeys.find((k) => isSameUser(k, currentUser)) || currentUser;
        if (!readLog[matchedKey]) readLog[matchedKey] = {};
        readLog[matchedKey][threadId] = latestCommentDate;
        await runFileHelper('write', PM_NOTES_READ_LOG_PATH, JSON.stringify(readLog, null, 2));
        return 'ok';
      } catch (e) {
        logger.warn(`markNoteAsRead failed: ${e}`);
        return `error: ${e}`;
      }
    },
  );

  const getProjectBooksPromise = papi.commands.registerCommand(
    'paratextProjectManager.getProjectBooks',
    async (projectId: string): Promise<string> => {
      try {
        const projectDir = await resolveProjectDir(projectId);
        await sendToNotesHelper('registerProjectDir', [projectId, projectDir]);
        const books = await sendToNotesHelper('getProjectBooks', [projectId, projectDir]);
        return JSON.stringify(books);
      } catch (e) {
        logger.warn(`getProjectBooks failed: ${e}`);
        return JSON.stringify([]);
      }
    },
  );

  const getChapterTextPromise = papi.commands.registerCommand(
    'paratextProjectManager.getChapterText',
    async (projectId: string, bookCode: string, chapter: number): Promise<string> => {
      try {
        const projectDir = await resolveProjectDir(projectId);
        await sendToNotesHelper('registerProjectDir', [projectId, projectDir]);
        const res = await sendToNotesHelper('getChapterText', [
          projectId,
          projectDir,
          bookCode,
          chapter,
        ]);
        return JSON.stringify(res);
      } catch (e) {
        logger.warn(`getChapterText failed: ${e}`);
        return JSON.stringify({ blocks: [], totalChapters: 0, error: String(e) });
      }
    },
  );

  const updateVerseTextPromise = papi.commands.registerCommand(
    'paratextProjectManager.updateVerseText',
    async (
      projectId: string,
      bookCode: string,
      chapter: number,
      verse: number,
      newText: string,
    ): Promise<string> => {
      try {
        const projectDir = await resolveProjectDir(projectId);
        await sendToNotesHelper('registerProjectDir', [projectId, projectDir]);
        await sendToNotesHelper('updateVerseText', [
          projectId,
          projectDir,
          bookCode,
          chapter,
          verse,
          newText,
        ]);

        // Broadcast the update so other computers reload the verse text
        const payload = { projectId, book: bookCode, chapter, verse, newText };
        collabEventEmitter.emit({ type: 'verse_update', payload });
        try {
          await sendToNotesHelper('broadcastCollab', [{ type: 'verse_update', payload }]);
        } catch (helperErr) {
          logger.warn(`Failed to broadcast verse_update to helper: ${helperErr}`);
        }

        return 'ok';
      } catch (e) {
        logger.warn(`updateVerseText failed: ${e}`);
        return `error: ${e}`;
      }
    },
  );

  const getNotesSettingsPromise = papi.commands.registerCommand(
    'paratextProjectManager.getNotesSettings',
    async (currentUser: string): Promise<string> => {
      try {
        const exists = await runFileHelper('exists', PM_USER_CONFIG_PATH);
        if (exists.trim() !== 'true') return '';
        const content = await runFileHelper('read', PM_USER_CONFIG_PATH);
        const config = JSON.parse(content) as { notesSettings?: Record<string, any> };
        const settings = config.notesSettings || {};
        const userKeys = Object.keys(settings);
        const matchedKey = userKeys.find((k) => isSameUser(k, currentUser)) || currentUser;
        return JSON.stringify(settings[matchedKey] || null);
      } catch (e) {
        logger.warn(`getNotesSettings failed: ${e}`);
        return '';
      }
    },
  );

  const saveNotesSettingsPromise = papi.commands.registerCommand(
    'paratextProjectManager.saveNotesSettings',
    async (currentUser: string, settingsJson: string): Promise<string> => {
      try {
        let config: Record<string, any> = {};
        const exists = await runFileHelper('exists', PM_USER_CONFIG_PATH);
        if (exists.trim() === 'true') {
          const content = await runFileHelper('read', PM_USER_CONFIG_PATH);
          config = JSON.parse(content);
        }
        if (!config.notesSettings) config.notesSettings = {};
        const userKeys = Object.keys(config.notesSettings);
        const matchedKey = userKeys.find((k) => isSameUser(k, currentUser)) || currentUser;
        config.notesSettings[matchedKey] = JSON.parse(settingsJson);
        await runFileHelper('write', PM_USER_CONFIG_PATH, JSON.stringify(config, null, 2));
        return 'ok';
      } catch (e) {
        logger.warn(`saveNotesSettings failed: ${e}`);
        return `error: ${e}`;
      }
    },
  );

  // Google Drive folder IDs cache for attachments and audios
  const driveAudioFolderIds: Record<string, string> = {};
  const driveAttachmentFolderIds: Record<string, string> = {};

  async function getDriveAudioFolderId(token: string, projectId: string): Promise<string> {
    if (driveAudioFolderIds[projectId]) return driveAudioFolderIds[projectId];
    const projectDir = await resolveProjectDir(projectId);
    const parts = projectDir.split(SEP);
    const projectName = parts[parts.length - 1] || projectId;
    const folderName = `Paratext PM Audios (${projectName})`;
    logger.info(`Project Manager: ensuring Google Drive folder exists: "${folderName}"`);
    const folderResStr = await runGcalHelper(
      'drive-get-or-create-folder',
      [token, folderName],
      undefined,
      15_000,
    );
    const res = JSON.parse(folderResStr) as { folderId: string };
    if (res.folderId) {
      driveAudioFolderIds[projectId] = res.folderId;
      logger.info(`Project Manager: Google Drive folder ID resolved: ${res.folderId}`);
      return res.folderId;
    }
    throw new Error(`Could not resolve Google Drive audio folder for project ${projectId}`);
  }

  async function getDriveAttachmentFolderId(token: string, projectId: string): Promise<string> {
    if (driveAttachmentFolderIds[projectId]) return driveAttachmentFolderIds[projectId];
    const projectDir = await resolveProjectDir(projectId);
    const parts = projectDir.split(SEP);
    const projectName = parts[parts.length - 1] || projectId;
    const folderName = `Paratext PM Attachments (${projectName})`;
    logger.info(`Project Manager: ensuring Google Drive folder exists: "${folderName}"`);
    const folderResStr = await runGcalHelper(
      'drive-get-or-create-folder',
      [token, folderName],
      undefined,
      15_000,
    );
    const res = JSON.parse(folderResStr) as { folderId: string };
    if (res.folderId) {
      driveAttachmentFolderIds[projectId] = res.folderId;
      logger.info(`Project Manager: Google Drive folder ID resolved: ${res.folderId}`);
      return res.folderId;
    }
    throw new Error(`Could not resolve Google Drive attachment folder for project ${projectId}`);
  }

  async function ensureAudioNoteLocally(projectId: string, filename: string): Promise<string> {
    const projectDir = await resolveProjectDir(projectId);
    const filePath = `${projectDir}${SEP}audio_notes${SEP}${filename}`;
    const exists = await sendToNotesHelper('exists', [filePath]);

    if (exists !== true) {
      logger.info(
        `Project Manager: audio file not found locally: ${filename}. Checking Google Drive...`,
      );
      try {
        const token = await getValidDriveToken();
        if (token) {
          const folderId = await getDriveAudioFolderId(token, projectId);
          let searchResStr = await runGcalHelper(
            'drive-search',
            [token, filename, folderId],
            undefined,
            10_000,
          );
          let searchResult = JSON.parse(searchResStr) as { fileId: string | null };
          if (!searchResult.fileId) {
            logger.info(
              `Project Manager: audio file ${filename} not found on Drive, trying ${filename}.base64`,
            );
            searchResStr = await runGcalHelper(
              'drive-search',
              [token, filename + '.base64', folderId],
              undefined,
              10_000,
            );
            searchResult = JSON.parse(searchResStr) as { fileId: string | null };
          }

          if (searchResult.fileId) {
            logger.info(
              `Project Manager: found audio file on Drive with ID ${searchResult.fileId}. Downloading...`,
            );
            const driveContent = await runGcalHelper(
              'drive-read',
              [token, searchResult.fileId],
              undefined,
              20_000,
            );
            await sendToNotesHelper('writeFile', [filePath, driveContent]);
            logger.info(`Project Manager: downloaded and saved audio note locally: ${filePath}`);
          } else {
            logger.warn(`Project Manager: audio file not found on Google Drive: ${filename}`);
          }
        }
      } catch (driveErr) {
        logger.warn(`Project Manager: failed to fetch audio note from Google Drive: ${driveErr}`);
      }
    }
    return filePath;
  }

  async function ensureAttachmentLocally(projectId: string, filename: string): Promise<string> {
    const projectDir = await resolveProjectDir(projectId);
    const filePath = `${projectDir}${SEP}attachments${SEP}${filename}`;
    const exists = await sendToNotesHelper('exists', [filePath]);

    if (exists !== true) {
      logger.info(
        `Project Manager: attachment file not found locally: ${filename}. Checking Google Drive...`,
      );
      try {
        const token = await getValidDriveToken();
        if (token) {
          const folderId = await getDriveAttachmentFolderId(token, projectId);
          let searchResStr = await runGcalHelper(
            'drive-search',
            [token, filename, folderId],
            undefined,
            10_000,
          );
          let searchResult = JSON.parse(searchResStr) as { fileId: string | null };
          if (!searchResult.fileId) {
            logger.info(
              `Project Manager: attachment file ${filename} not found on Drive, trying ${filename}.base64`,
            );
            searchResStr = await runGcalHelper(
              'drive-search',
              [token, filename + '.base64', folderId],
              undefined,
              10_000,
            );
            searchResult = JSON.parse(searchResStr) as { fileId: string | null };
          }

          if (searchResult.fileId) {
            logger.info(
              `Project Manager: found attachment file on Drive with ID ${searchResult.fileId}. Downloading...`,
            );
            const driveContent = await runGcalHelper(
              'drive-read',
              [token, searchResult.fileId],
              undefined,
              20_000,
            );
            await sendToNotesHelper('writeFile', [filePath, driveContent]);
            logger.info(`Project Manager: downloaded and saved attachment locally: ${filePath}`);
          } else {
            logger.warn(`Project Manager: attachment file not found on Google Drive: ${filename}`);
          }
        }
      } catch (driveErr) {
        logger.warn(`Project Manager: failed to fetch attachment from Google Drive: ${driveErr}`);
      }
    }
    return filePath;
  }

  const saveAudioNotePromise = papi.commands.registerCommand(
    'paratextProjectManager.saveAudioNote',
    async (
      projectId: string,
      filename: string,
      base64Data: string,
    ): Promise<{ status: string; fileId?: string; driveUrl?: string; error?: string }> => {
      let fileId: string | undefined;
      let driveUrl: string | undefined;
      try {
        const projectDir = await resolveProjectDir(projectId);
        await sendToNotesHelper('registerProjectDir', [projectId, projectDir]);
        await sendToNotesHelper('saveLocalAudioNote', [projectDir, filename, base64Data]);
        logger.info(`Project Manager: saved audio note file: ${filename}`);

        // Try uploading to Google Drive
        try {
          const token = await getValidDriveToken();
          if (token) {
            const folderId = await getDriveAudioFolderId(token, projectId);
            const res = await runGcalHelper(
              'drive-write',
              [token, '', filename, folderId],
              base64Data,
              30_000,
            );
            if (res) {
              const parsed = JSON.parse(res) as { fileId?: string };
              if (parsed.fileId) {
                fileId = parsed.fileId;
                driveUrl = `https://drive.google.com/open?id=${fileId}`;
              }
            }
          }
        } catch (driveErr) {
          logger.warn(`Project Manager: failed to upload audio note to Drive: ${driveErr}`);
        }

        return { status: 'ok', fileId, driveUrl };
      } catch (e) {
        logger.warn(`saveAudioNote failed: ${e}`);
        return { status: 'error', error: String(e) };
      }
    },
  );

  const getAudioNotePromise = papi.commands.registerCommand(
    'paratextProjectManager.getAudioNote',
    async (projectId: string, filename: string): Promise<string> => {
      try {
        const filePath = await ensureAudioNoteLocally(projectId, filename);
        const exists = await sendToNotesHelper('exists', [filePath]);
        if (exists !== true) {
          throw new Error(`Audio file not found: ${filePath}`);
        }
        const base64 = await sendToNotesHelper('readFileBase64', [filePath]);
        const parts = filename.split('.');
        const ext = parts[parts.length - 1].toLowerCase();
        let mime = 'audio/webm';
        if (ext === 'wav') mime = 'audio/wav';
        if (ext === 'mp3') mime = 'audio/mp3';
        if (ext === 'm4a') mime = 'audio/mp4';
        if (ext === 'ogg') mime = 'audio/ogg';
        return `data:${mime};base64,${base64}`;
      } catch (e) {
        logger.warn(`getAudioNote failed: ${e}`);
        return `error: ${e}`;
      }
    },
  );

  const saveAttachmentPromise = papi.commands.registerCommand(
    'paratextProjectManager.saveAttachment',
    async (
      projectId: string,
      filename: string,
      base64Data: string,
    ): Promise<{ status: string; fileId?: string; driveUrl?: string; error?: string }> => {
      let fileId: string | undefined;
      let driveUrl: string | undefined;
      try {
        const projectDir = await resolveProjectDir(projectId);
        await sendToNotesHelper('registerProjectDir', [projectId, projectDir]);
        await sendToNotesHelper('saveLocalAttachment', [projectDir, filename, base64Data]);
        logger.info(`Project Manager: saved attachment file: ${filename}`);

        // Try uploading to Google Drive
        try {
          const token = await getValidDriveToken();
          if (token) {
            const folderId = await getDriveAttachmentFolderId(token, projectId);
            const res = await runGcalHelper(
              'drive-write',
              [token, '', filename, folderId],
              base64Data,
              30_000,
            );
            if (res) {
              const parsed = JSON.parse(res) as { fileId?: string };
              if (parsed.fileId) {
                fileId = parsed.fileId;
                driveUrl = `https://drive.google.com/open?id=${fileId}`;
              }
            }
          }
        } catch (driveErr) {
          logger.warn(`Project Manager: failed to upload attachment to Drive: ${driveErr}`);
        }

        return { status: 'ok', fileId, driveUrl };
      } catch (e) {
        logger.warn(`saveAttachment failed: ${e}`);
        return { status: 'error', error: String(e) };
      }
    },
  );

  const getAttachmentPromise = papi.commands.registerCommand(
    'paratextProjectManager.getAttachment',
    async (projectId: string, filename: string): Promise<string> => {
      try {
        const filePath = await ensureAttachmentLocally(projectId, filename);
        const exists = await sendToNotesHelper('exists', [filePath]);
        if (exists !== true) {
          throw new Error(`Attachment file not found: ${filePath}`);
        }
        const base64 = await sendToNotesHelper('readFileBase64', [filePath]);
        const parts = filename.split('.');
        const ext = parts[parts.length - 1].toLowerCase();
        let mime = 'application/octet-stream';
        if (ext === 'png') mime = 'image/png';
        if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
        if (ext === 'webp') mime = 'image/webp';
        if (ext === 'gif') mime = 'image/gif';
        if (ext === 'pdf') mime = 'application/pdf';
        if (ext === 'txt') mime = 'text/plain; charset=utf-8';
        return `data:${mime};base64,${base64}`;
      } catch (e) {
        logger.warn(`getAttachment failed: ${e}`);
        return `error: ${e}`;
      }
    },
  );

  const openAttachmentPromise = papi.commands.registerCommand(
    'paratextProjectManager.openAttachment',
    async (projectId: string, filename: string): Promise<string> => {
      try {
        const filePath = await ensureAttachmentLocally(projectId, filename);
        const exists = await sendToNotesHelper('exists', [filePath]);
        if (exists !== true) {
          throw new Error(`Attachment file not found: ${filePath}`);
        }
        return await sendToNotesHelper('openPath', [filePath]);
      } catch (e) {
        logger.warn(`openAttachment failed: ${e}`);
        return `error: ${e}`;
      }
    },
  );

  const openExternalPromise = papi.commands.registerCommand(
    'paratextProjectManager.openExternal',
    async (url: string): Promise<string> => {
      try {
        return await sendToNotesHelper('openExternal', [url]);
      } catch (e) {
        logger.warn(`openExternal failed: ${e}`);
        return `error: ${e}`;
      }
    },
  );

  // --- Google Calendar commands ---

  /** Returns JSON { connected, email, calendarId, lastSync, clientId, hasCredentials } */
  const gcalGetStatusPromise = papi.commands.registerCommand(
    'paratextProjectManager.gcalGetStatus',
    async (): Promise<string> => {
      try {
        const config = await readGcalConfig();
        const accessToken = await getValidAccessToken();
        return JSON.stringify({
          connected: !!accessToken,
          email: config.userEmail,
          calendarId: config.calendarId,
          lastSync: config.lastSync,
          clientId: config.clientId, // let frontend pre-populate the Client ID field
          hasCredentials: !!(config.clientId && config.clientSecret), // enables one-click reconnect
        });
      } catch (_) {
        return JSON.stringify({
          connected: false,
          email: '',
          calendarId: 'primary',
          lastSync: '',
          clientId: '',
          hasCredentials: false,
        });
      }
    },
  );

  /**
   * Starts the OAuth flow: opens browser, waits for callback, exchanges code. Stores everything in
   * pm-gcal-config.json (no papi.settings). Returns JSON { success, email?, error? }
   */
  const gcalConnectPromise = papi.commands.registerCommand(
    'paratextProjectManager.gcalConnect',
    async (clientId: string, clientSecret: string): Promise<string> => {
      if (!clientId || !clientSecret)
        return JSON.stringify({ success: false, error: 'Se requiere Client ID y Client Secret' });
      // Persist credentials before starting the browser flow
      await writeGcalConfig({ clientId, clientSecret });
      startGcalAuthInBackground(clientId, clientSecret);
      return JSON.stringify({ status: 'started' });
    },
  );

  /**
   * Re-runs the OAuth flow using credentials already stored in pm-gcal-config.json. No arguments
   * needed — the user just clicks "Reconectar" without retyping credentials. Returns JSON {
   * success, email?, error? }
   */
  const gcalReconnectPromise = papi.commands.registerCommand(
    'paratextProjectManager.gcalReconnect',
    async (): Promise<string> => {
      const config = await readGcalConfig();
      if (!config.clientId || !config.clientSecret)
        return JSON.stringify({
          success: false,
          error:
            'No hay credenciales guardadas. Usa "Conectar" para ingresar el Client ID y Secret.',
        });
      startGcalAuthInBackground(config.clientId, config.clientSecret, config.refreshToken);
      return JSON.stringify({ status: 'started' });
    },
  );

  /** Returns current GCal auth status for polling during the OAuth browser flow. */
  const gcalPollAuthPromise = papi.commands.registerCommand(
    'paratextProjectManager.gcalPollAuth',
    (): string => JSON.stringify(gcalAuthState),
  );

  /** Clears all Google Calendar tokens. Returns 'ok'. */
  const gcalDisconnectPromise = papi.commands.registerCommand(
    'paratextProjectManager.gcalDisconnect',
    async (): Promise<string> => {
      try {
        await writeGcalConfig({
          accessToken: '',
          refreshToken: '',
          expiryDate: 0,
          userEmail: '',
          lastSync: '',
        });
        logger.info('Google Calendar: disconnected');
        return 'ok';
      } catch (e) {
        return `error: ${e}`;
      }
    },
  );

  /** Returns JSON array of { id, summary, primary } */
  const gcalListCalendarsPromise = papi.commands.registerCommand(
    'paratextProjectManager.gcalListCalendars',
    async (): Promise<string> => {
      try {
        const accessToken = await getValidAccessToken();
        if (!accessToken) return JSON.stringify([]);
        return await runGcalHelper('list-calendars', [accessToken]);
      } catch (e) {
        logger.warn(`gcalListCalendars failed: ${e}`);
        return JSON.stringify([]);
      }
    },
  );

  /** Sets the target calendar ID in config file. Returns 'ok'. */
  const gcalSetCalendarIdPromise = papi.commands.registerCommand(
    'paratextProjectManager.gcalSetCalendarId',
    async (calendarId: string): Promise<string> => {
      try {
        await writeGcalConfig({ calendarId });
        return 'ok';
      } catch (e) {
        return `error: ${e}`;
      }
    },
  );

  /** Syncs tasks with deadlines to Google Calendar. Returns JSON { synced, total, errors } */
  const gcalSyncDeadlinesPromise = papi.commands.registerCommand(
    'paratextProjectManager.gcalSyncDeadlines',
    async (projectId: string): Promise<string> => {
      try {
        const accessToken = await getValidAccessToken();
        if (!accessToken) {
          return JSON.stringify({
            synced: 0,
            total: 0,
            errors: ['No conectado a Google Calendar'],
          });
        }

        const config = await readGcalConfig();

        // Load tasks
        const tasksRaw = (await papi.commands.sendCommand(
          'paratextProjectManager.getTasks',
          projectId,
        )) as string;
        const store = JSON.parse(tasksRaw);
        const tasks = store.tasks || [];

        const stdinPayload = JSON.stringify({ accessToken, calendarId: config.calendarId, tasks });
        const result = await runGcalHelper('sync-deadlines', [], stdinPayload, 60 * 1000);

        await writeGcalConfig({ lastSync: new Date().toISOString() });

        logger.info(`Google Calendar sync: ${result}`);
        return result;
      } catch (e) {
        logger.warn(`gcalSyncDeadlines failed: ${e}`);
        return JSON.stringify({ synced: 0, total: 0, errors: [String(e)] });
      }
    },
  );

  /**
   * Fetches Google Calendar events for a date range. Returns JSON array of { id, summary, start,
   * end, description, allDay }
   */
  const gcalGetEventsPromise = papi.commands.registerCommand(
    'paratextProjectManager.gcalGetEvents',
    async (calendarId: string, timeMin: string, timeMax: string): Promise<string> => {
      try {
        const accessToken = await getValidAccessToken();
        if (!accessToken) return JSON.stringify([]);
        return await runGcalHelper(
          'list-events',
          [accessToken, calendarId || 'primary', timeMin, timeMax],
          undefined,
          15_000,
        );
      } catch (e) {
        logger.warn(`gcalGetEvents failed: ${e}`);
        return JSON.stringify([]);
      }
    },
  );

  /**
   * Deletes a single event from Google Calendar by event ID. Returns JSON { status: 'ok' | 'error',
   * error? }
   */
  const gcalDeleteEventPromise = papi.commands.registerCommand(
    'paratextProjectManager.gcalDeleteEvent',
    async (calendarId: string, eventId: string): Promise<string> => {
      try {
        const accessToken = await getValidAccessToken();
        if (!accessToken) return JSON.stringify({ status: 'error', error: 'No autenticado' });
        await runGcalHelper(
          'delete-event',
          [accessToken, calendarId || 'primary', eventId],
          undefined,
          10_000,
        );
        return JSON.stringify({ status: 'ok' });
      } catch (e) {
        logger.warn(`gcalDeleteEvent failed: ${e}`);
        return JSON.stringify({ status: 'error', error: String(e) });
      }
    },
  );

  /**
   * Syncs a single time entry to Google Calendar. If offline / no token: queues in pendingTimeSync.
   * Returns JSON { status: 'ok' | 'queued' }
   */
  const gcalSyncTimeEntryPromise = papi.commands.registerCommand(
    'paratextProjectManager.gcalSyncTimeEntry',
    async (timeEntryJson: string, taskLabel: string, calendarId: string): Promise<string> => {
      const pendingEntry: PendingTimeSyncEntry = {
        timeEntryJson,
        taskLabel,
        calendarId: calendarId || 'primary',
      };
      try {
        const accessToken = await getValidAccessToken();
        if (!accessToken) {
          await queuePendingTimeSync(pendingEntry);
          return JSON.stringify({ status: 'queued' });
        }
        const result = await runGcalHelper(
          'log-time-event',
          [accessToken, calendarId || 'primary', timeEntryJson, taskLabel],
          undefined,
          15_000,
        );
        // Remove from queue on success (if it was previously queued while offline)
        const config = await loadGcalConfig();
        if (config.pendingTimeSync?.length) {
          const parsed = JSON.parse(timeEntryJson) as { id: string };
          config.pendingTimeSync = config.pendingTimeSync.filter(
            (p) => (JSON.parse(p.timeEntryJson) as { id: string }).id !== parsed.id,
          );
          await saveGcalConfig(config);
        }
        return result;
      } catch (e) {
        logger.warn(`gcalSyncTimeEntry failed: ${e}`);
        await queuePendingTimeSync(pendingEntry);
        return JSON.stringify({ status: 'queued' });
      }
    },
  );

  /**
   * Flushes all queued (offline) time entries to Google Calendar. Returns JSON { synced: number,
   * remaining: number }
   */
  const gcalFlushPendingTimePromise = papi.commands.registerCommand(
    'paratextProjectManager.gcalFlushPendingTime',
    async (): Promise<string> => {
      const config = await loadGcalConfig();
      const pending = config.pendingTimeSync || [];
      if (!pending.length) return JSON.stringify({ synced: 0, remaining: 0 });
      const accessToken = await getValidAccessToken();
      if (!accessToken) return JSON.stringify({ synced: 0, remaining: pending.length });
      let synced = 0;
      const remaining: PendingTimeSyncEntry[] = [];
      for (const entry of pending) {
        try {
          await runGcalHelper(
            'log-time-event',
            [accessToken, entry.calendarId, entry.timeEntryJson, entry.taskLabel],
            undefined,
            15_000,
          );
          synced++;
        } catch (e) {
          logger.warn(`gcalFlushPendingTime: failed to sync entry: ${e}`);
          remaining.push(entry);
        }
      }
      config.pendingTimeSync = remaining;
      await saveGcalConfig(config);
      return JSON.stringify({ synced, remaining: remaining.length });
    },
  );

  /**
   * Writes content to the user's Downloads folder and opens it. Returns JSON { success, path?,
   * error? }
   */
  const saveToDownloadsPromise = papi.commands.registerCommand(
    'paratextProjectManager.saveToDownloads',
    async (filename: string, content: string): Promise<string> => {
      try {
        // Ensure Downloads folder exists
        await runFileHelper('mkdir', USER_DOWNLOADS_DIR);
        const filePath = `${USER_DOWNLOADS_DIR}${SEP}${filename}`;
        await runFileHelper('write', filePath, content);
        // Open with default application
        try {
          await runFileHelper('open', filePath);
        } catch (_) {
          /* non-critical */
        }
        logger.info(`Saved export to ${filePath}`);
        return JSON.stringify({ success: true, path: filePath });
      } catch (e) {
        logger.warn(`saveToDownloads failed: ${e}`);
        return JSON.stringify({ success: false, error: String(e) });
      }
    },
  );

  // --- Drive task sync commands ---

  /**
   * Starts the Drive OAuth flow in the background and returns immediately. The frontend polls
   * tasksDrivePollAuth to learn when it completes. This avoids papi's short JSON-RPC timeout
   * killing the long-lived browser auth wait.
   */
  const tasksDriveStartAuthPromise = papi.commands.registerCommand(
    'paratextProjectManager.tasksDriveStartAuth',
    async (clientId: string, clientSecret: string): Promise<string> => {
      if (!clientId || !clientSecret) {
        return JSON.stringify({ success: false, error: 'Se requiere Client ID y Client Secret' });
      }
      // Reset state before starting a new flow
      driveAuthPending = true;
      driveAuthResult = null;

      // Fire-and-forget — intentionally NOT awaited
      runGcalHelper('drive-auth-flow', [clientId, clientSecret], undefined, 6 * 60 * 1000)
        .then(async (result) => {
          const tokens = JSON.parse(result);
          await writeTasksDriveConfig({
            clientId,
            clientSecret,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token || '',
            expiryDate: tokens.expiry_date,
          });
          logger.info('Google Drive: connected for task sync');
          driveAuthPending = false;
          driveAuthResult = { success: true };
        })
        .catch((e) => {
          logger.warn(`tasksDriveStartAuth flow failed: ${e}`);
          driveAuthPending = false;
          driveAuthResult = { success: false, error: String(e) };
        });

      return JSON.stringify({ started: true });
    },
  );

  /**
   * Returns the current Drive auth state for frontend polling. status: 'pending' | 'success' |
   * 'error' | 'idle'
   */
  const tasksDrivePollAuthPromise = papi.commands.registerCommand(
    'paratextProjectManager.tasksDrivePollAuth',
    async (): Promise<string> => {
      if (driveAuthPending) return JSON.stringify({ status: 'pending' });
      if (driveAuthResult) {
        const result = driveAuthResult;
        driveAuthResult = null; // consume once
        return JSON.stringify({
          status: result.success ? 'success' : 'error',
          error: result.error,
        });
      }
      return JSON.stringify({ status: 'idle' });
    },
  );

  /** Returns { connected, hasCredentials, clientId, fileCount } */
  const tasksDriveGetStatusPromise = papi.commands.registerCommand(
    'paratextProjectManager.tasksDriveGetStatus',
    async (): Promise<string> => {
      try {
        const config = await readTasksDriveConfig();
        const token = await getValidDriveToken();
        return JSON.stringify({
          connected: !!token,
          hasCredentials: !!(config.clientId && config.clientSecret),
          clientId: config.clientId,
          fileCount: Object.keys(config.fileIds).length,
        });
      } catch (_) {
        return JSON.stringify({
          connected: false,
          hasCredentials: false,
          clientId: '',
          fileCount: 0,
        });
      }
    },
  );

  /** Returns the raw pm-tasks-config.json content for the admin to distribute to the team. */
  const tasksDriveExportConfigPromise = papi.commands.registerCommand(
    'paratextProjectManager.tasksDriveExportConfig',
    async (): Promise<string> => {
      try {
        const exists = await runFileHelper('exists', PM_TASKS_CONFIG_PATH);
        if (exists.trim() !== 'true')
          return JSON.stringify({ success: false, error: 'Drive no configurado' });
        const content = await runFileHelper('read', PM_TASKS_CONFIG_PATH);
        return JSON.stringify({ success: true, config: content });
      } catch (e) {
        return JSON.stringify({ success: false, error: String(e) });
      }
    },
  );

  /**
   * Lets a team member import the admin's pm-tasks-config.json by pasting the JSON. Writes the
   * config file directly — no OAuth flow needed on team machines.
   */
  const tasksDriveImportConfigPromise = papi.commands.registerCommand(
    'paratextProjectManager.tasksDriveImportConfig',
    async (configJson: string): Promise<string> => {
      try {
        const config = JSON.parse(configJson) as Partial<TasksDriveConfig>;
        if (!config.clientId || !config.refreshToken) {
          return JSON.stringify({
            success: false,
            error: 'Configuración inválida: faltan clientId o refreshToken',
          });
        }
        await runFileHelper('write', PM_TASKS_CONFIG_PATH, configJson);
        logger.info('Drive task config imported successfully');
        return JSON.stringify({ success: true });
      } catch (e) {
        return JSON.stringify({ success: false, error: String(e) });
      }
    },
  );

  /**
   * Force-syncs a specific project's local task file to Drive and returns detailed result. Reads
   * local tasks, writes to Drive, saves the fileId. Exposes the full error if it fails.
   */
  const tasksDriveForceSyncProjectPromise = papi.commands.registerCommand(
    'paratextProjectManager.tasksDriveForceSyncProject',
    async (projectId: string): Promise<string> => {
      try {
        // Step 1 — get token
        const token = await getValidDriveToken();
        if (!token) {
          return JSON.stringify({
            success: false,
            step: 'token',
            error: 'No se pudo obtener un token de Drive válido',
          });
        }

        // Step 2 — read local task file (or use empty store if missing)
        let tasksJson = JSON.stringify({ schemaVersion: 1, tasks: [] });
        try {
          const projectDir = await resolveProjectDir(projectId);
          const tasksPath = `${projectDir}${SEP}${TASKS_FILENAME}`;
          const exists = await runFileHelper('exists', tasksPath);
          if (exists.trim() === 'true') {
            tasksJson = await runFileHelper('read', tasksPath);
          }
        } catch (readErr) {
          return JSON.stringify({ success: false, step: 'read-local', error: String(readErr) });
        }

        // Step 3 — write to Drive
        const driveConfig = await readTasksDriveConfig();
        const existingFileId = driveConfig.fileIds[projectId] || '';
        const safeName = projectId.replace(/[^a-zA-Z0-9-]/g, '_');
        const fileName = `paratext-tasks-${safeName}.json`;
        const result = await runGcalHelper(
          'drive-write',
          [token, existingFileId, fileName],
          tasksJson,
          30_000,
        );
        const { fileId: newFileId } = JSON.parse(result) as { fileId: string };

        // Step 4 — persist fileId if new
        if (newFileId && newFileId !== existingFileId) {
          const updatedIds = { ...driveConfig.fileIds, [projectId]: newFileId };
          await writeTasksDriveConfig({ fileIds: updatedIds });
          logger.info(`Drive force-sync: created file ${newFileId} for "${projectId}"`);
        }

        return JSON.stringify({ success: true, fileId: newFileId, wasNew: !existingFileId });
      } catch (e) {
        return JSON.stringify({ success: false, step: 'drive-write', error: String(e) });
      }
    },
  );

  /**
   * Tries a real Drive write with a tiny test payload and returns the full result or error. Used by
   * the UI "Probar Drive" button so the user can see exactly what's failing.
   */
  const tasksDriveTestPromise = papi.commands.registerCommand(
    'paratextProjectManager.tasksDriveTest',
    async (): Promise<string> => {
      try {
        const token = await getValidDriveToken();
        if (!token) {
          const config = await readTasksDriveConfig();
          const hasRefresh = !!config.refreshToken;
          const hasClient = !!config.clientId;
          return JSON.stringify({
            success: false,
            step: 'token',
            error: `No se pudo obtener token. clientId:${hasClient} refreshToken:${hasRefresh}`,
          });
        }
        const testContent = JSON.stringify({ paratextPmTest: true, ts: Date.now() });
        const result = await runGcalHelper(
          'drive-write',
          [token, '', 'paratext-pm-connection-test.json'],
          testContent,
          20_000,
        );
        const { fileId } = JSON.parse(result) as { fileId: string };
        return JSON.stringify({ success: true, fileId });
      } catch (e) {
        return JSON.stringify({ success: false, step: 'drive-write', error: String(e) });
      }
    },
  );

  // Command: returns list of project IDs that have unsynced local changes
  const tasksDriveGetPendingSyncPromise = papi.commands.registerCommand(
    'paratextProjectManager.tasksDriveGetPendingSync',
    async (): Promise<string> => {
      const cfg = await readTasksDriveConfig();
      return JSON.stringify(cfg.pendingSyncProjects ?? []);
    },
  );

  /** Attempts to upload all pending-sync projects to Drive. Called by the retry loop. */
  async function flushPendingSyncToDrive(): Promise<void> {
    const cfg = await readTasksDriveConfig();
    const pending = cfg.pendingSyncProjects ?? [];
    if (pending.length === 0) return;

    const token = await getValidDriveToken();
    if (!token) return; // not authenticated — try again later

    const stillPending: string[] = [];
    for (const pid of pending) {
      try {
        const projectDir = await resolveProjectDir(pid);
        const tasksPath = `${projectDir}${SEP}${TASKS_FILENAME}`;
        const localJson = await runFileHelper('read', tasksPath);

        const freshCfg = await readTasksDriveConfig();
        const existingFileId = freshCfg.fileIds[pid] || '';
        const fileName = `paratext-tasks-${pid.replace(/[^a-zA-Z0-9-]/g, '_')}.json`;

        let contentToWrite = localJson;
        if (existingFileId) {
          try {
            const driveContent = await runGcalHelper(
              'drive-read',
              [token, existingFileId],
              undefined,
              15_000,
            );
            contentToWrite = mergeTaskStores(localJson, driveContent);
          } catch (_) {
            /* use local-only if Drive read fails */
          }
        }

        const result = await runGcalHelper(
          'drive-write',
          [token, existingFileId, fileName],
          contentToWrite,
          30_000,
        );
        const { fileId: newFileId } = JSON.parse(result) as { fileId: string };
        if (newFileId && newFileId !== existingFileId) {
          await writeTasksDriveConfig({ fileIds: { ...freshCfg.fileIds, [pid]: newFileId } });
        }
        logger.info(`Project Manager: background sync succeeded for "${pid}"`);
      } catch (err) {
        logger.warn(`Project Manager: background sync failed for "${pid}": ${err}`);
        stillPending.push(pid); // keep in queue, try again next cycle
      }
    }

    await writeTasksDriveConfig({ pendingSyncProjects: stillPending });
  }

  // Background retry loop: attempts to flush queued changes to Drive every 3 minutes
  const driveSyncRetryInterval = setInterval(
    () => {
      flushPendingSyncToDrive().catch(() => {
        /* ignore */
      });
    },
    3 * 60 * 1000,
  );
  context.registrations.add({ dispose: () => clearInterval(driveSyncRetryInterval) });

  // Await all registrations
  context.registrations.add(
    await taskBoardProviderPromise,
    await myTasksProviderPromise,
    await projectOverviewProviderPromise,
    await openTaskBoardPromise,
    await openMyTasksPromise,
    await openProjectOverviewPromise,
    await getTasksPromise,
    await saveTasksPromise,
    await getCurrentUserPromise,
    await setCurrentUserPromise,
    await gcalGetStatusPromise,
    await gcalConnectPromise,
    await gcalReconnectPromise,
    await gcalPollAuthPromise,
    await gcalDisconnectPromise,
    await gcalListCalendarsPromise,
    await gcalSetCalendarIdPromise,
    await gcalSyncDeadlinesPromise,
    await gcalGetEventsPromise,
    await gcalDeleteEventPromise,
    await gcalSyncTimeEntryPromise,
    await gcalFlushPendingTimePromise,
    await saveToDownloadsPromise,
    await tasksDriveStartAuthPromise,
    await tasksDrivePollAuthPromise,
    await tasksDriveGetStatusPromise,
    await tasksDriveExportConfigPromise,
    await tasksDriveImportConfigPromise,
    await tasksDriveTestPromise,
    await tasksDriveForceSyncProjectPromise,
    await tasksDriveGetPendingSyncPromise,
    await getTeamMembersPromise,
    await setTeamMembersPromise,
    await notesViewerProviderPromise,
    await scriptureViewerProviderPromise,
    await openNotesViewerPromise,
    await openScriptureViewerPromise,
    await getProjectNotesPromise,
    await saveProjectNotePromise,
    await deleteProjectNotePromise,
    await addNoteReplyPromise,
    await markNoteAsReadPromise,
    await getProjectBooksPromise,
    await getChapterTextPromise,
    await updateVerseTextPromise,
    await getNotesSettingsPromise,
    await saveNotesSettingsPromise,
    await saveAudioNotePromise,
    await getAudioNotePromise,
    await saveAttachmentPromise,
    await getAttachmentPromise,
    await openAttachmentPromise,
    await openExternalPromise,
    await navigateToVersePromise,
    await getLastNavigatedVersePromise,
    navigateToVerseEmitter,
    await startCollabHostPromise,
    await connectCollabClientPromise,
    await stopCollabPromise,
    await getCollabStatusPromise,
    await sendCollabChatPromise,
    await broadcastCursorPromise,
    collabEventEmitter,
  );

  logger.info('Project Manager extension finished activating!');
}

export async function deactivate(): Promise<boolean> {
  logger.info('Project Manager extension is deactivating!');
  return true;
}
