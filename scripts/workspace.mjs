import { loadSharedLocalEnv } from './load-shared-env.mjs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadSharedLocalEnv();

// Normalize the readiness timeout before spawning child workspaces. In particular,
// Number("0") is valid JavaScript but would make legacy child runners fail instantly.
const configuredServiceStartupTimeout = Number(process.env.SERVICE_STARTUP_TIMEOUT_MS);
process.env.SERVICE_STARTUP_TIMEOUT_MS = String(
  Number.isFinite(configuredServiceStartupTimeout) && configuredServiceStartupTimeout > 0
    ? Math.max(5000, configuredServiceStartupTimeout)
    : 60000
);

const mode = process.argv[2] || 'start';
if (!['start', 'dev'].includes(mode)) {
  console.error('Usage: node scripts/workspace.mjs [start|dev]');
  process.exit(2);
}

const children = [];
const isLocalProduction = process.env.NODE_ENV === 'production';

function configureLocalSecrets() {
  if (isLocalProduction) {
    const privateKey = String(process.env.PHARMA_JWT_PRIVATE_KEY || '').trim();
    const publicKey = String(process.env.PHARMA_JWT_PUBLIC_KEY || '').trim();
    if (privateKey.length < 100 || publicKey.length < 100) {
      throw new Error('NODE_ENV=production requires real PHARMA_JWT_PRIVATE_KEY and PHARMA_JWT_PUBLIC_KEY values. Refusing to generate production signing keys.');
    }
    return;
  }

  const privateKey = String(process.env.PHARMA_JWT_PRIVATE_KEY || '').trim();
  const publicKey = String(process.env.PHARMA_JWT_PUBLIC_KEY || '').trim();
  if (privateKey.length < 100 || publicKey.length < 100
      || !privateKey.includes('BEGIN PRIVATE KEY')
      || !publicKey.includes('BEGIN PUBLIC KEY')) {
    const pair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 3072,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    });
    process.env.PHARMA_JWT_PRIVATE_KEY = pair.privateKey;
    process.env.PHARMA_JWT_PUBLIC_KEY = pair.publicKey;
    console.info('[workspace] Generated an ephemeral RSA-3072 JWT key pair for this local run. It is not written to disk and will change on restart.');
  }

  if (!process.env.CACHE_SERVICE_TOKEN || process.env.CACHE_SERVICE_TOKEN.length < 32) {
    process.env.CACHE_SERVICE_TOKEN = crypto.randomBytes(32).toString('hex');
    console.info('[workspace] Generated an ephemeral local cache-service token for this run.');
  }

  if (process.env.USE_REMOTE_CACHE_SERVICE !== 'true') {
    process.env.CACHE_SERVICE_URL = 'http://127.0.0.1:8081';
  }
}

function portIsOpen(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}
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

const configuredStartupTimeout = Number(process.env.SERVICE_STARTUP_TIMEOUT_MS);
const startupTimeoutMs = Number.isFinite(configuredStartupTimeout) && configuredStartupTimeout > 0
  ? Math.max(5000, configuredStartupTimeout)
  : 60000;

function waitForPort(name, port, timeoutMs = startupTimeoutMs) {
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
    module: 'main:app',
    pythonEnv: 'PRESCRIPTION_SERVICE_PYTHON_BIN',
    dependencies: ['fastapi', 'pydantic', 'jwt']
  },
  {
    name: 'caching-service',
    cwd: path.join(root, 'services/caching-service'),
    port: Number(process.env.CACHE_SERVICE_PORT || 8081),
    module: 'server:app',
    pythonEnv: 'CACHE_SERVICE_PYTHON_BIN',
    dependencies: ['fastapi', 'pydantic', 'redis']
  }
];

async function main() {
  configureLocalSecrets();

  const redisPort = Number(process.env.REDIS_PORT || 6379);
  if (!process.env.REDIS_URL) process.env.REDIS_URL = 'redis://127.0.0.1:' + redisPort + '/0';
  let redisAvailable = await portIsOpen(redisPort);
  if (!redisAvailable && process.env.START_LOCAL_REDIS !== 'false') {
    const redisCheck = spawnSync('redis-server', ['--version'], { stdio: 'ignore' });
    if (redisCheck.status === 0) {
      launch('local-redis', 'redis-server', [
        '--bind', '127.0.0.1', '--port', String(redisPort),
        '--save', '', '--appendonly', 'no'
      ]);
      try {
        await waitForPort('local-redis', redisPort, 10000);
        redisAvailable = true;
      } catch {
        console.warn('[workspace] Local Redis did not become ready; shared cache will be disabled.');
      }
    }
  }
  if (!redisAvailable) {
    process.env.CACHE_SERVICE_URL = '';
    console.warn('[workspace] Redis is unavailable. Shared cache/event consumption is disabled for this run; install Redis or start it on localhost:6379.');
  }

  const nodeRunner = launch('node-workspaces', process.execPath, [
    path.join(root, 'scripts/service-runner.js'), mode
  ]);

  const readiness = [waitForPort('API gateway', Number(process.env.API_GATEWAY_PORT || 8080))];

  // The shell host is a separate local app workspace and uses port 5000.
  launch('shell-host', 'npm', [
    '--workspace', 'apps/shell-host', 'run', 'dev'
  ]);
  readiness.push(waitForPort('shell-host', Number(process.env.SHELL_HOST_PORT || 5000)));

  for (const service of pythonServices) {
    if (service.name === 'caching-service' && !redisAvailable) continue;

    const venvPython = path.join(
      service.cwd,
      process.platform === 'win32'
        ? '.venv/Scripts/python.exe'
        : '.venv/bin/python'
    );

    const servicePython = process.env[service.pythonEnv] || (
      canImportPythonModule(venvPython, 'uvicorn') ? venvPython : python
    );

    if (!canImportPythonModule(servicePython, 'uvicorn')) {
      console.warn(`[workspace] ${service.name} skipped: ${servicePython} cannot import uvicorn.`);
      continue;
    }

    const missing = service.dependencies.filter(
      moduleName => !canImportPythonModule(servicePython, moduleName)
    );

    if (missing.length) {
      console.warn(`[workspace] ${service.name} skipped; missing Python modules: ${missing.join(', ')}. Install ${path.relative(root, path.join(service.cwd, 'requirements.txt'))}.`);
      continue;
    }

    launch(service.name, servicePython, [
      '-m', 'uvicorn', service.module,
      '--host', '0.0.0.0',
      '--port', String(service.port)
    ], {
      cwd: service.cwd,
      env: { PORT: String(service.port) }
    });

    readiness.push(waitForPort(service.name, service.port));
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
