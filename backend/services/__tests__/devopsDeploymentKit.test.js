import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPLOYMENT_STRATEGIES,
  generateDeploymentFiles,
  validateDeploymentInput,
  validateGeneratedArtifact
} from '../devopsDeploymentKit.js';

const base = {
  serviceName: 'inventory-service',
  runtime: 'node',
  provider: 'kubernetes',
  environment: 'staging',
  strategy: 'progressive',
  port: 3001,
  replicas: 2
};

test('validates and normalizes supported deployment input', () => {
  const result = validateDeploymentInput(base);
  assert.equal(result.valid, true);
  assert.equal(result.value.serviceName, 'inventory-service');
  assert.deepEqual(DEPLOYMENT_STRATEGIES.progressive, [10, 25, 50, 75, 100]);
});

test('rejects unsafe names, unknown providers and floating image tags', () => {
  assert.equal(validateDeploymentInput({ ...base, serviceName: '../api' }).valid, false);
  assert.equal(validateDeploymentInput({ ...base, provider: 'unknown-cloud' }).valid, false);
  assert.equal(validateDeploymentInput({ ...base, image: 'example/app:latest' }).valid, false);
});

test('generates Docker, Compose, Kubernetes, Terraform, Ansible and pipeline artifacts', () => {
  const result = generateDeploymentFiles(base);
  assert.ok(result.files.Dockerfile.includes('USER node'));
  assert.ok(result.files['docker-compose.yml'].includes('no-new-privileges:true'));
  assert.ok(result.files['kubernetes/inventory-service.yaml'].includes('readOnlyRootFilesystem: true'));
  assert.ok(result.files['terraform/main.tf'].includes('required_version'));
  assert.ok(result.files['ansible/deploy.yml'].includes('kubernetes.core.k8s'));
  assert.ok(result.files['.github/workflows/inventory-service-deploy.yml'].includes('environment: staging'));
  assert.equal(result.digest.length, 64);
});

test('generates provider-specific Terraform resources for AWS, Azure and GCP', () => {
  assert.ok(generateDeploymentFiles({ ...base, provider: 'aws' }).files['terraform/main.tf'].includes('aws_ecs_service'));
  assert.ok(generateDeploymentFiles({ ...base, provider: 'azure' }).files['terraform/main.tf'].includes('azurerm_container_app'));
  assert.ok(generateDeploymentFiles({ ...base, provider: 'gcp' }).files['terraform/main.tf'].includes('google_cloud_run_v2_service'));
});

test('generates config schema with external secret references, not credential values', () => {
  const files = generateDeploymentFiles(base).files;
  assert.ok(files['config.schema.json'].includes('x-secretRefRequired'));
  assert.ok(files['.env.example'].includes('JWT_SECRET='));
  assert.equal(files['.env.example'].includes('replace-me'), false);
});

test('generated artifact policy passes its own output', () => {
  const result = generateDeploymentFiles(base);
  const validation = validateGeneratedArtifact(result.files);
  assert.equal(validation.valid, true, validation.errors.join('; '));
});

test('artifact policy rejects path traversal and embedded credentials', () => {
  const result = validateGeneratedArtifact({
    '../secrets.env': 'JWT_SECRET=do-not-commit-this-value'
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('Unsafe artifact path')));
  assert.ok(result.errors.some(error => error.includes('hard-coded secret')));
});
