import { spawn } from 'node:child_process';

let shuttingDown = false;

const processes = [
  ['backend', ['--prefix', 'backend', 'run', 'dev'], { PORT: '8090' }],
  ['api-gateway', ['--prefix', 'api-gateway', 'run', 'dev'], { PORT: '8080' }],
  ['frontend', ['--prefix', 'frontend', 'run', 'dev'], {}]
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
