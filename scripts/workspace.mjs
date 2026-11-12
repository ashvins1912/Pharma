import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] || 'start';
const isWindows = process.platform === 'win32';
const python = process.env.PYTHON || (isWindows ? 'python' : 'python3');
const npm = process.env.npm_execpath
  ? (isWindows ? process.env.ComSpec || 'cmd.exe' : process.execPath)
  : (isWindows ? 'npm.cmd' : 'npm');
const npmPrefix = process.env.npm_execpath && isWindows ? ['/d', '/s', '/c', 'node', process.env.npm_execpath] : [];
const envDirs = {
  common: 'env/common/.env',
  frontend: 'frontend/env/.env',
  backend: 'backend/env/.env',
  gateway: 'api-gateway/env/.env',
  inventory: 'services/inventory-service/env/.env',
  medicineMaster: 'services/medicine-master-service/env/.env',
  order: 'services/order-service/env/.env',
  websocket: 'services/websocket-service/env/.env',
  prescription: 'services/prescription-service/env/.env',
  cache: 'services/caching-service/env/.env'
};

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    values[match[1]] = value.replace(/\\n/g, '\n');
  }
  return values;
}

const commonEnv = parseEnvFile(resolve(root, envDirs.common));
function serviceEnv(name, file) {
  return { ...commonEnv, ...parseEnvFile(resolve(root, file)), ...process.env };
}
const services = [
  { name: 'backend', env: envDirs.backend, command: 'npm', args: ['--workspace', 'backend', 'run', 'dev'] , defaults: { PORT: '3001' } },
  { name: 'api-gateway', env: envDirs.gateway, command: 'npm', args: ['--workspace', 'api-gateway', 'run', 'dev'], defaults: { PORT: '8080' } },
  { name: 'inventory-service', env: envDirs.inventory, command: 'npm', args: ['--workspace', 'services/inventory-service', 'run', 'dev'], defaults: { PORT: '8091' } },
  { name: 'medicine-master-service', env: envDirs.medicineMaster, command: 'npm', args: ['--workspace', 'services/medicine-master-service', 'run', 'dev'], defaults: { PORT: '8092' } },
  { name: 'order-service', env: envDirs.order, command: 'npm', args: ['--workspace', 'services/order-service', 'run', 'dev'], defaults: { PORT: '8093' } },
  { name: 'websocket-service', env: envDirs.websocket, command: 'npm', args: ['--workspace', 'services/websocket-service', 'run', 'dev'], defaults: { PORT: '4000' } },
  { name: 'prescription-service', env: envDirs.prescription, command: 'python', args: ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', '3002'], cwd: 'services/prescription-service', venv: 'services/prescription-service/.venv' },
  { name: 'caching-service', env: envDirs.cache, command: 'python', args: ['-m', 'uvicorn', 'server:app', '--host', '0.0.0.0', '--port', '8081'], cwd: 'services/caching-service', venv: 'services/caching-service/.venv' },
  { name: 'frontend', env: envDirs.frontend, command: 'npm', args: ['--workspace', 'frontend', 'run', 'dev'], defaults: { VITE_DEV_API_PROXY: 'http://localhost:8080' } }
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function pythonExecutable(venv) {
  return resolve(root, venv, isWindows ? 'Scripts/python.exe' : 'bin/python');
}

async function setup() {
  console.log('\n[workspace] Installing JavaScript workspace dependencies...');
  run(npm, [...npmPrefix, 'install']);
  for (const service of services.filter(item => item.venv)) {
    const venvPath = resolve(root, service.venv);
    if (!existsSync(pythonExecutable(service.venv))) {
      console.log(`\n[workspace] Creating Python environment: ${service.name}`);
      run(python, ['-m', 'venv', service.venv]);
    }
    console.log(`[workspace] Installing Python dependencies: ${service.name}`);
    run(pythonExecutable(service.venv), ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', 'requirements.txt'], { cwd: resolve(root, service.cwd) });
  }
  console.log('\n[workspace] Dependency installation completed.');
}

function build() {
  console.log('\n[workspace] Building frontend and checking Python services...');
  run(npm, [...npmPrefix, '--workspace', 'frontend', 'run', 'build']);
  for (const service of services.filter(item => item.venv)) {
    const files = service.name === 'prescription-service' ? ['main.py'] : ['server.py'];
    run(pythonExecutable(service.venv), ['-m', 'py_compile', ...files], { cwd: resolve(root, service.cwd) });
  }
  console.log('\n[workspace] Build checks completed.');
}

function start() {
  let stopping = false;
  const children = [];
  const stop = (signal = 'SIGTERM') => {
    if (stopping) return;
    stopping = true;
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  };
  process.once('SIGINT', () => stop());
  process.once('SIGTERM', () => stop());

  for (const service of services) {
    const env = { ...serviceEnv(service.name, service.env), ...service.defaults };
    const command = service.venv ? pythonExecutable(service.venv) : (service.command === 'npm' ? npm : service.command);
    const args = service.venv ? service.args : [...(service.command === 'npm' ? npmPrefix : []), ...service.args];
    const cwd = resolve(root, service.cwd || '.');
    if (service.venv && !existsSync(command)) {
      console.error(`[workspace] Missing Python environment for ${service.name}. Run npm run setup:all first.`);
      stop();
      process.exitCode = 1;
      return;
    }
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', shell: isWindows && !service.venv });
    children.push(child);
    child.on('error', error => { console.error(`[${service.name}] failed to start:`, error.message); process.exitCode = 1; stop(); });
    child.on('exit', (code, signal) => {
      if (!stopping) {
        console.error(`[workspace] ${service.name} exited (${signal || code}). Stopping the stack.`);
        process.exitCode = code || 1;
        stop();
      }
    });
  }
  console.log('[workspace] All local services and the frontend have been started. Press Ctrl+C to stop.');
}

try {
  if (mode === 'setup') await setup();
  else if (mode === 'build') build();
  else if (mode === 'start') start();
  else if (mode === 'all') { await setup(); build(); start(); }
  else throw new Error('Usage: node scripts/workspace.mjs <setup|build|start|all>');
} catch (error) {
  console.error('[workspace] Failed:', error.message);
  process.exitCode = 1;
}
