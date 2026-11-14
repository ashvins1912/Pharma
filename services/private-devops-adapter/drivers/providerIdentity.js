import crypto from 'node:crypto';

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value, encoding) => crypto.createHmac('sha256', key).update(value).digest(encoding);

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw Object.assign(new Error('Missing provider credential: ' + name), { code: 'CREDENTIAL_FIELD_MISSING' });
  return value.trim();
}
async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
  const raw = await response.text();
  if (raw.length > 128 * 1024) throw Object.assign(new Error('Provider identity response too large.'), { code: 'PROVIDER_RESPONSE_TOO_LARGE' });
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('Provider returned invalid JSON.'), { code: 'PROVIDER_INVALID_RESPONSE' }); }
  if (!response.ok) throw Object.assign(new Error('Provider identity verification failed.'), { code: 'PROVIDER_AUTH_FAILED', statusCode: response.status });
  return data;
}

function awsSignature({ accessKeyId, secretAccessKey, sessionToken, region = 'us-east-1' }) {
  const service = 'sts', host = 'sts.' + region + '.amazonaws.com';
  const now = new Date(), amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const body = 'Action=GetCallerIdentity&Version=2011-06-15';
  const canonicalHeaders = 'content-type:application/x-www-form-urlencoded; charset=utf-8\nhost:' + host + '\nx-amz-date:' + amzDate + '\n' + (sessionToken ? 'x-amz-security-token:' + sessionToken + '\n' : '');
  const signedHeaders = 'content-type;host;x-amz-date' + (sessionToken ? ';x-amz-security-token' : '');
  const canonical = 'POST\n/\n\n' + canonicalHeaders + '\n' + signedHeaders + '\n' + sha256(body);
  const scope = date + '/' + region + '/' + service + '/aws4_request';
  const toSign = 'AWS4-HMAC-SHA256\n' + amzDate + '\n' + scope + '\n' + sha256(canonical);
  const kDate = hmac('AWS4' + secretAccessKey, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, toSign, 'hex');
  const authorization = 'AWS4-HMAC-SHA256 Credential=' + accessKeyId + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
  return { host, amzDate, body, authorization, sessionToken };
}
async function aws(credentials) {
  const accessKeyId = required(credentials.accessKeyId, 'aws.accessKeyId');
  const secretAccessKey = required(credentials.secretAccessKey, 'aws.secretAccessKey');
  const region = String(credentials.region || 'us-east-1');
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) throw new Error('AWS region is invalid.');
  const signed = awsSignature({ accessKeyId, secretAccessKey, sessionToken: credentials.sessionToken, region });
  const headers = {
    'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
    'x-amz-date': signed.amzDate,
    Authorization: signed.authorization
  };
  if (signed.sessionToken) headers['x-amz-security-token'] = signed.sessionToken;
  const response = await fetch('https://' + signed.host + '/', { method: 'POST', headers, body: signed.body, redirect: 'error', signal: AbortSignal.timeout(15000) });
  const xml = await response.text();
  if (!response.ok || !/<Account>[^<]+<\/Account>/.test(xml) || !/<Arn>[^<]+<\/Arn>/.test(xml)) throw Object.assign(new Error('AWS STS GetCallerIdentity failed.'), { code: 'AWS_IDENTITY_FAILED' });
  return { name: 'aws_identity', status: 'PASS', code: 'AWS_STS_IDENTITY_VERIFIED' };
}
async function azure(credentials) {
  const tenant = required(credentials.tenantId, 'azure.tenantId');
  const client = required(credentials.clientId, 'azure.clientId');
  const secret = required(credentials.clientSecret, 'azure.clientSecret');
  const token = await jsonRequest('https://login.microsoftonline.com/' + encodeURIComponent(tenant) + '/oauth2/v2.0/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client, client_secret: secret, grant_type: 'client_credentials', scope: 'https://management.azure.com/.default' })
  });
  if (!token.access_token) throw Object.assign(new Error('Azure did not issue an access token.'), { code: 'AZURE_TOKEN_FAILED' });
  const subs = await jsonRequest('https://management.azure.com/subscriptions?api-version=2022-12-01', { headers: { Authorization: 'Bearer ' + token.access_token } });
  if (!Array.isArray(subs.value) || !subs.value.length) throw Object.assign(new Error('Azure identity has no visible subscriptions.'), { code: 'AZURE_SUBSCRIPTION_NOT_FOUND' });
  const requested = credentials.subscriptionId;
  if (requested && !subs.value.some(item => item.subscriptionId === requested)) throw Object.assign(new Error('Configured Azure subscription is not accessible.'), { code: 'AZURE_SUBSCRIPTION_SCOPE_MISMATCH' });
  return { name: 'azure_identity', status: 'PASS', code: 'AZURE_SUBSCRIPTION_VERIFIED' };
}
async function gcp(credentials) {
  const email = required(credentials.clientEmail, 'gcp.clientEmail');
  const privateKey = required(credentials.privateKey, 'gcp.privateKey').replace(/\\n/g, '\n');
  const project = required(credentials.projectId, 'gcp.projectId');
  const now = Math.floor(Date.now() / 1000);
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 900 });
  const signer = crypto.createSign('RSA-SHA256'); signer.update(unsigned);
  const assertion = unsigned + '.' + signer.sign(privateKey, 'base64url');
  const token = await jsonRequest('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  if (!token.access_token) throw Object.assign(new Error('Google did not issue an access token.'), { code: 'GCP_TOKEN_FAILED' });
  await jsonRequest('https://cloudresourcemanager.googleapis.com/v3/projects/' + encodeURIComponent(project), { headers: { Authorization: 'Bearer ' + token.access_token } });
  return { name: 'gcp_identity', status: 'PASS', code: 'GCP_PROJECT_VERIFIED' };
}
async function kubernetes(credentials, integration) {
  const server = required(integration.endpoint || credentials.server, 'kubernetes.server');
  const url = new URL(server);
  if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') throw new Error('Kubernetes API endpoint must use HTTPS in production.');
  if (url.username || url.password || url.search || url.hash) throw new Error('Kubernetes API endpoint is invalid.');
  const token = required(credentials.token, 'kubernetes.token');
  const namespace = required(credentials.namespace, 'kubernetes.namespace');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(namespace)) throw new Error('Kubernetes namespace is invalid.');
  await jsonRequest(new URL('/version', url).toString(), { headers: { Authorization: 'Bearer ' + token } });
  await jsonRequest(new URL('/api/v1/namespaces/' + encodeURIComponent(namespace), url).toString(), { headers: { Authorization: 'Bearer ' + token } });
  return { name: 'kubernetes_identity', status: 'PASS', code: 'KUBERNETES_NAMESPACE_VERIFIED' };
}
async function launchdarkly(credentials, integration) {
  const apiKey = required(credentials.apiKey, 'launchdarkly.apiKey');
  const project = required(credentials.projectKey, 'launchdarkly.projectKey');
  const environment = required(credentials.environmentKey, 'launchdarkly.environmentKey');
  const base = new URL(integration.endpoint || 'https://app.launchdarkly.com');
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('LaunchDarkly API endpoint must be a trusted HTTPS URL.');
  await jsonRequest(new URL('/api/v2/projects/' + encodeURIComponent(project) + '/environments/' + encodeURIComponent(environment), base), {
    headers: { Authorization: apiKey, 'LD-API-Version': '20240415' }
  });
  return { name: 'launchdarkly_identity', status: 'PASS', code: 'LAUNCHDARKLY_ENVIRONMENT_VERIFIED' };
}

export async function verifyProviderIdentity(provider, credentials, integration = {}) {
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) throw new Error('Provider credentials must be an object.');
  const result = {
    aws, azure, gcp,
    kubernetes: value => kubernetes(value, integration),
    launchdarkly: value => launchdarkly(value, integration)
  }[provider];
  if (!result) throw new Error('Unsupported provider identity check.');
  return result(credentials);
}
