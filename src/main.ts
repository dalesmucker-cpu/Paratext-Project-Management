import papi, { logger } from '@papi/backend';
import type {
  ExecutionActivationContext,
  ElevatedPrivileges,
  IWebViewProvider,
  SavedWebViewDefinition,
  WebViewDefinition,
  ExecutionToken,
} from '@papi/core';

// Import bundled web views and their styles
import taskBoardWebView from './task-board.web-view?inline';
import taskBoardStyles from './task-board.web-view.scss?inline';
import myTasksWebView from './my-tasks.web-view?inline';
import myTasksStyles from './my-tasks.web-view.scss?inline';
import projectOverviewWebView from './project-overview.web-view?inline';
import projectOverviewStyles from './project-overview.web-view.scss?inline';
import type { PendingTimeSyncEntry } from './types/task.types';

const TASK_BOARD_TYPE = 'paratextProjectManager.taskBoard';
const MY_TASKS_TYPE = 'paratextProjectManager.myTasks';
const PROJECT_OVERVIEW_TYPE = 'paratextProjectManager.projectOverview';
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
const DEFAULT_PROJECTS_BASE =
  `${PARATEXT_STUDIO_DIR}${SEP}projects${SEP}Paratext 9 Projects`;

// File-based Google Calendar config (avoids papi.settings schema requirement)
const GCAL_CONFIG_PATH = `${PARATEXT_STUDIO_DIR}${SEP}pm-gcal-config.json`;
// File-based user config (more reliable than papi.settings for cross-restart persistence)
const PM_USER_CONFIG_PATH = `${PARATEXT_STUDIO_DIR}${SEP}pm-user-config.json`;
// Shared Drive config — same file distributed to all team machines
const PM_TASKS_CONFIG_PATH = `${PARATEXT_STUDIO_DIR}${SEP}pm-tasks-config.json`;
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
  clientId: '', clientSecret: '', accessToken: '', refreshToken: '',
  expiryDate: 0, fileIds: {}, pendingSyncProjects: [],
};

// Module-level references set during activate()
let processApi: NonNullable<ElevatedPrivileges['createProcess']> | undefined;
let execToken: ExecutionToken;

// Drive auth state — shared between tasksDriveStartAuth and tasksDrivePollAuth
let driveAuthPending = false;
let driveAuthResult: { success: boolean; error?: string } | null = null;

// GCal auth state — shared between gcalConnect/gcalReconnect and gcalPollAuth
let gcalAuthState: { status: 'idle' | 'pending' | 'success' | 'error'; email?: string; error?: string } = { status: 'idle' };

function startGcalAuthInBackground(clientId: string, clientSecret: string, existingRefreshToken?: string): void {
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
      } catch (_) { /* non-critical */ }
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
        try { child.kill(); } catch (_) { /* ignore */ }
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

function runGcalHelper(action: string, args: string[], stdinData?: string, timeoutMs?: number): Promise<string> {
  return runScript('assets/gcal-helper.js', [action, ...args], stdinData, timeoutMs);
}

// --- File-based gcal config (avoids papi.settings schema caching issues) ---

