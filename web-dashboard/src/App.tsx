import { useState, useEffect } from 'react';
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
  ThumbsDown, 
  ThumbsUp, 
  User, 
  AlertCircle
} from 'lucide-react';

// Interfaces based on extension schemas
interface ProjectTask {
  id: string;
  book: string;
  chapter: number;
  stage: string;
  assignedTo: string[];
  status: 'pending' | 'in-progress' | 'complete' | 'flagged';
  notes: string;
  deadline?: string;
}

interface TaskStore {
  tasks: ProjectTask[];
}

interface PrVote {
  user: string;
  value: 'up' | 'down';
  reason?: string;
  role: 'translator' | 'consultant' | 'admin';
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

// LCS Word Differ Algorithm for Visual Verse Comparisons
function diffWords(original: string, proposed: string) {
  if (!original) return [{ type: 'insert' as const, text: proposed }];
  if (!proposed) return [{ type: 'delete' as const, text: original }];

  const oWords = original.split(/(\s+)/);
  const pWords = proposed.split(/(\s+)/);

  const clean = (w: string) => w.trim();

  const n = oWords.length;
  const m = pWords.length;
  const dp: number[][] = Array(n + 1).fill(0).map(() => Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const co = clean(oWords[i - 1]);
      const cp = clean(pWords[j - 1]);
      if (co === cp && co !== "") {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result: { type: 'equal' | 'delete' | 'insert'; text: string }[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const co = clean(oWords[i - 1]);
    const cp = clean(pWords[j - 1]);
    if (i > 0 && j > 0 && co === cp && co !== "") {
      result.unshift({ type: 'equal', text: oWords[i - 1] });
      i--; j--;
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

export default function App() {
  const [clientId, setClientId] = useState(() => {
    const saved = localStorage.getItem('pm_oauth_client_id');
    if (saved) return saved;
    // Fallback to Vite environment variable configured at build time (e.g. on Netlify)
    return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) || '';
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [username, setUsername] = useState(() => localStorage.getItem('pm_dashboard_user') || 'Consultor');
  const [accessToken, setAccessToken] = useState(() => localStorage.getItem('pm_dashboard_token') || '');
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'board' | 'prs'>('board');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Selected PR state
  const [selectedPrId, setSelectedPrId] = useState<number | null>(null);
  const [newComment, setNewComment] = useState('');
  const [newSuggestion, setNewSuggestion] = useState('');
  
  // Filters
  const [bookFilter, setBookFilter] = useState('');
  const [taskStatusFilter, setTaskStatusFilter] = useState<string>('all');
  const [prStatusFilter, setPrStatusFilter] = useState<string>('all');

  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const selectedPr = selectedProject?.prsStore?.prs.find(pr => pr.id === selectedPrId);

  // Load Google Identity Services SDK
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

  // Fetch projects list when token is available
  useEffect(() => {
    if (accessToken) {
      fetchProjectsFromDrive();
    }
  }, [accessToken]);

  // Save Client ID & User Settings
  const saveSetup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId.trim()) {
      setError('Por favor ingrese un Google Client ID válido.');
      return;
    }
    localStorage.setItem('pm_oauth_client_id', clientId);
    localStorage.setItem('pm_dashboard_user', username);
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
            setError(`Error de autenticación: ${tokenResponse.error_description || tokenResponse.error}`);
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
      // Search Drive for tasks and prs files
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=name contains 'paratext-tasks-' or name contains 'paratext-prs-'&fields=files(id, name)`,
        {
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );
      
      if (response.status === 401) {
        handleLogout();
        setError('Su sesión de Google ha expirado. Por favor inicie sesión nuevamente.');
        setLoading(false);
        return;
      }

      if (!response.ok) {
        throw new Error(`Google Drive API error: ${response.statusText}`);
      }

      const data = await response.json();
      const files: DriveFile[] = (data.files || []).map((f: any) => {
        const isTasks = f.name.startsWith('paratext-tasks-');
        const isPrs = f.name.startsWith('paratext-prs-');
        let projectId = '';
        if (isTasks) projectId = f.name.replace('paratext-tasks-', '').replace('.json', '');
        if (isPrs) projectId = f.name.replace('paratext-prs-', '').replace('.json', '');
        return {
          id: f.id,
          name: f.name,
          type: isTasks ? 'tasks' : 'prs',
          projectId
        };
      }).filter((f: any) => f.projectId !== '');

      // Group files by projectId
      const projectMap: Record<string, ProjectData> = {};
      files.forEach(file => {
        if (!projectMap[file.projectId]) {
          projectMap[file.projectId] = {
            id: file.projectId,
            name: file.projectId.replace(/_/g, ' ')
          };
        }
        if (file.type === 'tasks') {
          projectMap[file.projectId].tasksFileId = file.id;
        } else if (file.type === 'prs') {
          projectMap[file.projectId].prsFileId = file.id;
        }
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
    setSelectedPrId(null);
    try {
      let tasksStore: TaskStore | undefined;
      let prsStore: PullRequestsStore | undefined;

      if (project.tasksFileId) {
        const tasksRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${project.tasksFileId}?alt=media`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (tasksRes.ok) {
          tasksStore = await tasksRes.json();
        }
      }

      if (project.prsFileId) {
        const prsRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${project.prsFileId}?alt=media`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (prsRes.ok) {
          prsStore = await prsRes.json();
        }
      }

      // Update state
      setProjects(prev => prev.map(p => {
        if (p.id === project.id) {
          return { ...p, tasksStore, prsStore };
        }
        return p;
      }));

      setSelectedProjectId(project.id);
    } catch (err: any) {
      setError(`Error cargando datos del proyecto: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Writes updated PR store back to Drive
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
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(updatedStore, null, 2)
        }
      );

      if (!response.ok) {
        throw new Error(`Drive update failed: ${response.statusText}`);
      }

      // Update state locally
      setProjects(prev => prev.map(p => {
        if (p.id === selectedProjectId) {
          return { ...p, prsStore: updatedStore };
        }
        return p;
      }));
    } catch (err: any) {
      setError(`Error al guardar en Drive: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Add a vote on the PR
  const handleVotePr = async (value: 'up' | 'down') => {
    if (!selectedProject || !selectedPr || !selectedProject.prsStore) return;
    
    const now = new Date().toISOString();
    const newVote: PrVote = {
      user: username,
      value,
      role: 'consultant', // The dashboard user is typically a consultant
      timestamp: now
    };

    const updatedPrs = selectedProject.prsStore.prs.map(pr => {
      if (pr.id === selectedPr.id) {
        // Filter out any existing vote by this user
        const cleanVotes = pr.votes.filter(v => v.user !== username);
        const votes = [...cleanVotes, newVote];
        
        // Add audit log to history
        const history = [
          ...(pr.history || []),
          {
            id: `h-${Date.now()}`,
            actor: username,
            action: value === 'up' ? 'upvoted' : 'downvoted',
            detail: `Votó ${value === 'up' ? 'A Favor' : 'En Contra'} de la propuesta.`,
            timestamp: now
          }
        ];

        return { ...pr, votes, history, updatedAt: now };
      }
      return pr;
    });

    const updatedStore = {
      ...selectedProject.prsStore,
      prs: updatedPrs
    };

    await savePrsToDrive(updatedStore);
  };

  // Suggest Alternative Translation
  const handleAddSuggestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSuggestion.trim() || !selectedProject || !selectedPr || !selectedProject.prsStore) return;

    const now = new Date().toISOString();
    const altId = `alt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newAlt: AlternativeRendering = {
      id: altId,
      text: newSuggestion,
      proposedBy: username,
      votes: [],
      createdAt: now
    };

    const updatedPrs = selectedProject.prsStore.prs.map(pr => {
      if (pr.id === selectedPr.id) {
        const alternatives = [...(pr.alternatives || []), newAlt];
        const history = [
          ...(pr.history || []),
          {
            id: `h-${Date.now()}`,
            actor: username,
            action: 'alternative_added',
            detail: `Sugirió alternativa: "${newSuggestion}"`,
            timestamp: now
          }
        ];
        return { ...pr, alternatives, history, updatedAt: now };
      }
      return pr;
    });

    const updatedStore = {
      ...selectedProject.prsStore,
      prs: updatedPrs
    };

    setNewSuggestion('');
    await savePrsToDrive(updatedStore);
  };

  // Upvote Alternative Translation suggestion
  const handleVoteAlternative = async (altId: string) => {
    if (!selectedProject || !selectedPr || !selectedProject.prsStore) return;

    const now = new Date().toISOString();
    const updatedPrs = selectedProject.prsStore.prs.map(pr => {
      if (pr.id === selectedPr.id) {
        const alternatives = pr.alternatives.map(alt => {
          if (alt.id === altId) {
            const cleanVotes = alt.votes.filter(v => v.user !== username);
            const votes = [...cleanVotes, {
              user: username,
              value: 'up' as const,
              role: 'consultant' as const,
              timestamp: now
            }];
            return { ...alt, votes };
          }
          return alt;
        });

        return { ...pr, alternatives, updatedAt: now };
      }
      return pr;
    });

    const updatedStore = {
      ...selectedProject.prsStore,
      prs: updatedPrs
    };

    await savePrsToDrive(updatedStore);
  };

  // Add Comment on PR discussion thread
  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !selectedProject || !selectedPr || !selectedProject.prsStore) return;

    const now = new Date().toISOString();
    const commentId = `c-${Date.now()}`;
    const comment: PrComment = {
      id: commentId,
      author: username,
      text: newComment,
      timestamp: now
    };

    const updatedPrs = selectedProject.prsStore.prs.map(pr => {
      if (pr.id === selectedPr.id) {
        const comments = [...(pr.comments || []), comment];
        return { ...pr, comments, updatedAt: now };
      }
      return pr;
    });

    const updatedStore = {
      ...selectedProject.prsStore,
      prs: updatedPrs
    };

    setNewComment('');
    await savePrsToDrive(updatedStore);
  };

  // Filter Tasks
  const filteredTasks = selectedProject?.tasksStore?.tasks.filter(t => {
    const matchesBook = bookFilter ? t.book.toLowerCase().includes(bookFilter.toLowerCase()) : true;
    const matchesStatus = taskStatusFilter !== 'all' ? t.status === taskStatusFilter : true;
    return matchesBook && matchesStatus;
  }) || [];

  // Filter PRs
  const filteredPrs = selectedProject?.prsStore?.prs.filter(pr => {
    const matchesBook = bookFilter ? pr.refLabel.toLowerCase().includes(bookFilter.toLowerCase()) : true;
    const matchesStatus = prStatusFilter !== 'all' ? pr.status === prStatusFilter : true;
    return matchesBook && matchesStatus;
  }) || [];

  const getTaskStatusLabel = (status: string) => {
    switch (status) {
      case 'pending': return 'Pendiente';
      case 'in-progress': return 'En Progreso';
      case 'complete': return 'Completado';
      case 'flagged': return 'Flagged (Bandera)';
      default: return status;
    }
  };

  const getPrStatusLabel = (status: string) => {
    switch (status) {
      case 'draft': return 'Borrador';
      case 'open': return 'Abierto';
      case 'needs-review': return 'Requiere Revisión';
      case 'approved': return 'Aprobado';
      case 'merged': return 'Fusionado (Merged)';
      case 'closed': return 'Cerrado';
      case 'expired': return 'Expirado';
      default: return status;
    }
  };

  // Auth / setup screen if no token
  if (!accessToken) {
    return (
      <div className="app-container" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div className="glass" style={{ width: '100%', maxWidth: '480px', padding: '40px' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ display: 'inline-flex', padding: '16px', background: 'rgba(129, 140, 248, 0.1)', borderRadius: '24px', marginBottom: '16px', border: '1px solid rgba(129, 140, 248, 0.2)' }}>
              <Database size={32} className="gradient-text" style={{ color: '#818cf8' }} />
            </div>
            <h1 style={{ fontSize: '1.8rem', marginBottom: '8px' }}>Tablero & PR Dashboard</h1>
            <p style={{ color: '#94a3b8', fontSize: '0.95rem' }}>Acceda a la información de sus proyectos en Google Drive de forma segura.</p>
          </div>

          {error && (
            <div style={{ padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '12px', color: '#fca5a5', fontSize: '0.9rem', marginBottom: '20px', display: 'flex', gap: '8px' }}>
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>{error}</div>
            </div>
          )}

          <form onSubmit={saveSetup} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {(!clientId || showAdvanced) ? (
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Google OAuth Client ID</label>
                <div style={{ position: 'relative' }}>
                  <Key size={18} style={{ position: 'absolute', left: '16px', top: '15px', color: '#64748b' }} />
                  <input 
                    type="text" 
                    placeholder="Ingrese Client ID" 
                    value={clientId} 
                    onChange={e => setClientId(e.target.value)} 
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
                  style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}
                >
                  Cambiar Google Client ID (Avanzado)
                </button>
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Nombre en Discusiones</label>
              <div style={{ position: 'relative' }}>
                <User size={18} style={{ position: 'absolute', left: '16px', top: '15px', color: '#64748b' }} />
                <input 
                  type="text" 
                  placeholder="Ej: Consultor Perez" 
                  value={username} 
                  onChange={e => setUsername(e.target.value)} 
                  style={{ paddingLeft: '48px' }} 
                  required
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '14px' }}>
              Ingresar con Google
            </button>
          </form>

          <div style={{ marginTop: '24px', borderTop: '1px solid var(--border-color)', paddingTop: '20px', fontSize: '0.8rem', color: '#64748b', textAlign: 'center' }}>
            Este dashboard se ejecuta localmente en su navegador y se conecta de forma segura con la API de Google Drive sin servidores intermediarios.
          </div>
        </div>
      </div>
    );
  }

  // Dashboard Home - Project Selector
  if (selectedProjectId === null) {
    return (
      <div className="app-container">
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px', borderBottom: '1px solid var(--border-color)', paddingBottom: '20px' }}>
          <div>
            <h1 style={{ fontSize: '2rem', fontWeight: 700 }} className="gradient-text">Mis Proyectos</h1>
            <p style={{ color: '#94a3b8', fontSize: '0.95rem' }}>Seleccione el proyecto de traducción para ver su tablero y pull requests.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ color: '#94a3b8', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <User size={16} /> {username} (Consultor)
            </span>
            <button onClick={handleLogout} className="btn" style={{ padding: '8px 12px' }}>
              <LogOut size={16} /> Cerrar Sesión
            </button>
          </div>
        </header>

        {error && (
          <div className="glass" style={{ padding: '16px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#fca5a5', marginBottom: '24px', display: 'flex', gap: '12px' }}>
            <AlertCircle size={20} />
            <div>{error}</div>
          </div>
        )}

        {loading ? (
          <div style={{ display: 'grid', placeItems: 'center', height: '200px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <RefreshCw size={32} className="spin" style={{ color: 'var(--primary)' }} />
              <span className="pulse" style={{ color: '#94a3b8' }}>Buscando archivos de proyectos en Google Drive...</span>
            </div>
          </div>
        ) : projects.length === 0 ? (
          <div className="glass" style={{ textAlign: 'center', padding: '60px 40px', color: '#94a3b8' }}>
            <Database size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
            <p style={{ fontSize: '1.1rem', marginBottom: '8px' }}>No se encontraron archivos de Paratext Project Manager.</p>
            <p style={{ fontSize: '0.9rem', color: '#64748b' }}>Asegúrese de haber habilitado y sincronizado Google Drive desde la extensión de Paratext 10.</p>
            <button onClick={fetchProjectsFromDrive} className="btn" style={{ marginTop: '20px' }}>
              <RefreshCw size={14} /> Reintentar
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '24px' }}>
            {projects.map(proj => (
              <div 
                key={proj.id} 
                onClick={() => loadProjectData(proj)}
                className="glass glass-interactive" 
                style={{ padding: '24px', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '160px' }}
              >
                <div>
                  <h3 style={{ fontSize: '1.25rem', marginBottom: '12px', textTransform: 'capitalize' }}>{proj.name}</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.85rem', color: '#94a3b8' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Layout size={14} /> Tablero: {proj.tasksFileId ? '✓ Disponible' : '❌ No configurado'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <GitPullRequest size={14} /> Pull Requests: {proj.prsFileId ? '✓ Disponible' : '❌ No configurado'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.9rem', color: 'var(--primary)' }}>
                    Ver Tablero <ChevronRight size={16} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Active Project View
  if (!selectedProject) return null;

  return (
    <div className="app-container" style={{ paddingBottom: '80px' }}>
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={() => setSelectedProjectId(null)} className="btn" style={{ padding: '8px 12px', fontSize: '0.85rem' }}>
            ← Proyectos
          </button>
          <div>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 700, textTransform: 'capitalize' }} className="gradient-text">{selectedProject.name}</h1>
            <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Código del proyecto: {selectedProject.id}</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={() => loadProjectData(selectedProject)} className="btn btn-icon" title="Recargar de Drive">
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
          <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
            {username} (Consultor)
          </span>
          <button onClick={handleLogout} className="btn" style={{ padding: '8px 12px', fontSize: '0.85rem' }}>
            Cerrar Sesión
          </button>
        </div>
      </header>

      {error && (
        <div className="glass" style={{ padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#fca5a5', marginBottom: '20px', display: 'flex', gap: '8px', fontSize: '0.9rem' }}>
          <AlertCircle size={18} />
          <div>{error}</div>
        </div>
      )}

      {/* Tabs and Filters */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
        {/* Navigation Tabs */}
        <div style={{ display: 'flex', gap: '4px', background: 'rgba(22, 28, 45, 0.4)', padding: '4px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <button 
            onClick={() => setActiveTab('board')}
            className={`btn ${activeTab === 'board' ? 'btn-primary' : ''}`}
            style={{ borderRadius: '8px', padding: '8px 16px', border: 'none', background: activeTab === 'board' ? undefined : 'transparent', boxShadow: activeTab === 'board' ? undefined : 'none' }}
          >
            <Layout size={16} /> Tablero de Progreso
          </button>
          <button 
            onClick={() => setActiveTab('prs')}
            className={`btn ${activeTab === 'prs' ? 'btn-primary' : ''}`}
            style={{ borderRadius: '8px', padding: '8px 16px', border: 'none', background: activeTab === 'prs' ? undefined : 'transparent', boxShadow: activeTab === 'prs' ? undefined : 'none' }}
          >
            <GitPullRequest size={16} /> Pull Requests ({selectedProject.prsStore?.prs.length || 0})
          </button>
        </div>

        {/* Filters Panel */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: '180px' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '11px', color: '#64748b' }} />
            <input 
              type="text" 
              placeholder="Buscar Libro (e.g. MAT)" 
              value={bookFilter}
              onChange={e => setBookFilter(e.target.value)}
              style={{ padding: '8px 12px 8px 36px', fontSize: '0.85rem' }}
            />
          </div>

          {activeTab === 'board' ? (
            <select 
              value={taskStatusFilter} 
              onChange={e => setTaskStatusFilter(e.target.value)}
              style={{ padding: '8px 16px', fontSize: '0.85rem', width: '150px' }}
            >
              <option value="all">Todos los Estados</option>
              <option value="pending">Pendiente</option>
              <option value="in-progress">En Progreso</option>
              <option value="complete">Completado</option>
              <option value="flagged">Flagged</option>
            </select>
          ) : (
            <select 
              value={prStatusFilter} 
              onChange={e => setPrStatusFilter(e.target.value)}
              style={{ padding: '8px 16px', fontSize: '0.85rem', width: '150px' }}
            >
              <option value="all">Todas las PRs</option>
              <option value="open">Abierta</option>
              <option value="needs-review">Requiere Revisión</option>
              <option value="approved">Aprobada</option>
              <option value="merged">Fusionada</option>
              <option value="closed">Cerrada</option>
              <option value="expired">Expirada</option>
            </select>
          )}
        </div>
      </div>

      {/* Main Tab Content */}
      {loading && !selectedProject.tasksStore && !selectedProject.prsStore ? (
        <div style={{ display: 'grid', placeItems: 'center', height: '300px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <RefreshCw size={28} className="spin" style={{ color: 'var(--primary)' }} />
            <span className="pulse" style={{ color: '#94a3b8' }}>Descargando información...</span>
          </div>
        </div>
      ) : activeTab === 'board' ? (
        /* TASK BOARD VIEW */
        !selectedProject.tasksStore ? (
          <div className="glass" style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
            <Layout size={32} style={{ opacity: 0.5, marginBottom: '12px' }} />
            <p>No se encontraron datos del Tablero de Progreso en Google Drive.</p>
          </div>
        ) : (
          <div>
            {/* Status Statistics Summary Widgets */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' }}>
              {(['pending', 'in-progress', 'flagged', 'complete'] as const).map(status => {
                const count = selectedProject.tasksStore!.tasks.filter(t => t.status === status).length;
                const total = selectedProject.tasksStore!.tasks.length || 1;
                const percent = Math.round((count / total) * 100);
                
                let color = 'var(--status-pending)';
                if (status === 'in-progress') color = 'var(--status-in-progress)';
                if (status === 'complete') color = 'var(--status-complete)';
                if (status === 'flagged') color = 'var(--status-flagged)';

                return (
                  <div key={status} className="glass" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '8px', height: '40px', background: color, borderRadius: '4px' }}></div>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>{getTaskStatusLabel(status)}</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '4px' }}>
                        <span style={{ fontSize: '1.5rem', fontWeight: 700 }}>{count}</span>
                        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{percent}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Kanban Columns (Read Only Status View) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', alignItems: 'start' }}>
              {(['pending', 'in-progress', 'flagged', 'complete'] as const).map(status => {
                const colTasks = filteredTasks.filter(t => t.status === status);
                let color = 'var(--status-pending)';
                if (status === 'in-progress') color = 'var(--status-in-progress)';
                if (status === 'complete') color = 'var(--status-complete)';
                if (status === 'flagged') color = 'var(--status-flagged)';

                return (
                  <div key={status} className="glass" style={{ padding: '16px', minHeight: '400px', background: 'rgba(22, 28, 45, 0.3)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: `2px solid ${color}`, paddingBottom: '8px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }}></span>
                        {getTaskStatusLabel(status)}
                      </span>
                      <span className="glass" style={{ fontSize: '0.8rem', padding: '2px 8px', borderRadius: '10px' }}>
                        {colTasks.length}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {colTasks.length === 0 ? (
                        <div style={{ textAlign: 'center', color: '#64748b', fontSize: '0.85rem', padding: '30px 10px', border: '1px dashed rgba(255, 255, 255, 0.04)', borderRadius: '12px' }}>
                          Sin Tareas
                        </div>
                      ) : (
                        colTasks.map(task => (
                          <div key={task.id} className="glass" style={{ padding: '16px', background: 'rgba(30, 41, 59, 0.4)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                              <span className="gradient-text" style={{ fontWeight: 700, fontSize: '1rem' }}>{task.book} {task.chapter}</span>
                              <span style={{ fontSize: '0.75rem', background: 'rgba(129, 140, 248, 0.1)', color: 'var(--primary)', padding: '2px 6px', borderRadius: '4px', textTransform: 'capitalize' }}>
                                {task.stage.replace('custom-', '')}
                              </span>
                            </div>
                            
                            {task.notes && (
                              <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '12px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                {task.notes}
                              </p>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', borderTop: '1px solid rgba(255, 255, 255, 0.04)', paddingTop: '8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#64748b' }}>
                                <Clock size={12} />
                                {task.deadline ? <span>{task.deadline}</span> : <span>Sin fecha</span>}
                              </div>
                              <div style={{ display: 'flex', gap: '4px' }}>
                                {task.assignedTo?.map((name, idx) => (
                                  <span key={name} className="glass" style={{ width: '24px', height: '24px', borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: '0.7rem', fontWeight: 600, background: `hsl(${(idx * 137) % 360}, 50%, 60%)`, color: '#fff' }} title={name}>
                                    {name.substring(0, 2).toUpperCase()}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )
      ) : (
        /* PULL REQUESTS VIEW */
        !selectedProject.prsStore ? (
          <div className="glass" style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
            <GitPullRequest size={32} style={{ opacity: 0.5, marginBottom: '12px' }} />
            <p>No se encontraron datos de Pull Requests en Google Drive.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '24px', alignItems: 'start' }}>
            {/* PR Sidebar List */}
            <div className="glass" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontWeight: 600, paddingBottom: '8px', borderBottom: '1px solid var(--border-color)', fontSize: '0.9rem', color: '#94a3b8' }}>
                Pull Requests ({filteredPrs.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '600px', overflowY: 'auto', paddingRight: '4px' }}>
                {filteredPrs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '30px 10px', color: '#64748b', fontSize: '0.85rem' }}>
                    Ningún Pull Request coincide con los filtros.
                  </div>
                ) : (
                  filteredPrs.map(pr => {
                    const isActive = pr.id === selectedPrId;
                    let prColor = 'var(--pr-draft)';
                    if (pr.status === 'open') prColor = 'var(--pr-open)';
                    if (pr.status === 'needs-review') prColor = 'var(--pr-review)';
                    if (pr.status === 'approved') prColor = 'var(--pr-review)';
                    if (pr.status === 'merged') prColor = 'var(--pr-merged)';
                    if (pr.status === 'closed') prColor = 'var(--pr-closed)';
                    if (pr.status === 'expired') prColor = 'var(--pr-expired)';

                    const upvoteCount = pr.votes?.filter(v => v.value === 'up').length || 0;

                    return (
                      <div 
                        key={pr.id}
                        onClick={() => setSelectedPrId(pr.id)}
                        className="glass"
                        style={{ 
                          padding: '12px 16px', 
                          cursor: 'pointer', 
                          background: isActive ? 'rgba(129, 140, 248, 0.1)' : 'rgba(30, 41, 59, 0.2)',
                          borderColor: isActive ? 'var(--primary)' : undefined,
                          transition: 'all 0.2s'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: prColor, background: `${prColor}15`, padding: '2px 6px', borderRadius: '4px' }}>
                            {getPrStatusLabel(pr.status)}
                          </span>
                          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>#{pr.id}</span>
                        </div>
                        <h4 style={{ fontSize: '0.95rem', marginBottom: '8px', color: '#fff' }}>{pr.refLabel}</h4>
                        <p style={{ fontSize: '0.85rem', color: '#94a3b8', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', marginBottom: '6px' }}>
                          {pr.title}
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: '#64748b' }}>
                          <span>Por: {pr.author}</span>
                          {upvoteCount > 0 && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--status-complete)' }}>
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

            {/* PR Details View */}
            <div>
              {!selectedPr ? (
                <div className="glass" style={{ height: '350px', display: 'grid', placeItems: 'center', color: '#94a3b8', textAlign: 'center' }}>
                  <div>
                    <GitPullRequest size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
                    <p style={{ fontSize: '1.1rem' }}>Seleccione una PR del panel izquierdo</p>
                    <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '4px' }}>Para revisar propuestas, votar o comentar.</p>
                  </div>
                </div>
              ) : (
                <div className="glass" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  {/* PR Header Info */}
                  <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontSize: '1.3rem', fontWeight: 700 }}>{selectedPr.refLabel}</span>
                        <span className="glass" style={{ fontSize: '0.75rem', padding: '2px 8px', color: 'var(--primary)' }}>PR #{selectedPr.id}</span>
                      </div>
                      <h2 style={{ fontSize: '1.1rem', color: '#f8fafc', fontWeight: 500 }}>{selectedPr.title}</h2>
                      <div style={{ display: 'flex', gap: '16px', color: '#64748b', fontSize: '0.85rem', marginTop: '8px' }}>
                        <span>Propuesto por: <strong>{selectedPr.author}</strong></span>
                        <span>Creado: {new Date(selectedPr.createdAt).toLocaleDateString()}</span>
                        <span>Actualizado: {new Date(selectedPr.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                      <span className="glass" style={{ 
                        fontSize: '0.85rem', 
                        fontWeight: 600, 
                        padding: '6px 12px',
                        color: selectedPr.status === 'merged' ? 'var(--pr-merged)' : selectedPr.status === 'open' ? 'var(--pr-open)' : 'inherit',
                        background: selectedPr.status === 'merged' ? 'rgba(16,185,129,0.1)' : 'rgba(59,130,246,0.1)'
                      }}>
                        Estado: {getPrStatusLabel(selectedPr.status)}
                      </span>
                    </div>
                  </div>

                  {/* Rationale / Description */}
                  {selectedPr.rationale && (
                    <div>
                      <h3 style={{ fontSize: '0.95rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.05em' }}>Justificación / Razón</h3>
                      <p className="glass" style={{ padding: '12px 16px', background: 'rgba(255, 255, 255, 0.02)', fontSize: '0.95rem', color: '#cbd5e1' }}>
                        {selectedPr.rationale}
                      </p>
                    </div>
                  )}

                  {/* Visual Word Diff comparison */}
                  {(selectedPr.originalText || selectedPr.proposedText) && (
                    <div>
                      <h3 style={{ fontSize: '0.95rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.05em' }}>Comparativa de Versículos (Diff)</h3>
                      <div className="glass" style={{ padding: '20px', background: '#0a0d14', border: '1px solid rgba(255, 255, 255, 0.03)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '16px', borderBottom: '1px solid rgba(255, 255, 255, 0.04)', paddingBottom: '12px' }}>
                          <div>
                            <span style={{ fontSize: '0.8rem', color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>Texto Anterior</span>
                          </div>
                          <div>
                            <span style={{ fontSize: '0.8rem', color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>Texto Propuesto</span>
                          </div>
                        </div>

                        {/* Inline diff representation */}
                        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '1.05rem', lineHeight: '1.6' }}>
                          {diffWords(selectedPr.originalText || '', selectedPr.proposedText || '').map((chunk, idx) => {
                            if (chunk.type === 'delete') {
                              return <span key={idx} className="diff-deleted">{chunk.text}</span>;
                            } else if (chunk.type === 'insert') {
                              return <span key={idx} className="diff-inserted">{chunk.text}</span>;
                            } else {
                              return <span key={idx}>{chunk.text}</span>;
                            }
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* PR Voting */}
                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                    <h3 style={{ fontSize: '0.95rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '12px', letterSpacing: '0.05em' }}>Votación del Consultor</h3>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                      <div style={{ display: 'flex', gap: '12px' }}>
                        <button 
                          onClick={() => handleVotePr('up')} 
                          className="btn" 
                          disabled={selectedPr.status === 'merged' || selectedPr.status === 'closed'}
                          style={{ borderColor: 'rgba(16, 185, 129, 0.2)', background: selectedPr.votes.some(v => v.user === username && v.value === 'up') ? 'rgba(16, 185, 129, 0.2)' : undefined }}
                        >
                          <ThumbsUp size={16} style={{ color: '#10b981' }} /> A Favor
                        </button>
                        <button 
                          onClick={() => handleVotePr('down')} 
                          className="btn"
                          disabled={selectedPr.status === 'merged' || selectedPr.status === 'closed'}
                          style={{ borderColor: 'rgba(239, 68, 68, 0.2)', background: selectedPr.votes.some(v => v.user === username && v.value === 'down') ? 'rgba(239, 68, 68, 0.2)' : undefined }}
                        >
                          <ThumbsDown size={16} style={{ color: '#ef4444' }} /> En Contra
                        </button>
                      </div>

                      {/* Vote statistics */}
                      <div className="glass" style={{ padding: '8px 16px', fontSize: '0.85rem', display: 'flex', gap: '16px' }}>
                        <span style={{ color: 'var(--status-complete)' }}>
                          Votos a Favor: {selectedPr.votes.filter(v => v.value === 'up').length}
                        </span>
                        <span style={{ color: 'var(--status-flagged)' }}>
                          Votos en Contra: {selectedPr.votes.filter(v => v.value === 'down').length}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Suggest Alternative Translation suggestion */}
                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                    <h3 style={{ fontSize: '0.95rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '12px', letterSpacing: '0.05em' }}>Sugerir Traducción Alternativa</h3>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {selectedPr.alternatives && selectedPr.alternatives.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          {selectedPr.alternatives.map(alt => {
                            const userHasVotedAlt = alt.votes?.some(v => v.user === username);
                            return (
                              <div key={alt.id} className="glass" style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.01)' }}>
                                <div>
                                  <p style={{ fontSize: '0.95rem', color: '#fff' }}>{alt.text}</p>
                                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Por: {alt.proposedBy}</span>
                                </div>
                                <button 
                                  onClick={() => handleVoteAlternative(alt.id)}
                                  className="btn" 
                                  disabled={userHasVotedAlt || selectedPr.status === 'merged'}
                                  style={{ padding: '6px 12px', fontSize: '0.8rem', background: userHasVotedAlt ? 'rgba(16,185,129,0.1)' : undefined }}
                                >
                                  <ThumbsUp size={12} style={{ color: '#10b981' }} /> Upvote ({alt.votes?.length || 0})
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {selectedPr.status !== 'merged' && selectedPr.status !== 'closed' && (
                        <form onSubmit={handleAddSuggestion} style={{ display: 'flex', gap: '12px' }}>
                          <input 
                            type="text" 
                            placeholder="Ingrese su propuesta alternativa..." 
                            value={newSuggestion}
                            onChange={e => setNewSuggestion(e.target.value)}
                            required
                          />
                          <button type="submit" className="btn btn-primary">
                            Proponer
                          </button>
                        </form>
                      )}
                    </div>
                  </div>

                  {/* Discussion Thread / Comments */}
                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                    <h3 style={{ fontSize: '0.95rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '12px', letterSpacing: '0.05em' }}>Discusión y Comentarios</h3>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {/* Comments list */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '300px', overflowY: 'auto', paddingRight: '4px' }}>
                        {(!selectedPr.comments || selectedPr.comments.length === 0) ? (
                          <p style={{ color: '#64748b', fontSize: '0.85rem', textAlign: 'center', padding: '20px 0' }}>
                            Sin comentarios. Inicie la conversación.
                          </p>
                        ) : (
                          selectedPr.comments.map(c => (
                            <div key={c.id} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#475569', display: 'grid', placeItems: 'center', fontSize: '0.75rem', fontWeight: 600, color: '#fff' }}>
                                {c.author.substring(0, 2).toUpperCase()}
                              </div>
                              <div className="glass" style={{ padding: '12px 16px', background: 'rgba(30, 41, 59, 0.2)', flexGrow: 1 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff' }}>{c.author}</span>
                                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <p style={{ fontSize: '0.9rem', color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>{c.text}</p>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Post new comment */}
                      <form onSubmit={handleAddComment} style={{ display: 'flex', gap: '12px' }}>
                        <input 
                          type="text" 
                          placeholder="Escriba un comentario o aclaración..." 
                          value={newComment}
                          onChange={e => setNewComment(e.target.value)}
                          required
                        />
                        <button type="submit" className="btn btn-icon btn-primary" title="Enviar Comentario">
                          <Send size={16} />
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}
