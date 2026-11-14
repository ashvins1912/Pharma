import { spawn } from 'node:child_process';

let shuttingDown = false;

const backendPort = process.env.BACKEND_PORT || '8090';
const gatewayPort = process.env.API_GATEWAY_PORT || '8081';

const processes = [
  ['backend', ['--prefix', 'backend', 'run', 'dev'], { PORT: backendPort }],
  ['api-gateway', ['--prefix', 'api-gateway', 'run', 'dev'], { PORT: gatewayPort, BACKEND_API_URL: `http://127.0.0.1:${backendPort}` }],
  ['frontend', ['--prefix', 'frontend', 'run', 'dev'], { VITE_DEV_API_PROXY: `http://127.0.0.1:${backendPort}` }]
].map(([name, args, overrides]) => {
  const child = spawn('npm', args, {
    stdio: 'inherit',
    env: { ...process.env, ...overrides }
  });
  child.on('error', error => {
    console.error(`Failed to start ${name}:`, error);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`${name} stopped${signal ? ` (${signal})` : ` with exit code ${code}`}.`);
      shutdown(code || 1);
    }
  });
  return child;
});

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of processes) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  process.exitCode = exitCode;
}

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));
