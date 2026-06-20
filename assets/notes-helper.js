/**
 * Persistent child process helper for Notes, USFM Scripture parsing/editing, and local HTTP server.
 * Communicates with the extension backend via Node IPC.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const net = require('net');
const os = require('os');

console.log('[helper] notes-helper process starting...');

// Override process.send with a try-catch wrapped function to avoid crashes if IPC channel closes
const originalProcessSend = process.send ? process.send.bind(process) : null;
process.send = (message) => {
  if (originalProcessSend) {
    try {
      originalProcessSend(message);
    } catch (err) {
      // console.warn('process.send failed:', err);
    }
  }
};

// Cache of projectId -> absolute projectDir
const projectDirs = new Map();

// Memory cache of parsed notes (filePath -> { mtimeMs, comments })
const notesCache = new Map();

// --- XML Utilities ---

function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function isSameUser(userA, userB) {
  if (!userA || !userB) return false;
  const normA = normalizeName(userA);
  const normB = normalizeName(userB);
  return normA.includes(normB) || normB.includes(normA);
}

function findNotesFileAndFullName(projectDir, currentUser) {
  try {
    const files = fs.readdirSync(projectDir);
    const notesFiles = files.filter((f) => f.startsWith('Notes_') && f.endsWith('.xml'));
    for (const file of notesFiles) {
      const author = file.slice(6, -4);
      if (isSameUser(author, currentUser)) {
        return {
          filePath: path.join(projectDir, file),
          fullName: author,
        };
      }
    }
  } catch (_) {
    /* ignore */
  }

  const safeName = currentUser.replace(/[<>:"\/\\|?*]/g, '');
  return {
    filePath: path.join(projectDir, `Notes_${safeName}.xml`),
    fullName: currentUser,
  };
}

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(safe) {
  if (!safe) return '';
  return safe
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripXml(xmlStr) {
  if (!xmlStr) return '';
  let s = xmlStr.replace(/<\/p>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  return s.trim();
}

function parseVerseRef(ref) {
  const parts = ref.split(' ');
  const book = parts[0] || '';
  let chapter = 0;
  let verse = 0;
  if (parts[1]) {
    const sub = parts[1].split(':');
    chapter = parseInt(sub[0], 10) || 0;
    verse = parseInt(sub[1], 10) || 0;
  }
  return { book, chapter, verse };
}

const tagRegexes = {
  SelectedText: /<SelectedText>([\s\S]*?)<\/SelectedText>/i,
  StartPosition: /<StartPosition>([\s\S]*?)<\/StartPosition>/i,
  ContextBefore: /<ContextBefore>([\s\S]*?)<\/ContextBefore>/i,
  ContextAfter: /<ContextAfter>([\s\S]*?)<\/ContextAfter>/i,
  Status: /<Status>([\s\S]*?)<\/Status>/i,
  Type: /<Type>([\s\S]*?)<\/Type>/i,
  Verse: /<Verse>([\s\S]*?)<\/Verse>/i,
  ReplyToUser: /<ReplyToUser>([\s\S]*?)<\/ReplyToUser>/i,
  HideInTextWindow: /<HideInTextWindow>([\s\S]*?)<\/HideInTextWindow>/i,
  AssignedUser: /<AssignedUser>([\s\S]*?)<\/AssignedUser>/i,
  Contents: /<Contents>([\s\S]*?)<\/Contents>/i,
};

function parseNotesXml(filePath) {
  try {
    const xml = fs.readFileSync(filePath, 'utf8');
    return parseNotesXmlContent(xml, path.basename(filePath));
  } catch (e) {
    return [];
  }
}

function parseNotesXmlContent(xml, filename) {
  const comments = [];
  try {
    const commentRegex = /<Comment\b([^>]*?)>([\s\S]*?)<\/Comment>/gi;
    let match;

    while ((match = commentRegex.exec(xml)) !== null) {
      const attrsStr = match[1];
      const body = match[2];

      const threadMatch = /Thread="([^"]*?)"/i.exec(attrsStr);
      const userMatch = /User="([^"]*?)"/i.exec(attrsStr);
      const verseRefMatch = /VerseRef="([^"]*?)"/i.exec(attrsStr);
      const langMatch = /Language="([^"]*?)"/i.exec(attrsStr);
      const dateMatch = /Date="([^"]*?)"/i.exec(attrsStr);

      const thread = threadMatch ? threadMatch[1] : '';
      const user = userMatch ? userMatch[1] : '';
      const verseRef = verseRefMatch ? verseRefMatch[1] : '';
      const language = langMatch ? langMatch[1] : '';
      const date = dateMatch ? dateMatch[1] : '';

      const getTag = (tag) => {
        const regex = tagRegexes[tag];
        if (!regex) return '';
        const m = regex.exec(body);
        return m ? m[1] : '';
      };

      const selectedText = unescapeXml(getTag('SelectedText'));
      const startPosition = getTag('StartPosition');
      const contextBefore = unescapeXml(getTag('ContextBefore'));
      const contextAfter = unescapeXml(getTag('ContextAfter'));
      const status = getTag('Status').trim();
      const type = getTag('Type').trim();
      const verse = getTag('Verse');
      const replyToUser = getTag('ReplyToUser').trim();
      const hideInTextWindow = getTag('HideInTextWindow').trim();
      const assignedUser = getTag('AssignedUser').trim();
      const contents = getTag('Contents');

      comments.push({
        thread,
        user,
        verseRef,
        language,
        date,
        selectedText,
        startPosition,
        contextBefore,
        contextAfter,
        status,
        type,
        verse,
        replyToUser,
        hideInTextWindow,
        contents,
        assignedUser,
        sourceFile: filename,
      });
    }
  } catch (e) {
    // console.warn('parseNotesXmlContent failed:', e);
  }
  return comments;
}

// --- USFM Scripture Parser ---

