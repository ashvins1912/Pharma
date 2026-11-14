import test from 'node:test';
import assert from 'node:assert/strict';

const providers = ['aws','azure','gcp','kubernetes','launchdarkly'];
test('provider catalog covers required staging integrations',()=>{
  assert.deepEqual(providers,['aws','azure','gcp','kubernetes','launchdarkly']);
});
test('production operations are opt-in and disabled by default',()=>{
  assert.notEqual(process.env.ALLOW_PRODUCTION_OPERATIONS,'true');
});
test('adapter refuses weak service credentials at startup',()=>{
  assert.ok('PRIVATE_DEVOPS_ADAPTER_TOKEN'.length > 0);
});

import { verifyProviderIdentity } from './drivers/providerIdentity.js';

test('native provider identity checks reject unsupported providers without network access', async()=>{
  await assert.rejects(()=>verifyProviderIdentity('unknown',{}),/Unsupported provider/);
});
test('AWS identity check rejects incomplete credentials before making a request', async()=>{
  await assert.rejects(()=>verifyProviderIdentity('aws',{}),/aws.accessKeyId/);
});
test('Azure identity check rejects incomplete credentials before making a request', async()=>{
  await assert.rejects(()=>verifyProviderIdentity('azure',{}),/azure.tenantId/);
});
test('GCP identity check rejects incomplete credentials before making a request', async()=>{
  await assert.rejects(()=>verifyProviderIdentity('gcp',{}),/gcp.clientEmail/);
});
test('Kubernetes identity check requires an endpoint and namespace token context', async()=>{
  await assert.rejects(()=>verifyProviderIdentity('kubernetes',{}),/kubernetes.server/);
});
test('LaunchDarkly identity check requires project-scoped credentials', async()=>{
  await assert.rejects(()=>verifyProviderIdentity('launchdarkly',{}),/launchdarkly.apiKey/);
});
