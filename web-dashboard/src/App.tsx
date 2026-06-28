import { useState, useEffect, useMemo } from 'react';
import {
  ChevronRight,
  Clock,
  Database,
  GitPullRequest,
  Key,
  Layout,
  LogOut,
  RefreshCw,
  Search,
  Send,
  Table,
  ThumbsDown,
  ThumbsUp,
  User,
  AlertCircle,
  Trash2,
  Edit2,
} from 'lucide-react';

// ---- Types & Constants ----

type TaskStatus = 'pending' | 'in-progress' | 'complete' | 'flagged';

const BIBLE_BOOKS = [
  'GEN',
  'EXO',
  'LEV',
  'NUM',
  'DEU',
  'JOS',
  'JDG',
  'RUT',
  '1SA',
  '2SA',
  '1KI',
  '2KI',
  '1CH',
  '2CH',
  'EZR',
  'NEH',
  'EST',
  'JOB',
  'PSA',
  'PRO',
  'ECC',
  'SNG',
  'ISA',
  'JER',
  'LAM',
  'EZK',
  'DAN',
  'HOS',
  'JOL',
  'AMO',
  'OBA',
  'JON',
  'MIC',
  'NAM',
  'HAB',
  'ZEP',
  'HAG',
  'ZEC',
  'MAL',
  'MAT',
  'MRK',
  'LUK',
  'JHN',
  'ACT',
  'ROM',
  '1CO',
  '2CO',
  'GAL',
  'EPH',
  'PHP',
  'COL',
  '1TH',
  '2TH',
  '1TI',
  '2TI',
  'TIT',
  'PHM',
  'HEB',
  'JAS',
  '1PE',
  '2PE',
  '1JN',
  '2JN',
  '3JN',
  'JUD',
  'REV',
] as const;

const STAGE_LABELS: Record<string, Record<string, string>> = {
  'primer-borrador': { es: 'Primer Borrador', en: 'First Draft' },
  revision1: { es: 'Revisión 1', en: 'Revision 1' },
  revision2: { es: 'Revisión 2', en: 'Revision 2' },
  'community-review': { es: 'Revisión en Comunidad', en: 'Community Review' },
  'back-translation': { es: 'Retrotraducción', en: 'Back Translation' },
  'back-translation-review': { es: 'Rev. Retrotraducción', en: 'Back Translation Review' },
  'answer-flags': { es: 'Contestar Banderas', en: 'Resolve Flags' },
  'translator-training': { es: 'Capacitación', en: 'Translator Training' },
  'consultant-review': { es: 'Revisión Consultor', en: 'Consultant Review' },
};

const STAGES = Object.keys(STAGE_LABELS);

interface StageConfig {
  label: string;
  order: number;
}

function getStageLabel(
  stage: string,
  lang: string,
  stageConfig?: Record<string, StageConfig>,
): string {
  if (stageConfig?.[stage]?.label) return stageConfig[stage].label;
  return STAGE_LABELS[stage]?.[lang] ?? STAGE_LABELS[stage]?.es ?? stage.replace(/^custom-/, '');
}

function getOrderedStages(stageConfig?: Record<string, StageConfig>): string[] {
  if (!stageConfig || Object.keys(stageConfig).length === 0) return [...STAGES];
  const customKeys = Object.keys(stageConfig).filter((k) => !STAGES.includes(k));
  const allStages = [...STAGES, ...customKeys];
  return allStages.sort((a, b) => {
    const orderA = stageConfig[a]?.order ?? STAGES.indexOf(a);
    const orderB = stageConfig[b]?.order ?? STAGES.indexOf(b);
    return orderA - orderB;
  });
}

/** Aggregate cell status for a (book, stage) combination */
function aggregateStatus(tasks: ProjectTask[]): TaskStatus | null {
  if (tasks.length === 0) return null;
  if (tasks.every((t) => t.status === 'complete')) return 'complete';
  if (tasks.some((t) => t.status === 'flagged')) return 'flagged';
  if (tasks.some((t) => t.status === 'in-progress')) return 'in-progress';
  return 'pending';
}

const CELL_ICONS: Record<TaskStatus, string> = {
  pending: '•',
  'in-progress': '⟳',
  complete: '✓',
  flagged: '⚑',
};

function getStatusLabel(status: TaskStatus, lang: string): string {
  const map: Record<TaskStatus, Record<string, string>> = {
    pending: { es: 'Pendiente', en: 'Pending' },
    'in-progress': { es: 'En Progreso', en: 'In Progress' },
    complete: { es: 'Completado', en: 'Completed' },
    flagged: { es: 'Bandera', en: 'Flagged' },
  };
  return map[status]?.[lang] ?? map[status]?.es ?? status;
}

const CONFIG_PASSCODE = 'slingshot2026'; // Change this to set a custom passcode for the hosted site

const TRANSLATIONS: Record<string, Record<string, string>> = {
  es: {
    projectsTitle: 'Mis Proyectos',
    projectsSub: 'Seleccione el proyecto de traducción para ver su tablero y pull requests.',
    nameInput: 'Nombre en Discusiones',
    roleInput: 'Rol / Relación',
    btnGoogle: 'Ingresar con Google',
    btnLogout: 'Cerrar Sesión',
    tabResumen: 'Resumen del Proyecto',
    tabTablero: 'Tablero',
    tabPrs: 'Pull Requests',
    searchBook: 'Buscar libro (MAT)',
    allPrs: 'Todas las PRs',
    totalProgress: 'Progreso Total',
    pending: 'Pendiente',
    inProgress: 'En Progreso',
    complete: 'Completado',
    flagged: 'Bandera',
    votedUp: 'Votado A Favor',
    votedDown: 'Votado En Contra',
    voteUp: 'A Favor',
    voteDown: 'En Contra',
    suggestAlt: 'Sugerir Traducción Alternativa',
    vote: 'Votar',
    voted: 'Votado',
    propose: 'Proponer',
    discussionTitle: 'Discusión y Comentarios',
    noComments: 'Sin comentarios. Inicie la conversación.',
    writeComment: 'Escriba un comentario o aclaración...',
    prevText: 'Texto Anterior',
    propText: 'Texto Propuesto',
    diffTitle: 'Comparativa de Versículos (Diff)',
    rationaleTitle: 'Justificación / Razón',
    overdue: 'vencido',
    noDeadline: 'Sin fecha',
    allStatus: 'Todos los Estados',
    consultant: 'Consultor',
    abtRep: 'Representante ABT',
    other: 'Otro',
    viewProject: 'Ver Proyecto',
    searchingDrive: 'Buscando archivos de proyectos en Google Drive...',
    noFilesFound: 'No se encontraron archivos de Paratext Project Manager.',
    makeSureSync:
      'Asegúrese de haber habilitado y sincronizado Google Drive desde la extensión de Paratext 10.',
    retry: 'Reintentar',
    googleClientId: 'Google OAuth Client ID',
    changeClientId: 'Cambiar Google Client ID (Avanzado)',
    privacyNote:
      'Este dashboard se ejecuta localmente en su navegador y se conecta de forma segura con la API de Google Drive sin servidores intermediarios.',
    invalidClientId: 'Por favor ingrese un Google Client ID válido.',
    googleSdkNotLoaded: 'El SDK de Google no está cargado aún. Espere un momento y reintente.',
    sessionExpired: 'Su sesión de Google ha expirado. Por favor inicie sesión nuevamente.',
    authError: 'Error de autenticación:',
    driveFetchError: 'Error obteniendo archivos de Drive:',
    projectLoadError: 'Error cargando datos del proyecto:',
    driveSaveError: 'Error al guardar en Drive:',
    projectCode: 'Código del proyecto:',
    code: 'Código:',
    proposedBy: 'Propuesto por:',
    created: 'Creado:',
    updated: 'Actualizado:',
    status: 'Estado:',
    selectPrLeft: 'Seleccione una PR del panel izquierdo',
    reviewPrDesc: 'Para revisar propuestas, votar o comentar.',
    votesUp: 'Votos a Favor',
    votesDown: 'Votos en Contra',
    enterAltSuggestion: 'Ingrese su propuesta alternativa...',
    cancel: 'Cancelar',
    save: 'Guardar',
    edit: 'Editar',
    delete: 'Eliminar',
    noTasks: 'Sin tareas',
    flaggedTasks: 'con bandera',
    inProgressTasks: 'en progreso',
    completeTasks: 'completo',
    total: 'Total',
    book: 'Libro',
    stage: 'Etapa',
    projects: 'Proyectos',
    votedFavor: 'Votado A Favor',
    votedAgainst: 'Votado En Contra',
    votingRole: 'Votación',
    enterPasscode: 'Ingrese la clave de acceso para entrar:',
    passcodeInvalid: 'Clave de acceso incorrecta.',
    unlockBtn: 'Desbloquear',
    lockTitle: 'Acceso Protegido',
    description: 'Descripción',
  },
  en: {
    projectsTitle: 'My Projects',
    projectsSub: 'Select the translation project to view its board and pull requests.',
    nameInput: 'Name in Discussions',
    roleInput: 'Role / Relationship',
    btnGoogle: 'Sign in with Google',
    btnLogout: 'Log Out',
    tabResumen: 'Project Overview',
    tabTablero: 'Board',
    tabPrs: 'Pull Requests',
    searchBook: 'Search book (MAT)',
    allPrs: 'All PRs',
    totalProgress: 'Total Progress',
    pending: 'Pending',
    inProgress: 'In Progress',
    complete: 'Completed',
    flagged: 'Flagged',
    votedUp: 'Voted in Favor',
    votedDown: 'Voted Against',
    voteUp: 'In Favor',
    voteDown: 'Against',
    suggestAlt: 'Suggest Alternative Translation',
    vote: 'Vote',
    voted: 'Voted',
    propose: 'Propose',
    discussionTitle: 'Discussion & Comments',
    noComments: 'No comments yet. Start the conversation.',
    writeComment: 'Write a comment or clarification...',
    prevText: 'Previous Text',
    propText: 'Proposed Text',
    diffTitle: 'Verse Comparison (Diff)',
    rationaleTitle: 'Justification / Reason',
    overdue: 'overdue',
    noDeadline: 'No deadline',
    allStatus: 'All Statuses',
    consultant: 'Consultant',
    abtRep: 'ABT Representative',
    other: 'Other',
    viewProject: 'View Project',
    searchingDrive: 'Searching for project files on Google Drive...',
    noFilesFound: 'No Paratext Project Manager files were found.',
    makeSureSync:
      'Make sure you have enabled and synced Google Drive from the Paratext 10 extension.',
    retry: 'Retry',
    googleClientId: 'Google OAuth Client ID',
    changeClientId: 'Change Google Client ID (Advanced)',
    privacyNote:
      'This dashboard runs locally in your browser and securely connects with the Google Drive API without intermediate servers.',
    invalidClientId: 'Please enter a valid Google Client ID.',
    googleSdkNotLoaded: 'The Google SDK is not loaded yet. Please wait a moment and retry.',
    sessionExpired: 'Your Google session has expired. Please sign in again.',
    authError: 'Authentication error:',
    driveFetchError: 'Error fetching files from Drive:',
    projectLoadError: 'Error loading project data:',
    driveSaveError: 'Error saving to Drive:',
    projectCode: 'Project code:',
    code: 'Code:',
    proposedBy: 'Proposed by:',
    created: 'Created:',
    updated: 'Updated:',
    status: 'Status:',
    selectPrLeft: 'Select a PR from the left panel',
    reviewPrDesc: 'To review proposals, vote, or comment.',
    votesUp: 'Votes in Favor',
    votesDown: 'Votes Against',
    enterAltSuggestion: 'Enter your alternative proposal...',
    cancel: 'Cancel',
    save: 'Save',
    edit: 'Edit',
    delete: 'Delete',
    noTasks: 'No tasks',
    flaggedTasks: 'flagged',
    inProgressTasks: 'in progress',
    completeTasks: 'complete',
    total: 'Total',
    book: 'Book',
    stage: 'Stage',
    projects: 'Projects',
    votedFavor: 'Voted in Favor',
    votedAgainst: 'Voted Against',
    votingRole: 'Voting',
    enterPasscode: 'Enter passcode to enter:',
    passcodeInvalid: 'Invalid passcode.',
    unlockBtn: 'Unlock',
    lockTitle: 'Protected Access',
    description: 'Description',
  },
};

