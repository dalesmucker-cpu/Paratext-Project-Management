/**
 * Helper child process for file I/O operations. Invoked via createProcess.fork() from the extension
 * backend.
 *
 * Usage: fork('assets/file-helper.js', ['read', filePath]) => stdout: file contents
 *
 * Fork('assets/file-helper.js', ['write', filePath]) => reads content from stdin, writes to
 * filePath
 *
 * Fork('assets/file-helper.js', ['readdir', dirPath]) => stdout: JSON array of directory entries
 *
 * Fork('assets/file-helper.js', ['readfile', filePath]) => stdout: file contents (same as read,
 * kept for clarity)
 *
 * Fork('assets/file-helper.js', ['exists', filePath]) => stdout: 'true' or 'false'
 */

const fs = require('fs');
const path = require('path');

const [, , action, targetPath] = process.argv;

if (action === 'read' || action === 'readfile') {
  try {
    const content = fs.readFileSync(targetPath, 'utf8');
    process.stdout.write(content);
    process.exit(0);
  } catch (e) {
    process.stderr.write(e.message);
    process.exit(1);
  }
} else if (action === 'write') {
  // Read content from stdin
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    data += chunk;
  });
  process.stdin.on('end', () => {
    try {
      fs.writeFileSync(targetPath, data, 'utf8');
      process.stdout.write('ok');
      process.exit(0);
    } catch (e) {
      process.stderr.write(e.message);
      process.exit(1);
    }
  });
  process.stdin.resume();
} else if (action === 'readdir') {
  try {
    const entries = fs.readdirSync(targetPath);
    process.stdout.write(JSON.stringify(entries));
    process.exit(0);
  } catch (e) {
    process.stderr.write(e.message);
    process.exit(1);
  }
} else if (action === 'exists') {
  try {
    const exists = fs.existsSync(targetPath);
    process.stdout.write(exists ? 'true' : 'false');
    process.exit(0);
  } catch (e) {
    process.stderr.write(e.message);
    process.exit(1);
  }
} else if (action === 'readxml') {
  // Read a Settings.xml and extract Guid and Name
  try {
    const xml = fs.readFileSync(targetPath, 'utf8');
    const guidMatch = /<Guid>([^<]+)<\/Guid>/i.exec(xml);
    const nameMatch = /<Name>([^<]+)<\/Name>/i.exec(xml);
    const fileNamePostPartMatch = /<FileNamePostPart>([^<]+)<\/FileNamePostPart>/i.exec(xml);
    process.stdout.write(
      JSON.stringify({
        guid: guidMatch ? guidMatch[1].trim() : '',
        name: nameMatch ? nameMatch[1].trim() : '',
        fileNamePostPart: fileNamePostPartMatch ? fileNamePostPartMatch[1].trim() : '',
      }),
    );
    process.exit(0);
  } catch (e) {
    process.stderr.write(e.message);
    process.exit(1);
  }
} else if (action === 'scanprojects') {
  // Scan a directory for project directories containing Settings.xml
  // Returns JSON array of { dir, guid, name, fileNamePostPart }
  try {
    const dirs = fs.readdirSync(targetPath);
    const results = [];
    dirs.forEach((dir) => {
      const settingsPath = path.join(targetPath, dir, 'Settings.xml');
      try {
        if (!fs.existsSync(settingsPath)) return;
        const xml = fs.readFileSync(settingsPath, 'utf8');
        const guidMatch = /<Guid>([^<]+)<\/Guid>/i.exec(xml);
        const nameMatch = /<Name>([^<]+)<\/Name>/i.exec(xml);
        const fileNamePostPartMatch = /<FileNamePostPart>([^<]+)<\/FileNamePostPart>/i.exec(xml);
        results.push({
          dir: path.join(targetPath, dir),
          guid: guidMatch ? guidMatch[1].trim() : '',
          name: nameMatch ? nameMatch[1].trim() : '',
          fileNamePostPart: fileNamePostPartMatch ? fileNamePostPartMatch[1].trim() : '',
        });
      } catch (_) {
        // skip unreadable
      }
    });
    process.stdout.write(JSON.stringify(results));
    process.exit(0);
  } catch (e) {
    process.stderr.write(e.message);
    process.exit(1);
  }
} else if (action === 'open') {
  // Open a file or URL with the system's default application (Windows: start)
  const { exec } = require('child_process');
  try {
    const escaped = targetPath.replace(/"/g, '\\"');
    exec(`start "" "${escaped}"`, (err) => {
      if (err) {
        process.stderr.write(err.message);
        process.exit(1);
      } else {
        process.stdout.write('ok');
        process.exit(0);
      }
    });
  } catch (e) {
    process.stderr.write(e.message);
    process.exit(1);
  }
} else if (action === 'mkdir') {
  // Create directory (and parents) if it doesn't exist
  try {
    fs.mkdirSync(targetPath, { recursive: true });
    process.stdout.write('ok');
    process.exit(0);
  } catch (e) {
    process.stderr.write(e.message);
    process.exit(1);
  }
} else if (action === 'loadlegacykeyterms') {
  // Read params from stdin
  let stdinContent = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    stdinContent += chunk;
  });
  process.stdin.on('end', () => {
    try {
      const params = JSON.parse(stdinContent);
      const pt9ListsDir = params.pt9ListsDir;
      const projectDir = targetPath;
      const languageCode = params.languageCode || 'es';

      const BIBLE_BOOKS = [
        'GEN',
        'EXO',
        'LEV',
        'NUM',
        'DEU',
        'JOS',
        'JDG',
        'RUT',
        '1SA',
        '2SA',
        '1KI',
        '2KI',
        '1CH',
        '2CH',
        'EZR',
        'NEH',
        'EST',
        'JOB',
        'PSA',
        'PRO',
        'ECC',
        'SNG',
        'ISA',
        'JER',
        'LAM',
        'EZK',
        'DAN',
        'HOS',
        'JOL',
        'AMO',
        'OBD',
        'JON',
        'MIC',
        'NAM',
        'HAB',
        'ZEP',
        'HAG',
        'ZEC',
        'MAL',
        'MAT',
        'MRK',
        'LUK',
        'JHN',
        'ACT',
        'ROM',
        '1CO',
        '2CO',
        'GAL',
        'EPH',
        'PHP',
        'COL',
        '1TH',
        '2TH',
        '1TI',
        '2TI',
        'TIT',
        'PHM',
        'HEB',
        'JAS',
        '1PE',
        '2PE',
        '1JN',
        '2JN',
        '3JN',
        'JUD',
        'REV',
      ];

      function convertVerseRef(verseRef14) {
        if (verseRef14.length < 9) return verseRef14;
        const bookNum = parseInt(verseRef14.substring(0, 3), 10);
        const chapterNum = parseInt(verseRef14.substring(3, 6), 10);
        const verseNum = parseInt(verseRef14.substring(6, 9), 10);

        const bookCode = BIBLE_BOOKS[bookNum - 1];
        if (!bookCode) return `${bookNum} ${chapterNum}:${verseNum}`;
        return `${bookCode} ${chapterNum}:${verseNum}`;
      }

      function parseBiblicalTermsXml(xmlContent) {
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
          const refs = [];
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
            references: refs,
          });
        }
        return termsMap;
      }

      function parseLocalizationsXml(xmlContent) {
        const locMap = new Map();
        const locRegex =
          /<Localization\s+Id="([^"]+)"\s+Gloss="([^"]*)"[^>]*>([\s\S]*?)<\/Localization>/g;
        let match;
        while ((match = locRegex.exec(xmlContent)) !== null) {
          const id = match[1];
          const gloss = match[2];
          const definition = match[3].trim();
          locMap.set(id, { gloss, definition });
        }
        return locMap;
      }

      function parseTermRenderingsXml(xmlContent) {
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
              const list = rendsStr
                .split('||')
                .map((r) => r.trim())
                .filter(Boolean);
              renderingsMap.set(id, list);
            }
          }
        }
        return renderingsMap;
      }

      // Resolve main XML path based on Project settings or file presence
      let mainXmlPath = path.join(pt9ListsDir, 'BiblicalTerms.xml');
      const fallbackProjectXml = path.join(projectDir, 'ProjectBiblicalTerms.xml');
      try {
        const settingsPath = path.join(projectDir, 'Settings.xml');
        if (fs.existsSync(settingsPath)) {
          const settingsXml = fs.readFileSync(settingsPath, 'utf8');
          const settingMatch =
            /<BiblicalTermsListSetting>([^<]+)<\/BiblicalTermsListSetting>/i.exec(settingsXml);
          if (settingMatch) {
            const settingVal = settingMatch[1].trim();
            const parts = settingVal.split(':');
            if (parts.length >= 3) {
              const type = parts[0].toLowerCase();
              const filename = parts[2];
              if (type === 'project') {
                const projectXmlPath = path.join(projectDir, filename);
                if (fs.existsSync(projectXmlPath)) {
                  mainXmlPath = projectXmlPath;
                }
              } else {
                const globalXmlPath = path.join(pt9ListsDir, filename);
                if (fs.existsSync(globalXmlPath)) {
                  mainXmlPath = globalXmlPath;
                }
              }
            }
          }
        }
      } catch (err) {
        // Ignore settings read errors
      }

      // General fallback if mainXmlPath doesn't exist or is still global but project has custom file
      if (
        !fs.existsSync(mainXmlPath) ||
        mainXmlPath === path.join(pt9ListsDir, 'BiblicalTerms.xml')
      ) {
        if (fs.existsSync(fallbackProjectXml)) {
          mainXmlPath = fallbackProjectXml;
        }
      }

      const locXmlPath = path.join(
        pt9ListsDir,
        languageCode === 'es' ? 'BiblicalTermsEs.xml' : 'BiblicalTermsEn.xml',
      );
      const renderingsXmlPath = path.join(projectDir, 'TermRenderings.xml');

      let termsMap = new Map();
      let locMap = new Map();
      let renderingsMap = new Map();

      if (fs.existsSync(mainXmlPath)) {
        termsMap = parseBiblicalTermsXml(fs.readFileSync(mainXmlPath, 'utf8'));
      }
      if (fs.existsSync(locXmlPath)) {
        locMap = parseLocalizationsXml(fs.readFileSync(locXmlPath, 'utf8'));
      }
      if (fs.existsSync(renderingsXmlPath)) {
        renderingsMap = parseTermRenderingsXml(fs.readFileSync(renderingsXmlPath, 'utf8'));
      }

      const terms = [];
      termsMap.forEach((termData, id) => {
        const loc = locMap.get(id);
        const gloss = loc ? loc.gloss : termData.gloss;
        const projectRenderings = renderingsMap.get(id) || [];

        const renderings = projectRenderings.map((text, idx) => ({
          id: `r-${idx}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          text,
          status: 'approved',
          contextTags: [],
          votes: [],
          proposedBy: 'Legacy Import',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));

        const cleanRefs = (termData.references || []).map(convertVerseRef);

        terms.push({
          id,
          lemma: id.replace(/-\d+$/, ''),
          strongs: termData.strongs,
          transliteration: termData.transliteration,
          gloss,
          domains: termData.domain
            ? termData.domain
                .split(';')
                .map((d) => d.trim())
                .filter(Boolean)
            : [],
          references: cleanRefs,
          renderings,
          notes: [],
          updatedAt: new Date().toISOString(),
        });
      });

      const store = {
        schemaVersion: 1,
        morphologyConfig: {
          languageName: languageCode === 'es' ? 'Español' : 'English',
          prefixes: [],
          suffixes: [],
          enableFuzzyMatch: true,
          maxEditDistance: 2,
        },
        terms,
      };

      const resultJson = JSON.stringify(store, null, 2);
      process.stdout.write(resultJson);
      process.exit(0);
    } catch (e) {
      process.stderr.write(e.message);
      process.exit(1);
    }
  });
  process.stdin.resume();
} else {
  process.stderr.write('Unknown action: ' + action);
  process.exit(1);
}
