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

function parseNotesXml(filePath) {
  const comments = [];
  try {
    const xml = fs.readFileSync(filePath, 'utf8');
    const commentRegex = /<Comment\b([^>]*?)>([\s\S]*?)<\/Comment>/gi;
    let match;
    const filename = path.basename(filePath);

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
        const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\/${tag}>`, 'i');
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
    // console.warn('parseNotesXml failed:', e);
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

    localAudioServer.listen(49876, '127.0.0.1', () => {
      // console.log('Notes helper: local HTTP server running on port 49876');
    });
  } catch (e) {
    // console.error('Failed to start HTTP server:', e);
  }
}

// --- IPC Request/Response Router ---

async function handleAction(action, args) {
  switch (action) {
    case 'registerProjectDir': {
      const [projectId, projectDir] = args;
      projectDirs.set(projectId, projectDir);
      return 'ok';
    }

    case 'getProjectNotes': {
      const [projectId, projectDir, currentUser, readLogPath] = args;
      projectDirs.set(projectId, projectDir); // ensure registered

      const files = fs.readdirSync(projectDir);
      const notesFiles = files.filter((f) => f.startsWith('Notes_') && f.endsWith('.xml'));

      const allComments = [];
      const authorsSet = new Set();

      for (const file of notesFiles) {
        const filePath = path.join(projectDir, file);
        const author = file.slice(6, -4);
        authorsSet.add(author);

        try {
          const stat = fs.statSync(filePath);
          const cached = notesCache.get(filePath);
          if (cached && cached.mtimeMs === stat.mtimeMs) {
            allComments.push(...cached.comments);
          } else {
            const comments = parseNotesXml(filePath);
            notesCache.set(filePath, {
              mtimeMs: stat.mtimeMs,
              comments,
            });
            allComments.push(...comments);
          }
        } catch (e) {
          // Fallback on error
          const comments = parseNotesXml(filePath);
          allComments.push(...comments);
        }
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
        if (fs.existsSync(readLogPath)) {
          readLog = JSON.parse(fs.readFileSync(readLogPath, 'utf8'));
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

      return { status: 'ok', fullName };
    }

    case 'getProjectBooks': {
      const [projectId, projectDir] = args;
      // Get filename settings
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
      const books = [];

      for (const code of BIBLE_BOOK_CODES) {
        const regex = new RegExp(
          `^${escapeRegex(prePart)}\\d*${code}${escapeRegex(postPart)}$`,
          'i',
        );
        const foundFile = files.find((f) => regex.test(f));

        if (foundFile) {
          let bookName = BIBLE_BOOK_NAMES_ES[code] || code;
          try {
            const filePath = path.join(projectDir, foundFile);
            const fd = fs.openSync(filePath, 'r');
            const buffer = Buffer.alloc(1024);
            const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0);
            fs.closeSync(fd);
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

          books.push({ code, name: bookName, fileName: foundFile });
        }
      }
      return books;
    }

    case 'getChapterText': {
      const [projectId, projectDir, bookCode, chapter] = args;
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
      const regex = new RegExp(
        `^${escapeRegex(prePart)}\\d*${bookCode}${escapeRegex(postPart)}$`,
        'i',
      );
      const foundFile = files.find((f) => regex.test(f));

      if (!foundFile) {
        throw new Error(`Book file not found for code ${bookCode}`);
      }

      const filePath = path.join(projectDir, foundFile);
      const fileContent = fs.readFileSync(filePath, 'utf8');

      const chapterRegex = new RegExp(
        `\\\\c\\s+${chapter}\\b([\\s\\S]*?)(?:\\\\c\\s+\\d+|\\$)`,
        'i',
      );
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
      const regex = new RegExp(
        `^${escapeRegex(prePart)}\\d*${bookCode}${escapeRegex(postPart)}$`,
        'i',
      );
      const foundFile = files.find((f) => regex.test(f));

      if (!foundFile) {
        throw new Error(`Book file not found for code ${bookCode}`);
      }

      const filePath = path.join(projectDir, foundFile);
      const fileContent = fs.readFileSync(filePath, 'utf8');

      const chapterRegex = new RegExp(
        `(\\\\c\\s+${chapter}\\b)([\\s\\S]*?)(?=\\\\c\\s+\\d+|$)`,
        'i',
      );
      const chapMatch = chapterRegex.exec(fileContent);
      if (!chapMatch) {
        throw new Error(`Chapter ${chapter} not found in book ${bookCode}`);
      }

      const chapHeader = chapMatch[1];
      const chapBody = chapMatch[2];

      const verseRegex = new RegExp(
        `(\\\\v\\s+${verse}\\b\\s*)([\\s\\S]*?)(?=\\\\v\\s+\\d+|$)`,
        'i',
      );
      const vMatch = verseRegex.exec(chapBody);
      if (!vMatch) {
        throw new Error(`Verse ${verse} not found in chapter ${chapter}`);
      }

      const vHeader = vMatch[1];
      const newline = fileContent.includes('\r\n') ? '\r\n' : '\n';

      const vStartIndex = vMatch.index;
      const vLength = vMatch[0].length;
      const updatedChapBody =
        chapBody.substring(0, vStartIndex) +
        vHeader +
        newText.trim() +
        newline +
        chapBody.substring(vStartIndex + vLength);

      const startIndex = chapMatch.index;
      const length = chapMatch[0].length;
      const updatedFileContent =
        fileContent.substring(0, startIndex) +
        chapHeader +
        updatedChapBody +
        fileContent.substring(startIndex + length);

      fs.writeFileSync(filePath, updatedFileContent, 'utf8');
      return 'ok';
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

      cleanupCollab();

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
              ws.send(JSON.stringify({
                type: 'host_room',
                payload: { roomId: collabRoomId, username: collabUsername }
              }));
            };

            ws.onmessage = (event) => {
              try {
                const msg = JSON.parse(event.data);

                if (msg.type === 'handshake_ack') {
                  resolve({ status: 'ok', role: 'host' });
                  process.send({ event: 'collab', data: { type: 'user_list', payload: { users: Array.from(collabActiveUsers) } } });
                  process.send({
                    event: 'collab',
                    data: { type: 'chat_message', payload: { user: 'Sistema', message: `Iniciaste sesión online en la sala: ${collabRoomId}`, timestamp: Date.now() } }
                  });
                } else if (msg.type === 'error') {
                  cleanupCollab();
                  reject(new Error(msg.payload.message));
                } else if (msg.type === 'user_joined') {
                  const guestName = msg.payload.username;
                  const tasksPath = path.join(projectDir, 'project-tasks.json');
                  let tasksJson = '{}';
                  if (fs.existsSync(tasksPath)) {
                    tasksJson = fs.readFileSync(tasksPath, 'utf8');
                  }
                  ws.send(JSON.stringify({
                    type: 'send_to',
                    target: guestName,
                    payload: { type: 'init_sync', payload: { tasksJson } }
                  }));
                } else if (msg.type === 'user_list') {
                  collabActiveUsers = new Set(msg.payload.users);
                  process.send({ event: 'collab', data: msg });
                } else if (msg.type === 'chat_message') {
                  process.send({ event: 'collab', data: msg });
                } else if (msg.type === 'tasks_update') {
                  saveTasksLocal(projectId, msg.payload.tasksJson);
                  process.send({ event: 'collab', data: msg });
                } else if (msg.type === 'note_update') {
                  saveCollabComment(projectId, msg.payload.senderUser, msg.payload.replyData);
                  process.send({ event: 'collab', data: msg });
                } else if (msg.type === 'cursor_update') {
                  process.send({ event: 'collab', data: msg });
                } else if (msg.type === 'status_update') {
                  process.send({ event: 'collab', data: msg });
                }
              } catch (err) {
                console.error('Error parsing host ws msg:', err);
              }
            };

            ws.onerror = (err) => {
              cleanupCollab();
              reject(err);
            };

            ws.onclose = () => {
              cleanupCollab();
              process.send({ event: 'collab', data: { type: 'status_update', payload: { role: 'none', error: 'Se cerró la sesión online.' } } });
            };

          } catch (e) {
            cleanupCollab();
            reject(e);
          }
        });
      } else {
        collabPort = portOrRoomId || 49885;
        collabActiveUsers = new Set([username]);

        return new Promise((resolve, reject) => {
          try {
            collabServer = net.createServer((socket) => {
              let socketUser = '';
              collabSockets.push(socket);

              setupSocketReceiver(
                socket,
                (msg) => {
                  if (msg.type === 'handshake') {
                    socketUser = msg.payload.username;
                    collabActiveUsers.add(socketUser);

                    // Broadcast updated user list
                    broadcastCollab({ type: 'user_list', payload: { users: Array.from(collabActiveUsers) } });

                    // Send init sync (current tasks)
                    const tasksPath = path.join(projectDir, 'project-tasks.json');
                    let tasksJson = '{}';
                    if (fs.existsSync(tasksPath)) {
                      tasksJson = fs.readFileSync(tasksPath, 'utf8');
                    }
                    socket.write(JSON.stringify({ type: 'init_sync', payload: { tasksJson } }) + '\n');

                    // Send system chat message
                    broadcastCollab({
                      type: 'chat_message',
                      payload: { user: 'Sistema', message: `${socketUser} se ha unido a la colaboración.`, timestamp: Date.now() }
                    });

                    // Notify host main.ts
                    process.send({ event: 'collab', data: { type: 'user_list', payload: { users: Array.from(collabActiveUsers) } } });
                    process.send({
                      event: 'collab',
                      data: { type: 'chat_message', payload: { user: 'Sistema', message: `${socketUser} se ha unido a la colaboración.`, timestamp: Date.now() } }
                    });
                  } else if (msg.type === 'tasks_update') {
                    saveTasksLocal(msg.payload.projectId, msg.payload.tasksJson);
                    broadcastCollab(msg, socket);
                    process.send({ event: 'collab', data: msg });
                  } else if (msg.type === 'note_update') {
                    saveCollabComment(msg.payload.projectId, msg.payload.senderUser, msg.payload.replyData);
                    broadcastCollab(msg, socket);
                    process.send({ event: 'collab', data: msg });
                  } else if (msg.type === 'cursor_update') {
                    broadcastCollab(msg, socket);
                    process.send({ event: 'collab', data: msg });
                  } else if (msg.type === 'chat_message') {
                    broadcastCollab(msg, socket);
                    process.send({ event: 'collab', data: msg });
                  }
                },
                () => {
                  collabSockets = collabSockets.filter((s) => s !== socket);
                  if (socketUser) {
                    collabActiveUsers.delete(socketUser);
                    broadcastCollab({ type: 'user_list', payload: { users: Array.from(collabActiveUsers) } });
                    broadcastCollab({
                      type: 'chat_message',
                      payload: { user: 'Sistema', message: `${socketUser} ha salido de la colaboración.`, timestamp: Date.now() }
                    });
                    process.send({ event: 'collab', data: { type: 'user_list', payload: { users: Array.from(collabActiveUsers) } } });
                    process.send({
                      event: 'collab',
                      data: { type: 'chat_message', payload: { user: 'Sistema', message: `${socketUser} ha salido de la colaboración.`, timestamp: Date.now() } }
                    });
                  }
                }
              );
            });

            collabServer.on('error', (err) => {
              cleanupCollab();
              reject(err);
            });

            collabServer.listen(collabPort, '0.0.0.0', () => {
              resolve({ status: 'ok', role: 'host', ips: getLocalIps() });
            });
          } catch (e) {
            cleanupCollab();
            reject(e);
          }
        });
      }
    }

    case 'connectCollabClient': {
      const [ipOrRoomId, portOrNull, username, projectId, projectDir, collabTypeArg, serverUrlArg] = args;
      if (projectDir) projectDirs.set(projectId, projectDir);

      cleanupCollab();

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
              ws.send(JSON.stringify({
                type: 'join_room',
                payload: { roomId: collabRoomId, username: collabUsername }
              }));
            };

            ws.onmessage = (event) => {
              try {
                const msg = JSON.parse(event.data);

                if (msg.type === 'handshake_ack') {
                  resolve({ status: 'ok', role: 'client' });
                } else if (msg.type === 'error') {
                  cleanupCollab();
                  reject(new Error(msg.payload.message));
                } else if (msg.type === 'init_sync') {
                  saveTasksLocal(projectId, msg.payload.tasksJson);
                  process.send({ event: 'collab', data: { type: 'tasks_update', payload: { projectId } } });
                } else if (msg.type === 'user_list') {
                  collabActiveUsers = new Set(msg.payload.users);
                  process.send({ event: 'collab', data: msg });
                } else if (msg.type === 'tasks_update') {
                  saveTasksLocal(msg.payload.projectId, msg.payload.tasksJson);
                  process.send({ event: 'collab', data: msg });
                } else if (msg.type === 'note_update') {
                  saveCollabComment(msg.payload.projectId, msg.payload.senderUser, msg.payload.replyData);
                  process.send({ event: 'collab', data: msg });
                } else if (msg.type === 'cursor_update') {
                  process.send({ event: 'collab', data: msg });
                } else if (msg.type === 'chat_message') {
                  process.send({ event: 'collab', data: msg });
                } else if (msg.type === 'status_update') {
                  process.send({ event: 'collab', data: msg });
                }
              } catch (err) {
                console.error('Error parsing client ws msg:', err);
              }
            };

            ws.onerror = (err) => {
              cleanupCollab();
              reject(err);
            };

            ws.onclose = () => {
              cleanupCollab();
              process.send({ event: 'collab', data: { type: 'status_update', payload: { role: 'none', error: 'Se perdió la conexión con el servidor online.' } } });
            };

          } catch (e) {
            cleanupCollab();
            reject(e);
          }
        });
      } else {
        collabPort = portOrNull || 49885;
        collabHostIp = ipOrRoomId;
        collabActiveUsers = new Set();

        return new Promise((resolve, reject) => {
          try {
            const socket = net.createConnection({ host: collabHostIp, port: collabPort }, () => {
              collabClientSocket = socket;
              socket.write(JSON.stringify({ type: 'handshake', payload: { username } }) + '\n');
              resolve({ status: 'ok', role: 'client' });
            });

            socket.on('error', (err) => {
              cleanupCollab();
              reject(err);
            });

            setupSocketReceiver(
              socket,
              (msg) => {
                if (msg.type === 'init_sync') {
                  saveTasksLocal(projectId, msg.payload.tasksJson);
                  process.send({ event: 'collab', data: { type: 'tasks_update', payload: { projectId } } });
                } else if (msg.type === 'user_list') {
                  collabActiveUsers = new Set(msg.payload.users);
                  process.send({ event: 'collab', data: msg });
                } else if (msg.type === 'tasks_update') {
                  saveTasksLocal(msg.payload.projectId, msg.payload.tasksJson);
                  process.send({ event: 'collab', data: msg });
                } else if (msg.type === 'note_update') {
                  saveCollabComment(msg.payload.projectId, msg.payload.senderUser, msg.payload.replyData);
                  process.send({ event: 'collab', data: msg });
                } else if (msg.type === 'cursor_update') {
                  process.send({ event: 'collab', data: msg });
                } else if (msg.type === 'chat_message') {
                  process.send({ event: 'collab', data: msg });
                }
              },
              () => {
                cleanupCollab();
                process.send({ event: 'collab', data: { type: 'status_update', payload: { role: 'none', error: 'Se perdió la conexión con el servidor.' } } });
              }
            );
          } catch (e) {
            cleanupCollab();
            reject(e);
          }
        });
      }
    }

    case 'stopCollab': {
      cleanupCollab();
      return 'ok';
    }

    case 'getCollabStatus': {
      return {
        role: collabRole,
        type: collabType,
        username: collabUsername,
        port: collabPort,
        hostIp: collabHostIp,
        roomId: collabRoomId,
        serverUrl: collabServerUrl,
        activeUsers: Array.from(collabActiveUsers),
        ips: getLocalIps()
      };
    }

    case 'broadcastCollab': {
      const [msg] = args;
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

function cleanupCollab() {
  if (collabServer) {
    try { collabServer.close(); } catch (_) {}
    collabServer = null;
  }
  for (const socket of collabSockets) {
    try { socket.destroy(); } catch (_) {}
  }
  collabSockets = [];

  if (collabClientSocket) {
    try { collabClientSocket.destroy(); } catch (_) {}
    collabClientSocket = null;
  }

  if (collabWs) {
    try { collabWs.close(); } catch (_) {}
    collabWs = null;
  }

  collabRole = 'none';
  collabType = 'local';
  collabActiveUsers = new Set();
  collabRoomId = '';
  collabServerUrl = '';
}

function broadcastCollab(msg, excludeSocket = null) {
  if (collabType === 'online') {
    if (collabWs && collabWs.readyState === 1) { // 1 is OPEN
      try {
        collabWs.send(JSON.stringify({ type: 'broadcast', payload: msg }));
      } catch (_) {}
    }
    return;
  }

  const line = JSON.stringify(msg) + '\n';
  if (collabRole === 'host') {
    for (const socket of collabSockets) {
      if (socket !== excludeSocket && socket.writable) {
        try { socket.write(line); } catch (_) {}
      }
    }
  } else if (collabRole === 'client') {
    if (collabClientSocket && collabClientSocket.writable) {
      try { collabClientSocket.write(line); } catch (_) {}
    }
  }
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
    // console.error('collab socket error:', err);
  });
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

    const deletedIds = new Set([
      ...(local.deletedTaskIds || []),
      ...(remote.deletedTaskIds || []),
    ]);

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
  try {
    const result = await handleAction(action, args);
    process.send({ id, result });
  } catch (err) {
    process.send({ id, error: err.message });
  }
});