// ---- Data Interfaces ----

interface ProjectTask {
  id: string;
  book: string;
  chapter: number;
  stage: string;
  assignedTo: string[];
  status: TaskStatus;
  notes: string;
  deadline?: string;
  estimatedHours?: number;
  loggedHours?: number;
}

interface TaskStore {
  tasks: ProjectTask[];
  stageConfig?: Record<string, StageConfig>;
}

interface PrVote {
  user: string;
  value: 'up' | 'down';
  reason?: string;
  role: 'translator' | 'consultant' | 'admin' | 'abt-rep' | 'other' | string;
  timestamp: string;
}

interface AlternativeRendering {
  id: string;
  text: string;
  proposedBy: string;
  votes: PrVote[];
  createdAt: string;
}

interface PrComment {
  id: string;
  author: string;
  text: string;
  timestamp: string;
}

interface PullRequest {
  id: number;
  ref?: { book: string; chapter: number; verse: number };
  refLabel: string;
  title: string;
  status: 'draft' | 'open' | 'needs-review' | 'approved' | 'merged' | 'closed' | 'expired';
  author: string;
  createdAt: string;
  updatedAt: string;
  originalText?: string;
  proposedText?: string;
  rationale?: string;
  votes: PrVote[];
  alternatives: AlternativeRendering[];
  comments: PrComment[];
  kind?: 'verse' | 'general';
  history?: {
    id: string;
    actor: string;
    action: string;
    detail?: string;
    timestamp: string;
  }[];
}

interface PullRequestsStore {
  prs: PullRequest[];
  nextId: number;
}

interface DriveFile {
  id: string;
  name: string;
  type: 'tasks' | 'prs';
  projectId: string;
}

interface ProjectData {
  id: string;
  name: string;
  tasksFileId?: string;
  prsFileId?: string;
  tasksStore?: TaskStore;
  prsStore?: PullRequestsStore;
}

// ---- Word Diff Utility ----

