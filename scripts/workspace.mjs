import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] || 'start';
if (!['start', 'dev'].includes(mode)) {
  console.error('Usage: node scripts/workspace.mjs [start|dev]');
  process.exit(2);
}

const children = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  process.exitCode = code;
}

function launch(name, command, args, options = {}) {
  console.log(`[workspace] STARTING ${name}`);
  const child = spawn(command, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    stdio: 'inherit',
    shell: false
  });
  children.push(child);
  child.once('error', error => {
    console.error(`[workspace] ${name} failed to launch:`, error.message);
    stop(1);
  });
  child.once('exit', (code, signal) => {
    if (!stopping) {
      console.error(`[workspace] ${name} exited${signal ? ` from ${signal}` : ` with code ${code}`}.`);
      stop(code || 1);
    }
  });
  return child;
}

function canImportPythonModule(python, moduleName) {
  const check = spawnSync(python, ['-c', `import ${moduleName}`], {
    cwd: root,
    stdio: 'ignore',
    env: process.env
  });
  return check.status === 0;
}

function waitForPort(name, port, timeoutMs = Number(process.env.SERVICE_STARTUP_TIMEOUT_MS || 60000)) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const probe = () => {
      if (stopping) return reject(new Error('Startup cancelled'));
      const socket = net.createConnection({ host: '127.0.0.1', port });
      const finish = ready => {
        socket.destroy();
        if (ready) {
          console.log(`[workspace] LISTENING ${name} on 127.0.0.1:${port}`);
          resolve();
        } else if (Date.now() >= deadline) {
          reject(new Error(`${name} did not listen on port ${port} within ${timeoutMs}ms`));
        } else {
          setTimeout(probe, 300);
        }
      };
      socket.setTimeout(500);
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.once('timeout', () => finish(false));
    };
    probe();
  });
}

const python = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
const pythonServices = [
  {
    name: 'prescription-service',
    cwd: path.join(root, 'services/prescription-service'),
    port: Number(process.env.PRESCRIPTION_SERVICE_PORT || 3002),
    module: 'main:app'
  },
  {
    name: 'caching-service',
    cwd: path.join(root, 'services/caching-service'),
    port: Number(process.env.CACHE_SERVICE_PORT || 8081),
    module: 'server:app'
  }
];

async function main() {
  const nodeRunner = launch('node-workspaces', process.execPath, [
    path.join(root, 'scripts/service-runner.js'), mode
  ]);

  const readiness = [waitForPort('API gateway', Number(process.env.API_GATEWAY_PORT || 8080))];

  // The shell host is a separate local app workspace and uses port 5000.
  launch('shell-host', 'npm', [
    '--workspace', 'apps/shell-host', 'run', 'dev'
  ]);
  readiness.push(waitForPort('shell-host', Number(process.env.SHELL_HOST_PORT || 5000)));

  if (canImportPythonModule(python, 'uvicorn')) {
    for (const service of pythonServices) {
      launch(service.name, python, [
        '-m', 'uvicorn', service.module,
        '--host', '0.0.0.0',
        '--port', String(service.port)
      ], {
        cwd: service.cwd,
        env: { PORT: String(service.port) }
      });
      readiness.push(waitForPort(service.name, service.port));
    }
  } else {
    console.warn(`[workspace] Python services skipped: ${python} cannot import uvicorn. Install each service's requirements.txt, then rerun.`);
  }

  await Promise.all(readiness);
  if (!stopping) console.log('[workspace] Local application startup completed. Node workspaces, shell host, and available Python services are listening; dependency health is checked separately.');
}

process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
main().catch(error => {
  console.error('[workspace] Startup failed:', error.message);
  stop(1);
});
