/**
 * Gcal-helper.js — Google Calendar OAuth 2.0 + API helper (pure Node.js, no external deps)
 *
 * Invoked via createProcess.fork() from the extension backend.
 *
 * Actions: full-auth-flow <clientId> <clientSecret> [port] Opens browser for OAuth (PKCE), waits
 * for callback on localhost:{port}, exchanges code for tokens. stdout: JSON { access_token,
 * refresh_token, expiry_date }
 *
 * Refresh <clientId> <clientSecret> <refreshToken> Refreshes an expired access token. stdout: JSON
 * { access_token, expiry_date }
 *
 * List-calendars <accessToken> Lists all calendars accessible to the user. stdout: JSON array of {
 * id, summary, primary }
 *
 * Sync-deadlines stdin: JSON { accessToken, calendarId, tasks: ProjectTask[] } Creates or updates
 * events for tasks that have a deadline and aren't complete. stdout: JSON { synced, total, errors:
 * string[] }
 *
 * Get-userinfo <accessToken> Returns the user's email address. stdout: JSON { email }
 */

'use strict';

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const urlModule = require('url');
const { exec } = require('child_process');

const action = process.argv[2];
const args = process.argv.slice(3);

// ---- PKCE helpers ----

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ---- HTTP helpers ----

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function httpsPost(hostname, path, params) {
  const body = new URLSearchParams(params).toString();
  return httpsRequest(
    {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    body,
  );
}

function httpsGetJson(url, accessToken) {
  const parsed = urlModule.parse(url);
  return httpsRequest({
    hostname: parsed.hostname,
    path: parsed.path,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

function httpsPutJson(url, accessToken, bodyObj) {
  const body = JSON.stringify(bodyObj);
  const parsed = urlModule.parse(url);
  return httpsRequest(
    {
      hostname: parsed.hostname,
      path: parsed.path,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${accessToken}`,
      },
    },
    body,
  );
}

function httpsPostJson(url, accessToken, bodyObj) {
  const body = JSON.stringify(bodyObj);
  const parsed = urlModule.parse(url);
  return httpsRequest(
    {
      hostname: parsed.hostname,
      path: parsed.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${accessToken}`,
      },
    },
    body,
  );
}

function httpsDeleteJson(url, accessToken) {
  const parsed = urlModule.parse(url);
  return httpsRequest(
    {
      hostname: parsed.hostname,
      path: parsed.path,
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Length': 0,
      },
    },
    '',
  );
}

// ---- Open browser (Windows) ----

function openBrowser(targetUrl) {
  // Use rundll32 + spawn (shell:false) so the URL is passed as a raw argument
  // with NO shell parsing — avoids cmd.exe mangling & and % characters.
  const { spawn } = require('child_process');
  try {
    spawn('rundll32.exe', ['url.dll,FileProtocolHandler', targetUrl], {
      shell: false,
      detached: true,
      stdio: 'ignore',
    }).unref();
  } catch (err) {
    process.stderr.write(`openBrowser error: ${err.message}\n`);
  }
}

// ---- Actions ----

// ---- Google Drive helpers ----

async function driveAuthFlow(clientId, clientSecret, port) {
  port = port ? parseInt(port, 10) : 8766; // different port from GCal (8765)
  const redirectUri = `http://127.0.0.1:${port}`;
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const scopes = 'https://www.googleapis.com/auth/drive.file';

  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    '?client_id=' +
    encodeURIComponent(clientId) +
    '&redirect_uri=' +
    encodeURIComponent(redirectUri) +
    '&response_type=code' +
    '&scope=' +
    encodeURIComponent(scopes) +
    '&access_type=offline' +
    '&prompt=consent' +
    '&code_challenge=' +
    encodeURIComponent(codeChallenge) +
    '&code_challenge_method=S256';

  process.stderr.write(`Drive auth URL: ${authUrl}\n`);

  const code = await new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 3;

    function tryListen(p) {
      const server = http.createServer((req, res) => {
        const parsedUrl = urlModule.parse(req.url, true);
        const authCode = parsedUrl.query.code;
        const authError = parsedUrl.query.error;

        if (!authCode && !authError) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<!DOCTYPE html><html><body></body></html>');
          return;
        }

        if (authCode) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            '<!DOCTYPE html><html><head><meta charset="utf-8">' +
              '<style>body{font-family:sans-serif;padding:40px;text-align:center;color:#333}</style>' +
              '</head><body>' +
              '<h2 style="color:#1a73e8">\u2713 Autorizaci\u00f3n completada</h2>' +
              '<p>Puedes cerrar esta pesta\u00f1a y regresar a Paratext 10.</p>' +
              '<script>setTimeout(function(){window.close()},3000)<\/script>' +
              '</body></html>',
          );
          server.close();
          resolve(authCode);
        } else {
          const errStr = typeof authError === 'string' ? authError : JSON.stringify(authError);
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html><html><body><h2>Error: ${errStr}</h2></body></html>`);
          server.close();
          reject(new Error(`OAuth denied: ${errStr || 'unknown'}`));
        }
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
          attempts++;
          tryListen(p + 1);
        } else {
          reject(err);
        }
      });

      server.listen(p, '127.0.0.1', () => {
        port = p;
        const finalUrl = p !== 8766 ? authUrl.replace('127.0.0.1:8766', `127.0.0.1:${p}`) : authUrl;
        openBrowser(finalUrl);
      });

      setTimeout(
        () => {
          server.close();
          reject(new Error('Tiempo de espera agotado (5 min). Reintenta la conexi\u00f3n.'));
        },
        5 * 60 * 1000,
      );
    }

    tryListen(port);
  });

  const tokenRes = await httpsPost('oauth2.googleapis.com', '/token', {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: `http://127.0.0.1:${port}`,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });

  const tokens = JSON.parse(tokenRes.body);
  if (tokens.error) {
    throw new Error(`Token exchange failed: ${tokens.error_description || tokens.error}`);
  }

  process.stdout.write(
    JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || '',
      expiry_date: Date.now() + (tokens.expires_in || 3600) * 1000,
    }),
  );
}

async function driveSearch(accessToken, fileName) {
  const q = "name='" + fileName.replace(/'/g, "\\'") + "' and trashed=false";
  const url =
    'https://www.googleapis.com/drive/v3/files?q=' +
    encodeURIComponent(q) +
    '&fields=files(id,name)&pageSize=1';
  const res = await httpsGetJson(url, accessToken);
  const data = JSON.parse(res.body);
  if (data.error) throw new Error('Drive search: ' + data.error.message);
  const file = (data.files || [])[0];
  process.stdout.write(JSON.stringify({ fileId: file ? file.id : null }));
}

async function driveRead(accessToken, fileId) {
  const res = await httpsGetJson(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    accessToken,
  );
  if (res.status < 200 || res.status >= 300) {
    let errMsg = res.body;
    try {
      errMsg = JSON.parse(res.body).error.message || res.body;
    } catch (_) {}
    throw new Error(`Drive read failed (${res.status}): ${errMsg}`);
  }
  process.stdout.write(res.body);
}

async function driveWrite(accessToken, fileId, fileName, content) {
  if (fileId && fileId.trim() !== '') {
    // Update existing file — media-only upload
    const res = await httpsRequest(
      {
        hostname: 'www.googleapis.com',
        path: `/upload/drive/v3/files/${encodeURIComponent(fileId.trim())}?uploadType=media`,
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'Content-Length': Buffer.byteLength(content, 'utf8'),
          Authorization: `Bearer ${accessToken}`,
        },
      },
      content,
    );
    const data = JSON.parse(res.body);
    if (data.error) throw new Error(`Drive update: ${data.error.message}`);
    process.stdout.write(JSON.stringify({ fileId: data.id }));
  } else {
    // Create new file — multipart upload (metadata + content)
    const boundary = 'driveBoundary' + Date.now() + Math.random().toString(36).slice(2, 8);
    const metadata = JSON.stringify({ name: fileName, mimeType: 'application/json' });
    const parts = [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n`,
      `--${boundary}--`,
    ].join('');
    const res = await httpsRequest(
      {
        hostname: 'www.googleapis.com',
        path: '/upload/drive/v3/files?uploadType=multipart',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': Buffer.byteLength(parts, 'utf8'),
          Authorization: `Bearer ${accessToken}`,
        },
      },
      parts,
    );
    const data = JSON.parse(res.body);
    if (data.error) throw new Error(`Drive create: ${data.error.message}`);
    process.stdout.write(JSON.stringify({ fileId: data.id }));
  }
}

async function fullAuthFlow(clientId, clientSecret, port) {
  port = port ? parseInt(port, 10) : 8765;

  // Use 127.0.0.1 — Google's recommended loopback address for Desktop app credentials
  const redirectUri = `http://127.0.0.1:${port}`;
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const scopes = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ].join(' ');

  // Build URL manually with encodeURIComponent (produces %20 for spaces).
  // URLSearchParams uses + for spaces (form encoding) which Google rejects.
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    '?client_id=' +
    encodeURIComponent(clientId) +
    '&redirect_uri=' +
    encodeURIComponent(redirectUri) +
    '&response_type=code' +
    '&scope=' +
    encodeURIComponent(scopes) +
    '&access_type=offline' +
    '&prompt=consent' +
    '&code_challenge=' +
    encodeURIComponent(codeChallenge) +
    '&code_challenge_method=S256';

  // Log the URL to stderr so it can be seen in extension logs for debugging
  process.stderr.write(`GCal auth URL: ${authUrl}\n`);

  // Start local HTTP server to capture the OAuth callback
  const code = await new Promise((resolve, reject) => {
    // Try a few ports in case the first is busy
    let attempts = 0;
    const maxAttempts = 3;

    function tryListen(p) {
      const server = http.createServer((req, res) => {
        const parsedUrl = urlModule.parse(req.url, true);
        const authCode = parsedUrl.query.code;
        const authError = parsedUrl.query.error;

        // Ignore favicon and other secondary browser requests
        if (!authCode && !authError) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<!DOCTYPE html><html><body></body></html>');
          return;
        }

        if (authCode) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            '<!DOCTYPE html><html><head><meta charset="utf-8">' +
              '<style>body{font-family:sans-serif;padding:40px;text-align:center;color:#333}</style>' +
              '</head><body>' +
              '<h2 style="color:#1a73e8">\u2713 Autorizaci\u00f3n completada</h2>' +
              '<p>Puedes cerrar esta pesta\u00f1a y regresar a Paratext 10.</p>' +
              '<script>setTimeout(function(){window.close()},3000)<\/script>' +
              '</body></html>',
          );
          server.close();
          resolve(authCode);
        } else {
          const errStr = typeof authError === 'string' ? authError : JSON.stringify(authError);
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            `<!DOCTYPE html><html><body><h2>Error: ${errStr || 'sin c\u00f3digo de autorizaci\u00f3n'}</h2></body></html>`,
          );
          server.close();
          reject(new Error(`OAuth denied: ${errStr || 'unknown'}`));
        }
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
          attempts++;
          tryListen(p + 1);
        } else {
          reject(err);
        }
      });

      server.listen(p, '127.0.0.1', () => {
        // Update port tracker in case we retried on a different port
        port = p;
        // Replace the port in the auth URL if it changed (port was busy)
        const finalUrl = p !== 8765 ? authUrl.replace(`127.0.0.1:8765`, `127.0.0.1:${p}`) : authUrl;
        openBrowser(finalUrl);
      });

      // Timeout: 5 minutes
      setTimeout(
        () => {
          server.close();
          reject(new Error('Tiempo de espera agotado (5 min). Reintenta la conexión.'));
        },
        5 * 60 * 1000,
      );
    }

    tryListen(port);
  });

  // Exchange authorization code for tokens
  const tokenRes = await httpsPost('oauth2.googleapis.com', '/token', {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: `http://127.0.0.1:${port}`,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });

  const tokens = JSON.parse(tokenRes.body);
  if (tokens.error) {
    throw new Error(`Token exchange failed: ${tokens.error_description || tokens.error}`);
  }

  process.stdout.write(
    JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || '',
      expiry_date: Date.now() + (tokens.expires_in || 3600) * 1000,
    }),
  );
}

