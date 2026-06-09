import { BIBLE_BOOKS } from '../types/shared.constants';
import type { KeyTerm, Rendering, KeyTermsStore, MorphologyConfig } from '../types/key-terms.types';


/**
 * Parses the main BiblicalTerms.xml list.
 */
export function parseBiblicalTermsXml(xmlContent: string): Map<string, {
  strongs?: string;
  transliteration?: string;
  category?: string;
  domain?: string;
  gloss: string;
  definition?: string;
  references: string[];
}> {
  const termsMap = new Map();
  const termRegex = /<Term\s+Id="([^"]+)">([\s\S]*?)<\/Term>/g;
  let match;
  
  while ((match = termRegex.exec(xmlContent)) !== null) {
    const id = match[1];
    const body = match[2];
    
    const strongMatch = /<Strong>([^<]*)<\/Strong>/i.exec(body);
    const translitMatch = /<Transliteration>([^<]*)<\/Transliteration>/i.exec(body);
    const catMatch = /<Category>([^<]*)<\/Category>/i.exec(body);
    const domMatch = /<Domain>([^<]*)<\/Domain>/i.exec(body);
    const glossMatch = /<Gloss>([^<]*)<\/Gloss>/i.exec(body);
    const defMatch = /<Definition>([^<]*)<\/Definition>/i.exec(body);
    
    const refs: string[] = [];
    const refRegex = /<Verse>([^<]+)<\/Verse>/g;
    let refMatch;
    while ((refMatch = refRegex.exec(body)) !== null) {
      refs.push(refMatch[1]);
    }
    
    termsMap.set(id, {
      strongs: strongMatch ? strongMatch[1].trim() : undefined,
      transliteration: translitMatch ? translitMatch[1].trim() : undefined,
      category: catMatch ? catMatch[1].trim() : undefined,
      domain: domMatch ? domMatch[1].trim() : undefined,
      gloss: glossMatch ? glossMatch[1].trim() : '',
      definition: defMatch ? defMatch[1].trim() : undefined,
      references: refs
    });
  }
  
  return termsMap;
}

/**
 * Parses language-specific localizations (e.g. BiblicalTermsEs.xml).
 */
export function parseLocalizationsXml(xmlContent: string): Map<string, { gloss: string; definition: string }> {
  const locMap = new Map();
  const locRegex = /<Localization\s+Id="([^"]+)"\s+Gloss="([^"]*)"[^>]*>([\s\S]*?)<\/Localization>/g;
  let match;
  
  while ((match = locRegex.exec(xmlContent)) !== null) {
    const id = match[1];
    const gloss = match[2];
    const definition = match[3].trim();
    locMap.set(id, { gloss, definition });
  }
  
  return locMap;
}

/**
 * Parses a project's TermRenderings.xml file.
 */
export function parseTermRenderingsXml(xmlContent: string): Map<string, string[]> {
  const renderingsMap = new Map();
  const trRegex = /<TermRendering\s+Id="([^"]+)"[^>]*>([\s\S]*?)<\/TermRendering>/g;
  let match;
  
  while ((match = trRegex.exec(xmlContent)) !== null) {
    const id = match[1];
    const body = match[2];
    
    const rMatch = /<Renderings>([^<]*)<\/Renderings>/i.exec(body);
    if (rMatch) {
      const rendsStr = rMatch[1].trim();
      if (rendsStr) {
        const list = rendsStr.split('||').map(r => r.trim()).filter(Boolean);
        renderingsMap.set(id, list);
      }
    }
  }
  
  return renderingsMap;
}

/**
 * Converts a 14-digit Paratext verse reference (BBBCCCVVVWWWWW) to standard "BOOK C:V".
 */
