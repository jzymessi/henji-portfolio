import { execFile } from 'node:child_process';
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const label = 'com.henji.portfolio';
const userDomain = `gui/${process.getuid()}`;
const projectRoot = path.resolve(import.meta.dirname, '..');
const launchAgents = path.join(os.homedir(), 'Library', 'LaunchAgents');
const plistPath = path.join(launchAgents, `${label}.plist`);
const dataDirectory = path.join(projectRoot, '.data');
const logPath = path.join(dataDirectory, 'local-service.log');

async function resolveNodeExecutable() {
  const candidates = [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    process.execPath,
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next common stable Node path.
    }
  }
  return process.execPath;
}

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

async function bootout() {
  try {
    await execFileAsync('launchctl', ['bootout', userDomain, plistPath]);
  } catch {
    // The service may not be installed or loaded yet.
  }
}

if (process.platform !== 'darwin') {
  throw new Error('The automatic service installer currently supports macOS only.');
}

if (process.argv.includes('--uninstall')) {
  await bootout();
  try {
    await unlink(plistPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  console.log(`Removed ${label}`);
  process.exit(0);
}

const nodeExecutable = await resolveNodeExecutable();
const pathValue = [
  path.dirname(nodeExecutable),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
].filter((item, index, items) => items.indexOf(item) === index).join(':');

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodeExecutable)}</string>
    <string>--env-file-if-exists=.env.local</string>
    <string>${xml(path.join(projectRoot, 'scripts', 'run-local.mjs'))}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(projectRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(pathValue)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logPath)}</string>
</dict>
</plist>
`;

await mkdir(launchAgents, { recursive: true });
await mkdir(dataDirectory, { recursive: true });
await bootout();
await writeFile(plistPath, plist, { mode: 0o644 });
await execFileAsync('plutil', ['-lint', plistPath]);
await execFileAsync('launchctl', ['bootstrap', userDomain, plistPath]);
console.log(`Installed and started ${label}`);
console.log(`Log: ${logPath}`);
