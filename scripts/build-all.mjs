import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const isWindows = process.platform === 'win32';
const python = service => resolve(root, 'services', service, '.venv', isWindows ? 'Scripts/python.exe' : 'bin/python');

function run(command, args, cwd = root) {
  console.info(\`\\n> \${command} \${args.join(' ')}\`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw new Error(\`Could not run \${command}: \${result.error.message}\`);
  if (result.status !== 0) throw new Error(\`\${command} exited with status \${result.status ?? 'unknown'}.\`);
}

run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--workspace', 'frontend', 'run', 'build']);
for (const service of ['prescription-service', 'caching-service']) {
  run(python(service), ['-m', 'compileall', '-q', '.'], resolve(root, 'services', service));
}
console.info('\\nFrontend production build and Python syntax checks completed successfully.');