async function refreshAccessToken(clientId, clientSecret, refreshToken) {
  const res = await httpsPost('oauth2.googleapis.com', '/token', {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const tokens = JSON.parse(res.body);
  if (tokens.error) {
    throw new Error(`Refresh failed: ${tokens.error_description || tokens.error}`);
  }

  process.stdout.write(
    JSON.stringify({
      access_token: tokens.access_token,
      expiry_date: Date.now() + (tokens.expires_in || 3600) * 1000,
    }),
  );
}

async function listCalendars(accessToken) {
  const res = await httpsGetJson(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList',
    accessToken,
  );

  const data = JSON.parse(res.body);
  if (data.error) throw new Error(`List calendars: ${data.error.message}`);

  const calendars = (data.items || []).map((c) => ({
    id: c.id,
    summary: c.summary,
    primary: c.primary || false,
  }));

  process.stdout.write(JSON.stringify(calendars));
}

async function listEvents(accessToken, calendarId, timeMin, timeMax) {
  const calId = encodeURIComponent(calendarId || 'primary');
  const params =
    'timeMin=' +
    encodeURIComponent(timeMin) +
    '&timeMax=' +
    encodeURIComponent(timeMax) +
    '&singleEvents=true&orderBy=startTime&maxResults=250';
  const url = 'https://www.googleapis.com/calendar/v3/calendars/' + calId + '/events?' + params;
  const res = await httpsGetJson(url, accessToken);
  const data = JSON.parse(res.body);
  if (data.error) throw new Error('List events: ' + data.error.message);
  const events = (data.items || []).map((ev) => ({
    id: ev.id,
    summary: ev.summary || '(Sin título)',
    start: ev.start.dateTime || ev.start.date || '',
    end: ev.end.dateTime || ev.end.date || '',
    description: ev.description || '',
    allDay: Boolean(ev.start.date && !ev.start.dateTime),
  }));
  process.stdout.write(JSON.stringify(events));
}

async function logTimeEvent(accessToken, calendarId, timeEntryJson, taskLabel) {
  const entry = JSON.parse(timeEntryJson);
  const calId = encodeURIComponent(calendarId || 'primary');

  // Search for existing event with this time entry ID
  const searchParams =
    'privateExtendedProperty=' +
    encodeURIComponent('pmTimeEntryId=' + entry.id) +
    '&singleEvents=true';
  const searchUrl =
    'https://www.googleapis.com/calendar/v3/calendars/' + calId + '/events?' + searchParams;
  const searchRes = await httpsGetJson(searchUrl, accessToken);
  const searchData = JSON.parse(searchRes.body);
  if (searchData.error) throw new Error('Search time events: ' + searchData.error.message);
  const existing = (searchData.items || [])[0];

  const eventBody = {
    summary: entry.user + ' ' + entry.hours + 'h ' + taskLabel,
    description: entry.note || '',
    start: { date: entry.date },
    end: { date: entry.date },
    extendedProperties: { private: { pmTimeEntryId: entry.id } },
  };

  if (existing) {
    const updateUrl =
      'https://www.googleapis.com/calendar/v3/calendars/' + calId + '/events/' + existing.id;
    const res = await httpsPutJson(updateUrl, accessToken, eventBody);
    const data = JSON.parse(res.body);
    if (data.error) throw new Error('Update time event: ' + data.error.message);
  } else {
    const createUrl = 'https://www.googleapis.com/calendar/v3/calendars/' + calId + '/events';
    const res = await httpsPostJson(createUrl, accessToken, eventBody);
    const data = JSON.parse(res.body);
    if (data.error) throw new Error('Create time event: ' + data.error.message);
  }
  process.stdout.write(JSON.stringify({ status: 'ok' }));
}

async function deleteEvent(accessToken, calendarId, eventId) {
  const calId = encodeURIComponent(calendarId || 'primary');
  const url =
    'https://www.googleapis.com/calendar/v3/calendars/' +
    calId +
    '/events/' +
    encodeURIComponent(eventId);
  const res = await httpsDeleteJson(url, accessToken);
  // 204 No Content = success; anything else is an error
  if (res.statusCode && res.statusCode !== 204 && res.body) {
    let msg = res.body;
    try {
      msg = JSON.parse(res.body).error?.message || res.body;
    } catch (_) {
      /* keep raw */
    }
    throw new Error('Delete event: ' + msg);
  }
  process.stdout.write(JSON.stringify({ status: 'ok' }));
}

async function getUserInfo(accessToken) {
  const res = await httpsGetJson('https://www.googleapis.com/oauth2/v2/userinfo', accessToken);

  const data = JSON.parse(res.body);
  if (data.error) throw new Error(`Get userinfo: ${data.error.message}`);

  process.stdout.write(JSON.stringify({ email: data.email || '' }));
}

async function syncDeadlines(input) {
  const { accessToken, calendarId, tasks } = input;
  const calId = encodeURIComponent(calendarId || 'primary');

  // Only sync tasks that have a deadline and aren't complete
  const tasksWithDeadlines = (tasks || []).filter((t) => t.deadline && t.status !== 'complete');

  let synced = 0;
  const errors = [];

  for (const task of tasksWithDeadlines) {
    try {
      const summary = `[Paratext] ${task.book} cap.${task.chapter} — ${task.stage}`;
      const descLines = [
        `Libro: ${task.book}, Capítulo: ${task.chapter}`,
        `Etapa: ${task.stage}`,
        `Estado: ${task.status}`,
        `Asignado a: ${(task.assignedTo || []).join(', ') || '—'}`,
        task.notes ? `Notas: ${task.notes}` : null,
        `ID tarea: ${task.id}`,
      ].filter(Boolean);

      const eventBody = {
        summary,
        description: descLines.join('\n'),
        start: { date: task.deadline },
        end: { date: task.deadline },
        extendedProperties: {
          private: { paratextTaskId: task.id },
        },
      };

      // Search for existing event by private extended property
      const searchRes = await httpsGetJson(
        `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?privateExtendedProperty=paratextTaskId%3D${encodeURIComponent(task.id)}&maxResults=1`,
        accessToken,
      );
      const searchData = JSON.parse(searchRes.body);

      if (searchData.error) {
        errors.push(`Task ${task.id}: ${searchData.error.message}`);
        continue;
      }

      const existingEvent = searchData.items && searchData.items[0];

      if (existingEvent) {
        // Update existing event
        const updateRes = await httpsPutJson(
          `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${existingEvent.id}`,
          accessToken,
          eventBody,
        );
        const updateData = JSON.parse(updateRes.body);
        if (updateData.error) {
          errors.push(`Update ${task.id}: ${updateData.error.message}`);
        } else {
          synced++;
        }
      } else {
        // Create new event
        const createRes = await httpsPostJson(
          `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`,
          accessToken,
          eventBody,
        );
        const createData = JSON.parse(createRes.body);
        if (createData.error) {
          errors.push(`Create ${task.id}: ${createData.error.message}`);
        } else {
          synced++;
        }
      }
    } catch (err) {
      errors.push(`Task ${task.id}: ${err.message}`);
    }
  }

  process.stdout.write(
    JSON.stringify({
      synced,
      total: tasksWithDeadlines.length,
      errors,
    }),
  );
}

// ---- Main ----

(async () => {
  try {
    if (action === 'full-auth-flow') {
      await fullAuthFlow(args[0], args[1], args[2]);
    } else if (action === 'refresh') {
      await refreshAccessToken(args[0], args[1], args[2]);
    } else if (action === 'list-calendars') {
      await listCalendars(args[0]);
    } else if (action === 'list-events') {
      await listEvents(args[0], args[1], args[2], args[3]);
    } else if (action === 'log-time-event') {
      await logTimeEvent(args[0], args[1], args[2], args[3]);
    } else if (action === 'get-userinfo') {
      await getUserInfo(args[0]);
    } else if (action === 'sync-deadlines') {
      let stdinData = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        stdinData += chunk;
      });
      await new Promise((resolve) => process.stdin.on('end', resolve));
      process.stdin.resume();
      await syncDeadlines(JSON.parse(stdinData));
    } else if (action === 'delete-event') {
      await deleteEvent(args[0], args[1], args[2]);
    } else if (action === 'drive-auth-flow') {
      await driveAuthFlow(args[0], args[1], args[2]);
    } else if (action === 'drive-search') {
      await driveSearch(args[0], args[1]);
    } else if (action === 'drive-read') {
      await driveRead(args[0], args[1]);
    } else if (action === 'drive-write') {
      let stdinData = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        stdinData += chunk;
      });
      await new Promise((resolve) => process.stdin.on('end', resolve));
      await driveWrite(args[0], args[1], args[2], stdinData);
    } else {
      process.stderr.write(`Unknown action: ${action}\n`);
      process.exit(1);
    }
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
})();