export function convertVerseRef(verseRef14: string): string {
  if (verseRef14.length < 9) return verseRef14;
  const bookNum = parseInt(verseRef14.substring(0, 3), 10);
  const chapterNum = parseInt(verseRef14.substring(3, 6), 10);
  const verseNum = parseInt(verseRef14.substring(6, 9), 10);
  
  const bookCode = BIBLE_BOOKS[bookNum - 1];
  if (!bookCode) return `${bookNum} ${chapterNum}:${verseNum}`;
  return `${bookCode} ${chapterNum}:${verseNum}`;
}

/**
 * Combines BiblicalTerms.xml and TermRenderings.xml files to produce the initial KeyTermsStore.
 * Asynchronous pure function that doesn't import fs or path.
 */
export async function loadLegacyKeyTermsAsync(
  pt9ListsDir: string,
  projectDir: string,
  languageCode: 'en' | 'es' = 'es',
  fileReader: (action: string, path: string) => Promise<string>
): Promise<KeyTermsStore> {
  const isWindows = pt9ListsDir.includes('\\') || projectDir.includes('\\');
  const sep = isWindows ? '\\' : '/';
  
  const mainXmlPath = `${pt9ListsDir}${sep}BiblicalTerms.xml`;
  const locXmlPath = `${pt9ListsDir}${sep}${languageCode === 'es' ? 'BiblicalTermsEs.xml' : 'BiblicalTermsEn.xml'}`;
  const renderingsXmlPath = `${projectDir}${sep}TermRenderings.xml`;

  let termsMap = new Map();
  let locMap = new Map();
  let renderingsMap = new Map();

  try {
    const mainExists = await fileReader('exists', mainXmlPath);
    if (mainExists.trim() === 'true') {
      const content = await fileReader('read', mainXmlPath);
      termsMap = parseBiblicalTermsXml(content);
    }
  } catch (e) {
    console.error('Failed to parse BiblicalTerms.xml:', e);
  }

  try {
    const locExists = await fileReader('exists', locXmlPath);
    if (locExists.trim() === 'true') {
      const content = await fileReader('read', locXmlPath);
      locMap = parseLocalizationsXml(content);
    }
  } catch (e) {
    console.error('Failed to parse BiblicalTerms localizations:', e);
  }

  try {
    const rendExists = await fileReader('exists', renderingsXmlPath);
    if (rendExists.trim() === 'true') {
      const content = await fileReader('read', renderingsXmlPath);
      renderingsMap = parseTermRenderingsXml(content);
    }
  } catch (e) {
    console.error('Failed to parse TermRenderings.xml:', e);
  }

  const terms: KeyTerm[] = [];
  
  termsMap.forEach((termData, id) => {
    const loc = locMap.get(id);
    const gloss = loc ? loc.gloss : termData.gloss;
    
    const projectRenderings = renderingsMap.get(id) || [];
    
    // Map legacy string renderings to our status-pipeline Rendering objects
    const renderings: Rendering[] = projectRenderings.map((text: string, idx: number) => ({
      id: `r-${idx}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      text,
      status: 'approved', // Legacy items are treated as approved
      contextTags: [],
      votes: [],
      proposedBy: 'Legacy Import',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));

    // Convert references to standard notation
    const cleanRefs = (termData.references || []).map(convertVerseRef);

    terms.push({
      id,
      lemma: id.replace(/-\d+$/, ''), // Strip homonym suffix for clean lemma display
      strongs: termData.strongs,
      transliteration: termData.transliteration,
      gloss,
      domains: termData.domain ? termData.domain.split(';').map((d: string) => d.trim()).filter(Boolean) : [],
      references: cleanRefs,
      renderings,
      notes: [],
      updatedAt: new Date().toISOString()
    });
  });

  const morphologyConfig: MorphologyConfig = {
    languageName: languageCode === 'es' ? 'Español' : 'English',
    prefixes: [],
    suffixes: [],
    enableFuzzyMatch: true,
    maxEditDistance: 2
  };

  return {
    schemaVersion: 1,
    morphologyConfig,
    terms
  };
}
