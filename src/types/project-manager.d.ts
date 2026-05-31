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
    'paratextProjectManager.saveTasks': (projectId: string, tasksJson: string) => Promise<string>;
    /** Gets the current user name from extension settings */
    'paratextProjectManager.getCurrentUser': () => Promise<string>;
    /** Writes the current user name to extension settings */
    'paratextProjectManager.setCurrentUser': (userName: string) => Promise<string>;
    /** Opens the Notes Viewer web view for a project */
    'paratextProjectManager.openNotesViewer': (projectId?: string) => Promise<string | undefined>;
    /** Opens the Scripture Viewer web view for a project */
    'paratextProjectManager.openScriptureViewer': (
      projectId?: string,
    ) => Promise<string | undefined>;
    /** Gets all notes/threads for a project */
    'paratextProjectManager.getProjectNotes': (
      projectId: string,
      currentUser: string,
    ) => Promise<string>;
    /** Saves notes */
    'paratextProjectManager.saveProjectNote': (
      projectId: string,
      authorName: string,
      threadId: string,
      commentDate: string,
      newContents: string,
    ) => Promise<string>;
    /** Deletes a note comment */
    'paratextProjectManager.deleteProjectNote': (
      projectId: string,
      authorName: string,
      threadId: string,
      commentDate: string,
    ) => Promise<string>;
    /** Adds a reply comment to a thread */
    'paratextProjectManager.addNoteReply': (
      projectId: string,
      currentUser: string,
      replyDataJson: string,
    ) => Promise<string>;
    /** Marks a thread as read */
    'paratextProjectManager.markNoteAsRead': (
      currentUser: string,
      threadId: string,
      latestCommentDate: string,
    ) => Promise<string>;
    /** Gets book list */
    'paratextProjectManager.getProjectBooks': (projectId: string) => Promise<string>;
    /** Gets chapter scripture text structure */
    'paratextProjectManager.getChapterText': (
      projectId: string,
      bookCode: string,
      chapter: number,
    ) => Promise<string>;
    /** Updates a verse text in USFM file */
    'paratextProjectManager.updateVerseText': (
      projectId: string,
      bookCode: string,
      chapter: number,
      verse: number,
      newText: string,
    ) => Promise<string>;
    /** Gets notes filter/display settings */
    'paratextProjectManager.getNotesSettings': (currentUser: string) => Promise<string>;
    /** Saves notes filter/display settings */
    'paratextProjectManager.saveNotesSettings': (
      currentUser: string,
      settingsJson: string,
    ) => Promise<string>;
    /** Saves recorded audio note */
    'paratextProjectManager.saveAudioNote': (
      projectId: string,
      filename: string,
      base64Data: string,
    ) => Promise<{ status: string; fileId?: string; driveUrl?: string; error?: string }>;
    /** Gets recorded audio note as data URI */
    'paratextProjectManager.getAudioNote': (projectId: string, filename: string) => Promise<string>;
    /** Saves attachment file */
    'paratextProjectManager.saveAttachment': (
      projectId: string,
      filename: string,
      base64Data: string,
    ) => Promise<{ status: string; fileId?: string; driveUrl?: string; error?: string }>;
    /** Gets attachment file as data URI */
    'paratextProjectManager.getAttachment': (
      projectId: string,
      filename: string,
    ) => Promise<string>;
    /** Opens attachment using system application */
    'paratextProjectManager.openAttachment': (
      projectId: string,
      filename: string,
    ) => Promise<string>;
    /** Opens external link in default browser */
    'paratextProjectManager.openExternal': (url: string) => Promise<string>;
    /** Starts a collaboration host server */
    'paratextProjectManager.startCollabHost': (
      portOrRoomId: number | string,
      username: string,
      projectId: string,
      collabType?: 'local' | 'online',
      serverUrl?: string,
    ) => Promise<any>;
    /** Connects to a collaboration host server */
    'paratextProjectManager.connectCollabClient': (
      ipOrRoomId: string,
      portOrNull: number | null,
      username: string,
      projectId: string,
      collabType?: 'local' | 'online',
      serverUrl?: string,
    ) => Promise<any>;
    /** Stops the collaboration session */
    'paratextProjectManager.stopCollab': () => Promise<string>;
    /** Gets the current collaboration status */
    'paratextProjectManager.getCollabStatus': () => Promise<any>;
    /** Sends a collaboration chat message */
    'paratextProjectManager.sendCollabChat': (
      username: string,
      message: string,
    ) => Promise<string>;
    /** Broadcasts editing cursor location */
    'paratextProjectManager.broadcastCursor': (
      username: string,
      projectId: string,
      book: string,
      chapter: number,
      verse: number | null,
      offset?: number | null,
    ) => Promise<string>;
    /** Navigates Scripture Viewer to verse */
    'paratextProjectManager.navigateToVerse': (
      projectId: string,
      bookCode: string,
      chapter: number,
      verse: number,
    ) => Promise<string>;
    /** Gets the last navigated verse to prevent defaulting to RUT on mount */
    'paratextProjectManager.getLastNavigatedVerse': (
      projectId: string,
    ) => Promise<{ projectId: string; bookCode: string; chapter: number; verse: number } | null>;
  }
}
