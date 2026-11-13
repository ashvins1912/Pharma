import { spawn } from 'node:child_process';

const mode = process.argv[2] || 'dev';
if (!['dev', 'start'].includes(mode)) {
  throw new Error('Usage: node scripts/service-runner.js [dev|start]');
}

let shuttingDown = false;
const ports = {
  backend: '8090',
  'api-gateway': '8080',
  'admin-control-plane': process.env.ADMIN_PORT || '8091',
  'inventory-service': process.env.INVENTORY_SERVICE_PORT || '5100',
  'medicine-master-service': process.env.MEDICINE_MASTER_SERVICE_PORT || '5101',
  'order-service': process.env.ORDER_SERVICE_PORT || '5200',
  'websocket-service': process.env.WS_PORT || '4000'
};

const workspace = (name, script, overrides = {}) => ({
  name,
  args: ['--workspace', name, 'run', script],
  env: { ...overrides }
});

const definitions = [
  workspace('backend', mode, { PORT: ports.backend }),
  workspace('api-gateway', mode, {
    PORT: ports['api-gateway'],
    ADMIN_SERVICE_URL: process.env.ADMIN_SERVICE_URL || `http://localhost:${ports['admin-control-plane']}`
  }),
  workspace('services/admin-control-plane', mode, { PORT: ports['admin-control-plane'] }),
  workspace('services/inventory-service', mode, { PORT: ports['inventory-service'] }),
  workspace('services/medicine-master-service', mode, { PORT: ports['medicine-master-service'] }),
  workspace('services/order-service', mode, { PORT: ports['order-service'] }),
  workspace('services/websocket-service', mode, { PORT: ports['websocket-service'], WS_PORT: ports['websocket-service'] }),
  workspace('frontend', mode === 'dev' ? 'dev' : 'preview', mode === 'start' ? { HOST: '0.0.0.0' } : {})
];

const children = [];
function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  process.exitCode = exitCode;
}

for (const service of definitions) {
  const child = spawn('npm', service.args, {
    stdio: 'inherit',
    env: { ...process.env, ...service.env }
  });
  children.push(child);
  child.on('error', error => {
    console.error(`Failed to start ${service.name}:`, error);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`${service.name} stopped${signal ? ` (${signal})` : ` with exit code ${code}`}.`);
      shutdown(code || 1);
    }
  });
}

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));
