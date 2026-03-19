declare module 'paratext-project-manager' {
  // Extension types
}

declare module 'papi-shared-types' {
  export interface CommandHandlers {
    /** Opens the Task Board web view for a project */
    'paratextProjectManager.openTaskBoard': (projectId?: string) => Promise<string | undefined>;
    /** Opens the My Tasks web view for a project */
    'paratextProjectManager.openMyTasks': (projectId?: string) => Promise<string | undefined>;
    /** Opens the Project Overview web view for a project */
    'paratextProjectManager.openProjectOverview': (
      projectId?: string,
    ) => Promise<string | undefined>;
    /** Gets all tasks for a project as a JSON string (TaskStore) */
    'paratextProjectManager.getTasks': (projectId: string) => Promise<string>;
    /** Saves all tasks for a project from a JSON string (TaskStore) */
    'paratextProjectManager.saveTasks': (
      projectId: string,
      tasksJson: string,
    ) => Promise<string>;
    /** Gets the current user name from extension settings */
    'paratextProjectManager.getCurrentUser': () => Promise<string>;
    /** Writes the current user name to extension settings */
    'paratextProjectManager.setCurrentUser': (userName: string) => Promise<string>;
  }
}
