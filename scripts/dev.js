import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const isWindows = process.platform === 'win32';
const pythonBin = name => resolve(root, 'services', name, '.venv', isWindows ? 'Scripts/python.exe' : 'bin/python');
const portFromUrl = (value, fallback) => {
  try { return String(new URL(value).port || fallback); } catch { return String(fallback); }
};
const envPort = (key, urlKey, fallback) => process.env[key] || portFromUrl(process.env[urlKey], fallback);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const specs = [
  { name: 'backend', command: npm, args: ['--prefix', 'backend', 'run', 'dev'], env: { PORT: envPort('BACKEND_PORT', 'BACKEND_API_URL', 3001) } },
  { name: 'api-gateway', command: npm, args: ['--prefix', 'api-gateway', 'run', 'dev'], env: { PORT: envPort('GATEWAY_PORT', 'VITE_API_GATEWAY_URL', 8080) } },
  { name: 'frontend', command: npm, args: ['--prefix', 'frontend', 'run', 'dev'], env: {} },
  { name: 'inventory-service', command: npm, args: ['--prefix', 'services/inventory-service', 'run', 'dev'], env: { PORT: envPort('INVENTORY_SERVICE_PORT', 'INVENTORY_SERVICE_URL', 5100) } },
  { name: 'medicine-master-service', command: npm, args: ['--prefix', 'services/medicine-master-service', 'run', 'dev'], env: { PORT: envPort('MEDICINE_MASTER_SERVICE_PORT', 'MEDICINE_MASTER_SERVICE_URL', 5101) } },
  { name: 'order-service', command: npm, args: ['--prefix', 'services/order-service', 'run', 'dev'], env: { PORT: envPort('ORDER_SERVICE_PORT', 'ORDER_SERVICE_URL', 5200) } },
  { name: 'websocket-service', command: npm, args: ['--prefix', 'services/websocket-service', 'run', 'dev'], env: { PORT: envPort('WEBSOCKET_SERVICE_PORT', 'WEBSOCKET_SERVICE_URL', 4000) } },
  { name: 'shared-cache', command: pythonBin('caching-service'), args: ['-m', 'uvicorn', 'server:app', '--reload', '--host', '0.0.0.0', '--port', envPort('CACHE_SERVICE_PORT', 'CACHE_SERVICE_URL', 8081)], cwd: resolve(root, 'services/caching-service'), env: {} },
  { name: 'prescription-api', command: pythonBin('prescription-service'), args: ['-m', 'uvicorn', 'main:app', '--reload', '--host', '0.0.0.0', '--port', envPort('PRESCRIPTION_SERVICE_PORT', 'PRESCRIPTION_SERVICE_URL', 8000)], cwd: resolve(root, 'services/prescription-service'), env: {} },
  { name: 'prescription-worker', command: pythonBin('prescription-service'), args: ['-m', 'app.workers'], cwd: resolve(root, 'services/prescription-service'), env: {} }
];

const missing = specs.filter(spec => spec.command.includes('.venv') && !existsSync(spec.command));
if (missing.length) {
  console.error('Python environments are missing. Run "npm run setup:all" first.');
  for (const spec of missing) console.error(\`  - \${spec.name}: \${spec.command}\`);
  process.exit(1);
}

let stopping = false;
const children = new Map();
function stopAll(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  console.info('\\nStopping all Pharma development processes...');
  for (const child of children.values()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    if (isWindows) {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    }
  }
  process.exitCode = exitCode;
}

for (const spec of specs) {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd || root,
    env: { ...process.env, ...spec.env },
    stdio: 'inherit',
    shell: isWindows,
    detached: !isWindows
  });
  children.set(spec.name, child);
  child.on('error', error => {
    console.error(\`[\${spec.name}] failed to start: \${error.message}\`);
    stopAll(1);
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(\`[\${spec.name}] exited unexpectedly\${signal ? \` (\${signal})\` : \` with code \${code}\`}.\`);
      stopAll(code || 1);
    }
  });
  console.info(\`Started \${spec.name}\`);
}

process.once('SIGINT', () => stopAll(0));
process.once('SIGTERM', () => stopAll(0));