function diffWords(original: string, proposed: string) {
  if (!original) return [{ type: 'insert' as const, text: proposed }];
  if (!proposed) return [{ type: 'delete' as const, text: original }];

  const oWords = original.split(/(\s+)/);
  const pWords = proposed.split(/(\s+)/);
  const clean = (w: string) => w.trim();

  const n = oWords.length;
  const m = pWords.length;
  const dp: number[][] = Array(n + 1)
    .fill(0)
    .map(() => Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const co = clean(oWords[i - 1]);
      const cp = clean(pWords[j - 1]);
      if (co === cp && co !== '') {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result: { type: 'equal' | 'delete' | 'insert'; text: string }[] = [];
  let i = n,
    j = m;
  while (i > 0 || j > 0) {
    const co = clean(oWords[i - 1]);
    const cp = clean(pWords[j - 1]);
    if (i > 0 && j > 0 && co === cp && co !== '') {
      result.unshift({ type: 'equal', text: oWords[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'insert', text: pWords[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'delete', text: oWords[i - 1] });
      i--;
    }
  }
  return result;
}

// ---- PR Status Helper ----

function getPrStatusLabel(status: string) {
  const map: Record<string, string> = {
    draft: 'Borrador',
    open: 'Abierto',
    'needs-review': 'Requiere Revisión',
    approved: 'Aprobado',
    merged: 'Fusionado',
    closed: 'Cerrado',
    expired: 'Expirado',
  };
  return map[status] ?? status;
}

function getPrStatusColor(status: string) {
  const map: Record<string, string> = {
    draft: 'var(--pr-draft)',
    open: 'var(--pr-open)',
    'needs-review': 'var(--pr-review)',
    approved: 'var(--pr-review)',
    merged: 'var(--pr-merged)',
    closed: 'var(--pr-closed)',
    expired: 'var(--pr-expired)',
  };
  return map[status] ?? '#94a3b8';
}

function cleanProjectName(id: string, allIds: string[]): string {
  const hexPattern = /^[0-9a-fA-F]{24,40}/;
  const match = id.match(hexPattern);
  if (match) {
    const hex = match[0].toLowerCase();
    const suffix = id.substring(match[0].length);
    if (suffix.startsWith('-') && suffix.length > 1) {
      return suffix.substring(1).replace(/_/g, ' ');
    }
    // If just hex, check if any other project has the same hex prefix and a friendly name
    const matchingProj = allIds.find((otherId) => {
      if (otherId === id) return false;
      const otherMatch = otherId.match(hexPattern);
      return (
        otherMatch && otherMatch[0].toLowerCase() === hex && otherId.length > otherMatch[0].length
      );
    });
    if (matchingProj) {
      const otherMatch = matchingProj.match(hexPattern)!;
      const suffix = matchingProj.substring(otherMatch[0].length);
      if (suffix.startsWith('-') && suffix.length > 1) {
        let name = suffix.substring(1).replace(/_/g, ' ');
        if (name.toLowerCase().endsWith('-draft')) {
          name = name.substring(0, name.length - 6);
        } else if (name.toLowerCase().endsWith(' draft')) {
          name = name.substring(0, name.length - 6);
        }
        return name || 'Slingshot';
      }
    }
    return 'Slingshot';
  }
  return id.replace(/_/g, ' ');
}

function getRoleLabel(role: string): string {
  const map: Record<string, string> = {
    consultant: 'Consultor',
    'abt-rep': 'Representante ABT',
    other: 'Otro',
  };
  return map[role] ?? role;
}

// ==========================
// ===   MAIN APP COMPONENT
// ==========================

export default function App() {
  // --- Auth & Settings State ---
  const [clientId, setClientId] = useState(() => {
    const saved = localStorage.getItem('pm_oauth_client_id');
    if (saved) return saved;
    return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) || '';
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [username, setUsername] = useState(
    () => localStorage.getItem('pm_dashboard_user') || 'Consultor',
  );
  const [userRole, setUserRole] = useState(
    () => localStorage.getItem('pm_dashboard_role') || 'consultant',
  );
  const [accessToken, setAccessToken] = useState(
    () => localStorage.getItem('pm_dashboard_token') || '',
  );

  // --- Language State ---
  const [lang, setLang] = useState(() => localStorage.getItem('pm_dashboard_lang') || 'es');

  const t = (key: string): string => {
    return TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS['es']?.[key] ?? key;
  };

  // --- Passcode Gate State ---
  const [passcodeAttempt, setPasscodeAttempt] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(() => {
    if (!CONFIG_PASSCODE) return true;
    return localStorage.getItem('pm_dashboard_unlocked') === 'true';
  });
  const [passcodeError, setPasscodeError] = useState('');

  // --- Comment Editing State ---
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');

  // --- Project State ---
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Navigation ---
  const [activeTab, setActiveTab] = useState<'resumen' | 'tablero' | 'prs'>('resumen');

  // --- PR State ---
  const [selectedPrId, setSelectedPrId] = useState<number | null>(null);
  const [newComment, setNewComment] = useState('');
  const [newSuggestion, setNewSuggestion] = useState('');

  // --- Filters ---
  const [bookFilter, setBookFilter] = useState('');
  const [prStatusFilter, setPrStatusFilter] = useState<string>('all');

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const selectedPr = selectedProject?.prsStore?.prs.find((pr) => pr.id === selectedPrId);

  // --- Computed Data: Clean and Filtered Projects ---
  const filteredProjectsList = useMemo(() => {
    const hexPattern = /^[0-9a-fA-F]{24,40}/;
    const allIds = projects.map((p) => p.id);

    // Clean names
    const cleaned = projects.map((p) => {
      const displayName = cleanProjectName(p.id, allIds);
      return { ...p, displayName };
    });

    // Filter out redundant drafts
    return cleaned.filter((proj, _, arr) => {
      const match = proj.id.match(hexPattern);
      if (match) {
        const hex = match[0].toLowerCase();
        const isDraft = proj.id.toLowerCase().includes('draft');
        if (isDraft) {
          const hasMain = arr.some((other) => {
            const otherMatch = other.id.match(hexPattern);
            return (
              otherMatch &&
              otherMatch[0].toLowerCase() === hex &&
              !other.id.toLowerCase().includes('draft')
            );
          });
          if (hasMain) return false;
        }
      }
      return true;
    });
  }, [projects]);

  // --- Computed Data: Resumen ---
  const orderedStages = useMemo(
    () => getOrderedStages(selectedProject?.tasksStore?.stageConfig),
    [selectedProject?.tasksStore?.stageConfig],
  );

  const allTasks = selectedProject?.tasksStore?.tasks ?? [];

  const booksInUse = useMemo(() => {
    const filtered = BIBLE_BOOKS.filter((b) => allTasks.some((t) => t.book === b));
    if (!bookFilter) return filtered;
    return filtered.filter((b) => b.toLowerCase().includes(bookFilter.toLowerCase()));
  }, [allTasks, bookFilter]);

  const summaryGrid = useMemo(() => {
    const map: Record<string, Record<string, ProjectTask[]>> = {};
    for (const book of booksInUse) {
      map[book] = {};
      for (const stage of orderedStages) {
        map[book][stage] = allTasks.filter((t) => t.book === book && t.stage === stage);
      }
    }
    return map;
  }, [booksInUse, orderedStages, allTasks]);

  const stageSummary = useMemo(() => {
    const summary: Record<
      string,
      { total: number; complete: number; flagged: number; inProgress: number }
    > = {};
    for (const stage of orderedStages) {
      const stageTasks = allTasks.filter((t) => t.stage === stage);
      summary[stage] = {
        total: stageTasks.length,
        complete: stageTasks.filter((t) => t.status === 'complete').length,
        flagged: stageTasks.filter((t) => t.status === 'flagged').length,
        inProgress: stageTasks.filter((t) => t.status === 'in-progress').length,
      };
    }
    return summary;
  }, [allTasks, orderedStages]);

  const totalTasks = allTasks.length;
  const completedTasks = allTasks.filter((t) => t.status === 'complete').length;
  const inProgressTasks = allTasks.filter((t) => t.status === 'in-progress').length;
  const flaggedTasks = allTasks.filter((t) => t.status === 'flagged').length;
  const pendingTasks = totalTasks - completedTasks - inProgressTasks - flaggedTasks;
  const pctComplete = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // --- Computed Data: Tablero (kanban by stage) ---
  const kanbanByStage = useMemo(() => {
    const map: Record<string, ProjectTask[]> = {};
    for (const stage of orderedStages) {
      let stageTasks = allTasks.filter((t) => t.stage === stage);

      // Apply book filter
      if (bookFilter) {
        stageTasks = stageTasks.filter((t) =>
          t.book.toLowerCase().includes(bookFilter.toLowerCase()),
        );
      }

      // Sort: flagged first, then in-progress, pending, complete; then by book order, chapter
      stageTasks.sort((a, b) => {
        const statusOrder: Record<TaskStatus, number> = {
          flagged: 0,
          'in-progress': 1,
          pending: 2,
          complete: 3,
        };
        const sa = statusOrder[a.status] ?? 4;
        const sb = statusOrder[b.status] ?? 4;
        if (sa !== sb) return sa - sb;

        const bookIdxA = (BIBLE_BOOKS as readonly string[]).indexOf(a.book);
        const bookIdxB = (BIBLE_BOOKS as readonly string[]).indexOf(b.book);
        if (bookIdxA !== bookIdxB) return bookIdxA - bookIdxB;
        return a.chapter - b.chapter;
      });

      map[stage] = stageTasks;
    }
    return map;
  }, [orderedStages, allTasks, bookFilter]);

  // --- Filtered PRs ---
  const filteredPrs =
    selectedProject?.prsStore?.prs.filter((pr) => {
      const matchesBook = bookFilter
        ? pr.refLabel.toLowerCase().includes(bookFilter.toLowerCase())
        : true;
      const matchesStatus = prStatusFilter !== 'all' ? pr.status === prStatusFilter : true;
      return matchesBook && matchesStatus;
    }) || [];

  // ==========================
  // ===   AUTH / DRIVE LOGIC
  // ==========================

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  useEffect(() => {
    if (accessToken) fetchProjectsFromDrive();
  }, [accessToken]);

  const saveSetup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId.trim()) {
      setError('Por favor ingrese un Google Client ID válido.');
      return;
    }
    localStorage.setItem('pm_oauth_client_id', clientId);
    localStorage.setItem('pm_dashboard_user', username);
    localStorage.setItem('pm_dashboard_role', userRole);
    triggerGoogleAuth();
  };

  const triggerGoogleAuth = () => {
    try {
      // @ts-ignore
      if (!window.google?.accounts?.oauth2) {
        setError('El SDK de Google no está cargado aún. Espere un momento y reintente.');
        return;
      }
      setError(null);
      // @ts-ignore
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive',
        callback: (tokenResponse: any) => {
          if (tokenResponse.error) {
            setError(
              `Error de autenticación: ${tokenResponse.error_description || tokenResponse.error}`,
            );
            return;
          }
          if (tokenResponse.access_token) {
            setAccessToken(tokenResponse.access_token);
            localStorage.setItem('pm_dashboard_token', tokenResponse.access_token);
          }
        },
      });
      client.requestAccessToken();
    } catch (e) {
      setError(`Error inicializando OAuth client: ${e}`);
    }
  };

  const handleLogout = () => {
    setAccessToken('');
    localStorage.removeItem('pm_dashboard_token');
    setSelectedProjectId(null);
    setProjects([]);
  };

  const fetchProjectsFromDrive = async () => {
    setLoading(true);
    setError(null);
    try {
      const query =
        "trashed = false and (name contains 'paratext-tasks-' or name contains 'paratext-prs-')";
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name)`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (response.status === 401) {
        handleLogout();
        setError('Su sesión de Google ha expirado. Por favor inicie sesión nuevamente.');
        setLoading(false);
        return;
      }

      if (!response.ok) throw new Error(`Google Drive API error: ${response.statusText}`);

      const data = await response.json();
      const files: DriveFile[] = (data.files || [])
        .map((f: any) => {
          const isTasks = f.name.startsWith('paratext-tasks-');
          const isPrs = f.name.startsWith('paratext-prs-');
          let projectId = '';
          if (isTasks) projectId = f.name.replace('paratext-tasks-', '').replace('.json', '');
          if (isPrs) projectId = f.name.replace('paratext-prs-', '').replace('.json', '');
          return { id: f.id, name: f.name, type: isTasks ? 'tasks' : 'prs', projectId };
        })
        .filter((f: any) => f.projectId !== '');

      const projectMap: Record<string, ProjectData> = {};
      files.forEach((file) => {
        if (!projectMap[file.projectId]) {
          projectMap[file.projectId] = {
            id: file.projectId,
            name: file.projectId.replace(/_/g, ' '),
          };
        }
        if (file.type === 'tasks') projectMap[file.projectId].tasksFileId = file.id;
        else if (file.type === 'prs') projectMap[file.projectId].prsFileId = file.id;
      });

      setProjects(Object.values(projectMap));
    } catch (err: any) {
      setError(`Error obteniendo archivos de Drive: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadProjectData = async (project: ProjectData) => {
    setLoading(true);
    setError(null);
    try {
      let tasksStore: TaskStore | undefined;
      let prsStore: PullRequestsStore | undefined;

      if (project.tasksFileId) {
        const tasksRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${project.tasksFileId}?alt=media`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (tasksRes.ok) tasksStore = await tasksRes.json();
      }

      if (project.prsFileId) {
        const prsRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${project.prsFileId}?alt=media`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (prsRes.ok) prsStore = await prsRes.json();
      }

      setProjects((prev) =>
        prev.map((p) => (p.id === project.id ? { ...p, tasksStore, prsStore } : p)),
      );

      setSelectedProjectId(project.id);
      setSelectedPrId((prev) => {
        if (prev == null) return prev;
        return prsStore?.prs?.some((pr) => pr.id === prev) ? prev : null;
      });
    } catch (err: any) {
      setError(`Error cargando datos del proyecto: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ==========================
  // ===   PR ACTIONS
  // ==========================

  const savePrsToDrive = async (updatedStore: PullRequestsStore) => {
    if (!selectedProject || !selectedProject.prsFileId) return;
    setLoading(true);
    try {
      const response = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${selectedProject.prsFileId}?uploadType=media`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updatedStore, null, 2),
        },
      );
      if (!response.ok) throw new Error(`Drive update failed: ${response.statusText}`);
      setProjects((prev) =>
        prev.map((p) => (p.id === selectedProjectId ? { ...p, prsStore: updatedStore } : p)),
      );
    } catch (err: any) {
      setError(`Error al guardar en Drive: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleVotePr = async (value: 'up' | 'down') => {
    if (!selectedProject || !selectedPr || !selectedProject.prsStore) return;
    const now = new Date().toISOString();

    const existingVote = selectedPr.votes.find((v) => v.user === username);
    const isRetraction = existingVote && existingVote.value === value;

    const updatedPrs = selectedProject.prsStore.prs.map((pr) => {
      if (pr.id === selectedPr.id) {
        const cleanVotes = pr.votes.filter((v) => v.user !== username);
        const votes = isRetraction
          ? cleanVotes
          : [...cleanVotes, { user: username, value, role: userRole, timestamp: now }];

        const history = [
          ...(pr.history || []),
          {
            id: `h-${Date.now()}`,
            actor: username,
            action: isRetraction ? 'vote_retracted' : value === 'up' ? 'upvoted' : 'downvoted',
            detail: isRetraction
              ? `Retractó su voto ${value === 'up' ? 'A Favor' : 'En Contra'}.`
              : `Votó ${value === 'up' ? 'A Favor' : 'En Contra'} de la propuesta.`,
            timestamp: now,
          },
        ];
        return { ...pr, votes, history, updatedAt: now };
      }
      return pr;
    });

    await savePrsToDrive({ ...selectedProject.prsStore, prs: updatedPrs });
  };

  const handleAddSuggestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSuggestion.trim() || !selectedProject || !selectedPr || !selectedProject.prsStore)
      return;
    const now = new Date().toISOString();
    const altId = `alt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newAlt: AlternativeRendering = {
      id: altId,
      text: newSuggestion,
      proposedBy: username,
      votes: [],
      createdAt: now,
    };

    const updatedPrs = selectedProject.prsStore.prs.map((pr) => {
      if (pr.id === selectedPr.id) {
        const history = [
          ...(pr.history || []),
          {
            id: `h-${Date.now()}`,
            actor: username,
            action: 'alternative_added',
            detail: `Sugirió alternativa: "${newSuggestion}"`,
            timestamp: now,
          },
        ];
        return {
          ...pr,
          alternatives: [...(pr.alternatives || []), newAlt],
          history,
          updatedAt: now,
        };
      }
      return pr;
    });

    setNewSuggestion('');
    await savePrsToDrive({ ...selectedProject.prsStore, prs: updatedPrs });
  };

  const handleVoteAlternative = async (altId: string) => {
    if (!selectedProject || !selectedPr || !selectedProject.prsStore) return;
    const now = new Date().toISOString();

    const updatedPrs = selectedProject.prsStore.prs.map((pr) => {
      if (pr.id === selectedPr.id) {
        const alternatives = pr.alternatives.map((alt) => {
          if (alt.id === altId) {
            const hasVoted = alt.votes?.some((v) => v.user === username);
            const cleanVotes = (alt.votes || []).filter((v) => v.user !== username);
            const votes = hasVoted
              ? cleanVotes
              : [
                  ...cleanVotes,
                  { user: username, value: 'up' as const, role: userRole, timestamp: now },
                ];
            return { ...alt, votes };
          }
          return alt;
        });
        return { ...pr, alternatives, updatedAt: now };
      }
      return pr;
    });

    await savePrsToDrive({ ...selectedProject.prsStore, prs: updatedPrs });
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !selectedProject || !selectedPr || !selectedProject.prsStore) return;
    const now = new Date().toISOString();
    const comment: PrComment = {
      id: `c-${Date.now()}`,
      author: username,
      text: newComment,
      timestamp: now,
    };

    const updatedPrs = selectedProject.prsStore.prs.map((pr) => {
      if (pr.id === selectedPr.id) {
        return { ...pr, comments: [...(pr.comments || []), comment], updatedAt: now };
      }
      return pr;
    });

    setNewComment('');
    await savePrsToDrive({ ...selectedProject.prsStore, prs: updatedPrs });
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!selectedProject || !selectedPr || !selectedProject.prsStore) return;
    const now = new Date().toISOString();

    const updatedPrs = selectedProject.prsStore.prs.map((pr) => {
      if (pr.id === selectedPr.id) {
        const comments = (pr.comments || []).filter((c) => c.id !== commentId);
        return { ...pr, comments, updatedAt: now };
      }
      return pr;
    });

    await savePrsToDrive({ ...selectedProject.prsStore, prs: updatedPrs });
  };

  const handleUpdateComment = async (commentId: string, newText: string) => {
    if (!selectedProject || !selectedPr || !selectedProject.prsStore) return;
    const now = new Date().toISOString();

    const updatedPrs = selectedProject.prsStore.prs.map((pr) => {
      if (pr.id === selectedPr.id) {
        const comments = (pr.comments || []).map((c) => {
          if (c.id === commentId) {
            return { ...c, text: newText, timestamp: now };
          }
          return c;
        });
        return { ...pr, comments, updatedAt: now };
      }
      return pr;
    });

    setEditingCommentId(null);
    setEditingCommentText('');
    await savePrsToDrive({ ...selectedProject.prsStore, prs: updatedPrs });
  };

  // ==========================
  // ===   DEADLINE HELPERS
  // ==========================

  function getDeadlineInfo(deadline?: string) {
    if (!deadline) return { label: t('noDeadline'), className: '' };
    const d = new Date(deadline);
    const now = new Date();
    const diffDays = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const label = d.toLocaleDateString(lang, { day: 'numeric', month: 'short' });
    if (diffDays < 0) return { label: `${label} (${t('overdue')})`, className: 'overdue' };
    if (diffDays <= 7) return { label, className: 'soon' };
    return { label, className: '' };
  }

  // ==========================
  // ===   RENDER: PASSCODE GATE
  // ==========================

  const handleVerifyPasscode = (e: React.FormEvent) => {
    e.preventDefault();
    if (passcodeAttempt.toLowerCase() === CONFIG_PASSCODE.toLowerCase()) {
      setIsUnlocked(true);
      localStorage.setItem('pm_dashboard_unlocked', 'true');
      setPasscodeError('');
    } else {
      setPasscodeError(t('passcodeInvalid'));
    }
  };

  if (CONFIG_PASSCODE && !isUnlocked) {
    return (
      <>
        <div className="bg-glow-container">
          <div className="glow-blob glow-blob-1"></div>
          <div className="glow-blob glow-blob-2"></div>
          <div className="glow-blob glow-blob-3"></div>
        </div>
        <div
          className="app-container"
          style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}
        >
          <div className="glass" style={{ width: '100%', maxWidth: '400px', padding: '40px' }}>
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <h1 style={{ fontSize: '1.5rem', marginBottom: '8px' }}>{t('lockTitle')}</h1>
              <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>{t('enterPasscode')}</p>
            </div>

            {passcodeError && (
              <div
                style={{
                  padding: '10px 12px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: '8px',
                  color: '#fca5a5',
                  fontSize: '0.85rem',
                  marginBottom: '16px',
                  textAlign: 'center',
                }}
              >
                {passcodeError}
              </div>
            )}

            <form
              onSubmit={handleVerifyPasscode}
              style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
            >
              <input
                type="password"
                placeholder="••••••••"
                value={passcodeAttempt}
                onChange={(e) => setPasscodeAttempt(e.target.value)}
                required
                style={{ textAlign: 'center', fontSize: '1.2rem', letterSpacing: '0.2em' }}
              />
              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {t('unlockBtn')}
              </button>
            </form>
          </div>
        </div>
      </>
    );
  }

  // ==========================
  // ===   RENDER: AUTH SCREEN
  // ==========================

  if (!accessToken) {
    return (
      <>
        <div className="bg-glow-container">
          <div className="glow-blob glow-blob-1"></div>
          <div className="glow-blob glow-blob-2"></div>
          <div className="glow-blob glow-blob-3"></div>
        </div>
        <div
          className="app-container"
          style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}
        >
          <div className="glass" style={{ width: '100%', maxWidth: '480px', padding: '40px' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '-20px' }}>
              <button
                onClick={() => {
                  const newLang = lang === 'es' ? 'en' : 'es';
                  setLang(newLang);
                  localStorage.setItem('pm_dashboard_lang', newLang);
                }}
                className="btn"
                style={{ padding: '6px 10px', fontSize: '0.75rem' }}
              >
                🌐 {lang === 'es' ? 'EN' : 'ES'}
              </button>
            </div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <div
                style={{
                  display: 'inline-flex',
                  padding: '16px',
                  background: 'rgba(129, 140, 248, 0.1)',
                  borderRadius: '24px',
                  marginBottom: '16px',
                  border: '1px solid rgba(129, 140, 248, 0.2)',
                }}
              >
                <Database size={32} style={{ color: '#818cf8' }} />
              </div>
              <h1 style={{ fontSize: '1.8rem', marginBottom: '8px' }}>Tablero & PR Dashboard</h1>
              <p style={{ color: '#94a3b8', fontSize: '0.95rem' }}>{t('projectsSub')}</p>
            </div>

            {error && (
              <div
                style={{
                  padding: '12px 16px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: '12px',
                  color: '#fca5a5',
                  fontSize: '0.9rem',
                  marginBottom: '20px',
                  display: 'flex',
                  gap: '8px',
                }}
              >
                <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>{error}</div>
              </div>
            )}

            <form
              onSubmit={saveSetup}
              style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}
            >
              {!clientId || showAdvanced ? (
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      color: '#94a3b8',
                      marginBottom: '8px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {t('googleClientId')}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Key
                      size={18}
                      style={{ position: 'absolute', left: '16px', top: '15px', color: '#64748b' }}
                    />
                    <input
                      type="text"
                      placeholder="Ingrese Client ID"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      style={{ paddingLeft: '48px' }}
                      required
                    />
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'right', marginTop: '-10px' }}>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(true)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#818cf8',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      fontFamily: 'inherit',
                    }}
                  >
                    {t('changeClientId')}
                  </button>
                </div>
              )}

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    color: '#94a3b8',
                    marginBottom: '8px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  {t('nameInput')}
                </label>
                <div style={{ position: 'relative' }}>
                  <User
                    size={18}
                    style={{ position: 'absolute', left: '16px', top: '15px', color: '#64748b' }}
                  />
                  <input
                    type="text"
                    placeholder="Ej: Consultor Perez"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    style={{ paddingLeft: '48px' }}
                    required
                  />
                </div>
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    color: '#94a3b8',
                    marginBottom: '8px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  {t('roleInput')}
                </label>
                <select value={userRole} onChange={(e) => setUserRole(e.target.value)} required>
                  <option value="consultant">{t('consultant')}</option>
                  <option value="abt-rep">{t('abtRep')}</option>
                  <option value="other">{t('other')}</option>
                </select>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', padding: '14px' }}
              >
                {t('btnGoogle')}
              </button>
            </form>

            <div
              style={{
                marginTop: '24px',
                borderTop: '1px solid var(--border-color)',
                paddingTop: '20px',
                fontSize: '0.8rem',
                color: '#64748b',
                textAlign: 'center',
              }}
            >
              {t('privacyNote')}
            </div>
          </div>
        </div>
      </>
    );
  }

  // ==========================
  // ===   RENDER: PROJECT SELECTOR
  // ==========================

  if (selectedProjectId === null) {
    return (
      <>
        <div className="bg-glow-container">
          <div className="glow-blob glow-blob-1"></div>
          <div className="glow-blob glow-blob-2"></div>
          <div className="glow-blob glow-blob-3"></div>
        </div>
        <div className="app-container">
          <header className="dashboard-header">
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 700 }} className="gradient-text">
                {t('projectsTitle')}
              </h1>
              <p style={{ color: '#94a3b8', fontSize: '0.95rem' }}>{t('projectsSub')}</p>
            </div>
            <div className="dashboard-header-right">
              <button
                onClick={() => {
                  const newLang = lang === 'es' ? 'en' : 'es';
                  setLang(newLang);
                  localStorage.setItem('pm_dashboard_lang', newLang);
                }}
                className="btn"
                style={{ padding: '8px 12px', fontSize: '0.85rem' }}
              >
                🌐 {lang === 'es' ? 'EN' : 'ES'}
              </button>
              <span
                style={{
                  color: '#94a3b8',
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <User size={16} /> {username} ({getRoleLabel(userRole)})
              </span>
              <button onClick={handleLogout} className="btn" style={{ padding: '8px 12px' }}>
                <LogOut size={16} /> {t('btnLogout')}
              </button>
            </div>
          </header>

          {error && (
            <div
              className="glass"
              style={{
                padding: '16px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#fca5a5',
                marginBottom: '24px',
                display: 'flex',
                gap: '12px',
              }}
            >
              <AlertCircle size={20} />
              <div>{error}</div>
            </div>
          )}

          {loading ? (
            <div style={{ display: 'grid', placeItems: 'center', height: '200px' }}>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <RefreshCw size={32} className="spin" style={{ color: 'var(--primary)' }} />
                <span className="pulse" style={{ color: '#94a3b8' }}>
                  {t('searchingDrive')}
                </span>
              </div>
            </div>
          ) : projects.length === 0 ? (
            <div
              className="glass"
              style={{ textAlign: 'center', padding: '60px 40px', color: '#94a3b8' }}
            >
              <Database size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
              <p style={{ fontSize: '1.1rem', marginBottom: '8px' }}>{t('noFilesFound')}</p>
              <p style={{ fontSize: '0.9rem', color: '#64748b' }}>{t('makeSureSync')}</p>
              <button
                onClick={fetchProjectsFromDrive}
                className="btn"
                style={{ marginTop: '20px' }}
              >
                <RefreshCw size={14} /> {t('retry')}
              </button>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '24px',
              }}
            >
              {filteredProjectsList.map((proj) => (
                <div
                  key={proj.id}
                  onClick={() => loadProjectData(proj)}
                  className="glass glass-interactive"
                  style={{
                    padding: '24px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    minHeight: '160px',
                  }}
                >
                  <div>
                    <h3
                      style={{
                        fontSize: '1.25rem',
                        marginBottom: '12px',
                        textTransform: 'capitalize',
                      }}
                    >
                      {proj.displayName}
                    </h3>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        fontSize: '0.85rem',
                        color: '#94a3b8',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Layout size={14} /> {t('tabTablero')}:{' '}
                        {proj.tasksFileId
                          ? '✓ ' + (lang === 'es' ? 'Disponible' : 'Available')
                          : '❌ ' + (lang === 'es' ? 'No configurado' : 'Not configured')}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <GitPullRequest size={14} /> {t('tabPrs')}:{' '}
                        {proj.prsFileId
                          ? '✓ ' + (lang === 'es' ? 'Disponible' : 'Available')
                          : '❌ ' + (lang === 'es' ? 'No configurado' : 'Not configured')}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '0.9rem',
                        color: 'var(--primary)',
                      }}
                    >
                      {t('viewProject')} <ChevronRight size={16} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </>
    );
  }

  // ==========================
  // ===   RENDER: PROJECT VIEW
  // ==========================

  if (!selectedProject) return null;

  return (
    <>
      <div className="bg-glow-container">
        <div className="glow-blob glow-blob-1"></div>
        <div className="glow-blob glow-blob-2"></div>
        <div className="glow-blob glow-blob-3"></div>
      </div>
      <div className="app-container" style={{ paddingBottom: '80px' }}>
        {/* Header */}
        <header className="dashboard-header">
          <div className="dashboard-header-left">
            <button
              onClick={() => setSelectedProjectId(null)}
              className="btn"
              style={{ padding: '8px 12px', fontSize: '0.85rem' }}
            >
              ← {t('projects')}
            </button>
            <div>
              <h1
                style={{ fontSize: '1.6rem', fontWeight: 700, textTransform: 'capitalize' }}
                className="gradient-text"
              >
                {cleanProjectName(
                  selectedProject.id,
                  projects.map((p) => p.id),
                )}
              </h1>
              <p style={{ color: '#94a3b8', fontSize: '0.82rem' }}>
                {t('code')} {selectedProject.id}
              </p>
            </div>
          </div>
          <div className="dashboard-header-right">
            <button
              onClick={() => {
                const newLang = lang === 'es' ? 'en' : 'es';
                setLang(newLang);
                localStorage.setItem('pm_dashboard_lang', newLang);
              }}
              className="btn"
              style={{ padding: '8px 12px', fontSize: '0.85rem' }}
            >
              🌐 {lang === 'es' ? 'EN' : 'ES'}
            </button>
            <button
              onClick={() => loadProjectData(selectedProject)}
              className="btn btn-icon"
              title="Recargar de Drive"
            >
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
            </button>
            <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
              {username} ({getRoleLabel(userRole)})
            </span>
            <button
              onClick={handleLogout}
              className="btn"
              style={{ padding: '8px 12px', fontSize: '0.85rem' }}
            >
              {t('btnLogout')}
            </button>
          </div>
        </header>

        {error && (
          <div
            className="glass"
            style={{
              padding: '12px 16px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              color: '#fca5a5',
              marginBottom: '20px',
              display: 'flex',
              gap: '8px',
              fontSize: '0.9rem',
            }}
          >
            <AlertCircle size={18} />
            <div>{error}</div>
          </div>
        )}

        {/* Tab Bar + Filters */}
        <div className="filters-row">
          <div className="tab-bar">
            <button
              onClick={() => setActiveTab('resumen')}
              className={`tab-btn ${activeTab === 'resumen' ? 'active' : ''}`}
            >
              <Table size={16} /> {t('tabResumen')}
            </button>
            <button
              onClick={() => setActiveTab('tablero')}
              className={`tab-btn ${activeTab === 'tablero' ? 'active' : ''}`}
            >
              <Layout size={16} /> {t('tabTablero')}
            </button>
            <button
              onClick={() => setActiveTab('prs')}
              className={`tab-btn ${activeTab === 'prs' ? 'active' : ''}`}
            >
              <GitPullRequest size={16} /> {t('tabPrs')} (
              {selectedProject.prsStore?.prs.length || 0})
            </button>
          </div>

          <div className="filter-group">
            <div className="search-input-wrapper">
              <Search size={16} />
              <input
                type="text"
                placeholder={t('searchBook')}
                value={bookFilter}
                onChange={(e) => setBookFilter(e.target.value)}
              />
            </div>
            {activeTab === 'prs' && (
              <select
                value={prStatusFilter}
                onChange={(e) => setPrStatusFilter(e.target.value)}
                style={{ padding: '8px 16px', fontSize: '0.85rem', width: '160px' }}
              >
                <option value="all">{t('allPrs')}</option>
                <option value="open">{lang === 'es' ? 'Abierta' : 'Open'}</option>
                <option value="needs-review">
                  {lang === 'es' ? 'Requiere Revisión' : 'Needs Review'}
                </option>
                <option value="approved">{lang === 'es' ? 'Aprobada' : 'Approved'}</option>
                <option value="merged">{lang === 'es' ? 'Fusionada' : 'Merged'}</option>
                <option value="closed">{lang === 'es' ? 'Cerrada' : 'Closed'}</option>
                <option value="expired">{lang === 'es' ? 'Expirada' : 'Expired'}</option>
              </select>
            )}
          </div>
        </div>

        {/* Loading overlay */}
        {loading && !selectedProject.tasksStore && !selectedProject.prsStore ? (
          <div style={{ display: 'grid', placeItems: 'center', height: '300px' }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <RefreshCw size={28} className="spin" style={{ color: 'var(--primary)' }} />
              <span className="pulse" style={{ color: '#94a3b8' }}>
                Descargando información...
              </span>
            </div>
          </div>
        ) : (
          <>
            {/* ========================================= */}
            {/* ===   TAB: RESUMEN DEL PROYECTO         */}
            {/* ========================================= */}
            {activeTab === 'resumen' &&
              (!selectedProject.tasksStore ? (
                <div className="glass empty-state">
                  <Layout size={32} />
                  <p>
                    {lang === 'es'
                      ? 'No se encontraron datos del proyecto en Google Drive.'
                      : 'No project data found on Google Drive.'}
                  </p>
                </div>
              ) : (
                <div>
                  {/* Progress Stats Bar */}
                  <div className="stats-bar">
                    <div className="glass stat-card">
                      <div
                        className="stat-indicator"
                        style={{ background: 'var(--primary)' }}
                      ></div>
                      <div>
                        <div className="stat-label">{t('totalProgress')}</div>
                        <div className="stat-value">
                          {pctComplete}%
                          <span className="stat-pct">
                            {completedTasks}/{totalTasks}
                          </span>
                        </div>
                        <div className="progress-bar-outer">
                          <div
                            className="progress-bar-fill"
                            style={{ width: `${pctComplete}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                    {[
                      {
                        key: 'pending' as const,
                        label: t('pending'),
                        count: pendingTasks,
                        color: 'var(--status-pending)',
                      },
                      {
                        key: 'in-progress' as const,
                        label: t('inProgress'),
                        count: inProgressTasks,
                        color: 'var(--status-in-progress)',
                      },
                      {
                        key: 'flagged' as const,
                        label: t('flagged'),
                        count: flaggedTasks,
                        color: 'var(--status-flagged)',
                      },
                      {
                        key: 'complete' as const,
                        label: t('complete'),
                        count: completedTasks,
                        color: 'var(--status-complete)',
                      },
                    ].map(({ key, label, count, color }) => (
                      <div key={key} className="glass stat-card">
                        <div className="stat-indicator" style={{ background: color }}></div>
                        <div>
                          <div className="stat-label">{label}</div>
                          <div className="stat-value">
                            {count}
                            <span className="stat-pct">
                              {totalTasks > 0 ? Math.round((count / totalTasks) * 100) : 0}%
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Matrix Table */}
                  <div className="glass" style={{ overflow: 'hidden' }}>
                    {totalTasks === 0 ? (
                      <p style={{ textAlign: 'center', color: '#64748b', padding: '40px 0' }}>
                        {lang === 'es'
                          ? 'No hay tareas para mostrar en el resumen.'
                          : 'No tasks to show in summary.'}
                      </p>
                    ) : (
                      <>
                        <div className="matrix-wrapper">
                          <table className="matrix-table">
                            <thead>
                              <tr>
                                <th>{t('book')}</th>
                                {orderedStages.map((stage) => {
                                  const s = stageSummary[stage];
                                  const allComplete = s && s.total > 0 && s.complete === s.total;
                                  const hasFlagged = s && s.flagged > 0;
                                  return (
                                    <th
                                      key={stage}
                                      title={getStageLabel(
                                        stage,
                                        lang,
                                        selectedProject.tasksStore?.stageConfig,
                                      )}
                                    >
                                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {getStageLabel(
                                          stage,
                                          lang,
                                          selectedProject.tasksStore?.stageConfig,
                                        )}
                                      </div>
                                      {s && s.total > 0 && (
                                        <span
                                          className="stage-count"
                                          style={{
                                            color: allComplete
                                              ? '#34d399'
                                              : hasFlagged
                                                ? '#f87171'
                                                : '#64748b',
                                          }}
                                        >
                                          {s.complete}/{s.total}
                                        </span>
                                      )}
                                    </th>
                                  );
                                })}
                              </tr>
                            </thead>
                            <tbody>
                              {booksInUse.map((book) => (
                                <tr key={book}>
                                  <td>{book}</td>
                                  {orderedStages.map((stage) => {
                                    const cellTasks = summaryGrid[book]?.[stage] ?? [];
                                    const status = aggregateStatus(cellTasks);
                                    return (
                                      <td
                                        key={stage}
                                        title={
                                          cellTasks.length > 0
                                            ? `${book} — ${getStageLabel(stage, lang, selectedProject.tasksStore?.stageConfig)}: ${cellTasks.length} ${cellTasks.length !== 1 ? (lang === 'es' ? 'tareas' : 'tasks') : lang === 'es' ? 'tarea' : 'task'} (${getStatusLabel(status!, lang)})`
                                            : ''
                                        }
                                      >
                                        {status && (
                                          <span className={`cell-badge status-${status}`}>
                                            {CELL_ICONS[status]}
                                            {cellTasks.length > 1 && <sup>{cellTasks.length}</sup>}
                                          </span>
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr>
                                <td>{t('total')}</td>
                                {orderedStages.map((stage) => {
                                  const s = stageSummary[stage];
                                  return (
                                    <td
                                      key={stage}
                                      style={{
                                        textAlign: 'center',
                                        color:
                                          s.total === 0
                                            ? '#475569'
                                            : s.complete === s.total
                                              ? '#34d399'
                                              : '#cbd5e1',
                                      }}
                                    >
                                      {s.total > 0 ? `${s.complete}/${s.total}` : ''}
                                    </td>
                                  );
                                })}
                              </tr>
                            </tfoot>
                          </table>
                        </div>

                        {/* Legend */}
                        <div className="matrix-legend">
                          <span className="legend-item">
                            <span
                              className="legend-dot"
                              style={{ background: 'var(--status-complete)' }}
                            ></span>
                            ✓ {t('complete')}
                          </span>
                          <span className="legend-item">
                            <span
                              className="legend-dot"
                              style={{ background: 'var(--status-in-progress)' }}
                            ></span>
                            ⟳ {t('inProgress')}
                          </span>
                          <span className="legend-item">
                            <span
                              className="legend-dot"
                              style={{ background: 'var(--status-pending)' }}
                            ></span>
                            • {t('pending')}
                          </span>
                          <span className="legend-item">
                            <span
                              className="legend-dot"
                              style={{ background: 'var(--status-flagged)' }}
                            ></span>
                            ⚑ {t('flagged')}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}

            {/* ========================================= */}
            {/* ===   TAB: TABLERO (Stage-Column Kanban) */}
            {/* ========================================= */}
            {activeTab === 'tablero' &&
              (!selectedProject.tasksStore ? (
                <div className="glass empty-state">
                  <Layout size={32} />
                  <p>
                    {lang === 'es'
                      ? 'No se encontraron datos del Tablero en Google Drive.'
                      : 'No Board data found on Google Drive.'}
                  </p>
                </div>
              ) : (
                <div>
                  {/* Summary line */}
                  <div style={{ marginBottom: '12px', fontSize: '0.85rem', color: '#94a3b8' }}>
                    {pctComplete}% {lang === 'es' ? 'completo' : 'complete'} — {completedTasks}/
                    {totalTasks} {lang === 'es' ? 'tareas' : 'tasks'}
                    {inProgressTasks > 0 && (
                      <>
                        {' '}
                        ·{' '}
                        <span style={{ color: 'var(--status-in-progress)' }}>
                          ⟳ {inProgressTasks} {t('inProgressTasks')}
                        </span>
                      </>
                    )}
                    {flaggedTasks > 0 && (
                      <>
                        {' '}
                        ·{' '}
                        <span style={{ color: 'var(--status-flagged)' }}>
                          ⚑ {flaggedTasks} {t('flaggedTasks')}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Kanban board — one column per STAGE */}
                  <div className="kanban-container">
                    {orderedStages.map((stage) => {
                      const stageTasks = kanbanByStage[stage] || [];
                      const stageLabel = getStageLabel(
                        stage,
                        lang,
                        selectedProject.tasksStore?.stageConfig,
                      );
                      const stageComplete = stageTasks.filter(
                        (t) => t.status === 'complete',
                      ).length;
                      const allDone = stageTasks.length > 0 && stageComplete === stageTasks.length;

                      return (
                        <div
                          key={stage}
                          className="kanban-column"
                          style={{
                            borderTopColor: allDone ? 'rgba(16, 185, 129, 0.3)' : undefined,
                          }}
                        >
                          {/* Column header */}
                          <div
                            className="kanban-column-header"
                            style={{
                              borderBottomColor: allDone ? 'rgba(16, 185, 129, 0.3)' : undefined,
                            }}
                          >
                            <span className="kanban-column-title" title={stageLabel}>
                              {stageLabel}
                            </span>
                            <span
                              className="kanban-column-count"
                              style={{
                                color: allDone ? '#34d399' : undefined,
                              }}
                            >
                              {stageComplete}/{stageTasks.length}
                            </span>
                          </div>

                          {/* Column body — task cards */}
                          <div className="kanban-column-body">
                            {stageTasks.length === 0 ? (
                              <div className="kanban-empty">{t('noTasks')}</div>
                            ) : (
                              stageTasks.map((task) => {
                                const deadlineInfo = getDeadlineInfo(task.deadline);
                                return (
                                  <div
                                    key={task.id}
                                    className="kanban-card"
                                    style={{
                                      borderLeftColor:
                                        task.status === 'flagged'
                                          ? 'rgba(239, 68, 68, 0.5)'
                                          : undefined,
                                      borderLeftWidth:
                                        task.status === 'flagged' ? '3px' : undefined,
                                    }}
                                  >
                                    <div className="kanban-card-header">
                                      <span className="kanban-card-ref">
                                        {task.book} {task.chapter}
                                      </span>
                                      <span className={`status-pill ${task.status}`}>
                                        {CELL_ICONS[task.status]}{' '}
                                        {getStatusLabel(task.status, lang)}
                                      </span>
                                    </div>

                                    {task.notes && (
                                      <div className="kanban-card-notes">{task.notes}</div>
                                    )}

                                    <div className="kanban-card-footer">
                                      <span className={`deadline-text ${deadlineInfo.className}`}>
                                        <Clock size={11} /> {deadlineInfo.label}
                                      </span>

                                      {task.assignedTo && task.assignedTo.length > 0 && (
                                        <div className="avatar-stack">
                                          {task.assignedTo.slice(0, 3).map((name, idx) => (
                                            <span
                                              key={name}
                                              className="avatar"
                                              style={{
                                                background: `hsl(${(idx * 137 + name.charCodeAt(0) * 47) % 360}, 45%, 55%)`,
                                              }}
                                              title={name}
                                            >
                                              {name.substring(0, 2).toUpperCase()}
                                            </span>
                                          ))}
                                          {task.assignedTo.length > 3 && (
                                            <span
                                              className="avatar"
                                              style={{ background: '#475569' }}
                                              title={task.assignedTo.slice(3).join(', ')}
                                            >
                                              +{task.assignedTo.length - 3}
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </div>

                                    {task.estimatedHours || task.loggedHours ? (
                                      <div
                                        style={{
                                          fontSize: '0.72rem',
                                          color: '#64748b',
                                          marginTop: '6px',
                                          display: 'flex',
                                          gap: '4px',
                                          alignItems: 'center',
                                        }}
                                      >
                                        ⏱ {task.loggedHours ?? 0}h
                                        {task.estimatedHours ? ` / ${task.estimatedHours}h` : ''}
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

            {/* ========================================= */}
            {/* ===   TAB: PULL REQUESTS                 */}
            {/* ========================================= */}
            {activeTab === 'prs' &&
              (!selectedProject.prsStore ? (
                <div className="glass empty-state">
                  <GitPullRequest size={32} />
                  <p>
                    {lang === 'es'
                      ? 'No se encontraron datos de Pull Requests en Google Drive.'
                      : 'No Pull Request data found on Google Drive.'}
                  </p>
                </div>
              ) : (
                <div className="pr-layout">
                  {/* PR Sidebar List */}
                  <div className="glass pr-sidebar">
                    <div className="pr-sidebar-title">
                      {t('tabPrs')} ({filteredPrs.length})
                    </div>
                    <div className="pr-list">
                      {filteredPrs.length === 0 ? (
                        <div
                          style={{
                            textAlign: 'center',
                            padding: '30px 10px',
                            color: '#64748b',
                            fontSize: '0.85rem',
                          }}
                        >
                          {lang === 'es'
                            ? 'Ningún Pull Request coincide con los filtros.'
                            : 'No Pull Requests match the filters.'}
                        </div>
                      ) : (
                        filteredPrs.map((pr) => {
                          const isActive = pr.id === selectedPrId;
                          const prColor = getPrStatusColor(pr.status);
                          const upvoteCount = pr.votes?.filter((v) => v.value === 'up').length || 0;

                          return (
                            <div
                              key={pr.id}
                              onClick={() => setSelectedPrId(pr.id)}
                              className={`glass pr-card ${isActive ? 'active' : ''}`}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  marginBottom: '6px',
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: '0.75rem',
                                    fontWeight: 600,
                                    color: prColor,
                                    background: `${prColor}15`,
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                  }}
                                >
                                  {getPrStatusLabel(pr.status)}
                                </span>
                                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                  #{pr.id}
                                </span>
                              </div>
                              <h4
                                style={{ fontSize: '0.95rem', marginBottom: '8px', color: '#fff' }}
                              >
                                {pr.refLabel}
                              </h4>
                              <p
                                style={{
                                  fontSize: '0.85rem',
                                  color: '#94a3b8',
                                  whiteSpace: 'nowrap',
                                  textOverflow: 'ellipsis',
                                  overflow: 'hidden',
                                  marginBottom: '6px',
                                }}
                              >
                                {pr.title}
                              </p>
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  fontSize: '0.8rem',
                                  color: '#64748b',
                                }}
                              >
                                <span>
                                  {t('proposedBy')} {pr.author}
                                </span>
                                {upvoteCount > 0 && (
                                  <span
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      color: 'var(--status-complete)',
                                    }}
                                  >
                                    <ThumbsUp size={12} /> {upvoteCount}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* PR Detail View */}
                  <div>
                    {!selectedPr ? (
                      <div
                        className="glass"
                        style={{
                          height: '350px',
                          display: 'grid',
                          placeItems: 'center',
                          color: '#94a3b8',
                          textAlign: 'center',
                        }}
                      >
                        <div>
                          <GitPullRequest
                            size={48}
                            style={{ opacity: 0.3, marginBottom: '16px' }}
                          />
                          <p style={{ fontSize: '1.1rem' }}>{t('selectPrLeft')}</p>
                          <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '4px' }}>
                            {t('reviewPrDesc')}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="glass"
                        style={{
                          padding: '24px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '24px',
                        }}
                      >
                        {/* PR Header */}
                        <div
                          style={{
                            borderBottom: '1px solid var(--border-color)',
                            paddingBottom: '16px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                          }}
                        >
                          <div>
                            <div
                              style={{
                                display: 'flex',
                                gap: '8px',
                                alignItems: 'center',
                                marginBottom: '8px',
                              }}
                            >
                              <span style={{ fontSize: '1.3rem', fontWeight: 700 }}>
                                {selectedPr.refLabel}
                              </span>
                              <span
                                className="glass"
                                style={{
                                  fontSize: '0.75rem',
                                  padding: '2px 8px',
                                  color: 'var(--primary)',
                                }}
                              >
                                PR #{selectedPr.id}
                              </span>
                            </div>
                            <h2 style={{ fontSize: '1.1rem', color: '#f8fafc', fontWeight: 500 }}>
                              {selectedPr.title}
                            </h2>
                            <div
                              style={{
                                display: 'flex',
                                gap: '16px',
                                color: '#64748b',
                                fontSize: '0.85rem',
                                marginTop: '8px',
                                flexWrap: 'wrap',
                              }}
                            >
                              <span>
                                {t('proposedBy')} <strong>{selectedPr.author}</strong>
                              </span>
                              <span>
                                {t('created')}{' '}
                                {new Date(selectedPr.createdAt).toLocaleDateString(lang)}
                              </span>
                              <span>
                                {t('updated')}{' '}
                                {new Date(selectedPr.updatedAt).toLocaleDateString(lang)}
                              </span>
                            </div>
                          </div>
                          <span
                            className="glass"
                            style={{
                              fontSize: '0.85rem',
                              fontWeight: 600,
                              padding: '6px 12px',
                              color: getPrStatusColor(selectedPr.status),
                              background:
                                selectedPr.status === 'merged'
                                  ? 'rgba(16,185,129,0.1)'
                                  : 'rgba(59,130,246,0.1)',
                            }}
                          >
                            {t('status')} {getPrStatusLabel(selectedPr.status)}
                          </span>
                        </div>

                        {/* Rationale */}
                        {selectedPr.rationale && (
                          <div>
                            <h3 className="section-label">{t('rationaleTitle')}</h3>
                            <p
                              className="glass"
                              style={{
                                padding: '12px 16px',
                                background: 'rgba(255, 255, 255, 0.02)',
                                fontSize: '0.95rem',
                                color: '#cbd5e1',
                              }}
                            >
                              {selectedPr.rationale}
                            </p>
                          </div>
                        )}

                        {/* Proposed Text: Diff for Verse PRs, simple description block for General PRs */}
                        {(() => {
                          const isGeneral = selectedPr.kind === 'general' || !selectedPr.ref;
                          if (isGeneral) {
                            if (!selectedPr.proposedText) return null;
                            return (
                              <div>
                                <h3 className="section-label">{t('description')}</h3>
                                <p
                                  className="glass"
                                  style={{
                                    padding: '16px 20px',
                                    background: '#0a0d14',
                                    border: '1px solid rgba(255, 255, 255, 0.03)',
                                    fontSize: '1rem',
                                    color: '#cbd5e1',
                                    whiteSpace: 'pre-wrap',
                                  }}
                                >
                                  {selectedPr.proposedText}
                                </p>
                              </div>
                            );
                          }

                          // Verse-specific PR with Diff
                          if (!selectedPr.originalText && !selectedPr.proposedText) return null;
                          return (
                            <div>
                              <h3 className="section-label">{t('diffTitle')}</h3>
                              <div
                                className="glass"
                                style={{
                                  padding: '20px',
                                  background: '#0a0d14',
                                  border: '1px solid rgba(255, 255, 255, 0.03)',
                                }}
                              >
                                <div
                                  style={{
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 1fr',
                                    gap: '20px',
                                    marginBottom: '16px',
                                    borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                                    paddingBottom: '12px',
                                  }}
                                >
                                  <div>
                                    <span
                                      style={{
                                        fontSize: '0.8rem',
                                        color: '#ef4444',
                                        background: 'rgba(239, 68, 68, 0.1)',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        fontWeight: 600,
                                      }}
                                    >
                                      {t('prevText')}
                                    </span>
                                  </div>
                                  <div>
                                    <span
                                      style={{
                                        fontSize: '0.8rem',
                                        color: '#10b981',
                                        background: 'rgba(16, 185, 129, 0.1)',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        fontWeight: 600,
                                      }}
                                    >
                                      {t('propText')}
                                    </span>
                                  </div>
                                </div>
                                <div
                                  style={{
                                    fontFamily: "'Outfit', sans-serif",
                                    fontSize: '1.05rem',
                                    lineHeight: '1.6',
                                  }}
                                >
                                  {diffWords(
                                    selectedPr.originalText || '',
                                    selectedPr.proposedText || '',
                                  ).map((chunk, idx) => {
                                    if (chunk.type === 'delete')
                                      return (
                                        <span key={idx} className="diff-deleted">
                                          {chunk.text}
                                        </span>
                                      );
                                    if (chunk.type === 'insert')
                                      return (
                                        <span key={idx} className="diff-inserted">
                                          {chunk.text}
                                        </span>
                                      );
                                    return <span key={idx}>{chunk.text}</span>;
                                  })}
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Voting */}
                        <div
                          style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}
                        >
                          <h3 className="section-label">
                            {t('votingRole')} ({getRoleLabel(userRole)})
                          </h3>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: '16px',
                            }}
                          >
                            <div style={{ display: 'flex', gap: '12px' }}>
                              <button
                                onClick={() => handleVotePr('up')}
                                className="btn"
                                disabled={
                                  selectedPr.status === 'merged' || selectedPr.status === 'closed'
                                }
                                style={{
                                  borderColor: 'rgba(16, 185, 129, 0.2)',
                                  background: selectedPr.votes.some(
                                    (v) => v.user === username && v.value === 'up',
                                  )
                                    ? 'rgba(16, 185, 129, 0.2)'
                                    : undefined,
                                }}
                              >
                                <ThumbsUp size={16} style={{ color: '#10b981' }} />{' '}
                                {selectedPr.votes.some(
                                  (v) => v.user === username && v.value === 'up',
                                )
                                  ? t('votedFavor')
                                  : t('voteUp')}
                              </button>
                              <button
                                onClick={() => handleVotePr('down')}
                                className="btn"
                                disabled={
                                  selectedPr.status === 'merged' || selectedPr.status === 'closed'
                                }
                                style={{
                                  borderColor: 'rgba(239, 68, 68, 0.2)',
                                  background: selectedPr.votes.some(
                                    (v) => v.user === username && v.value === 'down',
                                  )
                                    ? 'rgba(239, 68, 68, 0.2)'
                                    : undefined,
                                }}
                              >
                                <ThumbsDown size={16} style={{ color: '#ef4444' }} />{' '}
                                {selectedPr.votes.some(
                                  (v) => v.user === username && v.value === 'down',
                                )
                                  ? t('votedAgainst')
                                  : t('voteDown')}
                              </button>
                            </div>
                            <div
                              className="glass"
                              style={{
                                padding: '8px 16px',
                                fontSize: '0.85rem',
                                display: 'flex',
                                gap: '16px',
                              }}
                            >
                              <span style={{ color: 'var(--status-complete)' }}>
                                {t('voteUp')}:{' '}
                                {selectedPr.votes.filter((v) => v.value === 'up').length}
                              </span>
                              <span style={{ color: 'var(--status-flagged)' }}>
                                {t('voteDown')}:{' '}
                                {selectedPr.votes.filter((v) => v.value === 'down').length}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Alternatives */}
                        <div
                          style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}
                        >
                          <h3 className="section-label">{t('suggestAlt')}</h3>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {selectedPr.alternatives && selectedPr.alternatives.length > 0 && (
                              <div
                                style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
                              >
                                {selectedPr.alternatives.map((alt) => {
                                  const userVoted = alt.votes?.some((v) => v.user === username);
                                  return (
                                    <div
                                      key={alt.id}
                                      className="glass"
                                      style={{
                                        padding: '12px 16px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        background: 'rgba(255,255,255,0.01)',
                                      }}
                                    >
                                      <div>
                                        <p style={{ fontSize: '0.95rem', color: '#fff' }}>
                                          {alt.text}
                                        </p>
                                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                          {t('proposedBy')} {alt.proposedBy}
                                        </span>
                                      </div>
                                      <button
                                        onClick={() => handleVoteAlternative(alt.id)}
                                        className="btn"
                                        disabled={selectedPr.status === 'merged'}
                                        style={{
                                          padding: '6px 12px',
                                          fontSize: '0.8rem',
                                          background: userVoted
                                            ? 'rgba(16,185,129,0.2)'
                                            : undefined,
                                          borderColor: userVoted ? '#10b981' : undefined,
                                        }}
                                      >
                                        <ThumbsUp size={12} style={{ color: '#10b981' }} />{' '}
                                        {userVoted ? t('voted') : t('vote')} (
                                        {alt.votes?.length || 0})
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            {selectedPr.status !== 'merged' && selectedPr.status !== 'closed' && (
                              <form
                                onSubmit={handleAddSuggestion}
                                style={{ display: 'flex', gap: '12px' }}
                              >
                                <input
                                  type="text"
                                  placeholder={t('enterAltSuggestion')}
                                  value={newSuggestion}
                                  onChange={(e) => setNewSuggestion(e.target.value)}
                                  required
                                />
                                <button type="submit" className="btn btn-primary">
                                  {t('propose')}
                                </button>
                              </form>
                            )}
                          </div>
                        </div>

                        {/* Comments */}
                        <div
                          style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}
                        >
                          <h3 className="section-label">{t('discussionTitle')}</h3>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '12px',
                                maxHeight: '300px',
                                overflowY: 'auto',
                                paddingRight: '4px',
                              }}
                            >
                              {!selectedPr.comments || selectedPr.comments.length === 0 ? (
                                <p
                                  style={{
                                    color: '#64748b',
                                    fontSize: '0.85rem',
                                    textAlign: 'center',
                                    padding: '20px 0',
                                  }}
                                >
                                  {t('noComments')}
                                </p>
                              ) : (
                                selectedPr.comments.map((c) => (
                                  <div
                                    key={c.id}
                                    style={{
                                      display: 'flex',
                                      gap: '12px',
                                      alignItems: 'flex-start',
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: '28px',
                                        height: '28px',
                                        borderRadius: '50%',
                                        background: '#475569',
                                        display: 'grid',
                                        placeItems: 'center',
                                        fontSize: '0.75rem',
                                        fontWeight: 600,
                                        color: '#fff',
                                        flexShrink: 0,
                                      }}
                                    >
                                      {c.author.substring(0, 2).toUpperCase()}
                                    </div>
                                    <div
                                      className="glass"
                                      style={{
                                        padding: '12px 16px',
                                        background: 'rgba(30, 41, 59, 0.2)',
                                        flexGrow: 1,
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: 'flex',
                                          justifyContent: 'space-between',
                                          alignItems: 'center',
                                          marginBottom: '4px',
                                        }}
                                      >
                                        <span
                                          style={{
                                            fontSize: '0.85rem',
                                            fontWeight: 600,
                                            color: '#fff',
                                          }}
                                        >
                                          {c.author}
                                        </span>
                                        <div
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                          }}
                                        >
                                          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                            {new Date(c.timestamp).toLocaleTimeString(lang, {
                                              hour: '2-digit',
                                              minute: '2-digit',
                                            })}
                                          </span>
                                          {c.author === username && (
                                            <div
                                              style={{
                                                display: 'flex',
                                                gap: '8px',
                                                marginLeft: '12px',
                                              }}
                                            >
                                              <button
                                                onClick={() => {
                                                  setEditingCommentId(c.id);
                                                  setEditingCommentText(c.text);
                                                }}
                                                style={{
                                                  background: 'none',
                                                  border: 'none',
                                                  color: '#818cf8',
                                                  cursor: 'pointer',
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  padding: 0,
                                                }}
                                                title={t('edit')}
                                              >
                                                <Edit2 size={12} />
                                              </button>
                                              <button
                                                onClick={() => handleDeleteComment(c.id)}
                                                style={{
                                                  background: 'none',
                                                  border: 'none',
                                                  color: '#ef4444',
                                                  cursor: 'pointer',
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  padding: 0,
                                                }}
                                                title={t('delete')}
                                              >
                                                <Trash2 size={12} />
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      {editingCommentId === c.id ? (
                                        <div
                                          style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '8px',
                                            marginTop: '6px',
                                          }}
                                        >
                                          <textarea
                                            value={editingCommentText}
                                            onChange={(e) => setEditingCommentText(e.target.value)}
                                            style={{
                                              padding: '8px 12px',
                                              fontSize: '0.9rem',
                                              height: '60px',
                                              background: 'rgba(15, 23, 42, 0.8)',
                                              minHeight: '60px',
                                            }}
                                          />
                                          <div
                                            style={{
                                              display: 'flex',
                                              gap: '8px',
                                              justifyContent: 'flex-end',
                                            }}
                                          >
                                            <button
                                              onClick={() => setEditingCommentId(null)}
                                              className="btn"
                                              style={{
                                                padding: '4px 8px',
                                                fontSize: '0.75rem',
                                                borderRadius: '6px',
                                              }}
                                            >
                                              {t('cancel')}
                                            </button>
                                            <button
                                              onClick={() =>
                                                handleUpdateComment(c.id, editingCommentText)
                                              }
                                              className="btn btn-primary"
                                              style={{
                                                padding: '4px 8px',
                                                fontSize: '0.75rem',
                                                borderRadius: '6px',
                                              }}
                                            >
                                              {t('save')}
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <p
                                          style={{
                                            fontSize: '0.9rem',
                                            color: '#cbd5e1',
                                            whiteSpace: 'pre-wrap',
                                          }}
                                        >
                                          {c.text}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                            <form
                              onSubmit={handleAddComment}
                              style={{ display: 'flex', gap: '12px' }}
                            >
                              <input
                                type="text"
                                placeholder={t('writeComment')}
                                value={newComment}
                                onChange={(e) => setNewComment(e.target.value)}
                                required
                              />
                              <button
                                type="submit"
                                className="btn btn-icon btn-primary"
                                title={lang === 'es' ? 'Enviar Comentario' : 'Send Comment'}
                              >
                                <Send size={16} />
                              </button>
                            </form>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
          </>
        )}
      </div>
    </>
  );
}
