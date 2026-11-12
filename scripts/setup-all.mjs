import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const isWindows = process.platform === 'win32';
const pythonCommand = process.env.PYTHON || (isWindows ? 'python' : 'python3');
const services = ['prescription-service', 'caching-service'];

function run(command, args, options = {}) {
  console.info(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw new Error(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? 'unknown'}.`);
}

console.info('Installing root npm workspace dependencies...');
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install']);

for (const service of services) {
  const directory = resolve(root, 'services', service);
  const venv = resolve(directory, '.venv');
  const python = resolve(venv, isWindows ? 'Scripts/python.exe' : 'bin/python');
  const requirements = resolve(directory, 'requirements.txt');

  if (!existsSync(requirements)) throw new Error(`Missing Python requirements file: ${requirements}`);
  if (!existsSync(python)) {
    console.info(`\nCreating isolated Python environment for ${service}...`);
    run(pythonCommand, ['-m', 'venv', venv]);
  } else {
    console.info(`\nReusing Python environment for ${service}.`);
  }

  console.info(`Installing Python dependencies for ${service}...`);
  run(python, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  run(python, ['-m', 'pip', 'install', '-r', requirements]);
}

console.info('\nSetup complete. Run "npm run build:all" and then "npm run start:all".');
