import type { MorphologyConfig, MatchResult } from '../types/key-terms.types';

export function escapeRegex(text: string): string {
  return text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Unicode-aware word boundary patterns that handle accented characters (Spanish, etc.)
 * Standard JS \b treats accented letters as non-word characters.
 */
const UNI_WORD_CHAR = '[\\p{L}\\p{N}_]';

/**
 * Build a Unicode-aware regex for a word, wrapping with lookahead/lookbehind
 * to simulate word boundaries that respect accented letters.
 */
function unicodeWordRegex(pattern: string, flags = 'gi'): RegExp {
  // Use lookahead/lookbehind instead of \b for Unicode compatibility
  return new RegExp(`(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`, flags + 'u');
}

/**
 * Checks if a rendering text matches a verse text using morphology and wildcard configurations.
 */
export function matchRendering(
  verseText: string,
  renderingText: string,
  morphConfig: MorphologyConfig
): MatchResult {
  const cleanRendering = renderingText.trim();
  if (!cleanRendering) {
    return { found: false, matchType: 'none', confidence: 0 };
  }

  // 1. Handle wildcard asterisks (backward compatibility with existing Paratext wildcards)
  const hasAsterisk = cleanRendering.includes('*');
  if (hasAsterisk) {
    const startsWithAsterisk = cleanRendering.startsWith('*');
    const endsWithAsterisk = cleanRendering.endsWith('*');
    
    let coreText = cleanRendering;
    if (startsWithAsterisk) coreText = coreText.slice(1);
    if (endsWithAsterisk) coreText = coreText.slice(0, -1);
    
    const escapedCore = escapeRegex(coreText).replace(/\\\*/g, '[\\p{L}\\p{N}_]*');
    
    // Unicode-aware word character sequences
    let regexStr = '';
    
    if (startsWithAsterisk && endsWithAsterisk) {
      // Substring match: match the entire word containing the core
      regexStr = `(?<![\\p{L}\\p{N}_])[\\p{L}\\p{N}_]*${escapedCore}[\\p{L}\\p{N}_]*(?![\\p{L}\\p{N}_])`;
    } else if (startsWithAsterisk) {
      // Suffix match: match the entire word ending with the core
      regexStr = `(?<![\\p{L}\\p{N}_])[\\p{L}\\p{N}_]*${escapedCore}(?![\\p{L}\\p{N}_])`;
    } else if (endsWithAsterisk) {
      // Prefix match: match the entire word starting with the core
      regexStr = `(?<![\\p{L}\\p{N}_])${escapedCore}[\\p{L}\\p{N}_]*(?![\\p{L}\\p{N}_])`;
    } else {
      // Internal asterisks only
      regexStr = `(?<![\\p{L}\\p{N}_])${escapedCore}(?![\\p{L}\\p{N}_])`;
    }
    
    try {
      const regex = new RegExp(regexStr, 'iu');
      const match = verseText.match(regex);
      if (match) {
        return {
          found: true,
          matchType: 'wildcard',
          matchedText: match[0],
          confidence: 0.95
        };
      }
    } catch (_) {
      // Fallback for engines without Unicode property escapes
      const fallbackRegex = new RegExp(regexStr.replace(/\\p\{[LN]\}/g, '\\w').replace(/\\p\{N\}/g, '\\d'), 'i');
      const match = verseText.match(fallbackRegex);
      if (match) {
        return { found: true, matchType: 'wildcard', matchedText: match[0], confidence: 0.95 };
      }
    }
  }

  // 2. Exact match (without affixes) - Unicode-aware boundaries
  const escapedExact = escapeRegex(cleanRendering);
  let exactMatch: RegExpMatchArray | null = null;
  try {
    const exactRegex = unicodeWordRegex(escapedExact);
    exactMatch = verseText.match(exactRegex);
  } catch (_) {
    // Fallback to simple case-insensitive search
    const idx = verseText.toLowerCase().indexOf(cleanRendering.toLowerCase());
    if (idx !== -1) {
      exactMatch = [verseText.slice(idx, idx + cleanRendering.length)] as any;
    }
  }
  if (exactMatch) {
    return {
      found: true,
      matchType: 'exact',
      matchedText: exactMatch[0],
      confidence: 1.0
    };
  }

  // 3. Affix matching (if enabled and configuration has active affixes)
  const activePrefixes = morphConfig.prefixes ? morphConfig.prefixes.filter(p => p.enabled) : [];
  const activeSuffixes = morphConfig.suffixes ? morphConfig.suffixes.filter(s => s.enabled) : [];
  if (activePrefixes.length > 0 || activeSuffixes.length > 0) {
    let prefixPart = '';
    let suffixPart = '';
    if (activePrefixes.length > 0) {
      const pJoined = activePrefixes.map(p => escapeRegex(p.affix.replace(/-$/, ''))).join('|');
      prefixPart = `(?:${pJoined})?`;
    }
    if (activeSuffixes.length > 0) {
      const sJoined = activeSuffixes.map(s => escapeRegex(s.affix.replace(/^-/, ''))).join('|');
      suffixPart = `(?:${sJoined})?`;
    }
    
    try {
      const affixRegexStr = `(?<![\\p{L}\\p{N}_])${prefixPart}${escapedExact}${suffixPart}(?![\\p{L}\\p{N}_])`;
      const affixRegex = new RegExp(affixRegexStr, 'iu');
      const affixMatch = verseText.match(affixRegex);
      if (affixMatch) {
        return {
          found: true,
          matchType: 'affix',
          matchedText: affixMatch[0],
          confidence: 0.85
        };
      }
    } catch (_) {
      // Fallback without Unicode property escapes
      const affixRegex = new RegExp(`\\b${prefixPart}${escapedExact}${suffixPart}\\b`, 'i');
      const affixMatch = verseText.match(affixRegex);
      if (affixMatch) {
        return { found: true, matchType: 'affix', matchedText: affixMatch[0], confidence: 0.85 };
      }
    }
  }

  // 3.5 Infix matching (if enabled and configuration has active infixes)
  const activeInfixes = morphConfig.infixes ? morphConfig.infixes.filter(i => i.enabled) : [];
  if (activeInfixes.length > 0) {
    const rawInfixes = activeInfixes.map(i => i.affix.replace(/^-|-$/g, '').trim()).filter(Boolean);
    if (rawInfixes.length > 0) {
      // Build a pattern that allows infixes to optionally appear between any characters of the rendering.
      // E.g., for "dawan" and infix "in", it produces "d(?:in)?a(?:in)?w(?:in)?a(?:in)?n"
      const escapedChars = [...cleanRendering].map(c => escapeRegex(c));
      const infixPattern = `(?:${rawInfixes.map(escapeRegex).join('|')})`;
      
      // Join characters with the optional infix pattern
      const infixRegexStr = `(?<![\\p{L}\\p{N}_])${escapedChars.join(`${infixPattern}?`)}(?![\\p{L}\\p{N}_])`;
      
      try {
        const infixRegex = new RegExp(infixRegexStr, 'iu');
        const infixMatch = verseText.match(infixRegex);
        if (infixMatch) {
          return {
            found: true,
            matchType: 'affix',
            matchedText: infixMatch[0],
            confidence: 0.85
          };
        }
      } catch (_) {
        // Fallback without Unicode property escapes
        try {
          const fallbackInfixRegex = new RegExp(`\\b${escapedChars.join(`${infixPattern}?`)}\\b`, 'i');
          const infixMatch = verseText.match(fallbackInfixRegex);
          if (infixMatch) {
            return { found: true, matchType: 'affix', matchedText: infixMatch[0], confidence: 0.85 };
          }
        } catch (_) {}
      }
    }
  }

  // 4. Levenshtein Fuzzy matching (if enabled)
  if (morphConfig.enableFuzzyMatch) {
    const words = verseText.split(/[\s.,;:!?"'()\[\]“”‘’]+/);
    let bestWord = '';
    let bestDist = Infinity;
    
    for (const w of words) {
      const cleanWord = w.trim();
      if (cleanWord.length < Math.min(4, cleanRendering.length)) continue;
      
      const dist = levenshteinDistance(cleanWord.toLowerCase(), cleanRendering.toLowerCase());
      if (dist < bestDist) {
        bestDist = dist;
        bestWord = cleanWord;
      }
    }
    
    if (bestDist <= morphConfig.maxEditDistance) {
      return {
        found: true,
        matchType: 'fuzzy',
        matchedText: bestWord,
        editDistance: bestDist,
        confidence: Math.max(0.1, 1.0 - (bestDist / (cleanRendering.length + 1)))
      };
    }
  }

  return { found: false, matchType: 'none', confidence: 0 };
}

/**
 * Computes Levenshtein distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix = Array.from({ length: b.length + 1 }, () => Array(a.length + 1).fill(0));
  
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      if (b[j - 1] === a[i - 1]) {
        matrix[j][i] = matrix[j - 1][i - 1];
      } else {
        matrix[j][i] = Math.min(
          matrix[j - 1][i] + 1,    // deletion
          matrix[j][i - 1] + 1,    // insertion
          matrix[j - 1][i - 1] + 1 // substitution
        );
      }
    }
  }
  return matrix[b.length][a.length];
}
