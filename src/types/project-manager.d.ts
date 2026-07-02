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
    /** Lightweight ping that returns 'pong' instantly — used by the disconnect heartbeat */
    'paratextProjectManager.ping': () => Promise<string>;
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
    /** Opens the Drafting Terms web view (key terms for the selected verse) for a project */
    'paratextProjectManager.openDraftingTerms': (projectId?: string) => Promise<string | undefined>;
    /** Broadcasts a verse-selection event (from Scripture Viewer) to the Drafting Terms window */
    'paratextProjectManager.selectVerse': (
      projectId: string,
      bookCode: string,
      chapter: number,
      verse: number,
    ) => Promise<string>;
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
    /** Gets raw USFM text for a chapter (markers preserved). */
    'paratextProjectManager.getChapterRawUsfm': (
      projectId: string,
      bookCode: string,
      chapter: number,
    ) => Promise<string>;
    /** Saves raw USFM text for a whole chapter (markers preserved). */
    'paratextProjectManager.saveChapterRawUsfm': (
      projectId: string,
      bookCode: string,
      chapter: number,
      rawUsfm: string,
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
    /** Manually retries a connection using the last saved parameters */
    'paratextProjectManager.reconnectCollab': () => Promise<any>;
    /** Gets the current collaboration status */
    'paratextProjectManager.getCollabStatus': () => Promise<any>;
    /** Sends a collaboration chat message */
    'paratextProjectManager.sendCollabChat': (username: string, message: string) => Promise<string>;
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
    /** Gets the update status notice if an update was recently applied */
    'paratextProjectManager.getUpdateStatus': () => Promise<string | null>;
    /** Opens the Key Terms Checker web view for a project */
    'paratextProjectManager.openKeyTerms': (projectId?: string) => Promise<string | undefined>;
    /** Gets all key terms data for a project */
    'paratextProjectManager.getKeyTermsData': (projectId: string) => Promise<string>;
    /** Saves key terms data for a project */
    'paratextProjectManager.saveKeyTermsData': (
      projectId: string,
      dataJson: string,
    ) => Promise<string>;
    /** Scans a chapter's USFM for key terms and renderings match status */
    'paratextProjectManager.scanChapterRenderings': (
      projectId: string,
      bookCode: string,
      chapter: number,
    ) => Promise<string>;
    /** Scans an entire book's USFM for key terms and renderings match status */
    'paratextProjectManager.scanBookRenderings': (
      projectId: string,
      bookCode: string,
    ) => Promise<string>;
    /** Opens the Key Terms Analytics dashboard web view for a project */
    'paratextProjectManager.openKeyTermsAnalytics': (
      projectId?: string,
    ) => Promise<string | undefined>;
    /** Opens the Pull Requests web view for a project */
    'paratextProjectManager.openPullRequests': (projectId?: string) => Promise<string | undefined>;
    /** Gets all pull requests data for a project (PullRequestsStore JSON) */
    'paratextProjectManager.getPullRequests': (projectId: string) => Promise<string>;
    /** Saves pull requests data for a project (PullRequestsStore JSON) */
    'paratextProjectManager.savePullRequests': (
      projectId: string,
      storeJson: string,
    ) => Promise<string>;
    /** Approves a PR and merges its proposed verse text into the USFM file */
    'paratextProjectManager.approveAndMergePullRequest': (
      projectId: string,
      prId: number,
      approverUser: string,
    ) => Promise<string>;
    /** Creates a new pull request for a verse change */
    'paratextProjectManager.createPullRequest': (
      projectId: string,
      book: string,
      chapter: number,
      verse: number,
      title: string,
      originalText: string,
      proposedText: string,
      rationale: string,
      author: string,
      status?: 'draft' | 'open',
    ) => Promise<string>;
    /** Gets team member roles (name -> translator|consultant|admin) */
    'paratextProjectManager.getTeamRoles': () => Promise<string>;
    /** Sets team member roles */
    'paratextProjectManager.setTeamRoles': (rolesJson: string) => Promise<string>;
    /** Gets quorum config for a project */
    'paratextProjectManager.getPrQuorumConfig': (projectId: string) => Promise<string>;
    /** Sets quorum config for a project */
    'paratextProjectManager.setPrQuorumConfig': (
      projectId: string,
      quorumJson: string,
    ) => Promise<string>;
    /** Casts a vote on a PR (downvote requires reason) */
    'paratextProjectManager.castPrVote': (
      projectId: string,
      prId: number,
      user: string,
      value: 'up' | 'down',
      reason: string,
    ) => Promise<string>;
    /** Changes a PR's status (cannot merge — use approveAndMergePullRequest) */
    'paratextProjectManager.setPrStatus': (
      projectId: string,
      prId: number,
      newStatus: string,
      actor: string,
    ) => Promise<string>;
    /** Reverts a merged PR by creating a new PR that restores the original text */
    'paratextProjectManager.revertPullRequest': (
      projectId: string,
      prId: number,
      actor: string,
    ) => Promise<string>;
    /** Opens the Pull Requests tab at a specific PR (notification click-through) */
    'paratextProjectManager.openPullRequestsAt': (notificationId: string | number) => Promise<void>;
    /** Gets team members list */
    'paratextProjectManager.getTeamMembers': () => Promise<string>;
    /** Sets team members list */
    'paratextProjectManager.setTeamMembers': (membersJson: string) => Promise<string>;
    /** Gets projects pending tasks-drive sync */
    'paratextProjectManager.tasksDriveGetPendingSync': () => Promise<string>;
    /** Emits key term selection event */
    'paratextProjectManager.selectKeyTerm': (projectId: string, termId: string) => Promise<string>;
    /**
     * Emits a network event asking the Key Terms view to add a rendering (from Scripture selection)
     * to its currently-selected term
     */
    'paratextProjectManager.addRenderingToSelectedTerm': (
      projectId: string,
      renderingText: string,
      verseRef: string,
    ) => Promise<string>;
    /** Broadcasts live verse editing cursor / typing events */
    'paratextProjectManager.broadcastVerseEdit': (
      username: string,
      projectId: string,
      book: string,
      chapter: number,
      verse: number,
      newText: string,
    ) => Promise<string>;
    /** Gets Google Calendar connection status */
    'paratextProjectManager.gcalGetStatus': () => Promise<string>;
    /** Connects Google Calendar using Client ID and Secret */
    'paratextProjectManager.gcalConnect': (
      clientId: string,
      clientSecret: string,
    ) => Promise<string>;
    /** Reconnects Google Calendar using existing config credentials */
    'paratextProjectManager.gcalReconnect': () => Promise<string>;
    /** Polls Google Calendar OAuth flow status */
    'paratextProjectManager.gcalPollAuth': () => string;
    /** Disconnects Google Calendar connection */
    'paratextProjectManager.gcalDisconnect': () => Promise<string>;
    /** Lists calendars from Google Calendar account */
    'paratextProjectManager.gcalListCalendars': () => Promise<string>;
    /** Sets active calendar ID in Google Calendar config */
    'paratextProjectManager.gcalSetCalendarId': (calendarId: string) => Promise<string>;
    /** Syncs task deadlines to Google Calendar */
    'paratextProjectManager.gcalSyncDeadlines': (projectId: string) => Promise<string>;
    /** Gets Google Calendar events for a range */
    'paratextProjectManager.gcalGetEvents': (
      calendarId: string,
      timeMin: string,
      timeMax: string,
    ) => Promise<string>;
    /** Deletes an event from Google Calendar */
    'paratextProjectManager.gcalDeleteEvent': (
      calendarId: string,
      eventId: string,
    ) => Promise<string>;
    /** Syncs a single time log entry to Google Calendar */
    'paratextProjectManager.gcalSyncTimeEntry': (
      timeEntryJson: string,
      taskLabel: string,
      calendarId: string,
    ) => Promise<string>;
    /** Flushes pending time entries to Google Calendar */
    'paratextProjectManager.gcalFlushPendingTime': () => Promise<string>;
    /** Saves content to Downloads and tries to open it */
    'paratextProjectManager.saveToDownloads': (
      filename: string,
      content: string,
    ) => Promise<string>;
    /** Starts the Drive OAuth flow in the background */
    'paratextProjectManager.tasksDriveStartAuth': (
      clientId: string,
      clientSecret: string,
    ) => Promise<string>;
    /** Polls the Drive OAuth flow status */
    'paratextProjectManager.tasksDrivePollAuth': () => Promise<string>;
    /** Gets Drive sync status */
    'paratextProjectManager.tasksDriveGetStatus': () => Promise<string>;
    /** Exports the Drive sync config JSON string */
    'paratextProjectManager.tasksDriveExportConfig': () => Promise<string>;
    /** Imports the Drive sync config JSON string */
    'paratextProjectManager.tasksDriveImportConfig': (configJson: string) => Promise<string>;
    /** Force-syncs a project's local tasks file to Drive */
    'paratextProjectManager.tasksDriveForceSyncProject': (projectId: string) => Promise<string>;
    /** Tests the Drive connection with a small payload */
    'paratextProjectManager.tasksDriveTest': () => Promise<string>;
    /** Opens Hebrew/Greek dictionary on STEP Bible website for a strong number or term */
    'paratextProjectManager.openHebrewGreekDictionary': (term: string) => Promise<string>;
  }
}

declare module '*?inline' {
  const content: string;
  export default content;
}
