import type { MorphologyConfig, MatchResult } from '../types/key-terms.types';

export function escapeRegex(text: string): string {
  return text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
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
    
    const escapedCore = escapeRegex(coreText).replace(/\\\*/g, '.*');
    let regexStr = '';
    
    if (startsWithAsterisk && endsWithAsterisk) {
      // Substring match
      regexStr = escapedCore;
    } else if (startsWithAsterisk) {
      // Suffix match (matches end of word)
      regexStr = escapedCore + '\\b';
    } else if (endsWithAsterisk) {
      // Prefix match (matches start of word)
      regexStr = '\\b' + escapedCore;
    } else {
      // Internal asterisks only
      regexStr = '\\b' + escapedCore + '\\b';
    }
    
    const regex = new RegExp(regexStr, 'i');
    const match = verseText.match(regex);
    if (match) {
      return {
        found: true,
        matchType: 'wildcard',
        matchedText: match[0],
        confidence: 0.95
      };
    }
  }

  // 2. Exact match (without affixes)
  const escapedExact = escapeRegex(cleanRendering);
  const exactRegex = new RegExp(`\\b${escapedExact}\\b`, 'i');
  const exactMatch = verseText.match(exactRegex);
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
    
    const affixRegex = new RegExp(`\\b${prefixPart}${escapedExact}${suffixPart}\\b`, 'i');
    const affixMatch = verseText.match(affixRegex);
    if (affixMatch) {
      return {
        found: true,
        matchType: 'affix',
        matchedText: affixMatch[0],
        confidence: 0.85
      };
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