const BIBLE_BOOK_CODES = [
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
  'OBA',
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

const BIBLE_BOOK_NAMES_ES = {
  GEN: 'Génesis',
  EXO: 'Éxodo',
  LEV: 'Levítico',
  NUM: 'Números',
  DEU: 'Deuteronomio',
  JOS: 'Josué',
  JDG: 'Jueces',
  RUT: 'Rut',
  '1SA': '1 Samuel',
  '2SA': '2 Samuel',
  '1KI': '1 Reyes',
  '2KI': '2 Reyes',
  '1CH': '1 Crónicas',
  '2CH': '2 Crónicas',
  EZR: 'Esdras',
  NEH: 'Nehemías',
  EST: 'Ester',
  JOB: 'Job',
  PSA: 'Salmos',
  PRO: 'Proverbios',
  ECC: 'Eclesiastés',
  SNG: 'Cantares',
  ISA: 'Isaías',
  JER: 'Jeremías',
  LAM: 'Lamentaciones',
  EZK: 'Ezequiel',
  DAN: 'Daniel',
  HOS: 'Oseas',
  JOL: 'Joel',
  AMO: 'Amós',
  OBA: 'Abdías',
  JON: 'Jonás',
  MIC: 'Miqueas',
  NAM: 'Nahúm',
  HAB: 'Habacuc',
  ZEP: 'Sofonías',
  HAG: 'Hageo',
  ZEC: 'Zacarías',
  MAL: 'Malaquías',
  MAT: 'Mateo',
  MRK: 'Marcos',
  LUK: 'Lucas',
  JHN: 'Juan',
  ACT: 'Hechos',
  ROM: 'Romanos',
  '1CO': '1 Corintios',
  '2CO': '2 Corintios',
  GAL: 'Gálatas',
  EPH: 'Efesios',
  PHP: 'Filipenses',
  COL: 'Colosenses',
  '1TH': '1 Tesalonicenses',
  '2TH': '2 Tesalonicenses',
  '1TI': '1 Timoteo',
  '2TI': '2 Timoteo',
  TIT: 'Tito',
  PHM: 'Filemón',
  HEB: 'Hebreos',
  JAS: 'Santiago',
  '1PE': '1 Pedro',
  '2PE': '2 Pedro',
  '1JN': '1 Juan',
  '2JN': '2 Juan',
  '3JN': '3 Juan',
  JUD: 'Judas',
  REV: 'Apocalipsis',
};

function escapeRegex(str) {
  return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function countChapters(fileContent) {
  const matches = fileContent.match(/\\c\s+\d+/g);
  return matches ? matches.length : 0;
}

function parseUsfmChapter(content) {
  const lines = content.split(/\r?\n/);
  const blocks = [];
  let currentBlock = null;
  let activeVerseNum = null;
  let activeVerseStr = null;

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

    const verseRegex = /\\v\s+([^\s\\]+)\s*([\s\S]*?)(?=\\v\s+|$)/g;
    let vMatch;
    let hasVerses = false;

    const firstVerseIndex = cleanedText.indexOf('\\v ');
    if (firstVerseIndex > 0) {
      const beforeText = cleanUsfmText(cleanedText.substring(0, firstVerseIndex));
      if (beforeText) {
        if (activeVerseNum !== null) {
          const existingVerse = children.find(
            (c) => c.type === 'verse' && c.number === activeVerseNum,
          );
          if (existingVerse) {
            existingVerse.text += ' ' + beforeText;
          } else {
            children.push({
              type: 'verse',
              number: activeVerseNum,
              numberStr: activeVerseStr || String(activeVerseNum),
              text: beforeText,
            });
          }
        } else {
          if (children.length > 0 && children[children.length - 1].type === 'text') {
            children[children.length - 1].text += ' ' + beforeText;
          } else {
            children.push({ type: 'text', text: beforeText });
          }
        }
      }
    }

    while ((vMatch = verseRegex.exec(cleanedText)) !== null) {
      hasVerses = true;
      const verseNumStr = vMatch[1];
      const verseNum = parseInt(verseNumStr, 10);
      const verseText = cleanUsfmText(vMatch[2] || '');
      activeVerseNum = verseNum;
      activeVerseStr = verseNumStr;

      const existingVerse = children.find((c) => c.type === 'verse' && c.number === verseNum);
      if (existingVerse) {
        existingVerse.text += ' ' + verseText;
        if (!existingVerse.numberStr) {
          existingVerse.numberStr = verseNumStr;
        }
      } else {
        children.push({
          type: 'verse',
          number: verseNum,
          numberStr: verseNumStr,
          text: verseText,
        });
      }
    }

    if (!hasVerses) {
      const clean = cleanUsfmText(cleanedText);
      if (clean) {
        if (activeVerseNum !== null) {
          const existingVerse = children.find(
            (c) => c.type === 'verse' && c.number === activeVerseNum,
          );
          if (existingVerse) {
            existingVerse.text += ' ' + clean;
          } else {
            children.push({
              type: 'verse',
              number: activeVerseNum,
              numberStr: activeVerseStr || String(activeVerseNum),
              text: clean,
            });
          }
        } else {
          if (children.length > 0 && children[children.length - 1].type === 'text') {
            children[children.length - 1].text += ' ' + clean;
          } else {
            children.push({ type: 'text', text: clean });
          }
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
      activeVerseNum = null;
      activeVerseStr = null;
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
      if (!currentBlock) {
        currentBlock = { type: 'paragraph', children: [] };
        blocks.push(currentBlock);
      }
      parseLineContent(line, currentBlock.children);
    }
  }

  return blocks;
}

// --- Local Player/Attachment Server ---

let localAudioServer = null;

function startLocalAudioServer() {
  if (localAudioServer) return;
  try {
    localAudioServer = http.createServer(async (req, res) => {
      try {
        const urlObj = new URL(req.url || '', `http://${req.headers.host}`);
        const projectId = urlObj.searchParams.get('project');
        const file = urlObj.searchParams.get('file');

        if (urlObj.pathname === '/play') {
          if (!projectId || !file) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Faltan parámetros: project y file');
            return;
          }

          const projectDir = projectDirs.get(projectId) || '';
          const projectName = projectDir ? path.basename(projectDir) : projectId;

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Reproductor de Nota de Voz</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      background-color: #f8fafc;
      margin: 0;
      color: #334155;
    }
    .card {
      background: white;
      padding: 32px 24px;
      border-radius: 16px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
      text-align: center;
      border: 1px solid #e2e8f0;
      width: 90%;
      max-width: 400px;
    }
    h2 { margin-top: 0; margin-bottom: 8px; color: #1e293b; font-size: 20px; }
    p { margin: 4px 0; color: #64748b; font-size: 13px; }
    audio { margin-top: 24px; width: 100%; outline: none; }
    .footer { font-size: 11px; margin-top: 24px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <h2>🎙️ Nota de Voz</h2>
    <p>Proyecto: <strong>${projectName}</strong></p>
    <p>Archivo: <code>${file}</code></p>
    <audio controls autoplay src="/audio?project=${encodeURIComponent(projectId)}&file=${encodeURIComponent(file)}"></audio>
    <div class="footer">Paratext Project Manager</div>
  </div>
</body>
</html>`);
          return;
        }

        if (urlObj.pathname === '/audio') {
          if (!projectId || !file) {
            res.writeHead(400);
            res.end('Faltan parámetros: project y file');
            return;
          }

          const projectDir = projectDirs.get(projectId);
          if (!projectDir) {
            res.writeHead(404);
            res.end('Project not registered');
            return;
          }

          const filePath = path.join(projectDir, 'audio_notes', file);
          if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            const ext = path.extname(file).toLowerCase();
            let mime = 'audio/webm';
            if (ext === '.wav') mime = 'audio/wav';
            if (ext === '.mp3') mime = 'audio/mp3';
            if (ext === '.m4a') mime = 'audio/mp4';
            if (ext === '.ogg') mime = 'audio/ogg';

            res.writeHead(200, {
              'Content-Type': mime,
              'Content-Length': stat.size,
              'Cache-Control': 'no-cache',
            });
            fs.createReadStream(filePath).pipe(res);
          } else {
            res.writeHead(404);
            res.end('Audio file not found');
          }
          return;
        }

        if (urlObj.pathname === '/attachment') {
          if (!projectId || !file) {
            res.writeHead(400);
            res.end('Faltan parámetros: project y file');
            return;
          }

          const projectDir = projectDirs.get(projectId);
          if (!projectDir) {
            res.writeHead(404);
            res.end('Project not registered');
            return;
          }

          const filePath = path.join(projectDir, 'attachments', file);
          if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            const ext = path.extname(file).toLowerCase();
            let mime = 'application/octet-stream';
            if (ext === '.png') mime = 'image/png';
            if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
            if (ext === '.webp') mime = 'image/webp';
            if (ext === '.gif') mime = 'image/gif';
            if (ext === '.pdf') mime = 'application/pdf';
            if (ext === '.txt') mime = 'text/plain; charset=utf-8';
            if (ext === '.doc') mime = 'application/msword';
            if (ext === '.docx')
              mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            if (ext === '.xls') mime = 'application/vnd.ms-excel';
            if (ext === '.xlsx')
              mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

            const isInline = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf', '.txt'].includes(
              ext,
            );
            const contentDisposition = isInline
              ? 'inline'
              : `attachment; filename="${encodeURIComponent(file)}"`;

            res.writeHead(200, {
              'Content-Type': mime,
              'Content-Length': stat.size,
              'Content-Disposition': contentDisposition,
              'Cache-Control': 'no-cache',
            });
            fs.createReadStream(filePath).pipe(res);
          } else {
            res.writeHead(404);
            res.end('Attachment file not found');
          }
          return;
        }

        res.writeHead(404);
        res.end('Not Found');
      } catch (err) {
        res.writeHead(500);
        res.end(`Internal Server Error: ${err}`);
      }
    });

    localAudioServer.on('error', (err) => {
      console.error('[helper] Audio HTTP server error:', err.message || err);
    });

    localAudioServer.listen(49876, '127.0.0.1', () => {
      console.log('[helper] Audio HTTP server listening on port 49876');
    });
  } catch (e) {
    console.error('[helper] Failed to start HTTP server:', e.message || e);
  }
}

// --- IPC Request/Response Router ---

async function handleAction(action, args) {
  switch (action) {
    case 'ping': {
      return 'pong';
    }

    case 'fileIO': {
      const [ioAction, targetPath, stdinData] = args;
      if (ioAction === 'read' || ioAction === 'readfile') {
        return await fs.promises.readFile(targetPath, 'utf8');
      } else if (ioAction === 'write') {
        await fs.promises.writeFile(targetPath, stdinData || '', 'utf8');
        return 'ok';
      } else if (ioAction === 'readdir') {
        const entries = await fs.promises.readdir(targetPath);
        return entries;
      } else if (ioAction === 'exists') {
        try {
          await fs.promises.access(targetPath, fs.constants.F_OK);
          return 'true';
        } catch (_) {
          return 'false';
        }
      } else if (ioAction === 'readxml') {
        const xml = await fs.promises.readFile(targetPath, 'utf8');
        const guidMatch = /<Guid>([^<]+)<\/Guid>/i.exec(xml);
        const nameMatch = /<Name>([^<]+)<\/Name>/i.exec(xml);
        const fileNamePostPartMatch = /<FileNamePostPart>([^<]+)<\/FileNamePostPart>/i.exec(xml);
        return {
          guid: guidMatch ? guidMatch[1].trim() : '',
          name: nameMatch ? nameMatch[1].trim() : '',
          fileNamePostPart: fileNamePostPartMatch ? fileNamePostPartMatch[1].trim() : '',
        };
      } else if (ioAction === 'scanprojects') {
        const dirs = await fs.promises.readdir(targetPath);
        const results = [];
        for (const dir of dirs) {
          const settingsPath = path.join(targetPath, dir, 'Settings.xml');
          try {
            await fs.promises.access(settingsPath, fs.constants.F_OK);
            const xml = await fs.promises.readFile(settingsPath, 'utf8');
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
            // skip
          }
        }
        return results;
      } else if (ioAction === 'open') {
        const { exec } = require('child_process');
        return new Promise((resolve, reject) => {
          const escaped = targetPath.replace(/"/g, '\\"');
          exec(`start "" "${escaped}"`, (err) => {
            if (err) reject(err);
            else resolve('ok');
          });
        });
      } else if (ioAction === 'mkdir') {
        await fs.promises.mkdir(targetPath, { recursive: true });
        return 'ok';
      } else if (ioAction === 'loadlegacykeyterms') {
        const params = typeof stdinData === 'string' ? JSON.parse(stdinData) : stdinData;
        const pt9ListsDir = params.pt9ListsDir;
        const projectDir = targetPath;
        const languageCode = params.languageCode || 'es';

        const BIBLE_BOOKS = [
          'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI',
          '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER',
          'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP',
          'HAG', 'ZEC', 'MAL', 'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL',
          'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE',
          '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV'
        ];

        const convertVerseRef = (verseRef14) => {
          if (verseRef14.length < 9) return verseRef14;
          const bookNum = parseInt(verseRef14.substring(0, 3), 10);
          const chapterNum = parseInt(verseRef14.substring(3, 6), 10);
          const verseNum = parseInt(verseRef14.substring(6, 9), 10);
          const bookCode = BIBLE_BOOKS[bookNum - 1];
          if (!bookCode) return `${bookNum} ${chapterNum}:${verseNum}`;
          return `${bookCode} ${chapterNum}:${verseNum}`;
        };

        const parseBiblicalTermsXml = (xmlContent) => {
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
        };

        const parseLocalizationsXml = (xmlContent) => {
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
        };

        const parseTermRenderingsXml = (xmlContent) => {
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
        };

        let mainXmlPath = path.join(pt9ListsDir, 'BiblicalTerms.xml');
        const fallbackProjectXml = path.join(projectDir, 'ProjectBiblicalTerms.xml');
        try {
          const settingsPath = path.join(projectDir, 'Settings.xml');
          const settingsExists = await fs.promises.access(settingsPath, fs.constants.F_OK).then(() => true).catch(() => false);
          if (settingsExists) {
            const settingsXml = await fs.promises.readFile(settingsPath, 'utf8');
            const settingMatch = /<BiblicalTermsListSetting>([^<]+)<\/BiblicalTermsListSetting>/i.exec(settingsXml);
            if (settingMatch) {
              const settingVal = settingMatch[1].trim();
              const parts = settingVal.split(':');
              if (parts.length >= 3) {
                const type = parts[0].toLowerCase();
                const filename = parts[2];
                if (type === 'project') {
                  const projectXmlPath = path.join(projectDir, filename);
                  const projectXmlExists = await fs.promises.access(projectXmlPath, fs.constants.F_OK).then(() => true).catch(() => false);
                  if (projectXmlExists) {
                    mainXmlPath = projectXmlPath;
                  }
                } else {
                  const globalXmlPath = path.join(pt9ListsDir, filename);
                  const globalXmlExists = await fs.promises.access(globalXmlPath, fs.constants.F_OK).then(() => true).catch(() => false);
                  if (globalXmlExists) {
                    mainXmlPath = globalXmlPath;
                  }
                }
              }
            }
          }
        } catch (_) {}

        const mainExists = await fs.promises.access(mainXmlPath, fs.constants.F_OK).then(() => true).catch(() => false);
        const fallbackExists = await fs.promises.access(fallbackProjectXml, fs.constants.F_OK).then(() => true).catch(() => false);
        if (!mainExists || mainXmlPath === path.join(pt9ListsDir, 'BiblicalTerms.xml')) {
          if (fallbackExists) {
            mainXmlPath = fallbackProjectXml;
          }
        }

        const locXmlPath = path.join(pt9ListsDir, languageCode === 'es' ? 'BiblicalTermsEs.xml' : 'BiblicalTermsEn.xml');
        const renderingsXmlPath = path.join(projectDir, 'TermRenderings.xml');

        let termsMap = new Map();
        let locMap = new Map();
        let renderingsMap = new Map();

        const mainExistsFinal = await fs.promises.access(mainXmlPath, fs.constants.F_OK).then(() => true).catch(() => false);
        if (mainExistsFinal) {
          termsMap = parseBiblicalTermsXml(await fs.promises.readFile(mainXmlPath, 'utf8'));
        }
        const locExists = await fs.promises.access(locXmlPath, fs.constants.F_OK).then(() => true).catch(() => false);
        if (locExists) {
          locMap = parseLocalizationsXml(await fs.promises.readFile(locXmlPath, 'utf8'));
        }
        const renderingsExists = await fs.promises.access(renderingsXmlPath, fs.constants.F_OK).then(() => true).catch(() => false);
        if (renderingsExists) {
          renderingsMap = parseTermRenderingsXml(await fs.promises.readFile(renderingsXmlPath, 'utf8'));
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
            domains: termData.domain ? termData.domain.split(';').map((d) => d.trim()).filter(Boolean) : [],
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
        return store;
      } else {
        throw new Error(`Unknown fileIO action: ${ioAction}`);
      }
    }

    case 'registerProjectDir': {
      const [projectId, projectDir] = args;
      projectDirs.set(projectId, projectDir);
      return 'ok';
    }

    case 'getProjectNotes': {
      const [projectId, projectDir, currentUser, readLogPath] = args;
      projectDirs.set(projectId, projectDir); // ensure registered

      const files = await fs.promises.readdir(projectDir);
      const notesFiles = files.filter((f) => f.startsWith('Notes_') && f.endsWith('.xml'));

      const allComments = [];
      const authorsSet = new Set();

      const readPromises = notesFiles.map(async (file) => {
        const filePath = path.join(projectDir, file);
        const author = file.slice(6, -4);
        authorsSet.add(author);

        try {
          const stat = await fs.promises.stat(filePath);
          const cached = notesCache.get(filePath);
          if (cached && cached.mtimeMs === stat.mtimeMs) {
            return cached.comments;
          } else {
            const xml = await fs.promises.readFile(filePath, 'utf8');
            const comments = parseNotesXmlContent(xml, file);
            notesCache.set(filePath, {
              mtimeMs: stat.mtimeMs,
              comments,
            });
            return comments;
          }
        } catch (e) {
          // Fallback on error
          try {
            const xml = await fs.promises.readFile(filePath, 'utf8');
            return parseNotesXmlContent(xml, file);
          } catch (_) {
            return [];
          }
        }
      });

      const commentsArrays = await Promise.all(readPromises);
      for (const comments of commentsArrays) {
        allComments.push(...comments);
      }

      // Group comments by Thread ID
      const threadsMap = new Map();
      for (const comm of allComments) {
        if (!comm.thread) continue;
        if (!threadsMap.has(comm.thread)) {
          threadsMap.set(comm.thread, []);
        }
        threadsMap.get(comm.thread).push(comm);
      }

      // Load read log
      let readLog = {};
      try {
        const exists = await fs.promises
          .access(readLogPath)
          .then(() => true)
          .catch(() => false);
        if (exists) {
          readLog = JSON.parse(await fs.promises.readFile(readLogPath, 'utf8'));
        }
      } catch (_) {}

      const userKeys = Object.keys(readLog);
      const matchedKey = userKeys.find((k) => isSameUser(k, currentUser)) || currentUser;
      const userReadLog = readLog[matchedKey] || {};

      const threads = [];

      for (const [threadId, commentsList] of threadsMap.entries()) {
        commentsList.sort((a, b) => a.date.localeCompare(b.date));

        const latestComment = commentsList[commentsList.length - 1];

        if (latestComment.status === 'deleted') continue;
        if (commentsList.some((c) => c.type === 'conflict')) continue;

        const { book, chapter, verse } = parseVerseRef(latestComment.verseRef);

        let assignedUser = '';
        for (let i = commentsList.length - 1; i >= 0; i--) {
          if (commentsList[i].assignedUser) {
            assignedUser = commentsList[i].assignedUser;
            break;
          }
        }

        let isUnread = false;
        if (!isSameUser(latestComment.user, currentUser)) {
          const lastReadDate = userReadLog[threadId];
          if (!lastReadDate) {
            isUnread = true;
          } else {
            isUnread = latestComment.date.localeCompare(lastReadDate) > 0;
          }
        }

        const formattedComments = commentsList.map((c) => ({
          user: c.user,
          date: c.date,
          contents: unescapeXml(c.contents),
          plainText: unescapeXml(stripXml(c.contents)),
          status: c.status,
          type: c.type,
          replyToUser: c.replyToUser,
          sourceFile: c.sourceFile,
        }));

        const rootComment = commentsList[0];

        threads.push({
          threadId,
          verseRef: latestComment.verseRef,
          selectedText: rootComment.selectedText,
          book,
          chapter,
          verse,
          comments: formattedComments,
          latestDate: latestComment.date,
          latestUser: latestComment.user,
          status: latestComment.status,
          type: latestComment.type,
          assignedUser,
          isUnread,
          language: rootComment.language,
          startPosition: rootComment.startPosition,
          contextBefore: rootComment.contextBefore,
          contextAfter: rootComment.contextAfter,
          verseXml: rootComment.verse,
          hideInTextWindow: rootComment.hideInTextWindow,
        });
      }

      threads.sort((a, b) => b.latestDate.localeCompare(a.latestDate));

      return {
        threads,
        authors: Array.from(authorsSet),
      };
    }

    case 'saveProjectNote': {
      const [projectId, projectDir, authorName, threadId, commentDate, newContents] = args;
      const { filePath } = findNotesFileAndFullName(projectDir, authorName);

      if (!fs.existsSync(filePath)) {
        throw new Error(`Notes file not found: ${filePath}`);
      }

      let fileXml = fs.readFileSync(filePath, 'utf8');

      const escapedThread = escapeRegex(threadId);
      const escapedDate = escapeRegex(commentDate);

      const commentRegex = new RegExp(
        `(<Comment\\b[^>]*?(?:Thread="${escapedThread}"[^>]*?Date="${escapedDate}"|Date="${escapedDate}"[^>]*?Thread="${escapedThread}")[^>]*?>)([\\s\\S]*?)(</Comment>)`,
        'i',
      );

      const commentMatch = fileXml.match(commentRegex);
      if (!commentMatch) {
        throw new Error(
          `Comment not found in XML file for thread ${threadId} and date ${commentDate}`,
        );
      }

      const commentBlock = commentMatch[0];
      const contentsMatch = /<Contents>([\s\S]*?)<\/Contents>/i.exec(commentBlock);
      const originalContents = contentsMatch ? contentsMatch[1] : '';
      const hasParagraphs = /<\/p>|<p\b/i.test(originalContents);

      let formattedContents = '';
      if (hasParagraphs || newContents.includes('\n')) {
        const paragraphs = newContents.split(/\r?\n/);
        formattedContents = paragraphs.map((p) => `<p>${escapeXml(p)}</p>`).join('');
      } else {
        formattedContents = escapeXml(newContents);
      }

      const updatedBlock = commentBlock.replace(
        /(<Contents>)([\s\S]*?)(<\/Contents>)/i,
        `$1${formattedContents}$3`,
      );

      fileXml = fileXml.replace(commentRegex, updatedBlock);
      fs.writeFileSync(filePath, fileXml, 'utf8');
      notesCache.delete(filePath);
      return 'ok';
    }

    case 'deleteProjectNote': {
      const [projectId, projectDir, authorName, threadId, commentDate] = args;
      const { filePath } = findNotesFileAndFullName(projectDir, authorName);

      if (!fs.existsSync(filePath)) {
        throw new Error(`Notes file not found: ${filePath}`);
      }

      let fileXml = fs.readFileSync(filePath, 'utf8');

      const escapedThread = escapeRegex(threadId);
      const escapedDate = escapeRegex(commentDate);

      const commentRegex = new RegExp(
        `\\s*<Comment\\b[^>]*?(?:Thread="${escapedThread}"[^>]*?Date="${escapedDate}"|Date="${escapedDate}"[^>]*?Thread="${escapedThread}")[\\s\\S]*?</Comment>\\s*`,
        'i',
      );

      if (!commentRegex.test(fileXml)) {
        throw new Error(`Comment not found in XML for thread ${threadId} and date ${commentDate}`);
      }

      fileXml = fileXml.replace(commentRegex, '\n');
      fs.writeFileSync(filePath, fileXml, 'utf8');
      notesCache.delete(filePath);
      return 'ok';
    }

    case 'addNoteReply': {
      const [projectId, projectDir, currentUser, replyData] = args;
      const { filePath, fullName } = findNotesFileAndFullName(projectDir, currentUser);

      const {
        threadId,
        verseRef,
        language,
        selectedText,
        startPosition,
        contextBefore,
        contextAfter,
        verseXml,
        replyToUser,
        hideInTextWindow,
        contents,
        assignedUser,
      } = replyData;

      let formattedContents = '';
      if (contents && contents.includes('\n')) {
        const paragraphs = contents.split(/\r?\n/);
        formattedContents = paragraphs.map((p) => `<p>${escapeXml(p)}</p>`).join('');
      } else {
        formattedContents = escapeXml(contents || '');
      }

      const newCommentXml = `  <Comment Thread="${threadId}" User="${escapeXml(fullName)}" VerseRef="${escapeXml(verseRef)}" Language="${escapeXml(language || '')}" Date="${new Date().toISOString()}">
    <SelectedText>${escapeXml(selectedText || '')}</SelectedText>
    <StartPosition>${startPosition || '0'}</StartPosition>
    <ContextBefore>${escapeXml(contextBefore || '')}</ContextBefore>
    <ContextAfter>${escapeXml(contextAfter || '')}</ContextAfter>
    <Status></Status>
    <Type></Type>
    <ConflictType />
    <Verse>${escapeXml(verseXml || '')}</Verse>
    <ReplyToUser>${escapeXml(replyToUser || '')}</ReplyToUser>
    <HideInTextWindow>${hideInTextWindow || 'false'}</HideInTextWindow>
    <AssignedUser>${escapeXml(assignedUser || '')}</AssignedUser>
    <Contents>${formattedContents}</Contents>
  </Comment>\n`;

      let fileXml = '';
      if (fs.existsSync(filePath)) {
        fileXml = fs.readFileSync(filePath, 'utf8');
      } else {
        fileXml = `<?xml version="1.0" encoding="utf-8"?>\n<CommentList>\n</CommentList>\n`;
      }

      const closingTagIndex = fileXml.lastIndexOf('</CommentList>');
      if (closingTagIndex === -1) {
        throw new Error(`Invalid XML file: missing </CommentList> closing tag in ${filePath}`);
      }

      fileXml = fileXml.slice(0, closingTagIndex) + newCommentXml + fileXml.slice(closingTagIndex);
      fs.writeFileSync(filePath, fileXml, 'utf8');
      notesCache.delete(filePath);

      return { status: 'ok', fullName };
    }

    case 'getProjectBooks': {
      const [projectId, projectDir] = args;
      // Get filename settings
      let postPart = '.SFM';
      let prePart = '';
      const settingsPath = path.join(projectDir, 'Settings.xml');
      try {
        const xml = await fs.promises.readFile(settingsPath, 'utf8');
        const postMatch = /<FileNamePostPart>([^<]+)<\/FileNamePostPart>/i.exec(xml);
        if (postMatch) postPart = postMatch[1].trim();
        const preMatch = /<FileNamePrePart>([^<]+)<\/FileNamePrePart>/i.exec(xml);
        if (preMatch) prePart = preMatch[1].trim();
      } catch (_) {}

      const files = await fs.promises.readdir(projectDir);
      const bookPromises = BIBLE_BOOK_CODES.map(async (code) => {
        const regex = new RegExp(
          `^${escapeRegex(prePart)}\\d*${code}${escapeRegex(postPart)}$`,
          'i',
        );
        const foundFile = files.find((f) => regex.test(f));

        if (foundFile) {
          let bookName = BIBLE_BOOK_NAMES_ES[code] || code;
          try {
            const filePath = path.join(projectDir, foundFile);
            const fd = await fs.promises.open(filePath, 'r');
            const buffer = Buffer.alloc(1024);
            const { bytesRead } = await fd.read(buffer, 0, 1024, 0);
            await fd.close();
            const headText = buffer.toString('utf8', 0, bytesRead);

            let parsedName = '';
            const hMatch = /\\h[ \t]+([^\r\n]+)/i.exec(headText);
            if (hMatch && hMatch[1].trim() && !hMatch[1].trim().startsWith('\\')) {
              parsedName = hMatch[1].trim();
            } else {
              const tocMatch = /\\toc2[ \t]+([^\r\n]+)/i.exec(headText);
              if (tocMatch && tocMatch[1].trim() && !tocMatch[1].trim().startsWith('\\')) {
                parsedName = tocMatch[1].trim();
              }
            }
            if (parsedName) bookName = parsedName;
          } catch (e) {
            /* ignore header read error */
          }

          if (code === 'DEU' && (bookName.toLowerCase().trim() === 'ma dakiwan balna' || (projectId && projectId.toUpperCase() === 'VMM'))) {
            bookName = 'Deuteronomio';
          }

          return { code, name: bookName, fileName: foundFile };
        }
        return null;
      });

      const books = (await Promise.all(bookPromises)).filter(Boolean);
      return books;
    }

    case 'getChapterText': {
      const [projectId, projectDir, bookCode, chapter] = args;
      let postPart = '.SFM';
      let prePart = '';
      const settingsPath = path.join(projectDir, 'Settings.xml');
      try {
        const xml = await fs.promises.readFile(settingsPath, 'utf8');
        const postMatch = /<FileNamePostPart>([^<]+)<\/FileNamePostPart>/i.exec(xml);
        if (postMatch) postPart = postMatch[1].trim();
        const preMatch = /<FileNamePrePart>([^<]+)<\/FileNamePrePart>/i.exec(xml);
        if (preMatch) prePart = preMatch[1].trim();
      } catch (_) {}

      const files = await fs.promises.readdir(projectDir);
      const regex = new RegExp(
        `^${escapeRegex(prePart)}\\d*${bookCode}${escapeRegex(postPart)}$`,
        'i',
      );
      const foundFile = files.find((f) => regex.test(f));

      if (!foundFile) {
        throw new Error(`Book file not found for code ${bookCode}`);
      }

      const filePath = path.join(projectDir, foundFile);
      const fileContent = await fs.promises.readFile(filePath, 'utf8');

      const chapterRegex = new RegExp(`\\\\c\\s+${chapter}\\b([\\s\\S]*?)(?=\\\\c\\s+\\d+|$)`, 'i');
      const match = chapterRegex.exec(fileContent);
      if (!match) {
        return { blocks: [], totalChapters: countChapters(fileContent) };
      }

      const chapterContent = match[1];
      const blocks = parseUsfmChapter(chapterContent);
      const totalChapters = countChapters(fileContent);

      return { blocks, totalChapters };
    }

    case 'updateVerseText': {
      const [projectId, projectDir, bookCode, chapter, verse, newText] = args;
      if (projectDir) projectDirs.set(projectId, projectDir);
      try {
        saveVerseLocal(projectId, bookCode, chapter, verse, newText);
        return { status: 'ok' };
      } catch (saveErr) {
        return { status: 'error', error: saveErr.message || String(saveErr) };
      }
    }

    case 'saveLocalAudioNote': {
      const [projectDir, filename, base64Data] = args;
      const audioDir = path.join(projectDir, 'audio_notes');
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }
      const filePath = path.join(audioDir, filename);
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(filePath, buffer);
      return 'ok';
    }

    case 'saveLocalAttachment': {
      const [projectDir, filename, base64Data] = args;
      const attachmentsDir = path.join(projectDir, 'attachments');
      if (!fs.existsSync(attachmentsDir)) {
        fs.mkdirSync(attachmentsDir, { recursive: true });
      }
      const filePath = path.join(attachmentsDir, filename);
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(filePath, buffer);
      return 'ok';
    }

    case 'exists': {
      const [filePath] = args;
      return fs.existsSync(filePath);
    }

    case 'writeFile': {
      const [filePath, base64Data] = args;
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(filePath, buffer);
      return 'ok';
    }

    case 'readFileBase64': {
      const [filePath] = args;
      if (!fs.existsSync(filePath)) throw new Error('File not found');
      const data = fs.readFileSync(filePath);
      return data.toString('base64');
    }

    case 'openPath': {
      const [filePath] = args;
      const { exec } = require('child_process');
      return new Promise((resolve, reject) => {
        exec(`start "" "${filePath.replace(/"/g, '\\"')}"`, (err) => {
          if (err) reject(err);
          else resolve('ok');
        });
      });
    }

    case 'openExternal': {
      const [url] = args;
      const { exec } = require('child_process');
      return new Promise((resolve, reject) => {
        exec(`start "" "${url.replace(/"/g, '\\"')}"`, (err) => {
          if (err) reject(err);
          else resolve('ok');
        });
      });
    }

    case 'startCollabHost': {
      const [portOrRoomId, username, projectId, projectDir, collabTypeArg, serverUrlArg] = args;
      if (projectDir) projectDirs.set(projectId, projectDir);

      // If we're in an auto-reconnect, the state is already clean and we
      // don't want a duplicate status_update going to main.ts.
      const inAutoReconnect = isReconnecting || (reconnectParams && collabRole === 'none');
      cleanupCollab(inAutoReconnect);

      collabRole = 'host';
      collabType = collabTypeArg || 'local';
      collabUsername = username;

      if (collabType === 'online') {
        collabRoomId = portOrRoomId;
        collabServerUrl = serverUrlArg || 'ws://localhost:8080';
        collabActiveUsers = new Set([username]);

        return new Promise((resolve, reject) => {
          try {
            const ws = new globalThis.WebSocket(collabServerUrl);
            collabWs = ws;

            ws.onopen = () => {
              ws.send(
                JSON.stringify({
                  type: 'host_room',
                  payload: { roomId: collabRoomId, username: collabUsername },
                }),
              );
            };

            ws.onmessage = (event) => {
              try {
                const msg = JSON.parse(event.data);

                if (msg.type === 'handshake_ack') {
                  rememberConnection('host', {
                    portOrRoomId,
                    username,
                    projectId,
                    projectDir,
                    type: collabType,
                    serverUrl: collabServerUrl,
                  });
                  resolve({ status: 'ok', role: 'host' });
                  process.send({
                    event: 'collab',
                    data: { type: 'user_list', payload: { users: Array.from(collabActiveUsers) } },
                  });
                  process.send({
                    event: 'collab',
                    data: {
                      type: 'chat_message',
                      payload: {
                        user: 'Sistema',
                        message: `Iniciaste sesión online en la sala: ${collabRoomId}`,
                        timestamp: Date.now(),
                      },
                    },
                  });
                } else if (msg.type === 'error') {
                  cleanupCollab(inAutoReconnect);
                  reject(new Error(msg.payload.message));
                } else if (msg.type === 'user_joined') {
                  const guestName = msg.payload.username;
                  const tasksPath = path.join(projectDir, 'project-tasks.json');
                  let tasksJson = '{}';
                  if (fs.existsSync(tasksPath)) {
                    tasksJson = fs.readFileSync(tasksPath, 'utf8');
                  }
                  ws.send(
                    JSON.stringify({
                      type: 'send_to',
                      target: guestName,
                      payload: { type: 'init_sync', payload: { tasksJson } },
                    }),
                  );
                } else if (msg.type === 'user_list') {
                  collabActiveUsers = new Set(msg.payload.users);
                  process.send({ event: 'collab', data: msg });
                } else if (msg.type === 'chat_message') {
                  process.send({ event: 'collab', data: msg });
                } else if (msg.type === 'tasks_update') {
                  const localMsg = localizeCollabProject(msg, projectId);
                  saveTasksLocal(projectId, localMsg.payload.tasksJson);
                  process.send({ event: 'collab', data: localMsg });
                } else if (msg.type === 'note_update') {
                  const localMsg = localizeCollabProject(msg, projectId);
                  saveCollabComment(
                    projectId,
                    localMsg.payload.senderUser,
                    localMsg.payload.replyData,
                  );
                  process.send({ event: 'collab', data: localMsg });
                } else if (msg.type === 'cursor_update') {
                  process.send({ event: 'collab', data: localizeCollabProject(msg, projectId) });
                } else if (msg.type === 'verse_update') {
                  const localMsg = localizeCollabProject(msg, projectId);
                  try {
                    saveVerseLocal(
                      projectId,
                      localMsg.payload.book,
                      localMsg.payload.chapter,
                      localMsg.payload.verse,
                      localMsg.payload.newText,
                    );
                  } catch (svErr) {
                    console.error(`[collab] HOST (online) saveVerseLocal failed: ${svErr.message}`);
                  }
                  process.send({ event: 'collab', data: localMsg });
                } else if (msg.type === 'status_update') {
                  process.send({ event: 'collab', data: msg });
                } else {
                  process.send({ event: 'collab', data: msg });
                }
              } catch (err) {
                console.error('Error parsing host ws msg:', err);
              }
            };

            ws.onerror = (err) => {
              cleanupCollab(inAutoReconnect);
              reject(err);
            };

            ws.onclose = () => {
              const wasReconnecting = isReconnecting;
              const willReconnect = !!reconnectParams && !wasReconnecting;
              cleanupCollab(willReconnect);
              if (willReconnect) {
                console.log(`[collab] HOST connection lost — scheduling auto-reconnect`);
                scheduleReconnect();
              } else {
                process.send({
                  event: 'collab',
                  data: {
                    type: 'status_update',
                    payload: { role: 'none', error: 'Se cerró la sesión online.' },
                  },
                });
              }
            };
          } catch (e) {
            cleanupCollab(inAutoReconnect);
            reject(e);
          }
        });
      } else {
        collabPort = portOrRoomId || 49885;
        collabActiveUsers = new Set([username]);

        return new Promise((resolve, reject) => {
          try {
            collabServer = net.createServer((socket) => {
              socket.setKeepAlive(true, 10000);
              socket.setNoDelay(true);
              let socketUser = '';
              let lastPongAt = Date.now();
              collabSockets.push(socket);

              setupSocketReceiver(
                socket,
                (msg) => {
                  hasAliveLanSocket();
                  if (msg.type === 'pong') {
                    lastPongAt = Date.now();
                    return;
                  }
                  if (msg.type === 'ping') {
                    try {
                      socket.write(JSON.stringify({ type: 'pong' }) + '\n');
                    } catch (_) {}
                    return;
                  }
                  console.log(`[collab] HOST received from client: ${msg.type}`);
                  if (msg.type === 'handshake') {
                    // Handshake marks the connection as fully established.
                    // Reset lastPongAt so the connection doesn't get killed
                    // by the 15s timeout before any pings flow.
                    lastPongAt = Date.now();
                    socketUser = msg.payload.username;
                    collabActiveUsers.add(socketUser);

                    // Broadcast updated user list
                    broadcastCollab({
                      type: 'user_list',
                      payload: { users: Array.from(collabActiveUsers) },
                    });

                    // Send init sync (current tasks)
                    const tasksPath = path.join(projectDir, 'project-tasks.json');
                    let tasksJson = '{}';
                    if (fs.existsSync(tasksPath)) {
                      tasksJson = fs.readFileSync(tasksPath, 'utf8');
                    }
                    socket.write(
                      JSON.stringify({ type: 'init_sync', payload: { tasksJson } }) + '\n',
                    );

                    // Send system chat message
                    broadcastCollab({
                      type: 'chat_message',
                      payload: {
                        user: 'Sistema',
                        message: `${socketUser} se ha unido a la colaboración.`,
                        timestamp: Date.now(),
                      },
                    });

                    // Notify host main.ts
                    process.send({
                      event: 'collab',
                      data: {
                        type: 'user_list',
                        payload: { users: Array.from(collabActiveUsers) },
                      },
                    });
                    process.send({
                      event: 'collab',
                      data: {
                        type: 'chat_message',
                        payload: {
                          user: 'Sistema',
                          message: `${socketUser} se ha unido a la colaboración.`,
                          timestamp: Date.now(),
                        },
                      },
                    });
                  } else if (msg.type === 'tasks_update') {
                    const localMsg = localizeCollabProject(msg, projectId);
                    saveTasksLocal(projectId, localMsg.payload.tasksJson);
                    broadcastCollab(localMsg, socket);
                    process.send({ event: 'collab', data: localMsg });
                  } else if (msg.type === 'note_update') {
                    const localMsg = localizeCollabProject(msg, projectId);
                    saveCollabComment(
                      projectId,
                      localMsg.payload.senderUser,
                      localMsg.payload.replyData,
                    );
                    broadcastCollab(localMsg, socket);
                    process.send({ event: 'collab', data: localMsg });
                  } else if (msg.type === 'cursor_update') {
                    const localMsg = localizeCollabProject(msg, projectId);
                    broadcastCollab(localMsg, socket);
                    process.send({ event: 'collab', data: localMsg });
                  } else if (msg.type === 'chat_message') {
                    broadcastCollab(msg, socket);
                    process.send({ event: 'collab', data: msg });
                  } else if (msg.type === 'verse_update') {
                    const localMsg = localizeCollabProject(msg, projectId);
                    try {
                      saveVerseLocal(
                        projectId,
                        localMsg.payload.book,
                        localMsg.payload.chapter,
                        localMsg.payload.verse,
                        localMsg.payload.newText,
                      );
                    } catch (svErr) {
                      console.error(
                        `[collab] HOST saveVerseLocal from client failed: ${svErr.message}`,
                      );
                    }
                    broadcastCollab(localMsg, socket);
                    process.send({ event: 'collab', data: localMsg });
                  } else {
                    broadcastCollab(msg, socket);
                    process.send({ event: 'collab', data: msg });
                  }
                },
                () => {
                  collabSockets = collabSockets.filter((s) => s !== socket);
                  if (socketUser) {
                    collabActiveUsers.delete(socketUser);
                    broadcastCollab({
                      type: 'user_list',
                      payload: { users: Array.from(collabActiveUsers) },
                    });
                    broadcastCollab({
                      type: 'chat_message',
                      payload: {
                        user: 'Sistema',
                        message: `${socketUser} ha salido de la colaboración.`,
                        timestamp: Date.now(),
                      },
                    });
                    process.send({
                      event: 'collab',
                      data: {
                        type: 'user_list',
                        payload: { users: Array.from(collabActiveUsers) },
                      },
                    });
                    process.send({
                      event: 'collab',
                      data: {
                        type: 'chat_message',
                        payload: {
                          user: 'Sistema',
                          message: `${socketUser} ha salido de la colaboración.`,
                          timestamp: Date.now(),
                        },
                      },
                    });
                  }
                },
              );

              // Send periodic pings to detect dead connections
              const pingInterval = setInterval(() => {
                if (!socket.writable || socket.destroyed) {
                  clearInterval(pingInterval);
                  return;
                }
                // If no pong in 15s, consider the connection dead
                if (Date.now() - lastPongAt > 15000) {
                  console.warn(
                    `[collab] HOST: client ${socketUser} hasn't responded to pings in 15s, closing`,
                  );
                  try {
                    socket.destroy();
                  } catch (_) {}
                  clearInterval(pingInterval);
                  return;
                }
                try {
                  socket.write(JSON.stringify({ type: 'ping' }) + '\n');
                } catch (_) {}
              }, 5000);
              socket.on('close', () => clearInterval(pingInterval));
            });

            collabServer.on('error', (err) => {
              cleanupCollab(inAutoReconnect);
              reject(err);
            });

            collabServer.listen(collabPort, '0.0.0.0', () => {
              rememberConnection('host', {
                portOrRoomId: collabPort,
                username,
                projectId,
                projectDir,
                type: collabType,
                serverUrl: '',
              });
              resolve({ status: 'ok', role: 'host', ips: getLocalIps() });
            });
          } catch (e) {
            cleanupCollab(inAutoReconnect);
            reject(e);
          }
        });
      }
    }

    case 'connectCollabClient': {
      const [ipOrRoomId, portOrNull, username, projectId, projectDir, collabTypeArg, serverUrlArg] =
        args;
      if (projectDir) projectDirs.set(projectId, projectDir);

      // If we're in an auto-reconnect, the state is already clean and we
      // don't want a duplicate status_update going to main.ts.
      const inAutoReconnect = isReconnecting || (reconnectParams && collabRole === 'none');
      cleanupCollab(inAutoReconnect);

      collabRole = 'client';
      collabType = collabTypeArg || 'local';
      collabUsername = username;

      if (collabType === 'online') {
        collabRoomId = ipOrRoomId;
        collabServerUrl = serverUrlArg || 'ws://localhost:8080';
        collabActiveUsers = new Set();

        return new Promise((resolve, reject) => {
          try {
            const ws = new globalThis.WebSocket(collabServerUrl);
            collabWs = ws;

            ws.onopen = () => {
              ws.send(
                JSON.stringify({
                  type: 'join_room',
                  payload: { roomId: collabRoomId, username: collabUsername },
                }),
              );
            };

            ws.onmessage = (event) => {
              try {
                const msg = JSON.parse(event.data);

                if (msg.type === 'handshake_ack') {
                  rememberConnection('client', {
                    ipOrRoomId,
                    port: portOrNull,
                    username,
                    projectId,
                    projectDir,
                    type: collabType,
                    serverUrl: collabServerUrl,
                  });
                  resolve({ status: 'ok', role: 'client' });
                } else if (msg.type === 'error') {
                  cleanupCollab(inAutoReconnect);
                  reject(new Error(msg.payload.message));
                } else if (msg.type === 'init_sync') {
                  saveTasksLocal(projectId, msg.payload.tasksJson);
                  process.send({
                    event: 'collab',
                    data: { type: 'tasks_update', payload: { projectId } },
                  });
                } else if (msg.type === 'user_list') {
                  collabActiveUsers = new Set(msg.payload.users);
                  process.send({ event: 'collab', data: msg });
                } else if (msg.type === 'tasks_update') {
                  const localMsg = localizeCollabProject(msg, projectId);
                  saveTasksLocal(projectId, localMsg.payload.tasksJson);
                  process.send({ event: 'collab', data: localMsg });
                } else if (msg.type === 'note_update') {
                  const localMsg = localizeCollabProject(msg, projectId);
                  saveCollabComment(
                    projectId,
                    localMsg.payload.senderUser,
                    localMsg.payload.replyData,
                  );
                  process.send({ event: 'collab', data: localMsg });
                } else if (msg.type === 'cursor_update') {
                  process.send({ event: 'collab', data: localizeCollabProject(msg, projectId) });
                } else if (msg.type === 'chat_message') {
                  process.send({ event: 'collab', data: msg });
                } else if (msg.type === 'verse_update') {
                  const localMsg = localizeCollabProject(msg, projectId);
                  try {
                    saveVerseLocal(
                      projectId,
                      localMsg.payload.book,
                      localMsg.payload.chapter,
                      localMsg.payload.verse,
                      localMsg.payload.newText,
                    );
                  } catch (svErr) {
                    console.error(
                      `[collab] CLIENT saveVerseLocal from host failed: ${svErr.message}`,
                    );
                  }
                  process.send({ event: 'collab', data: localMsg });
                } else if (msg.type === 'status_update') {
                  process.send({ event: 'collab', data: msg });
                } else {
                  process.send({ event: 'collab', data: msg });
                }
              } catch (err) {
                console.error('Error parsing client ws msg:', err);
              }
            };

            ws.onerror = (err) => {
              cleanupCollab(inAutoReconnect);
              reject(err);
            };

            ws.onclose = () => {
              const wasReconnecting = isReconnecting;
              const willReconnect = !!reconnectParams && !wasReconnecting;
              cleanupCollab(willReconnect);
              if (willReconnect) {
                console.log(`[collab] CLIENT connection lost — scheduling auto-reconnect`);
                scheduleReconnect();
              } else {
                process.send({
                  event: 'collab',
                  data: {
                    type: 'status_update',
                    payload: { role: 'none', error: 'Se perdió la conexión con el servidor online.' },
                  },
                });
              }
            };
          } catch (e) {
            cleanupCollab(inAutoReconnect);
            reject(e);
          }
        });
      } else {
        collabPort = portOrNull || 49885;
        collabHostIp = ipOrRoomId;
        collabActiveUsers = new Set();

        return new Promise((resolve, reject) => {
          let connected = false;
          let lastPongAt = Date.now();
          try {
            const socket = net.createConnection({ host: collabHostIp, port: collabPort }, () => {
              connected = true;
              lastPongAt = Date.now();
              socket.setKeepAlive(true, 10000);
              socket.setNoDelay(true);
              collabClientSocket = socket;
              console.log(
                `[collab] CLIENT socket connected to host ${collabHostIp}:${collabPort}, writable=${socket.writable}`,
              );
              socket.write(JSON.stringify({ type: 'handshake', payload: { username } }) + '\n');
              // Remember params for auto-reconnect BEFORE resolving.
              rememberConnection('client', {
                ipOrRoomId,
                port: portOrNull,
                username,
                projectId,
                projectDir,
                type: collabType,
                serverUrl: '',
              });

              // Notify main.ts and webview of successful connection
              try {
                process.send({
                  event: 'collab',
                  data: {
                    type: 'status_update',
                    payload: { role: 'client' },
                  },
                });
              } catch (_) {}

              resolve({ status: 'ok', role: 'client' });
            });

            socket.on('error', (err) => {
              console.error(`[collab] CLIENT socket error: ${err.message}`);
              // Don't reject here if we're already connected — let the close
              // handler run the cleanup and the auto-reconnect schedule. We
              // only reject the initial connection promise.
              if (!connected) {
                cleanupCollab(inAutoReconnect);
                reject(err);
              } else {
                try {
                  socket.destroy();
                } catch (_) {}
              }
            });

            setupSocketReceiver(
              socket,
              (msg) => {
                hasAliveLanSocket();
                if (msg.type === 'ping') {
                  // Respond to host pings with a pong but do NOT reset lastPongAt.
                  // lastPongAt tracks whether the HOST is responding to OUR pings.
                  // Resetting it here would mask a dead one-way connection where
                  // the host sends pings but never responds to client pings.
                  try {
                    socket.write(JSON.stringify({ type: 'pong' }) + '\n');
                  } catch (_) {}
                  return;
                }
                if (msg.type === 'pong') {
                  // Host responded to our ping — connection is alive
                  lastPongAt = Date.now();
                  return;
                }
                console.log(`[collab] CLIENT received from host: ${msg.type}`);
                if (msg.type === 'init_sync') {
                  saveTasksLocal(projectId, msg.payload.tasksJson);
                  process.send({
                    event: 'collab',
                    data: { type: 'tasks_update', payload: { projectId } },
                  });
                } else if (msg.type === 'user_list') {
                  collabActiveUsers = new Set(msg.payload.users);
                  process.send({ event: 'collab', data: msg });
                } else if (msg.type === 'tasks_update') {
                  const localMsg = localizeCollabProject(msg, projectId);
                  saveTasksLocal(projectId, localMsg.payload.tasksJson);
                  process.send({ event: 'collab', data: localMsg });
                } else if (msg.type === 'note_update') {
                  const localMsg = localizeCollabProject(msg, projectId);
                  saveCollabComment(
                    projectId,
                    localMsg.payload.senderUser,
                    localMsg.payload.replyData,
                  );
                  process.send({ event: 'collab', data: localMsg });
                } else if (msg.type === 'cursor_update') {
                  process.send({ event: 'collab', data: localizeCollabProject(msg, projectId) });
                } else if (msg.type === 'chat_message') {
                  process.send({ event: 'collab', data: msg });
                } else if (msg.type === 'verse_update') {
                  const localMsg = localizeCollabProject(msg, projectId);
                  try {
                    saveVerseLocal(
                      projectId,
                      localMsg.payload.book,
                      localMsg.payload.chapter,
                      localMsg.payload.verse,
                      localMsg.payload.newText,
                    );
                  } catch (svErr) {
                    console.error(`[collab] saveVerseLocal (online) failed: ${svErr.message}`);
                  }
                  process.send({ event: 'collab', data: localMsg });
                } else {
                  process.send({ event: 'collab', data: msg });
                }
              },
              () => {
                // Connection dropped. Clean up and (if the user has not
                // explicitly stopped) try to reconnect automatically.
                const wasReconnecting = isReconnecting;
                const willReconnect = !!reconnectParams && !wasReconnecting;
                // Pass silent=true when we will immediately schedule a reconnect
                // so cleanupCollab doesn't send a status_update{role:'none'} that
                // causes the UI to briefly flash the disconnected banner before
                // the reconnecting banner appears from scheduleReconnect().
                cleanupCollab(willReconnect);
                if (willReconnect) {
                  console.log(`[collab] CLIENT connection lost — scheduling auto-reconnect`);
                  scheduleReconnect();
                } else {
                  process.send({
                    event: 'collab',
                    data: {
                      type: 'status_update',
                      payload: { role: 'none', error: 'Se perdió la conexión con el servidor.' },
                    },
                  });
                }
              },
            );

            // Send periodic pings; if no pong in 15s, the connection is dead
            const pingInterval = setInterval(() => {
              if (!socket.writable || socket.destroyed) {
                clearInterval(pingInterval);
                return;
              }
              if (Date.now() - lastPongAt > 15000) {
                console.warn(`[collab] CLIENT: no pong from host in 15s, destroying socket`);
                try {
                  socket.destroy();
                } catch (_) {}
                clearInterval(pingInterval);
                return;
              }
              try {
                socket.write(JSON.stringify({ type: 'ping' }) + '\n');
              } catch (_) {}
            }, 5000);
            socket.on('close', () => clearInterval(pingInterval));
          } catch (e) {
            cleanupCollab();
            reject(e);
          }
        });
      }
    }

    case 'stopCollab': {
      clearReconnectParams();
      cleanupCollab();
      return 'ok';
    }

    case 'reconnectCollab': {
      // Manually trigger a reconnect attempt using the most recent
      // connection parameters. Resets the backoff counter so it tries
      // immediately.
      if (!reconnectParams) {
        return { status: 'error', error: 'No hay parámetros de reconexión guardados.' };
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      isReconnecting = false;
      reconnectAttempts = 0;
      attemptReconnect();
      return { status: 'ok', message: 'Reconectando...' };
    }

    case 'getReconnectStatus': {
      return {
        reconnecting: isReconnecting,
        attempts: reconnectAttempts,
        hasParams: !!reconnectParams,
      };
    }

    case 'getCollabStatus': {
      hasAliveLanSocket();
      return {
        role: collabRole,
        type: collabType,
        username: collabUsername,
        port: collabPort,
        hostIp: collabHostIp,
        roomId: collabRoomId,
        serverUrl: collabServerUrl,
        activeUsers: Array.from(collabActiveUsers),
        ips: getLocalIps(),
        reconnecting: isReconnecting,
        reconnectAttempts: reconnectAttempts,
        hasReconnectParams: !!reconnectParams,
      };
    }

    case 'broadcastCollab': {
      const [msg] = args;
      hasAliveLanSocket();
      console.log(
        `[collab] Helper received broadcastCollab IPC: ${msg?.type} (role=${collabRole}, type=${collabType})`,
      );
      broadcastCollab(msg);
      return 'ok';
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// --- LAN & Online Collaboration State & Helpers ---
let collabRole = 'none'; // 'host', 'client', 'none'
let collabType = 'local'; // 'local', 'online'
let collabServer = null;
let collabSockets = []; // host-only: active local TCP client sockets
let collabClientSocket = null; // client-only: local TCP socket to host
let collabWs = null; // WebSocket connection to relay server (for online host/client)
let collabUsername = '';
let collabPort = 49885;
let collabHostIp = '127.0.0.1';
let collabRoomId = '';
let collabServerUrl = '';
let collabActiveUsers = new Set(); // active usernames online

// Auto-reconnect state (client-side only). When the connection drops we
// remember the parameters used to connect and try again with exponential
// backoff so the user does not have to manually reconnect on every blip.
let reconnectParams = null; // { ipOrRoomId, port, username, projectId, projectDir, type, serverUrl }
let reconnectAttempts = 0;
let reconnectTimer = null;
let isReconnecting = false;

function getLocalIps() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (iface) {
      for (const entry of iface) {
        const family = String(entry.family).toLowerCase();
        if ((family === 'ipv4' || family === '4') && !entry.internal) {
          addresses.push(entry.address);
        }
      }
    }
  }
  return addresses;
}

// --- Auto-reconnect helpers (client side) ---

// Save the parameters of a successful client connection so we can re-use
// them when the connection drops. Called from connectCollabClient after the
// socket is established and the handshake has been sent.
function rememberConnection(role, params) {
  reconnectParams = { role, ...params };
  reconnectAttempts = 0;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  isReconnecting = false;
}

function clearReconnectParams() {
  reconnectParams = null;
  reconnectAttempts = 0;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  isReconnecting = false;
}

function scheduleReconnect() {
  if (!reconnectParams) return;
  if (isReconnecting) return;
  // Exponential backoff: 2s, 4s, 8s, 16s, 30s (cap)
  const delays = [2000, 4000, 8000, 16000, 30000];
  const delay = delays[Math.min(reconnectAttempts, delays.length - 1)];
  reconnectAttempts++;
  isReconnecting = true;
  const targetId = reconnectParams.role === 'host' ? reconnectParams.portOrRoomId : (reconnectParams.ipOrRoomId + ':' + reconnectParams.port);
  console.log(
    `[collab] Auto-reconnect attempt #${reconnectAttempts} in ${delay}ms to ${targetId}`,
  );
  try {
    process.send({
      event: 'collab',
      data: {
        type: 'status_update',
        payload: { role: 'none', reconnecting: true, attempt: reconnectAttempts, delayMs: delay },
      },
    });
  } catch (_) {}
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    isReconnecting = false;
    attemptReconnect();
  }, delay);
}

async function attemptReconnect() {
  if (!reconnectParams) return;
  const params = reconnectParams;
  const targetId = params.role === 'host' ? params.portOrRoomId : (params.ipOrRoomId + ':' + params.port);
  console.log(
    `[collab] Auto-reconnect: connecting as ${params.role} to ${targetId} (attempt #${reconnectAttempts})`,
  );
  try {
    let result;
    if (params.role === 'host') {
      result = await handleAction('startCollabHost', [
        params.portOrRoomId,
        params.username,
        params.projectId,
        params.projectDir,
        params.type || 'local',
        params.serverUrl || '',
      ]);
    } else {
      result = await handleAction('connectCollabClient', [
        params.ipOrRoomId,
        params.port,
        params.username,
        params.projectId,
        params.projectDir,
        params.type || 'local',
        params.serverUrl || '',
      ]);
    }
    if (result && result.status === 'ok') {
      console.log(`[collab] Auto-reconnect succeeded`);
      reconnectAttempts = 0;
      isReconnecting = false;
    } else {
      console.warn(`[collab] Auto-reconnect returned non-ok: ${JSON.stringify(result)}`);
      scheduleReconnect();
    }
  } catch (err) {
    console.warn(`[collab] Auto-reconnect failed: ${err.message || err}`);
    scheduleReconnect();
  }
}

function cleanupCollab(silent = false) {
  // Cancel any pending auto-reconnect so we don't fight with the user
  // when they explicitly stop the session.
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  isReconnecting = false;

  if (collabServer) {
    try {
      collabServer.close();
    } catch (_) {}
    collabServer = null;
  }
  for (const socket of collabSockets) {
    try {
      socket.destroy();
    } catch (_) {}
  }
  collabSockets = [];

  if (collabClientSocket) {
    try {
      collabClientSocket.destroy();
    } catch (_) {}
    collabClientSocket = null;
  }

  if (collabWs) {
    try {
      collabWs.close();
    } catch (_) {}
    collabWs = null;
  }

  const wasHost = collabRole === 'host';
  const wasClient = collabRole === 'client';
  const prevType = collabType;
  collabRole = 'none';
  collabType = 'local';
  collabActiveUsers = new Set();
  collabRoomId = '';
  collabServerUrl = '';

  if (silent) return;

  // Always notify main.ts of the role change. Without this, a silent
  // cleanupCollab (e.g., from a socket error) leaves main.ts thinking the
  // user is still connected, and subsequent broadcasts are dropped.
  try {
    process.send({
      event: 'collab',
      data: {
        type: 'status_update',
        payload: {
          role: 'none',
          previousRole: wasHost ? 'host' : wasClient ? 'client' : 'none',
          previousType: prevType,
        },
      },
    });
  } catch (_) {}
}

// Returns true if there is at least one writable socket that can receive
// LAN broadcasts, regardless of the collabRole state. This is a defensive
// check for the case where main.ts believes the user is connected but the
// helper's collabRole was reset to 'none' (e.g., from a previous cleanup
// that did not propagate a status_update). The fix prevents silently
// dropping messages that the user thinks are being broadcast.
function hasAliveLanSocket() {
  if (collabRole === 'host') {
    return collabSockets.some((s) => s && s.writable && !s.destroyed);
  }
  if (collabRole === 'client') {
    return !!(collabClientSocket && collabClientSocket.writable && !collabClientSocket.destroyed);
  }
  // collabRole is 'none' — but the socket may still be alive from a prior
  // connection. Check anyway so we don't drop messages.
  if (collabClientSocket && collabClientSocket.writable && !collabClientSocket.destroyed) {
    // Self-heal: bring the role back in sync with reality.
    console.log('[collab] collabRole was none but client socket is alive — repairing state');
    collabRole = 'client';
    try {
      process.send({
        event: 'collab',
        data: {
          type: 'status_update',
          payload: { role: 'client' },
        },
      });
    } catch (_) {}
    return true;
  }
  if (collabSockets.some((s) => s && s.writable && !s.destroyed)) {
    console.log('[collab] collabRole was none but host sockets are alive — repairing state');
    collabRole = 'host';
    try {
      process.send({
        event: 'collab',
        data: {
          type: 'status_update',
          payload: { role: 'host' },
        },
      });
    } catch (_) {}
    return true;
  }
  return false;
}

function broadcastCollab(msg, excludeSocket = null) {
  hasAliveLanSocket();
  if (collabType === 'online') {
    if (collabWs && collabWs.readyState === 1) {
      // 1 is OPEN
      try {
        collabWs.send(JSON.stringify({ type: 'broadcast', payload: msg }));
      } catch (_) {}
    }
    return;
  }

  // Don't broadcast control pings
  if (msg && msg.type === 'ping') return;

  const line = JSON.stringify(msg) + '\n';
  if (collabRole === 'host' || (collabRole === 'none' && collabSockets.length > 0)) {
    let sentCount = 0;
    let skipped = 0;
    for (const socket of collabSockets) {
      if (socket !== excludeSocket && socket.writable && !socket.destroyed) {
        try {
          socket.write(line, (err) => {
            if (err) {
              console.error('[collab] Socket write error (host):', err.message);
              try {
                socket.destroy();
              } catch (_) {}
            }
          });
          sentCount++;
        } catch (e) {
          console.error('[collab] Socket write exception (host):', e.message);
          try {
            socket.destroy();
          } catch (_) {}
        }
      } else {
        skipped++;
      }
    }
    if (
      msg.type === 'cursor_update' ||
      msg.type === 'verse_update' ||
      msg.type === 'tasks_update' ||
      msg.type === 'note_update'
    ) {
      console.log(
        `[collab] HOST broadcast ${msg.type} to ${sentCount}/${collabSockets.length} client(s) (skipped ${skipped} dead)`,
      );
    }
  } else if (collabRole === 'client' || (collabRole === 'none' && collabClientSocket)) {
    const socket = collabClientSocket;
    if (socket && socket.writable && !socket.destroyed) {
      try {
        const ok = socket.write(line, (err) => {
          if (err) {
            console.error('[collab] Client socket write error:', err.message);
            try {
              socket.destroy();
            } catch (_) {}
          }
        });
        if (
          msg.type === 'cursor_update' ||
          msg.type === 'verse_update' ||
          msg.type === 'tasks_update' ||
          msg.type === 'note_update' ||
          msg.type === 'chat_message' ||
          msg.type === 'note_update'
        ) {
          console.log(
            `[collab] CLIENT sent ${msg.type} to host (writable=${socket.writable}, write OK=${ok})`,
          );
        }
      } catch (e) {
        console.error('[collab] Client socket write exception:', e.message);
        try {
          socket.destroy();
        } catch (_) {}
      }
    } else {
      console.warn(
        `[collab] CLIENT tried to send ${msg.type} but socket is not writable (writable=${socket?.writable}, destroyed=${socket?.destroyed}, exists=${!!socket})`,
      );
    }
  } else {
    console.warn(
      `[collab] broadcastCollab called with collabRole='${collabRole}' and no live socket — message dropped: ${msg.type}`,
    );
  }
}

function localizeCollabProject(msg, localProjectId) {
  if (!msg || !msg.payload || typeof msg.payload !== 'object') return msg;
  if (!('projectId' in msg.payload)) return msg;
  return {
    ...msg,
    payload: {
      ...msg.payload,
      projectId: localProjectId,
    },
  };
}

function setupSocketReceiver(socket, onMessage, onClose) {
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let boundary = buffer.indexOf('\n');
    while (boundary !== -1) {
      const line = buffer.substring(0, boundary).trim();
      buffer = buffer.substring(boundary + 1);
      if (line) {
        try {
          const msg = JSON.parse(line);
          onMessage(msg);
        } catch (e) {
          console.error('Error parsing TCP frame:', e, line);
        }
      }
      boundary = buffer.indexOf('\n');
    }
  });

  socket.on('close', () => {
    onClose();
  });

  socket.on('error', (err) => {
    console.error('collab socket error:', err);
    socket.destroy();
  });
}

