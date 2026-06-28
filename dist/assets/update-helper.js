const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

async function run() {
  try {
    const extensionDir = path.join(__dirname, '..');

    // Skip update check if running in a development git clone
    if (fs.existsSync(path.join(extensionDir, '.git'))) {
      sendResult({
        status: 'no_update',
        message: 'Running in development mode (Git detected). Update check skipped.',
      });
      process.exit(0);
    }

    const packageJsonPath = path.join(extensionDir, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      sendResult({ status: 'error', error: 'package.json not found at ' + packageJsonPath });
      process.exit(1);
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const currentVersion = packageJson.version;

    // Fetch latest release metadata from GitHub
    const url =
      'https://api.github.com/repos/dalesmucker-cpu/Paratext-Project-Management/releases/latest';
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Paratext-Project-Manager-Extension-Updater',
      },
    });

    if (!res.ok) {
      sendResult({
        status: 'error',
        error: `GitHub API request failed: ${res.status} ${res.statusText}`,
      });
      process.exit(1);
    }

    const release = await res.json();
    const latestVersion = release.tag_name ? release.tag_name.replace(/^v/, '') : '';

    if (!latestVersion) {
      sendResult({ status: 'no_update', message: 'No valid version tag found in latest release.' });
      process.exit(0);
    }

    // Compare versions
    if (semverCompare(currentVersion, latestVersion) >= 0) {
      sendResult({ status: 'no_update', currentVersion, latestVersion });
      process.exit(0);
    }

    // Find the zip asset
    const zipAsset = release.assets.find((asset) => asset.name.endsWith('.zip'));
    if (!zipAsset) {
      sendResult({ status: 'error', error: 'No zip asset found in the latest release.' });
      process.exit(1);
    }

    const downloadUrl = zipAsset.browser_download_url;
    const tempZipPath = path.join(os.tmpdir(), `ppm-update-${latestVersion}.zip`);

    // Download the zip asset
    const assetRes = await fetch(downloadUrl, {
      headers: {
        'User-Agent': 'Paratext-Project-Manager-Extension-Updater',
      },
    });

    if (!assetRes.ok) {
      sendResult({
        status: 'error',
        error: `Failed to download release zip: ${assetRes.status} ${assetRes.statusText}`,
      });
      process.exit(1);
    }

    const arrayBuffer = await assetRes.arrayBuffer();
    fs.writeFileSync(tempZipPath, Buffer.from(arrayBuffer));

    // Run PowerShell command to extract the zip over the extension directory
    const psCommand = `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '${tempZipPath}' -DestinationPath '${extensionDir}' -Force"`;

    exec(psCommand, (err, stdout, stderr) => {
      // Clean up temp file
      try {
        fs.unlinkSync(tempZipPath);
      } catch (_) {}

      if (err) {
        sendResult({
          status: 'error',
          error: `Failed to extract update: ${stderr || err.message}`,
        });
        process.exit(1);
      }

      sendResult({ status: 'updated', currentVersion, latestVersion });
      process.exit(0);
    });
  } catch (error) {
    sendResult({ status: 'error', error: error.message || String(error) });
    process.exit(1);
  }
}

function sendResult(data) {
  try {
    process.stdout.write(JSON.stringify(data));
  } catch (_) {}
  if (process.send) {
    try {
      process.send(data);
    } catch (_) {}
  }
}

function semverCompare(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

run();
