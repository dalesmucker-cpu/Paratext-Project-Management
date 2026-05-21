# Track Changes: Mercurial-Based Read-Only Viewer

## Overview

Rewrite the Track Changes extension from an inline editor to a **read-only diff viewer**
that pulls version history from the project's Mercurial (.hg) repository. Users select two
revisions to compare, and the view shows verse-by-verse changes with accept/reject per verse.

## Key Decisions

- **Accept verse** = commit the current text to hg (marks it as approved)
- **Reject verse** = revert the verse in the .SFM file on disk to the base revision text
- **Accept All / Reject All** = applies to all changed verses currently displayed
- **Read-only display** — no editing in the track changes window

## Architecture

### Backend (main.ts)

Shell out to `C:\Program Files\TortoiseHg\hg.exe` from the extension host via Node child_process.

Commands:

1. `getRevisions(projectId, bookId)` — returns last ~50 revisions for the book's SFM file
2. `getFileAtRevision(projectId, bookId, rev)` — returns full USFM text at a given revision
3. `acceptVerse(projectId)` — runs `hg commit` on the current SFM file to mark text as accepted
4. `revertVerse(projectId, bookId, chapter, verse, oldVerseText)` — reads the current SFM file,
   replaces the specific verse content, writes the file back to disk

Project path resolution: scan `~/.paratext-10-studio/projects/Paratext 9 Projects/*/Settings.xml`
for matching `<Guid>` to find the project directory from the Paranext projectId.

SFM filename: built from `FileNameBookNameForm` pattern in Settings.xml
(e.g., `05DEU` + `VMM.SFM` → `05DEUVMM.SFM`).

### Diff Engine (verse-diff.ts)

- `parseVerses(usfmText)` — parse USFM into a Map<string, string> keyed by `"chapter:verse"`
- `diffVerses(oldVerses, newVerses)` — compare two verse maps, return `VerseDiff[]`
  with type `modified`, `added`, or `removed`
- `diffWords(oldText, newText)` — word-level diff within a verse (reuses existing LCS algorithm)

### Frontend (track-changes.web-view.tsx)

- **Two dropdown selectors**: "Base revision" (older) and "Compare revision" (newer/working)
  - Default: most recent commit vs current working copy
  - Each option shows: `rev# · author · date`
- **Verse list**: only changed verses displayed, grouped by chapter
  - Each verse block shows verse ref + inline word diff (red/green/blue)
  - Per-verse Accept and Reject buttons
- **Toolbar**: project selector, revision dropdowns, Accept All, Reject All, change count
- **No editing** — purely a review/comparison view

### Types

- `RevisionInfo { rev: number, hash: string, author: string, date: string }`
- `VerseDiff { book: string, chapter: number, verse: number | string, oldText: string,
newText: string, type: 'modified' | 'added' | 'removed' }`
- `WordDiff { type: 'equal' | 'insert' | 'delete' | 'move', text: string }`

### Renderer (verse-renderer.tsx)

- Renders a list of VerseDiff blocks
- Each block: verse reference header, word-level highlighted text, accept/reject buttons
- Red strikethrough for deleted words, green underline for inserted, blue wavy for moved

## Files Changed

| File                                    | Action                                       |
| --------------------------------------- | -------------------------------------------- |
| `src/types/track-changes.types.ts`      | Rewrite — new types                          |
| `src/types/paratext-track-changes.d.ts` | Update command declarations                  |
| `src/main.ts`                           | Rewrite — hg integration, project resolution |
| `src/track-changes.web-view.tsx`        | Rewrite — read-only viewer                   |
| `src/utils/usj-diff.ts`                 | Delete, replace with `verse-diff.ts`         |
| `src/utils/verse-diff.ts`               | New — USFM parser + verse differ             |
| `src/utils/usj-renderer.tsx`            | Delete, replace with `verse-renderer.tsx`    |
| `src/utils/verse-renderer.tsx`          | New — verse diff block renderer              |
| `src/utils/change-operations.ts`        | Delete — no longer needed                    |
| `src/track-changes.web-view.scss`       | Update — new layout styles                   |

## Implementation Phases

### Phase 1: Types + USFM verse parser + word diff

### Phase 2: Backend — hg integration, project resolution, commands

### Phase 3: Frontend — read-only viewer with revision selectors

### Phase 4: Renderer + styles

### Phase 5: Lint, build, package, install