// Strip USFM markers from a string to get the visible/cleaned text.
// This mirrors what parseUsfmChapter does so we can match user edits
// against the original cleaned text.
function stripUsfmForCompare(text) {
  return (text || '')
    .replace(/\\x\s+[\s\S]*?\\x\*/g, '')
    .replace(/\\f\s+(\S+)\s+(?:\\fr\s+[^\\]+)?\\ft\s+([\s\S]*?)\\f\*/g, '')
    .replace(/\\[a-z]+\*?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Apply the user's edit (which is on the cleaned text) to the original
// raw USFM text so we preserve italics/footnotes/character markers.
// Strategy: split raw into (plain, marker) tokens, then for each plain
// token, replace it with the corresponding slice of the user's new
// cleaned text. Markers are kept intact.
function applyEditToRawUsfm(originalRaw, originalCleaned, newCleaned) {
  if (!originalRaw) return newCleaned;
  if (originalCleaned === newCleaned) return originalRaw;

  // Tokenize originalRaw into an array of segments:
  //   { kind: 'text', value: '...' }   — plain text
  //   { kind: 'mark', value: '...' }   — USFM marker (e.g. \it, \f ... \f*, [FN:...])
  const segments = [];
  let i = 0;
  let plainBuf = '';
  const flushPlain = () => {
    if (plainBuf.length > 0) {
      segments.push({ kind: 'text', value: plainBuf });
      plainBuf = '';
    }
  };
  // Helper: collect the next USFM marker starting at i
  const collectMarker = (startI) => {
    // Inline char marker: \x (where x is one or more letters, optional *)
    //   or self-closing like \*
    // Footnote block: \f ... \f*
    // Or anything starting with backslash
    if (originalRaw[startI] !== '\\') return null;
    // Read marker name (letters)
    let j = startI + 1;
    while (j < originalRaw.length && /[a-z*+]/.test(originalRaw[j])) j++;
    let name = originalRaw.substring(startI, j);
    // Paired markers that need their full content captured
    if (name === '\\f' || name === '\\x' || name === '\\fe') {
      // Find the closing \f*, \x*, \fe* — must respect nesting loosely
      // Paratext footnotes don't nest the same marker, so a simple scan works
      const closer = name + '*';
      const closeIdx = originalRaw.indexOf(closer, j);
      if (closeIdx !== -1) {
        return originalRaw.substring(startI, closeIdx + closer.length);
      }
      return originalRaw.substring(startI); // unmatched — take rest
    }
    // Self-closing marker (\*, \wj*, etc.) — already ended with * above
    if (name.endsWith('*') || name.endsWith('+')) {
      return name;
    }
    // Inline char marker (\it, \bd, etc.) — captures content up to the
    // matching closing marker. Use a simple heuristic: read until next
    // backslash, then check if it's the closer \it* etc.
    const closerName = name + '*';
    // Look ahead: find the next \... that equals the closer
    let k = j;
    let foundClose = -1;
    while (k < originalRaw.length) {
      const backIdx = originalRaw.indexOf('\\', k);
      if (backIdx === -1) break;
      // Read candidate name
      let m = backIdx + 1;
      while (m < originalRaw.length && /[a-z*+]/.test(originalRaw[m])) m++;
      const candidate = originalRaw.substring(backIdx, m);
      if (candidate === closerName) {
        foundClose = backIdx;
        break;
      }
      // Nested marker — keep scanning (don't capture as our closer)
      k = m;
    }
    if (foundClose !== -1) {
      return originalRaw.substring(startI, foundClose + closerName.length);
    }
    return name;
  };

  while (i < originalRaw.length) {
    const ch = originalRaw[i];
    if (ch === '\\') {
      flushPlain();
      const marker = collectMarker(i);
      if (marker) {
        segments.push({ kind: 'mark', value: marker });
        i += marker.length;
        continue;
      }
    }
    // Also capture the [FN:...] placeholder that parseUsfmChapter produces
    if (ch === '[' && originalRaw.substring(i, i + 4) === '[FN:') {
      flushPlain();
      const endIdx = originalRaw.indexOf(']', i);
      if (endIdx !== -1) {
        segments.push({ kind: 'mark', value: originalRaw.substring(i, endIdx + 1) });
        i = endIdx + 1;
        continue;
      }
    }
    plainBuf += ch;
    i++;
  }
  flushPlain();

  // Build cleaned text from segments (markers become empty strings, text
  // segments are concatenated with their original whitespace preserved).
  // We compare against the originalCleaned provided by the caller.
  const rebuiltCleaned = segments
    .map((s) => (s.kind === 'text' ? s.value : ''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  // If the rebuilt cleaned text doesn't match the original, fall back to
  // the new cleaned text (best effort — formatting will be lost).
  if (rebuiltCleaned !== originalCleaned.replace(/\s+/g, ' ').trim()) {
    return newCleaned;
  }

  // Walk segments and assign each text segment a slice of newCleaned.
  // We compute the cumulative cleaned length at segment boundaries and
  // map the differences.
  const textSegments = segments.map((s, idx) => ({ ...s, idx })).filter((s) => s.kind === 'text');

  if (textSegments.length === 0) {
    return newCleaned + (originalRaw ? ' ' + originalRaw : '');
  }

  // Compute the length of each text segment's contribution to the
  // original cleaned text (whitespace normalized).
  const textCleanedLengths = textSegments.map((s) => {
    return s.value.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').length;
  });

  const getLeadingWhitespace = (str) => {
    const match = str.match(/^\s+/);
    return match ? match[0] : '';
  };

  const getTrailingWhitespace = (str) => {
    const match = str.match(/\s+$/);
    return match ? match[0] : '';
  };

  // Walk newCleaned and assign characters to text segments in order.
  let newCleanedPos = 0;
  const resultParts = [];
  for (let ti = 0; ti < textSegments.length; ti++) {
    const seg = textSegments[ti];
    let take;
    if (ti < textSegments.length - 1) {
      // Take exactly the original cleaned-length of this segment
      take = textCleanedLengths[ti];
    } else {
      // Last segment takes everything remaining
      take = newCleaned.length - newCleanedPos;
    }
    const slice = newCleaned.substring(newCleanedPos, newCleanedPos + take);
    newCleanedPos += take;

    // Preserve original leading and trailing whitespace to prevent space stripping/tag merging
    const leadingWs = getLeadingWhitespace(seg.value);
    const trailingWs = getTrailingWhitespace(seg.value);
    resultParts.push({ idx: seg.idx, value: leadingWs + slice + trailingWs });
  }

  // If we didn't consume all of newCleaned, append the remainder to the
  // last text segment.
  if (newCleanedPos < newCleaned.length && resultParts.length > 0) {
    const last = resultParts[resultParts.length - 1];
    const trailingWs = getTrailingWhitespace(textSegments[textSegments.length - 1].value);
    // Strip trailing whitespace from intermediate value, append remainder, then re-append trailing whitespace
    const currentBase = last.value.substring(0, last.value.length - trailingWs.length);
    last.value = currentBase + newCleaned.substring(newCleanedPos) + trailingWs;
  }

  // Reassemble segments, replacing text values with their assigned slices.
  const resultMap = new Map(resultParts.map((p) => [p.idx, p.value]));
  const finalRaw = segments
    .map((s, idx) => (s.kind === 'text' ? resultMap.get(idx) || '' : s.value))
    .join('');

  return finalRaw;
}

function saveVerseLocal(projectId, bookCode, chapter, verse, newText) {
  const projectDir = projectDirs.get(projectId);
  if (!projectDir) {
    const err = `projectDir not found for project ${projectId}`;
    console.error(`[collab] saveVerseLocal: ${err}`);
    throw new Error(err);
  }
  let postPart = '.SFM';
  let prePart = '';
  const settingsPath = path.join(projectDir, 'Settings.xml');
  if (fs.existsSync(settingsPath)) {
    try {
      const xml = fs.readFileSync(settingsPath, 'utf8');
      const postMatch = /<FileNamePostPart>([^<]+)<\/FileNamePostPart>/i.exec(xml);
      if (postMatch) postPart = postMatch[1].trim();
      const preMatch = /<FileNamePrePart>([^<]+)<\/FileNamePrePart>/i.exec(xml);
      if (preMatch) prePart = preMatch[1].trim();
    } catch (_) {}
  }

  const files = fs.readdirSync(projectDir);
  const regex = new RegExp(`^${escapeRegex(prePart)}\\d*${bookCode}${escapeRegex(postPart)}$`, 'i');
  const foundFile = files.find((f) => regex.test(f));
  if (!foundFile) {
    const err = `Book file not found for code ${bookCode} in ${projectDir}`;
    console.error(`[collab] saveVerseLocal: ${err}`);
    throw new Error(err);
  }

  const filePath = path.join(projectDir, foundFile);
  const fileContent = fs.readFileSync(filePath, 'utf8');

  const chapterRegex = new RegExp(`(\\\\c\\s+${chapter}\\b)([\\s\\S]*?)(?=\\\\c\\s+\\d+|$)`, 'i');
  const chapMatch = chapterRegex.exec(fileContent);
  if (!chapMatch) {
    const err = `Chapter ${chapter} not found in ${foundFile}`;
    console.error(`[collab] saveVerseLocal: ${err}`);
    throw new Error(err);
  }

  const chapHeader = chapMatch[1];
  const chapBody = chapMatch[2];

  const verseRegex = new RegExp(
    `(\\\\v\\s+${verse}\\b[ \\t]*)([\\s\\S]*?)(?=\\\\v\\s+\\d+|$)`,
    'i',
  );
  const vMatch = verseRegex.exec(chapBody);
  if (!vMatch) {
    const err = `Verse ${verse} not found in chapter ${chapter} of ${foundFile}`;
    console.error(`[collab] saveVerseLocal: ${err}`);
    throw new Error(err);
  }

  const vHeader = vMatch[1];
  const vBody = vMatch[2];
  const newline = fileContent.includes('\r\n') ? '\r\n' : '\n';

  // Find the first block marker to split off trailing structural markup
  const blockMarkerRegex =
    /[\r\n]+\\(p|m|q|s|b|li|lh|lim|tr|tc|cl|im|ip|is|iot|io|d|r|nb)[a-z0-9]*\b/i;
  const blockMatch = blockMarkerRegex.exec(vBody);

  let trailingBlockMarkers = '';
  let actualVerseText = vBody;
  if (blockMatch) {
    const splitIndex = blockMatch.index;
    actualVerseText = vBody.substring(0, splitIndex);
    trailingBlockMarkers = vBody.substring(splitIndex);
  }

  // Try to preserve USFM markers if the new text is the edited cleaned
  // version of the original raw text.
  let verseReplacement = newText;
  if (newText && !newText.startsWith('\\') && actualVerseText) {
    const originalCleaned = stripUsfmForCompare(actualVerseText);
    const newCleaned = (newText || '').replace(/\s+/g, ' ').trim();
    if (originalCleaned && newCleaned) {
      verseReplacement = applyEditToRawUsfm(actualVerseText, originalCleaned, newCleaned);
    }
  }

  const vStartIndex = vMatch.index;
  const vLength = vMatch[0].length;
  const updatedChapBody =
    chapBody.substring(0, vStartIndex) +
    vHeader +
    verseReplacement.trimEnd() +
    (trailingBlockMarkers ? '' : newline) +
    trailingBlockMarkers +
    chapBody.substring(vStartIndex + vLength);

  const startIndex = chapMatch.index;
  const length = chapMatch[0].length;
  const updatedFileContent =
    fileContent.substring(0, startIndex) +
    chapHeader +
    updatedChapBody +
    fileContent.substring(startIndex + length);

  // Atomic write: write to temp file, then rename. This prevents the file
  // from being partially written if the process is killed mid-write.
  const tmpPath = filePath + '.tmp-verse-' + Date.now();
  fs.writeFileSync(tmpPath, updatedFileContent, 'utf8');
  fs.renameSync(tmpPath, filePath);

  // Verify the write by reading back the verse.
  try {
    const verify = fs.readFileSync(filePath, 'utf8');
    if (verify !== updatedFileContent) {
      const err = `Verification failed: file content differs after write (${verify.length} vs ${updatedFileContent.length} bytes)`;
      console.error(`[collab] saveVerseLocal: ${err}`);
      throw new Error(err);
    }
  } catch (vErr) {
    if (vErr && vErr.message && vErr.message.startsWith('Verification failed')) throw vErr;
    console.warn(`[collab] saveVerseLocal: post-write verification read failed: ${vErr.message}`);
  }

  console.log(
    `[collab] saveVerseLocal: wrote ${bookCode} ${chapter}:${verse} to ${foundFile} (${updatedFileContent.length} bytes)`,
  );
}

function saveTasksLocal(projectId, tasksJson) {
  const projectDir = projectDirs.get(projectId);
  if (!projectDir) return;
  const tasksPath = path.join(projectDir, 'project-tasks.json');
  let finalJson = tasksJson;
  if (fs.existsSync(tasksPath)) {
    try {
      const localJson = fs.readFileSync(tasksPath, 'utf8');
      finalJson = mergeTasks(localJson, tasksJson);
    } catch (_) {}
  }
  fs.writeFileSync(tasksPath, finalJson, 'utf8');
}

function mergeTasks(localJson, incomingJson) {
  try {
    const local = JSON.parse(localJson);
    const remote = JSON.parse(incomingJson);
    if (!local.tasks) return incomingJson;
    if (!remote.tasks) return localJson;

    const deletedIds = new Set([...(local.deletedTaskIds || []), ...(remote.deletedTaskIds || [])]);

    const taskMap = new Map();
    for (const t of remote.tasks || []) {
      if (!deletedIds.has(t.id)) taskMap.set(t.id, t);
    }
    for (const t of local.tasks || []) {
      if (deletedIds.has(t.id)) continue;
      const existing = taskMap.get(t.id);
      if (!existing || t.updatedAt >= existing.updatedAt) {
        taskMap.set(t.id, t);
      }
    }

    const logMap = new Map();
    for (const e of remote.activityLog || []) logMap.set(e.id, e);
    for (const e of local.activityLog || []) logMap.set(e.id, e);
    const mergedLog = Array.from(logMap.values())
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 200);

    const merged = {
      schemaVersion: 1,
      tasks: Array.from(taskMap.values()),
      stageConfig: local.stageConfig || remote.stageConfig,
      ...(mergedLog.length > 0 ? { activityLog: mergedLog } : {}),
      ...(deletedIds.size > 0 ? { deletedTaskIds: Array.from(deletedIds) } : {}),
    };
    return JSON.stringify(merged, null, 2);
  } catch (e) {
    return localJson || incomingJson;
  }
}

function saveCollabComment(projectId, senderUser, replyData) {
  const projectDir = projectDirs.get(projectId);
  if (!projectDir) return;

  const { filePath, fullName } = findNotesFileAndFullName(projectDir, senderUser);

  const {
    threadId,
    verseRef,
    language,
    selectedText,
    startPosition,
    contextBefore,
    contextAfter,
    verseXml,
    replyToUser,
    hideInTextWindow,
    contents,
    assignedUser,
  } = replyData;

  let formattedContents = '';
  if (contents && contents.includes('\n')) {
    const paragraphs = contents.split(/\r?\n/);
    formattedContents = paragraphs.map((p) => `<p>${escapeXml(p)}</p>`).join('');
  } else {
    formattedContents = escapeXml(contents || '');
  }

  const newCommentXml = `  <Comment Thread="${threadId}" User="${escapeXml(fullName)}" VerseRef="${escapeXml(verseRef)}" Language="${escapeXml(language || '')}" Date="${new Date().toISOString()}">
    <SelectedText>${escapeXml(selectedText || '')}</SelectedText>
    <StartPosition>${startPosition || '0'}</StartPosition>
    <ContextBefore>${escapeXml(contextBefore || '')}</ContextBefore>
    <ContextAfter>${escapeXml(contextAfter || '')}</ContextAfter>
    <Status></Status>
    <Type></Type>
    <ConflictType />
    <Verse>${escapeXml(verseXml || '')}</Verse>
    <ReplyToUser>${escapeXml(replyToUser || '')}</ReplyToUser>
    <HideInTextWindow>${hideInTextWindow || 'false'}</HideInTextWindow>
    <AssignedUser>${escapeXml(assignedUser || '')}</AssignedUser>
    <Contents>${formattedContents}</Contents>
  </Comment>\n`;

  let fileXml = '';
  if (fs.existsSync(filePath)) {
    fileXml = fs.readFileSync(filePath, 'utf8');
  } else {
    fileXml = `<?xml version="1.0" encoding="utf-8"?>\n<CommentList>\n</CommentList>\n`;
  }

  const closingTagIndex = fileXml.lastIndexOf('</CommentList>');
  if (closingTagIndex === -1) {
    throw new Error(`Invalid XML file: missing </CommentList> closing tag in ${filePath}`);
  }

  fileXml = fileXml.slice(0, closingTagIndex) + newCommentXml + fileXml.slice(closingTagIndex);
  fs.writeFileSync(filePath, fileXml, 'utf8');

  // Clear memory cache so the note updates instantly when loaded
  notesCache.delete(filePath);
}

// Start HTTP Server
startLocalAudioServer();

// Listen to parent IPC messages
process.on('message', async (message) => {
  const { id, action, args } = message;
  if (action !== 'ping') {
    console.log(`[helper] IPC received: action=${action} id=${id}`);
  }
  try {
    const result = await handleAction(action, args);
    process.send({ id, result });
    if (action !== 'ping') {
      console.log(`[helper] IPC response sent: action=${action} id=${id} success=true`);
    }
  } catch (err) {
    console.error(`[helper] IPC error: action=${action} id=${id} error=${err.message}`);
    process.send({ id, error: err.message });
  }
});
