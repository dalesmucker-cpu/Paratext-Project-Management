/**
 * USFM-aware diff engine.
 *
 * Translators need to see what changed in _meaning_, not just characters. This tokenizer splits
 * USFM into marker-aware segments (markers like \w, \f, \nd, \v plus words and whitespace) and runs
 * a word-level LCS so added/removed content is highlighted with its enclosing marker context.
 *
 * The output drives the diff rendering in the Pull Requests view: equal/insert/delete segments with
 * a `marker` classification so the UI can color wordlist (\w), footnote (\f), and divine-name (\nd)
 * changes distinctly, plus a summary that flags which semantic categories changed.
 */

export type UsfmTokenType = 'marker' | 'word' | 'space';

export interface UsfmToken {
  kind: UsfmTokenType;
  text: string;
  /** For markers: the bare marker name without backslash or closing star (e.g. 'w', 'f', 'nd', 'v'). */
  marker?: string;
  /** True for closing markers like \w*, \f*, \nd*. */
  closing?: boolean;
}

export type DiffOp = 'equal' | 'insert' | 'delete';

export interface UsfmDiffSegment {
  op: DiffOp;
  kind: UsfmTokenType;
  text: string;
  /**
   * Marker name this segment belongs to (for marker tokens, the marker itself; for text, the
   * enclosing open marker, e.g. 'w' / 'f' / 'nd', or undefined for plain verse text).
   */
  marker?: string;
}

export interface UsfmDiffSummary {
  /** Plain verse wording changed (outside any special marker). */
  textChanged: boolean;
  /** A wordlist (\w) token was added/removed. */
  wordlistChanged: boolean;
  /** A footnote (\f) token was added/removed. */
  footnoteChanged: boolean;
  /** A divine-name (\nd) token was added/removed. */
  divineNameChanged: boolean;
  /** Net word count delta (inserted - deleted word tokens). */
  wordDelta: number;
  /** Short human-readable label, e.g. "+1 wording", "footnote changed". */
  label: string;
}

const MARKER_RE = /\\([a-z]+[0-9]*)(\*?)/g;

/**
 * Tokenize a USFM string into markers, words, and whitespace runs. Punctuation stays attached to
 * the nearest word so the diff reads naturally.
 */
export function tokenizeUsfm(text: string): UsfmToken[] {
  const tokens: UsfmToken[] = [];
  const matches = Array.from(text.matchAll(MARKER_RE));
  let last = 0;
  matches.forEach((match) => {
    if (match.index > last) {
      pushTextTokens(tokens, text.slice(last, match.index));
    }
    tokens.push({
      kind: 'marker',
      text: match[0],
      marker: match[1],
      closing: match[2] === '*',
    });
    last = match.index + match[0].length;
  });
  if (last < text.length) {
    pushTextTokens(tokens, text.slice(last));
  }
  return tokens;
}

function pushTextTokens(tokens: UsfmToken[], chunk: string): void {
  // Split into whitespace runs and non-whitespace words (punctuation stays with the word).
  chunk
    .split(/(\s+)/)
    .filter((part) => part !== '')
    .forEach((part) => {
      if (/^\s+$/.test(part)) {
        tokens.push({ kind: 'space', text: part });
      } else {
        tokens.push({ kind: 'word', text: part });
      }
    });
}

/**
 * Compute the enclosing open marker for each text token by walking the stream with a stack. Returns
 * a parallel array of marker names (or undefined) for non-marker tokens. Marker tokens map to their
 * own marker name.
 */
function computeMarkerContext(tokens: UsfmToken[]): (string | undefined)[] {
  const stack: string[] = [];
  return tokens.map((tok) => {
    if (tok.kind === 'marker') {
      if (tok.closing) {
        stack.pop();
        return tok.marker;
      }
      // Self-closing or structural markers (v, c, p, q, etc.) don't enclose content; only push
      // content-bearing markers that have a known closing form.
      if (tok.marker && isSpanMarker(tok.marker)) {
        stack.push(tok.marker);
      }
      return tok.marker;
    }
    return stack.length > 0 ? stack[stack.length - 1] : undefined;
  });
}

