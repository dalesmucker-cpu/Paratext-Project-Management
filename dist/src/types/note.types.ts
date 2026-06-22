export interface ParatextComment {
  user: string;
  date: string; // ISO timestamp
  contents: string; // HTML contents
  plainText: string; // stripped text for preview/search
  status: string; // "todo" | "deleted" | ""
  type: string; // "conflict" | ""
  replyToUser: string;
  sourceFile: string;
}

export interface ParatextNoteThread {
  threadId: string;
  verseRef: string;
  selectedText: string;
  book: string;
  chapter: number;
  verse: number;
  comments: ParatextComment[];
  latestDate: string;
  latestUser: string;
  status: string;
  type: string;
  assignedUser: string;
  isUnread: boolean;
  // Metadata for replying
  language: string;
  startPosition: string;
  contextBefore: string;
  contextAfter: string;
  verseXml: string; // <Verse> content
  hideInTextWindow: string;
}

export type NotesSortBy = 'most_recent' | 'oldest' | 'book_order' | 'unread_first';

export interface NotesDisplaySettings {
  showMode: 'all' | 'unread_only'; // Show only unread or all notes
  scope: 'all' | 'assigned_to_me' | 'my_threads';
  maxAgeDays: number; // 0 for no limit, e.g. 7, 30
  limitCount: number; // e.g. 5, 10, 20
  persons: string[]; // Filter by specific authors
  sortBy?: NotesSortBy;
  textSize?: 'small' | 'medium' | 'large' | 'xlarge';
}

export const DEFAULT_NOTES_SETTINGS: NotesDisplaySettings = {
  showMode: 'unread_only',
  scope: 'all',
  maxAgeDays: 30,
  limitCount: 5,
  persons: [],
  sortBy: 'most_recent',
  textSize: 'medium',
};
