import { spawn } from 'node:child_process';
import net from 'node:net';

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
  'websocket-service': process.env.WS_PORT || '4000',
  'private-devops-adapter': process.env.PRIVATE_DEVOPS_ADAPTER_PORT || '8092'
};
const privateAdapterConfigured = Boolean(process.env.PRIVATE_DEVOPS_ADAPTER_TOKEN && (process.env.ADAPTER_MONGO_URI || process.env.MONGO_URI));
const privateAdapterExplicit = process.env.START_PRIVATE_DEVOPS_ADAPTER === 'true';
if (privateAdapterExplicit && !privateAdapterConfigured) throw new Error('START_PRIVATE_DEVOPS_ADAPTER requires PRIVATE_DEVOPS_ADAPTER_TOKEN and ADAPTER_MONGO_URI or MONGO_URI.');

const workspace = (name, script, overrides = {}, port = null, extraArgs = []) => ({
  name,
  port,
  args: ['--workspace', name, 'run', script, ...extraArgs],
  env: { ...overrides }
});

const definitions = [
  workspace('backend', mode, {
    PORT: ports.backend,
    ...(process.env.PRIVATE_DEVOPS_ADAPTER_TOKEN ? {
      PRIVATE_DEVOPS_ADAPTER_URL: privateAdapterExplicit ? `http://localhost:${ports['private-devops-adapter']}` : (process.env.PRIVATE_DEVOPS_ADAPTER_URL || `http://localhost:${ports['private-devops-adapter']}`),
      PRIVATE_DEVOPS_ADAPTER_TOKEN: process.env.PRIVATE_DEVOPS_ADAPTER_TOKEN
    } : {})
  }, Number(ports.backend)),
  workspace('api-gateway', mode, {
    PORT: ports['api-gateway'],
    ADMIN_SERVICE_URL: process.env.ADMIN_SERVICE_URL || `http://localhost:${ports['admin-control-plane']}`,
    INVENTORY_SERVICE_URL: process.env.INVENTORY_SERVICE_URL || `http://localhost:${ports['inventory-service']}`,
    MEDICINE_MASTER_SERVICE_URL: process.env.MEDICINE_MASTER_SERVICE_URL || `http://localhost:${ports['medicine-master-service']}`,
    ORDER_SERVICE_URL: process.env.ORDER_SERVICE_URL || `http://localhost:${ports['order-service']}`,
    WEBSOCKET_SERVICE_URL: process.env.WEBSOCKET_SERVICE_URL || `http://localhost:${ports['websocket-service']}`
  }, Number(ports['api-gateway'])),
  workspace('services/admin-control-plane', mode, { PORT: ports['admin-control-plane'] }, Number(ports['admin-control-plane'])),
  workspace('services/inventory-service', mode, { PORT: ports['inventory-service'] }, Number(ports['inventory-service'])),
  workspace('services/medicine-master-service', mode, { PORT: ports['medicine-master-service'] }, Number(ports['medicine-master-service'])),
  workspace('services/order-service', mode, { PORT: ports['order-service'] }, Number(ports['order-service'])),
  workspace('services/websocket-service', mode, { PORT: ports['websocket-service'], WS_PORT: ports['websocket-service'] }, Number(ports['websocket-service'])),
  workspace('frontend', mode === 'dev' ? 'dev' : 'preview', mode === 'start' ? { HOST: '0.0.0.0' } : {}, mode === 'dev' ? 5173 : 4173, ['--', '--host', '0.0.0.0', '--port', mode === 'dev' ? '5173' : '4173', '--strictPort'])
];
if (privateAdapterExplicit || (privateAdapterConfigured && !process.env.PRIVATE_DEVOPS_ADAPTER_URL)) {
  definitions.push(workspace('services/private-devops-adapter', mode, {
    PORT: ports['private-devops-adapter'],
    ADAPTER_MONGO_URI: process.env.ADAPTER_MONGO_URI || process.env.MONGO_URI,
    PRIVATE_DEVOPS_ADAPTER_TOKEN: process.env.PRIVATE_DEVOPS_ADAPTER_TOKEN
  }, Number(ports['private-devops-adapter'])));
} else if (!privateAdapterConfigured) {
  console.info('[workspace] Private DevOps adapter is optional and was not started; configure its Mongo URI and 32+ character service token to enable it.');
}

const children = [];
function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  process.exitCode = exitCode;
}

function isPortListening(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(750);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

async function waitForListener(service, timeoutMs = Number(process.env.SERVICE_STARTUP_TIMEOUT_MS || 45000)) {
  const deadline = Date.now() + timeoutMs;
  while (!shuttingDown && Date.now() < deadline) {
    if (await isPortListening(service.port)) {
      console.log(`[workspace] LISTENING ${service.name} on 127.0.0.1:${service.port}`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`${service.name} did not open port ${service.port} within ${timeoutMs}ms`);
}

async function verifyWorkspaceDependencies() {
  await new Promise((resolve, reject) => {
    const check = spawn('npm', ['ls', '--workspaces', '--depth=0'], { stdio: 'inherit' });
    check.once('error', reject);
    check.once('exit', code => code === 0 ? resolve() : reject(new Error('Workspace dependencies are incomplete. Run npm install at the repository root.')));
  });
}

async function start() {
  try {
    await verifyWorkspaceDependencies();
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
    await Promise.all(definitions.filter(service => service.port).map(waitForListener));
    if (!shuttingDown) console.log('[workspace] All configured services are LISTENING. Application health checks remain separate.');
  } catch (error) {
    console.error('[workspace] Startup failed:', error.message);
    shutdown(1);
  }
}

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));
void start();
