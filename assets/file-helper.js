/**
 * Helper child process for file I/O operations.
 * Invoked via createProcess.fork() from the extension backend.
 *
 * Usage:
 *   fork('assets/file-helper.js', ['read', filePath])
 *     => stdout: file contents
 *
 *   fork('assets/file-helper.js', ['write', filePath])
 *     => reads content from stdin, writes to filePath
 *
 *   fork('assets/file-helper.js', ['readdir', dirPath])
 *     => stdout: JSON array of directory entries
 *
 *   fork('assets/file-helper.js', ['readfile', filePath])
 *     => stdout: file contents (same as read, kept for clarity)
 *
 *   fork('assets/file-helper.js', ['exists', filePath])
 *     => stdout: 'true' or 'false'
 */

const fs = require('fs');
const path = require('path');

const [,, action, targetPath] = process.argv;

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
    process.stdout.write(JSON.stringify({
      guid: guidMatch ? guidMatch[1].trim() : '',
      name: nameMatch ? nameMatch[1].trim() : '',
      fileNamePostPart: fileNamePostPartMatch ? fileNamePostPartMatch[1].trim() : '',
    }));
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
} else {
  process.stderr.write('Unknown action: ' + action);
  process.exit(1);
}
