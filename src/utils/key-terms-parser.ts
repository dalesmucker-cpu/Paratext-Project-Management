import type { KeyTermsStore } from '../types/key-terms.types';

/**
 * Combines BiblicalTerms.xml and TermRenderings.xml files to produce the initial KeyTermsStore.
 * Delegates the heavy XML parsing to the background file helper child process.
 */
export async function loadLegacyKeyTermsAsync(
  pt9ListsDir: string,
  projectDir: string,
  languageCode: 'en' | 'es' = 'es',
  fileReader: (action: string, path: string, stdin?: string) => Promise<string>,
): Promise<KeyTermsStore> {
  const stdinData = JSON.stringify({ pt9ListsDir, languageCode });
  const resultJson = await fileReader('loadlegacykeyterms', projectDir, stdinData);
  return JSON.parse(resultJson) as KeyTermsStore;
}
