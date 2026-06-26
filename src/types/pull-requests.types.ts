/**
 * Pull Request lifecycle. Gates prevent accidental merges: draft -> open -> needs-review ->
 * approved -> merged -> closed | expired
 *
 * - `draft`: author is still composing; not visible to voters yet.
 * - `open`: accepting votes and comments.
 * - `needs-review`: auto-triggered when a key term / \w / \nd marker changed, or a consultant
 *   downvoted; requires explicit reviewer sign-off before admin can approve.
 * - `approved`: admin approved; verse text has NOT yet been written.
 * - `merged`: verse text was written via `updateVerseText`; PR is locked.
 * - `closed`: rejected/withdrawn without merging.
 * - `expired`: auto-closed after `quorum.expiryDays` of inactivity.
 */
export type PrStatus =
  | 'draft'
  | 'open'
  | 'needs-review'
  | 'approved'
  | 'merged'
  | 'closed'
  | 'expired';

/** Reviewer roles used for role-weighted voting. */
export type ReviewerRole = 'translator' | 'consultant' | 'admin';

export interface PrVote {
  user: string;
  /** 'up' = approve, 'down' = reject. Downvotes require a `reason` (Phase 2 enforcement). */
  value: 'up' | 'down';
  reason?: string;
  role: ReviewerRole;
  /** Numeric weight contributed by this vote (translator=1, consultant=2, admin=veto). */
  weight: number;
  timestamp: string; // ISO string
}

/**
 * Alternative rendering. Each alternative is a first-class candidate with its own votes; the admin
 * picks the winner at merge time. Keeps discussion clean (no burying alternatives in comments).
 */
export interface AlternativeRendering {
  id: string; // e.g. 'A', 'B', 'C'
  text: string;
  proposedBy: string;
  votes: PrVote[];
  /** True once the admin selects this alternative as the winner during merge. */
  isSelectedWinner?: boolean;
  createdAt: string;
}

export interface PrComment {
  id: string;
  author: string;
  text: string;
  timestamp: string; // ISO string
  /** Parent comment id for threaded replies. Top-level comments have parentId = undefined. */
  parentId: string | undefined;
  /** Team members tagged via @mentions in this comment. */
  mentions: string[];
}

export interface PrHistoryEntry {
  id: string;
  actor: string;
  action: string; // e.g. 'opened', 'upvoted', 'merged', 'reverted'
  detail?: string;
  timestamp: string;
}

export interface VerseRef {
  book: string;
  chapter: number;
  verse: number;
}

/**
 * A single Pull Request. Phase 1 targets a single verse; the `hunks` field is reserved so the
 * schema can extend to multi-verse changes without breaking saved files.
 */
export interface PullRequest {
  id: number;
  ref?: VerseRef;
  /** Human-readable ref label, e.g. "MAT 5:3" or "General". */
  refLabel: string;
  title: string;
  status: PrStatus;
  author: string;
  /** Short initials for avatar rendering. */
  avatar: string;
  createdAt: string; // ISO string
  /** ISO timestamp of the last activity (vote/comment/status change). Drives expiry sweep. */
  updatedAt: string;
  /** Original USFM verse text (before the change). Optional for general PRs. */
  originalText?: string;
  /** Proposed USFM verse text or decision text (after the change). */
  proposedText?: string;
  /** Author's rationale for the change. */
  rationale?: string;
  /** PR-level votes (on the proposal as a whole). */
  votes: PrVote[];
  /** Alternative renderings, each with its own votes. */
  alternatives: AlternativeRendering[];
  /** Threaded discussion comments. */
  comments: PrComment[];
  /** Audit trail. */
  history: PrHistoryEntry[];
  /** Reviewers explicitly requested to weigh in (via "Request review"). */
  requestedReviewers: string[];
  /** True when the PR was created while offline (pending sync). Phase 3. */
  createdOffline?: boolean;
  /** Kind of pull request: verse-specific or a general project policy/decision. */
  kind?: 'verse' | 'general';
  /** Reserved for future multi-verse support. */
  hunks?: never[];
  originalBackTranslation?: string;
  proposedBackTranslation?: string;
}

export interface QuorumConfig {
  /** Minimum upvote weight required before admin can approve. */
  minUpvotes: number;
  /** If true, any consultant downvote blocks approval until resolved. */
  requireNoConsultantDownvotes: boolean;
  /** If true, admin vote is a veto (a single admin downvote forces needs-review/closed). */
  adminVeto: boolean;
  /** Auto-close PRs after this many days of inactivity. 0 = never expire. */
  expiryDays: number;
  /** E-mail addresses to send PRs to. */
  consultantEmail?: string;
  orgEmail?: string;
}

export interface PullRequestsStore {
  schemaVersion: 1;
  prs: PullRequest[];
  /** Next PR id counter. */
  nextId: number;
  quorum: QuorumConfig;
  /** Maps team member name -> role. Names not present default to 'translator'. */
  teamRoles: Record<string, ReviewerRole>;
}

export const ROLE_WEIGHTS: Record<ReviewerRole, number> = {
  translator: 1,
  consultant: 2,
  admin: 1, // admin uses veto, not additive weight
};

export const DEFAULT_QUORUM: QuorumConfig = {
  minUpvotes: 2,
  requireNoConsultantDownvotes: true,
  adminVeto: true,
  expiryDays: 30,
};

export function createEmptyStore(): PullRequestsStore {
  return {
    schemaVersion: 1,
    prs: [],
    nextId: 1,
    quorum: { ...DEFAULT_QUORUM },
    teamRoles: {},
  };
}
