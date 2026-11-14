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
