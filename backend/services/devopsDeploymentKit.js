import crypto from 'node:crypto';

export const DEPLOYMENT_STRATEGIES = Object.freeze({
  rolling: [25, 50, 75, 100],
  canary: [5, 25, 50, 100],
  progressive: [10, 25, 50, 75, 100],
  ring: [1, 5, 25, 100],
  blue_green: [0, 100],
  feature_flag: [5, 25, 50, 100],
  kill_switch: [0]
});

const RUNTIMES = new Set(['node', 'python', 'go', 'java']);
const PROVIDERS = new Set(['aws', 'azure', 'gcp', 'kubernetes', 'generic']);
const ENVIRONMENTS = new Set(['development', 'staging', 'production']);
const STRATEGIES = new Set(Object.keys(DEPLOYMENT_STRATEGIES));
const SERVICE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,50}[a-z0-9])?$/;
const IMAGE = /^[a-z0-9][a-z0-9._\/-]{0,180}:[a-zA-Z0-9_.-]{1,64}$/;
const CPU = /^(?:[1-9]\d{0,4}m|[1-9]\d?(?:\.\d{1,2})?)$/;
const MEMORY = /^(?:[1-9]\d{0,4})(?:Mi|Gi)$/;

export function validateDeploymentInput(input = {}) {
  const errors = [];
  const serviceName = String(input.serviceName || '').trim().toLowerCase();
  const runtime = String(input.runtime || 'node').toLowerCase();
  const provider = String(input.provider || 'kubernetes').toLowerCase();
  const environment = String(input.environment || 'staging').toLowerCase();
  const strategy = String(input.strategy || 'progressive').toLowerCase();
  const port = Number(input.port ?? 3000);
  const replicas = Number(input.replicas ?? 2);
  const cpuRequest = String(input.cpuRequest || '100m');
  const memoryRequest = String(input.memoryRequest || '128Mi');
  const image = String(input.image || '').trim();

  if (!SERVICE_NAME.test(serviceName)) errors.push('Service name must be a lowercase DNS-safe name (1–52 characters).');
  if (!RUNTIMES.has(runtime)) errors.push('Unsupported runtime. Choose node, python, go or java.');
  if (!PROVIDERS.has(provider)) errors.push('Unsupported deployment provider.');
  if (!ENVIRONMENTS.has(environment)) errors.push('Environment must be development, staging or production.');
  if (!STRATEGIES.has(strategy)) errors.push('Unsupported deployment strategy.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('Port must be an integer from 1 to 65535.');
  if (!Number.isInteger(replicas) || replicas < 1 || replicas > 20) errors.push('Replicas must be an integer from 1 to 20.');
  if (!CPU.test(cpuRequest)) errors.push('CPU request must use a bounded Kubernetes quantity such as 100m or 1.');
  if (!MEMORY.test(memoryRequest)) errors.push('Memory request must use Mi or Gi, for example 128Mi.');
  if (image && !IMAGE.test(image)) errors.push('Container image must be an explicit tagged image; floating latest tags are not allowed.');

  return {
    valid: errors.length === 0,
    errors,
    value: { serviceName, runtime, provider, environment, strategy, port, replicas, cpuRequest, memoryRequest, image }
  };
}

function dockerfile(runtime, port) {
  const lines = {
    node: [
      'FROM node:22-alpine',
      'WORKDIR /app',
      'ENV NODE_ENV=production',
      'COPY package*.json ./',
      'RUN npm ci --omit=dev',
      'COPY --chown=node:node . .',
      'USER node',
      `EXPOSE ${port}`,
      'CMD ["node", "server.js"]'
    ],
    python: [
      'FROM python:3.12-slim',
      'ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1',
      'WORKDIR /app',
      'COPY requirements.txt ./',
      'RUN pip install --no-cache-dir -r requirements.txt',
      'COPY --chown=10001:10001 . .',
      'USER 10001:10001',
      `EXPOSE ${port}`,
      'CMD ["python", "app.py"]'
    ],
    go: [
      'FROM golang:1.24-alpine AS build',
      'WORKDIR /src',
      'COPY go.mod go.sum ./',
      'RUN go mod download',
      'COPY . .',
      'RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/app ./...',
      'FROM gcr.io/distroless/static-debian12:nonroot',
      'COPY --from=build /out/app /app',
      `EXPOSE ${port}`,
      'USER nonroot:nonroot',
      'ENTRYPOINT ["/app"]'
    ],
    java: [
      'FROM eclipse-temurin:21-jre',
      'WORKDIR /app',
      'COPY target/*.jar app.jar',
      'USER 10001:10001',
      `EXPOSE ${port}`,
      'ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]'
    ]
  };
  return lines[runtime].join('\n') + '\n';
}

function compose(config, image) {
  return `services:
  ${config.serviceName}:
    build:
      context: .
      dockerfile: Dockerfile
    image: ${image || 'ghcr.io/your-org/' + config.serviceName + ':CHANGE_ME'}
    restart: unless-stopped
    init: true
    read_only: true
    tmpfs:
      - /tmp
    ports:
      - "${config.port}:${config.port}"
    environment:
      NODE_ENV: ${config.environment}
      PORT: "${config.port}"
    env_file:
      - path: .env
        required: false
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    deploy:
      resources:
        limits:
          cpus: "1.00"
          memory: 512M
`;
}

function kubernetes(config, image) {
  const containerImage = image || `ghcr.io/your-org/${config.serviceName}:CHANGE_ME`;
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${config.serviceName}
  namespace: pharma-${config.environment}
  labels:
    app.kubernetes.io/name: ${config.serviceName}
    app.kubernetes.io/managed-by: pharma-devops
spec:
  replicas: ${config.replicas}
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app.kubernetes.io/name: ${config.serviceName}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${config.serviceName}
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: ${config.serviceName}
          image: ${containerImage}
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: ${config.port}
          env:
            - name: NODE_ENV
              value: "${config.environment}"
            - name: PORT
              value: "${config.port}"
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: ${config.serviceName}-runtime
                  key: DATABASE_URL
          resources:
            requests:
              cpu: ${config.cpuRequest}
              memory: ${config.memoryRequest}
            limits:
              cpu: "1"
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /ready
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 15
            periodSeconds: 20
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
---
apiVersion: v1
kind: Service
metadata:
  name: ${config.serviceName}
  namespace: pharma-${config.environment}
spec:
  selector:
    app.kubernetes.io/name: ${config.serviceName}
  ports:
    - name: http
      port: 80
      targetPort: http
  type: ClusterIP
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${config.serviceName}
  namespace: pharma-${config.environment}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${config.serviceName}
  minReplicas: ${config.replicas}
  maxReplicas: ${Math.min(20, Math.max(config.replicas, config.replicas * 4))}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
`;
}

function terraform(config, image) {
  const selectedImage = image || `ghcr.io/your-org/${config.serviceName}:CHANGE_ME`;
  if (config.provider === 'aws') return `terraform {
  required_version = ">= 1.6.0, < 2.0.0"
  required_providers {
    aws = {
      source = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
provider "aws" {
  region = var.region
}
variable "region" {
  type = string
}
variable "cluster_arn" {
  type = string
}
variable "execution_role_arn" {
  type = string
}
variable "subnet_ids" {
  type = list(string)
}
variable "security_group_ids" {
  type = list(string)
}
variable "assign_public_ip" {
  type = bool
  default = false
}
variable "desired_count" {
  type = number
  default = ${config.replicas}
}
variable "image" {
  type = string
  default = "${selectedImage}"
}
resource "aws_ecs_task_definition" "service" {
  family = "${config.serviceName}"
  requires_compatibilities = ["FARGATE"]
  network_mode = "awsvpc"
  cpu = "256"
  memory = "512"
  execution_role_arn = var.execution_role_arn
  container_definitions = jsonencode([{
    name = "${config.serviceName}"
    image = var.image
    essential = true
    portMappings = [{ containerPort = ${config.port}, protocol = "tcp" }]
    readonlyRootFilesystem = true
    environment = [{ name = "NODE_ENV", value = "${config.environment}" }]
  }])
}
resource "aws_ecs_service" "service" {
  name = "${config.serviceName}"
  cluster = var.cluster_arn
  task_definition = aws_ecs_task_definition.service.arn
  desired_count = var.desired_count
  launch_type = "FARGATE"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent = 200
  network_configuration {
    subnets = var.subnet_ids
    security_groups = var.security_group_ids
    assign_public_ip = var.assign_public_ip
  }
}
output "service_name" {
  value = aws_ecs_service.service.name
}
output "task_definition_arn" {
  value = aws_ecs_task_definition.service.arn
}
`;
  if (config.provider === 'azure') return `terraform {
  required_version = ">= 1.6.0, < 2.0.0"
  required_providers {
    azurerm = {
      source = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}
provider "azurerm" {
  features {}
}
variable "resource_group_name" {
  type = string
}
variable "location" {
  type = string
}
variable "container_app_environment_id" {
  type = string
}
variable "image" {
  type = string
  default = "${selectedImage}"
}
resource "azurerm_container_app" "service" {
  name = "${config.serviceName}"
  resource_group_name = var.resource_group_name
  container_app_environment_id = var.container_app_environment_id
  revision_mode = "Multiple"
  template {
    min_replicas = ${config.replicas}
    max_replicas = ${Math.min(20, config.replicas * 4)}
    container {
      name = "${config.serviceName}"
      image = var.image
      cpu = 0.5
      memory = "1Gi"
      env {
        name = "NODE_ENV"
        value = "${config.environment}"
      }
    }
  }
  ingress {
    external_enabled = true
    target_port = ${config.port}
    transport = "auto"
    traffic_weight {
      percentage = 100
      latest_revision = true
    }
  }
}
output "container_app_id" {
  value = azurerm_container_app.service.id
}
`;
  if (config.provider === 'gcp') return `terraform {
  required_version = ">= 1.6.0, < 2.0.0"
  required_providers {
    google = {
      source = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}
provider "google" {
  project = var.project_id
  region = var.region
}
variable "project_id" {
  type = string
}
variable "region" {
  type = string
}
variable "image" {
  type = string
  default = "${selectedImage}"
}
resource "google_cloud_run_v2_service" "service" {
  name = "${config.serviceName}"
  location = var.region
  ingress = "INGRESS_TRAFFIC_ALL"
  template {
    scaling {
      min_instance_count = ${config.replicas}
      max_instance_count = ${Math.min(20, config.replicas * 4)}
    }
    containers {
      image = var.image
      ports {
        container_port = ${config.port}
      }
      resources {
        limits = {
          cpu = "1"
          memory = "512Mi"
        }
      }
      env {
        name = "NODE_ENV"
        value = "${config.environment}"
      }
    }
  }
}
output "service_uri" {
  value = google_cloud_run_v2_service.service.uri
}
`;
  return `# Provider-neutral Terraform contract.
# Select AWS, Azure or GCP to generate a provider-specific resource module.
terraform {
  required_version = ">= 1.6.0, < 2.0.0"
}
variable "service_name" {
  type = string
  default = "${config.serviceName}"
}
variable "container_image" {
  type = string
  default = "${selectedImage}"
}
output "deployment_contract" {
  value = {
    service = var.service_name
    image = var.container_image
    environment = "${config.environment}"
  }
}
`;
}
function ansible(config) {
  return `---
- name: Apply ${config.serviceName} through the Kubernetes API
  hosts: localhost
  connection: local
  gather_facts: false
  collections:
    - kubernetes.core
  tasks:
    - name: Apply versioned application manifests
      kubernetes.core.k8s:
        state: present
        src: ../kubernetes/${config.serviceName}.yaml
        apply: true
        wait: true
        wait_timeout: 180
    - name: Verify rollout availability
      kubernetes.core.k8s_info:
        api_version: apps/v1
        kind: Deployment
        name: ${config.serviceName}
        namespace: pharma-${config.environment}
      register: deployment_status
      failed_when: deployment_status.resources | length != 1
`;
}

function workflow(config) {
  return `name: ${config.serviceName} CI and release
on:
  pull_request:
    paths:
      - '**'
  push:
    branches: [main]
permissions:
  contents: read
  packages: write
  id-token: write
concurrency:
  group: ${config.serviceName}-${config.environment}-${'${{ github.ref }}'}
  cancel-in-progress: false
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Validate deployment configuration
        run: |
          test -s Dockerfile
          test -s docker-compose.yml
          test -s kubernetes/${config.serviceName}.yaml
          test -s terraform/main.tf
          test -s ansible/deploy.yml
  build:
    if: github.event_name == 'push'
    needs: validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${'${{ github.actor }}'}
          password: ${'${{ secrets.GITHUB_TOKEN }}'}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ghcr.io/${'${{ github.repository_owner }}'}/${config.serviceName}:${'${{ github.sha }}'}
  deploy:
    if: github.event_name == 'push'
    needs: build
    runs-on: ubuntu-latest
    environment: ${config.environment}
    steps:
      - name: Await protected environment approval
        run: echo "Deployment is gated by the GitHub Environment protection rules."
      - name: Submit deployment through the approved control plane
        run: echo "Configure a trusted deployment adapter; no remote shell or arbitrary command runner is used."
`;
}

export function generateDeploymentFiles(input = {}) {
  const checked = validateDeploymentInput(input);
  if (!checked.valid) {
    const error = new Error(checked.errors.join(' '));
    error.code = 'INVALID_DEPLOYMENT_CONFIGURATION';
    error.details = checked.errors;
    throw error;
  }
  const config = checked.value;
  const image = config.image;
  const envSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `${config.serviceName} runtime configuration`,
    type: 'object',
    additionalProperties: false,
    properties: {
      NODE_ENV: { type: 'string', enum: [...ENVIRONMENTS], default: config.environment },
      PORT: { type: 'integer', minimum: 1, maximum: 65535, default: config.port },
      DATABASE_URL: { type: 'string', format: 'uri', writeOnly: true, 'x-secretRefRequired': true },
      JWT_SECRET: { type: 'string', minLength: 32, writeOnly: true, 'x-secretRefRequired': true }
    },
    required: ['NODE_ENV', 'PORT']
  };
  const rollout = {
    strategy: config.strategy,
    stages: DEPLOYMENT_STRATEGIES[config.strategy].map(percent => ({
      trafficPercent: percent,
      requiredHealthWindowMinutes: config.environment === 'production' ? 10 : 2,
      automaticPromotion: false,
      rollbackOnSloBreach: true
    })),
    promotionRequiresApproval: config.environment === 'production',
    rollback: { enabled: true, trigger: ['readiness_failure', 'error_budget_breach', 'manual'] }
  };
  const files = {
    'Dockerfile': dockerfile(config.runtime, config.port),
    'docker-compose.yml': compose(config, image),
    [`kubernetes/${config.serviceName}.yaml`]: kubernetes(config, image),
    'terraform/main.tf': terraform(config, image),
    'ansible/deploy.yml': ansible(config),
    '.env.example': `NODE_ENV=${config.environment}\nPORT=${config.port}\nDATABASE_URL=\nJWT_SECRET=\n`,
    'config.schema.json': JSON.stringify(envSchema, null, 2) + '\n',
    'deployment/rollout-strategy.json': JSON.stringify(rollout, null, 2) + '\n',
    [`.github/workflows/${config.serviceName}-deploy.yml`]: workflow(config)
  };
  const digest = crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex');
  return { config, files, digest, strategy: rollout };
}

const SECRET_PATTERN = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:password|client_secret|api[_-]?key|access[_-]?token|jwt[_-]?secret|database_url|private[_-]?key|secret[_-]?key)\s*[:=]\s*[^\s$<"'{}][^\n]*)/i;
export function validateGeneratedArtifact(files = {}) {
  const errors = [];
  const paths = Object.keys(files);
  if (!paths.length || paths.length > 40) errors.push('Artifact must contain between 1 and 40 files.');
  for (const [path, content] of Object.entries(files)) {
    if (path.startsWith('/') || path.split('/').includes('..') || !/^[a-zA-Z0-9._/-]{1,180}$/.test(path)) {
      errors.push(`Unsafe artifact path: ${path}`);
    }
    if (typeof content !== 'string' || content.length > 200_000) {
      errors.push(`Artifact file ${path} is not text or exceeds 200 KB.`);
      continue;
    }
    if (SECRET_PATTERN.test(content)) errors.push(`Potential hard-coded secret detected in ${path}.`);
    if (/\b(?:curl|wget)\s+[^\n]*\|\s*(?:sh|bash)|\b(?:sudo\s+)?(?:rm\s+-rf|mkfs|dd\s+if=)/i.test(content)) {
      errors.push(`Unsafe remote or destructive command pattern detected in ${path}.`);
    }
  }
  if (files.Dockerfile && !/\bUSER\s+(?!root\b)\S+/m.test(files.Dockerfile)) errors.push('Dockerfile must declare a non-root USER.');
  if (files.Dockerfile && /:latest\b/.test(files.Dockerfile)) errors.push('Floating latest image tags are not permitted.');
  if (files['deployment/rollout-strategy.json']) {
    try {
      const rollout = JSON.parse(files['deployment/rollout-strategy.json']);
      if (!STRATEGIES.has(rollout.strategy) || !Array.isArray(rollout.stages)) errors.push('Rollout strategy document is invalid.');
    } catch { errors.push('Rollout strategy document must be valid JSON.'); }
  }
  return { valid: errors.length === 0, errors };
}
