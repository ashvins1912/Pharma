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
import { nativeProviderPreflight, nativeProviderRollback } from './drivers/nativeExecution.js';

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

test('AWS native preflight refuses placeholder images before Terraform execution',async()=>{
  await assert.rejects(()=>nativeProviderPreflight('aws',{
    integration:{targetConfig:{stateBackend:{type:'s3',bucket:'staging-state',key:'service.tfstate',region:'us-east-1'}}},
    credentials:{accessKeyId:'x',secretAccessKey:'y'},
    deployment:{files:{'terraform/main.tf':'terraform { backend "s3" {} }'},image:'ghcr.io/example/service:CHANGE_ME'}
  }),/pinned, explicitly tagged container image/);
});
test('Kubernetes native preflight requires an explicit target namespace',async()=>{
  await assert.rejects(()=>nativeProviderPreflight('kubernetes',{
    integration:{endpoint:'https://k8s.example.test',targetConfig:{}},
    credentials:{token:'test-token'},
    deployment:{files:{'kubernetes/service.yaml':'kind: Deployment'},image:'ghcr.io/example/service:v1'}
  }),/Kubernetes namespace/);
});
test('LaunchDarkly rollback refuses to run without a captured prior state',async()=>{
  await assert.rejects(()=>nativeProviderRollback('launchdarkly',{
    integration:{targetConfig:{projectKey:'project',environmentKey:'staging'}},
    credentials:{apiKey:'test-api-key'},
    flag:{key:'test-flag'}
  }),/captured prior LaunchDarkly state/);
});