const SPAN_MARKERS = new Set([
  'w',
  'f',
  'nd',
  'k',
  'xo',
  'xt',
  'rq',
  'add',
  'bk',
  'dc',
  'qt',
  'sig',
  'sls',
  'em',
  'bd',
  'it',
  'bdit',
  'no',
  'sc',
  'sup',
]);

function isSpanMarker(m: string): boolean {
  return SPAN_MARKERS.has(m);
}

interface LcsOp {
  op: DiffOp;
  tok: UsfmToken;
}

/**
 * Standard dynamic-programming LCS over two token arrays, compared by `text`. Returns the merged
 * sequence of operations (equal/insert/delete). Token arrays are small (a single verse), so the
 * O(n*m) DP table is fine.
 */
function lcsTokens(a: UsfmToken[], b: UsfmToken[]): LcsOp[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = length of LCS of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (a[i].text === b[j].text && a[i].kind === b[j].kind) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }
  const out: LcsOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].text === b[j].text && a[i].kind === b[j].kind) {
      out.push({ op: 'equal', tok: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: 'delete', tok: a[i] });
      i += 1;
    } else {
      out.push({ op: 'insert', tok: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ op: 'delete', tok: a[i] });
    i += 1;
  }
  while (j < m) {
    out.push({ op: 'insert', tok: b[j] });
    j += 1;
  }
  return out;
}

/**
 * Produce a USFM-aware diff between two verse texts. Each segment carries its enclosing marker
 * context so the UI can highlight wordlist/footnote/divine-name changes distinctly.
 */
export function diffUsfm(oldText: string, newText: string): UsfmDiffSegment[] {
  const oldTokens = tokenizeUsfm(oldText);
  const newTokens = tokenizeUsfm(newText);
  const oldCtx = computeMarkerContext(oldTokens);
  const newCtx = computeMarkerContext(newTokens);

  const ops = lcsTokens(oldTokens, newTokens);
  const segments: UsfmDiffSegment[] = [];
  let oi = 0;
  let ni = 0;
  ops.forEach(({ op, tok }) => {
    const marker = op === 'insert' ? newCtx[ni] : oldCtx[oi];
    segments.push({ op, kind: tok.kind, text: tok.text, marker });
    if (op !== 'insert') oi += 1;
    if (op !== 'delete') ni += 1;
  });
  return segments;
}

/**
 * Summarize which semantic categories changed in a diff. Used to render badges like "+1 wording" or
 * "footnote changed" above the proposed text.
 */
export function summarizeUsfmDiff(segments: UsfmDiffSegment[]): UsfmDiffSummary {
  let textChanged = false;
  let wordlistChanged = false;
  let footnoteChanged = false;
  let divineNameChanged = false;
  let wordDelta = 0;

  segments.forEach((seg) => {
    if (seg.op === 'equal') return;
    if (seg.kind === 'word') {
      wordDelta += seg.op === 'insert' ? 1 : -1;
    }
    if (seg.marker === 'w') wordlistChanged = true;
    else if (seg.marker === 'f') footnoteChanged = true;
    else if (seg.marker === 'nd') divineNameChanged = true;
    else if (!seg.marker && seg.kind !== 'marker') textChanged = true;
  });

  const labels: string[] = [];
  if (textChanged) {
    labels.push(`${wordDelta > 0 ? '+' : ''}${wordDelta} wording`);
  }
  if (wordlistChanged) labels.push('key term');
  if (footnoteChanged) labels.push('footnote');
  if (divineNameChanged) labels.push('divine name');

  return {
    textChanged,
    wordlistChanged,
    footnoteChanged,
    divineNameChanged,
    wordDelta,
    label: labels.length > 0 ? labels.join(' · ') : 'no change',
  };
}