const GCAL_DEFAULTS: GcalConfig = {
  clientId: '', clientSecret: '', accessToken: '', refreshToken: '',
  expiryDate: 0, userEmail: '', calendarId: 'primary', lastSync: '',
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
 * - Tasks: per-task ID, keep whichever copy has the newer `updatedAt` timestamp.
 *   Tasks present on only one side are always kept.
 * - stageConfig: local (in-memory) copy wins — admin controls stage configuration.
 * - activityLog: union by entry id, sorted newest-first, capped at 200.
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

/** Returns a valid Drive access token, refreshing if expired. Empty string if not configured. */
async function getValidDriveToken(): Promise<string> {
  try {
    const config = await readTasksDriveConfig();
    if (!config.refreshToken || !config.clientId) return '';
    if (Date.now() < config.expiryDate - 5 * 60 * 1000) return config.accessToken;
    // Token expired — refresh it
    const result = await runGcalHelper('refresh', [config.clientId, config.clientSecret, config.refreshToken]);
    const data = JSON.parse(result);
    await writeTasksDriveConfig({ accessToken: data.access_token, expiryDate: data.expiry_date });
    return data.access_token;
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

    // Token expired — refresh it
    const result = await runGcalHelper('refresh', [config.clientId, config.clientSecret, config.refreshToken]);
    const data = JSON.parse(result);
    await writeGcalConfig({ accessToken: data.access_token, expiryDate: data.expiry_date });
    return data.access_token;
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
  } catch (_) { /* ignore */ }

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
 * OpenWebViewOptions does NOT include projectId (confirmed in papi.d.ts lines 612-640).
 * We use this registry to pass the selected projectId from open commands into getWebView,
 * which CAN set projectId on the returned WebViewDefinition.
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
      return papi.webViews.openWebView(TASK_BOARD_TYPE);
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
      return papi.webViews.openWebView(MY_TASKS_TYPE);
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
      return papi.webViews.openWebView(PROJECT_OVERVIEW_TYPE);
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

      // --- Also try Drive and MERGE (local pending offline changes must not be overwritten) ---
      try {
        const token = await getValidDriveToken();
        if (token) {
          const driveConfig = await readTasksDriveConfig();
          let fileId = driveConfig.fileIds[projectId];

          // If no cached fileId, search Drive by filename so team members auto-discover the file
          if (!fileId) {
            const safeName = projectId.replace(/[^a-zA-Z0-9-]/g, '_');
            const fileName = `paratext-tasks-${safeName}.json`;
            try {
              const searchResult = JSON.parse(
                await runGcalHelper('drive-search', [token, fileName], undefined, 10_000),
              ) as { fileId: string | null };
              if (searchResult.fileId) {
                fileId = searchResult.fileId;
                // Cache it locally so future reads are fast
                const updatedIds = { ...driveConfig.fileIds, [projectId]: fileId };
                await writeTasksDriveConfig({ fileIds: updatedIds });
                logger.info(`Project Manager: discovered Drive file ${fileId} for "${projectId}"`);
              }
            } catch (searchErr) {
              logger.warn(`Drive file search failed for "${projectId}": ${searchErr}`);
            }
          }

          if (fileId) {
            const driveContent = await runGcalHelper('drive-read', [token, fileId], undefined, 15_000);
            JSON.parse(driveContent); // validate

            if (localContent) {
              // Merge: per-task updatedAt wins — local offline changes are preserved
              const merged = mergeTaskStores(localContent, driveContent);
              // Write merged back to local so it stays current
              if (tasksPath) {
                try { await runFileHelper('write', tasksPath, merged); } catch (_) { /* ignore */ }
              }
              logger.info(`Project Manager: getTasks merged local+Drive for "${projectId}"`);
              return merged;
            }
            // No local file yet — use Drive as source of truth
            logger.info(`Project Manager: getTasks from Drive only for "${projectId}"`);
            return driveContent;
          }
        }
      } catch (driveErr) {
        logger.warn(`Drive getTasks failed, using local: ${driveErr}`);
      }

      // --- Local only (Drive not configured or failed) ---
      if (localContent) return localContent;
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

      // --- Also sync to Drive if configured (non-blocking on failure) ---
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
                'drive-read', [token, existingFileId], undefined, 15_000,
              );
              contentToWrite = mergeTaskStores(tasksJson, driveContent);
              logger.info(`Project Manager: merged local + Drive tasks for "${projectId}"`);
            } catch (readErr) {
              logger.warn(`Drive read-before-merge failed, writing local only: ${readErr}`);
            }
          }

          const result = await runGcalHelper(
            'drive-write', [token, existingFileId, fileName], contentToWrite, 30_000,
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
        } catch (_) { /* ignore — main save already succeeded */ }
        return 'queued';
      }

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
        } catch (_) { /* use empty config */ }
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
    'Noel', 'Jhoan', 'Anysa', 'Benjamín', 'Patricio', 'Nilska', 'Dale', 'Betsy', 'Familia',
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
      } catch (_) { /* fall through */ }
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
        } catch (_) { /* start fresh */ }
        config.teamMembers = members;
        await runFileHelper('write', PM_USER_CONFIG_PATH, JSON.stringify(config, null, 2));
        logger.info(`Project Manager: team members updated (${(members as string[]).length} members)`);
        return 'ok';
      } catch (e) {
        logger.warn(`setTeamMembers failed: ${e}`);
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
        return JSON.stringify({ connected: false, email: '', calendarId: 'primary', lastSync: '', clientId: '', hasCredentials: false });
      }
    },
  );

  /**
   * Starts the OAuth flow: opens browser, waits for callback, exchanges code.
   * Stores everything in pm-gcal-config.json (no papi.settings).
   * Returns JSON { success, email?, error? }
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
   * Re-runs the OAuth flow using credentials already stored in pm-gcal-config.json.
   * No arguments needed — the user just clicks "Reconectar" without retyping credentials.
   * Returns JSON { success, email?, error? }
   */
  const gcalReconnectPromise = papi.commands.registerCommand(
    'paratextProjectManager.gcalReconnect',
    async (): Promise<string> => {
      const config = await readGcalConfig();
      if (!config.clientId || !config.clientSecret)
        return JSON.stringify({ success: false, error: 'No hay credenciales guardadas. Usa "Conectar" para ingresar el Client ID y Secret.' });
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
          accessToken: '', refreshToken: '', expiryDate: 0,
          userEmail: '', lastSync: '',
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

  /**
   * Syncs tasks with deadlines to Google Calendar.
   * Returns JSON { synced, total, errors }
   */
  const gcalSyncDeadlinesPromise = papi.commands.registerCommand(
    'paratextProjectManager.gcalSyncDeadlines',
    async (projectId: string): Promise<string> => {
      try {
        const accessToken = await getValidAccessToken();
        if (!accessToken) {
          return JSON.stringify({ synced: 0, total: 0, errors: ['No conectado a Google Calendar'] });
        }

        const config = await readGcalConfig();

        // Load tasks
        const tasksRaw = await papi.commands.sendCommand('paratextProjectManager.getTasks', projectId) as string;
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
   * Fetches Google Calendar events for a date range.
   * Returns JSON array of { id, summary, start, end, description, allDay }
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

  /** Deletes a single event from Google Calendar by event ID. Returns JSON { status: 'ok' | 'error', error? } */
  const gcalDeleteEventPromise = papi.commands.registerCommand(
    'paratextProjectManager.gcalDeleteEvent',
    async (calendarId: string, eventId: string): Promise<string> => {
      try {
        const accessToken = await getValidAccessToken();
        if (!accessToken) return JSON.stringify({ status: 'error', error: 'No autenticado' });
        await runGcalHelper('delete-event', [accessToken, calendarId || 'primary', eventId], undefined, 10_000);
        return JSON.stringify({ status: 'ok' });
      } catch (e) {
        logger.warn(`gcalDeleteEvent failed: ${e}`);
        return JSON.stringify({ status: 'error', error: String(e) });
      }
    },
  );

  /**
   * Syncs a single time entry to Google Calendar.
   * If offline / no token: queues in pendingTimeSync.
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
   * Flushes all queued (offline) time entries to Google Calendar.
   * Returns JSON { synced: number, remaining: number }
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
   * Writes content to the user's Downloads folder and opens it.
   * Returns JSON { success, path?, error? }
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
        try { await runFileHelper('open', filePath); } catch (_) { /* non-critical */ }
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
   * Starts the Drive OAuth flow in the background and returns immediately.
   * The frontend polls tasksDrivePollAuth to learn when it completes.
   * This avoids papi's short JSON-RPC timeout killing the long-lived browser auth wait.
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
   * Returns the current Drive auth state for frontend polling.
   * status: 'pending' | 'success' | 'error' | 'idle'
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
        return JSON.stringify({ connected: false, hasCredentials: false, clientId: '', fileCount: 0 });
      }
    },
  );

  /** Returns the raw pm-tasks-config.json content for the admin to distribute to the team. */
  const tasksDriveExportConfigPromise = papi.commands.registerCommand(
    'paratextProjectManager.tasksDriveExportConfig',
    async (): Promise<string> => {
      try {
        const exists = await runFileHelper('exists', PM_TASKS_CONFIG_PATH);
        if (exists.trim() !== 'true') return JSON.stringify({ success: false, error: 'Drive no configurado' });
        const content = await runFileHelper('read', PM_TASKS_CONFIG_PATH);
        return JSON.stringify({ success: true, config: content });
      } catch (e) {
        return JSON.stringify({ success: false, error: String(e) });
      }
    },
  );

  /**
   * Lets a team member import the admin's pm-tasks-config.json by pasting the JSON.
   * Writes the config file directly — no OAuth flow needed on team machines.
   */
  const tasksDriveImportConfigPromise = papi.commands.registerCommand(
    'paratextProjectManager.tasksDriveImportConfig',
    async (configJson: string): Promise<string> => {
      try {
        const config = JSON.parse(configJson) as Partial<TasksDriveConfig>;
        if (!config.clientId || !config.refreshToken) {
          return JSON.stringify({ success: false, error: 'Configuración inválida: faltan clientId o refreshToken' });
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
   * Force-syncs a specific project's local task file to Drive and returns detailed result.
   * Reads local tasks, writes to Drive, saves the fileId. Exposes the full error if it fails.
   */
  const tasksDriveForceSyncProjectPromise = papi.commands.registerCommand(
    'paratextProjectManager.tasksDriveForceSyncProject',
    async (projectId: string): Promise<string> => {
      try {
        // Step 1 — get token
        const token = await getValidDriveToken();
        if (!token) {
          return JSON.stringify({ success: false, step: 'token', error: 'No se pudo obtener un token de Drive válido' });
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
          'drive-write', [token, existingFileId, fileName], tasksJson, 30_000,
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
   * Tries a real Drive write with a tiny test payload and returns the full result or error.
   * Used by the UI "Probar Drive" button so the user can see exactly what's failing.
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
          'drive-write', [token, '', 'paratext-pm-connection-test.json'], testContent, 20_000,
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
            const driveContent = await runGcalHelper('drive-read', [token, existingFileId], undefined, 15_000);
            contentToWrite = mergeTaskStores(localJson, driveContent);
          } catch (_) { /* use local-only if Drive read fails */ }
        }

        const result = await runGcalHelper('drive-write', [token, existingFileId, fileName], contentToWrite, 30_000);
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
    () => { flushPendingSyncToDrive().catch(() => { /* ignore */ }); },
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
  );

  logger.info('Project Manager extension finished activating!');
}

export async function deactivate(): Promise<boolean> {
  logger.info('Project Manager extension is deactivating!');
  return true;
}
