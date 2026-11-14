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
import { nativeProviderPreflight, nativeProviderRollback, validateNativeArtifactFiles, allocateLaunchDarklyRolloutWeights } from './drivers/nativeExecution.js';

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
    integration:{targetConfig:{stateBackend:{type:'s3',bucket:'staging-state',key:'service.tfstate',region:'us-east-1'},allowedServiceNames:['inventory-service']}},
    credentials:{accessKeyId:'x',secretAccessKey:'y'},
    deployment:{serviceName:'inventory-service',files:{'terraform/main.tf':'terraform { backend "s3" {} }'},image:'ghcr.io/example/service:CHANGE_ME'}
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
    integration:{targetConfig:{projectKey:'project',environmentKey:'staging',allowedFlagKeys:['test-flag']}},
    credentials:{apiKey:'test-api-key'},
    flag:{key:'test-flag'}
  }),/captured prior LaunchDarkly state/);
});

test('AWS identity preflight validates configured region before network access',async()=>{
  await assert.rejects(()=>verifyProviderIdentity('aws',{accessKeyId:'AKIATEST',secretAccessKey:'test-secret'},{targetConfig:{region:'not-a-region'}}),/AWS region is invalid/);
});
test('GCP identity preflight consumes the saved project target before network access',async()=>{
  await assert.rejects(()=>verifyProviderIdentity('gcp',{clientEmail:'svc@example.test',privateKey:'not-a-private-key'},{targetConfig:{projectId:'pharma-staging'}}),error=>error.name!=='ReferenceError');
});


test('native artifact validator permits the generated Kubernetes manifest and neutral Terraform contract',()=>{
  assert.equal(validateNativeArtifactFiles([
    {path:'kubernetes/inventory-service.yaml',content:'apiVersion: apps/v1\nkind: Deployment\n'},
    {path:'terraform/main.tf',content:'variable "service_name" { type = string }\noutput "deployment_contract" { value = var.service_name }\n'}
  ],'kubernetes'),true);
});

test('native artifact validator permits only the approved AWS ECS resources',()=>{
  const valid='terraform { required_providers { aws = { source = "hashicorp/aws" } } }\nprovider "aws" {}\nresource "aws_ecs_service" "service" {}';
  assert.equal(validateNativeArtifactFiles({'terraform/main.tf':valid},'aws'),true);
  const unsafe='terraform { required_providers { aws = { source = "hashicorp/aws" } } }\nprovider "aws" {}\nresource "aws_s3_bucket" "unexpected" {}';
  assert.throws(()=>validateNativeArtifactFiles({'terraform/main.tf':unsafe},'aws'),/allowlist/);
});

test('native artifact validator blocks Terraform provisioners and duplicate paths',()=>{
  assert.throws(()=>validateNativeArtifactFiles({'terraform/main.tf':'resource "aws_ecs_service" "service" { provisioner "local-exec" { command = "id" } }'},'aws'),/execution hooks/);
  assert.throws(()=>validateNativeArtifactFiles([{path:'kubernetes/a.yaml',content:'one'},{path:'kubernetes/a.yaml',content:'two'}],'kubernetes'),/Duplicate artifact paths/);
});


test('LaunchDarkly rollout weights target the selected variation and preserve the other variation mix',()=>{
  const two=allocateLaunchDarklyRolloutWeights([
    {variation:0,weight:70000},{variation:1,weight:30000}
  ],1,20);
  assert.deepEqual(two.map(item=>item.weight),[80000,20000]);
  const three=allocateLaunchDarklyRolloutWeights([
    {variation:0,weight:50000},{variation:1,weight:30000},{variation:2,weight:20000}
  ],1,40);
  assert.deepEqual(three.map(item=>item.weight),[42857,40000,17143]);
  assert.equal(three.reduce((sum,item)=>sum+item.weight,0),100000);
});

test('LaunchDarkly rollout weight allocation rejects invalid target variations and percentages',()=>{
  assert.throws(()=>allocateLaunchDarklyRolloutWeights([{variation:0,weight:100000}],0,50),/at least two/);
  assert.throws(()=>allocateLaunchDarklyRolloutWeights([{variation:0,weight:50000},{variation:1,weight:50000}],2,50),/target variation/);
  assert.throws(()=>allocateLaunchDarklyRolloutWeights([{variation:0,weight:50000},{variation:1,weight:50000}],0,101),/between 0 and 100/);
});
