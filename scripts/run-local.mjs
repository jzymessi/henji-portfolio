import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const vinextCli = path.join(projectRoot, 'node_modules', 'vinext', 'dist', 'cli.js');
const services = [
  {
    name: 'bridge',
    args: [path.join(projectRoot, 'local-bridge', 'server.mjs')],
  },
  {
    name: 'web',
    args: [vinextCli, 'dev', '--hostname', '127.0.0.1'],
  },
];

let stopping = false;
let exitCode = 0;
const children = new Map();

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) {
    if (!child.killed) child.kill(signal);
  }
  const timer = setTimeout(() => {
    for (const child of children.values()) {
      if (!child.killed) child.kill('SIGKILL');
    }
  }, 5000);
  timer.unref();
}

for (const service of services) {
  const child = spawn(process.execPath, service.args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  });
  children.set(service.name, child);
  console.log(`[local] started ${service.name} (pid ${child.pid})`);

  child.on('error', (error) => {
    console.error(`[local] ${service.name} failed to start: ${error.message}`);
    exitCode = 1;
    stop();
  });

  child.on('exit', (code, signal) => {
    children.delete(service.name);
    if (!stopping) {
      console.error(
        `[local] ${service.name} exited unexpectedly (${signal || code}); restarting service group`,
      );
      exitCode = code || 1;
      stop();
    }
    if (children.size === 0) process.exit(exitCode);
  });
}

process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
