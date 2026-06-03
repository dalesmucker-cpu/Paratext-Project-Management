const fs = require('fs');
const path = require('path');

// Mock data based on the timeout parameters in the user request:
// Project: 95F9D2DE8892138DD1386F78F0671712F31D48D0
// Book: DEU, Chapter: 21

function escapeRegex(str) {
  return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function countChapters(fileContent) {
  const matches = fileContent.match(/\\c\s+\d+/g);
  return matches ? matches.length : 0;
}

// Replicate parseUsfmChapter from notes-helper.js
function parseUsfmChapter(content) {
  const lines = content.split(/\r?\n/);
  const blocks = [];
  let currentBlock = null;

  const cleanUsfmText = (text) => {
    return text
      .replace(/\\x\s+[\s\S]*?\\x\*/g, '')
      .replace(
        /\\f\s+(\S+)\s+(?:\\fr\s+[^\\]+)?\\ft\s+([\s\S]*?)\\f\*/g,
        (_, _caller, ftText) => `[FN:${ftText}]`,
      )
      .replace(/\\[a-z]+\*?/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const parseLineContent = (text, children) => {
    const cleanedText = text.trim();
    if (!cleanedText) return;

    const verseRegex = /\\v\s+(\d+)\s+([\s\S]*?)(?=\\v\s+\d+|$)/g;
    let vMatch;
    let hasVerses = false;

    const firstVerseIndex = cleanedText.indexOf('\\v ');
    if (firstVerseIndex > 0) {
      const beforeText = cleanUsfmText(cleanedText.substring(0, firstVerseIndex));
      if (beforeText) {
        if (children.length > 0 && children[children.length - 1].type === 'text') {
          children[children.length - 1].text += ' ' + beforeText;
        } else {
          children.push({ type: 'text', text: beforeText });
        }
      }
    }

    while ((vMatch = verseRegex.exec(cleanedText)) !== null) {
      hasVerses = true;
      const verseNum = parseInt(vMatch[1], 10);
      const verseText = cleanUsfmText(vMatch[2]);

      const existingVerse = children.find((c) => c.type === 'verse' && c.number === verseNum);
      if (existingVerse) {
        existingVerse.text += ' ' + verseText;
      } else {
        children.push({ type: 'verse', number: verseNum, text: verseText });
      }
    }

    if (!hasVerses) {
      const clean = cleanUsfmText(cleanedText);
      if (clean) {
        if (children.length > 0 && children[children.length - 1].type === 'verse') {
          children[children.length - 1].text += ' ' + clean;
        } else if (children.length > 0 && children[children.length - 1].type === 'text') {
          children[children.length - 1].text += ' ' + clean;
        } else {
          children.push({ type: 'text', text: clean });
        }
      }
    }
  };

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    if (line.startsWith('\\s')) {
      const text = line.replace(/\\s\d*\s*/, '').trim();
      blocks.push({ type: 'heading', text });
      currentBlock = null;
    } else if (line.startsWith('\\p') || line.startsWith('\\m')) {
      currentBlock = { type: 'paragraph', children: [] };
      blocks.push(currentBlock);
      const content = line.replace(/^\\(p|m)\s*/, '');
      if (content) {
        parseLineContent(content, currentBlock.children);
      }
    } else if (line.startsWith('\\q')) {
      const match = line.match(/^\\q(\d*)\s*/);
      const indent = match ? parseInt(match[1], 10) || 1 : 1;
      currentBlock = { type: 'poetry', indent, children: [] };
      blocks.push(currentBlock);
      const content = line.replace(/^\\q\d*\s*/, '');
      if (content) {
        parseLineContent(content, currentBlock.children);
      }
    } else if (line.startsWith('\\v')) {
      if (!currentBlock) {
        currentBlock = { type: 'paragraph', children: [] };
        blocks.push(currentBlock);
      }
      parseLineContent(line, currentBlock.children);
    } else {
      if (currentBlock) {
        parseLineContent(line, currentBlock.children);
      } else {
        currentBlock = { type: 'paragraph', children: [] };
        blocks.push(currentBlock);
        parseLineContent(line, currentBlock.children);
      }
    }
  }

  return blocks;
}

// Replicate resolution algorithm from main.ts
function findProjectDir(projectId) {
  const userHome = 'C:\\Users\\Dale';
  const searchPaths = [
    'C:\\My Paratext 9 Projects',
    path.join(userHome, 'My Paratext 9 Projects'),
    path.join(userHome, '.paratext-10-studio', 'projects', 'Paratext 9 Projects'),
    'C:\\My Paratext Projects',
    path.join(userHome, 'My Paratext Projects')
  ];

  console.log('Searching paths:', searchPaths);

  const normalizeGuid = (g) => g.toLowerCase().replace(/[{}-]/g, '');
  const normalizedId = normalizeGuid(projectId);

  for (const basePath of searchPaths) {
    if (fs.existsSync(basePath)) {
      console.log('Path exists:', basePath);
      try {
        const folders = fs.readdirSync(basePath);
        for (const folder of folders) {
          const fullPath = path.join(basePath, folder);
          if (fs.statSync(fullPath).isDirectory()) {
            const settingsPath = path.join(fullPath, 'Settings.xml');
            if (fs.existsSync(settingsPath)) {
              const xml = fs.readFileSync(settingsPath, 'utf8');
              const guidMatch = /<Guid>([^<]+)<\/Guid>/i.exec(xml);
              const nameMatch = /<Name>([^<]+)<\/Name>/i.exec(xml);
              const guid = guidMatch ? guidMatch[1] : '';
              const name = nameMatch ? nameMatch[1] : '';
              
              if (normalizeGuid(guid) === normalizedId || name === projectId || folder === projectId) {
                return fullPath;
              }
            }
          }
        }
      } catch (err) {
        console.warn('Error reading path:', basePath, err.message);
      }
    } else {
      console.log('Path does not exist:', basePath);
    }
  }
  return null;
}

async function run() {
  const projectId = '95F9D2DE8892138DD1386F78F0671712F31D48D0';
  console.log('Resolving project directory for:', projectId);
  
  const pPath = findProjectDir(projectId);
  if (!pPath) {
    console.error('Could not resolve project directory.');
    return;
  }

  console.log('Found project dir:', pPath);
  const bookCode = 'DEU';
  const chapter = 21;

  let postPart = '.SFM';
  let prePart = '';
  const settingsPath = path.join(pPath, 'Settings.xml');
  if (fs.existsSync(settingsPath)) {
    const xml = fs.readFileSync(settingsPath, 'utf8');
    const postMatch = /<FileNamePostPart>([^<]+)<\/FileNamePostPart>/i.exec(xml);
    if (postMatch) postPart = postMatch[1].trim();
    const preMatch = /<FileNamePrePart>([^<]+)<\/FileNamePrePart>/i.exec(xml);
    if (preMatch) prePart = preMatch[1].trim();
  }

  const files = fs.readdirSync(pPath);
  const regex = new RegExp(`^${escapeRegex(prePart)}\\d*${bookCode}${escapeRegex(postPart)}$`, 'i');
  const foundFile = files.find((f) => regex.test(f));
  if (!foundFile) {
    console.error('DEU book file not found in project directory.');
    return;
  }

  const filePath = path.join(pPath, foundFile);
  console.log('Reading file:', filePath);
  const fileContent = fs.readFileSync(filePath, 'utf8');
  console.log('File size:', fileContent.length, 'bytes');

  console.log('Running RegExp match...');
  const start = Date.now();
  const chapterRegex = new RegExp(`\\\\c\\s+${chapter}\\b([\\s\\S]*?)(?=\\\\c\\s+\\d+|$)`, 'i');
  const match = chapterRegex.exec(fileContent);
  console.log('RegExp match completed in', Date.now() - start, 'ms');

  if (!match) {
    console.log('No chapter match found!');
    return;
  }

  const chapterContent = match[1];
  console.log('Chapter length:', chapterContent.length, 'characters');

  console.log('Parsing USFM chapter...');
  const parseStart = Date.now();
  const blocks = parseUsfmChapter(chapterContent);
  console.log('USFM parsing completed in', Date.now() - parseStart, 'ms. Total blocks:', blocks.length);
}

run().catch(console.error);
