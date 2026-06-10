import type { BibleBook } from './shared.constants';

export type RenderingStatus = 'draft' | 'proposed' | 'disputed' | 'approved';

export interface Vote {
  user: string;
  value: 'up' | 'down';
  timestamp: string; // ISO string
}

export interface TermNote {
  id: string;
  author: string;
  text: string;
  verseRef?: string; // e.g., "GEN 1:1"
  timestamp: string; // ISO string
}

export interface Rendering {
  id: string;
  text: string; // Target language rendering
  status: RenderingStatus;
  contextTags: string[]; // Semantic domain tags or categories this rendering applies to
  matchPattern?: string; // Optional regex or custom wildcard pattern for match overrides
  votes: Vote[];
  proposedBy: string;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
}

export interface KeyTerm {
  id: string; // original identifier, e.g. from BiblicalTerms.xml or generated
  lemma: string; // Greek or Hebrew word
  strongs?: string; // Strong's number, e.g., G3056, H7307
  transliteration?: string; // e.g. "logos", "ruach"
  gloss: string; // Gloss in English/Spanish
  domains: string[]; // Semantic domains (Louw-Nida or categories)
  references: string[]; // Verses where this term appears (format: "BOOK C:V", e.g., "GEN 1:1")
  renderings: Rendering[];
  notes: TermNote[];
  updatedAt: string; // ISO string
}

export interface AffixRule {
  id: string;
  affix: string; // e.g. "ni-", "-ini"
  label: string; // description
  enabled: boolean;
}

export interface MorphologyConfig {
  languageName: string;
  prefixes: AffixRule[];
  suffixes: AffixRule[];
  infixes?: AffixRule[];
  enableFuzzyMatch: boolean;
  maxEditDistance: number; // default: 2
}

export interface KeyTermsStore {
  schemaVersion: 1;
  morphologyConfig: MorphologyConfig;
  terms: KeyTerm[];
}

export interface MatchResult {
  found: boolean;
  matchType: 'exact' | 'regex' | 'wildcard' | 'affix' | 'fuzzy' | 'none';
  matchedText?: string;
  editDistance?: number;
  confidence: number; // 0 to 1
}

export interface VerseMatchStatus {
  reference: string; // e.g., "GEN 1:1"
  termId: string;
  lemma: string;
  gloss: string;
  expectedRenderings: string[];
  matchResult: MatchResult;
}

export interface ChapterScanResult {
  chapter: number;
  bookCode: BibleBook;
  matches: VerseMatchStatus[];
}
