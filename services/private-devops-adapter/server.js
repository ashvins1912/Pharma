import express from 'express';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { verifyProviderIdentity } from './drivers/providerIdentity.js';
import { nativeProviderPreflight, nativeProviderExecute, nativeProviderRollback } from './drivers/nativeExecution.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
const PORT = Number(process.env.PORT || 8090);
const MONGO_URI = process.env.ADAPTER_MONGO_URI || process.env.MONGO_URI;
const TOKEN = String(process.env.PRIVATE_DEVOPS_ADAPTER_TOKEN || '');
const PROVIDERS = new Set(['aws','azure','gcp','kubernetes','launchdarkly']);
const ENVIRONMENTS = new Set(['development','staging','production']);
const TERMINAL = new Set(['SUCCEEDED','FAILED','CANCELLED','ROLLED_BACK']);
const DRIVER_CHECK_STATES = new Set(['PASS','BLOCKED','FAIL','WARN']);
const SAFE_CODE = /^[A-Z0-9_:-]{1,80}$/;
const productionEnabled = () => process.env.ALLOW_PRODUCTION_OPERATIONS === 'true';
const safeErrorCode = (value,fallback) => SAFE_CODE.test(String(value||'')) ? String(value) : fallback;

const jobSchema = new mongoose.Schema({
  jobId: { type: String, required: true, unique: true },
  idempotencyKey: { type: String, required: true, unique: true },
  provider: { type: String, required: true, index: true },
  operation: { type: String, required: true },
  environment: { type: String, required: true, index: true },
  status: { type: String, required: true, index: true },
  request: { type: mongoose.Schema.Types.Mixed, required: true },
  result: { type: mongoose.Schema.Types.Mixed, default: null },
  errorCode: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { minimize: false, strict: true });
jobSchema.index({ provider: 1, environment: 1, createdAt: -1 });
const Job = mongoose.models.PrivateDevOpsJob || mongoose.model('PrivateDevOpsJob', jobSchema, 'private_devops_jobs');

const evidenceSchema = new mongoose.Schema({
  runId: { type: String, required: true, unique: true },
  provider: { type: String, required: true },
  environment: { type: String, required: true },
  status: { type: String, required: true },
  checks: { type: [mongoose.Schema.Types.Mixed], default: [] },
  checkedAt: { type: Date, default: Date.now }
}, { strict: true });
const Evidence = mongoose.models.PrivateDevOpsEvidence || mongoose.model('PrivateDevOpsEvidence', evidenceSchema, 'private_devops_evidence');
const artifactSnapshotSchema = new mongoose.Schema({
  snapshotId: { type: String, required: true, unique: true },
  provider: { type: String, required: true, index: true },
  environment: { type: String, required: true, index: true },
  serviceName: { type: String, required: true, index: true },
  digest: { type: String, required: true },
  image: { type: String, required: true },
  files: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now, index: true }
}, { strict: true, minimize: false });
const ArtifactSnapshot = mongoose.models.PrivateDevOpsArtifactSnapshot || mongoose.model('PrivateDevOpsArtifactSnapshot', artifactSnapshotSchema, 'private_devops_artifact_snapshots');

function safeEqual(a, b) {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function auth(req,res,next) {
  const supplied = String(req.get('authorization') || '').replace(/^Bearer\s+/i,'');
  if (TOKEN.length < 32 || !safeEqual(supplied,TOKEN)) return res.status(401).json({success:false,code:'ADAPTER_UNAUTHORIZED'});
  next();
}
function validateBase(req,res,next) {
  const { provider, environment } = req.body || {}; const selectedProvider = provider || req.body?.integration?.provider; const selectedEnvironment = environment || req.body?.integration?.environment;
  if (!PROVIDERS.has(selectedProvider) || !ENVIRONMENTS.has(selectedEnvironment)) return res.status(400).json({success:false,code:'INVALID_PROVIDER_OR_ENVIRONMENT'});
  if (selectedEnvironment === 'production' && !productionEnabled()) return res.status(423).json({success:false,code:'PRODUCTION_LOCKED',message:'Production execution is disabled by adapter policy.'});
  next();
}
function endpointFor(provider) {
  const key = 'DEVOPS_DRIVER_' + provider.toUpperCase() + '_URL';
  const raw = String(process.env[key] || '').trim();
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') throw new Error('Provider driver endpoints must use HTTPS in production.');
  if (url.username || url.password || url.search || url.hash) throw new Error('Invalid provider driver URL.');
  return url.toString().replace(/\/$/,'');
}
async function driverCall(provider,path,payload) {
  const base = endpointFor(provider);
  if (!base) throw Object.assign(new Error('Provider driver is not configured.'),{code:'DRIVER_NOT_CONFIGURED',statusCode:503});
  const token = String(process.env['DEVOPS_DRIVER_'+provider.toUpperCase()+'_TOKEN'] || '');
  if (token.length < 32) throw Object.assign(new Error('Provider driver authentication is not configured.'),{code:'DRIVER_AUTH_NOT_CONFIGURED',statusCode:503});
  const response = await fetch(new URL(path,base),{
    method:'POST', redirect:'error', headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+token},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)
  });
  const text = await response.text();
  if (text.length > 65536) throw Object.assign(new Error('Provider driver response exceeded limit.'),{code:'DRIVER_RESPONSE_TOO_LARGE'});
  let data={}; try { data=text ? JSON.parse(text) : {}; } catch { throw Object.assign(new Error('Provider driver returned invalid JSON.'),{code:'DRIVER_INVALID_RESPONSE'}); }
  if (!response.ok) throw Object.assign(new Error('Provider driver rejected the operation.'),{code:data.code || 'DRIVER_REJECTED',statusCode:response.status});
  return data;
}
async function providerCall(provider, operation, payload) {
  let configured = false;
  try { configured = Boolean(endpointFor(provider)); } catch (error) { throw Object.assign(error,{code:'DRIVER_ENDPOINT_INVALID'}); }
  if (configured) {
    const paths = { preflight:'/v1/preflight', execute:'/v1/deployments/execute', status:'/v1/deployments/status', rollback:'/v1/deployments/rollback', flag:'/v1/feature-flags/rollout', flagRollback:'/v1/feature-flags/rollback' };
    return driverCall(provider,paths[operation],payload);
  }
  if (operation === 'preflight') return {checks:[await nativeProviderPreflight(provider,payload)]};
  if (operation === 'execute') return nativeProviderExecute(provider,payload);
  if (operation === 'rollback') return nativeProviderRollback(provider,payload);
  if (operation === 'flag') return nativeProviderExecute(provider,payload);
  if (operation === 'flagRollback') return nativeProviderRollback(provider,payload);
  if (operation === 'status') return {status:'SUCCEEDED'};
  throw new Error('Unsupported provider operation.');
}

function safeChecks(checks) {
  if (!Array.isArray(checks)) return [];
  return checks.slice(0,100).map(check => ({
    name: String(check?.name || 'provider_check').slice(0,100),
    status: DRIVER_CHECK_STATES.has(String(check?.status || '').toUpperCase()) ? String(check.status).toUpperCase() : 'FAIL',
    ...(SAFE_CODE.test(String(check?.code || '')) ? {code:String(check.code)} : {}),
    ...(typeof check?.message === 'string' ? {message:check.message.replace(/[\r\n]+/g,' ').slice(0,240)} : {})
  }));
}
function publicJob(job) {
  return {jobId:job.jobId,provider:job.provider,operation:job.operation,environment:job.environment,status:job.status,result:job.result,errorCode:job.errorCode,rollbackAvailable:Boolean(job.request?.previousSnapshotId),createdAt:job.createdAt,updatedAt:job.updatedAt};
}
app.get('/health',(_req,res)=>res.json({success:true,service:'private-devops-adapter',status:'UP'}));
app.get('/ready',(_req,res)=>res.status(mongoose.connection.readyState===1?200:503).json({success:mongoose.connection.readyState===1,database:mongoose.connection.readyState===1?'connected':'disconnected'}));
app.use('/v1',auth);

app.get('/v1/catalog',(_req,res)=>res.json({success:true,providers:[...PROVIDERS],environments:[...ENVIRONMENTS],productionEnabled:productionEnabled(),driverStatus:Object.fromEntries([...PROVIDERS].map(p=>[p,Boolean(process.env['DEVOPS_DRIVER_'+p.toUpperCase()+'_URL'])]))}));

app.post('/v1/preflight',validateBase,async(req,res)=>{
  const {provider,environment,capabilities=[],integration,credentials}=req.body;
  if (!integration?.id || !credentials || typeof credentials !== 'object' || Array.isArray(credentials)) return res.status(400).json({success:false,code:'INTEGRATION_CONTEXT_REQUIRED'});
  const checks=[];
  checks.push({name:'native_execution_driver',status:'PASS',code:'NATIVE_DRIVER_AVAILABLE'});
  checks.push({name:'environment_policy',status:environment==='production'&&!productionEnabled()?'BLOCKED':'PASS'});
  try { checks.push(await verifyProviderIdentity(provider,credentials,{id:integration.id,endpoint:integration.endpoint,targetConfig:integration.targetConfig||{}})); }
  catch(error){checks.push({name:'provider_identity',status:'FAIL',code:SAFE_CODE.test(String(error.code||''))?error.code:'PROVIDER_IDENTITY_FAILED'});}
  try { const result=await providerCall(provider,'preflight',{provider,environment,capabilities,integration:{id:integration.id,endpoint:integration.endpoint,targetConfig:integration.targetConfig||{}},credentials,deployment:req.body.deployment||{files:req.body.files||{},serviceName:req.body.serviceName||'preflight'},flag:req.body.flag}); const providerChecks=safeChecks(result.checks||[result]); checks.push(...providerChecks); if (!providerChecks.length) checks.push({name:'provider_execution_preflight',status:'FAIL',code:'EMPTY_PROVIDER_EVIDENCE'}); }
  catch(error){checks.push({name:'provider_execution_preflight',status:'FAIL',code:SAFE_CODE.test(String(error.code||''))?error.code:'PREFLIGHT_FAILED'});}
  const passed=checks.length>0 && checks.every(c=>c.status==='PASS');
  const evidence=await Evidence.create({runId:crypto.randomUUID(),provider,environment,status:passed?'PASS':checks.some(c=>c.status==='FAIL')?'FAIL':'BLOCKED',checks:safeChecks(checks)});
  return res.status(passed?200:424).json({success:passed,evidence});
});

app.post('/v1/deployments/execute',validateBase,async(req,res)=>{
  const {integration,credentials,deployment}=req.body||{};
  const provider=integration?.provider, environment=integration?.environment;
  if(!integration?.id || !credentials || typeof credentials!=='object' || !deployment?.id) return res.status(400).json({success:false,code:'INTEGRATION_CONTEXT_REQUIRED'});
  const idempotencyKey='deployment:'+String(deployment.id);
  if(idempotencyKey.length<16||idempotencyKey.length>160) return res.status(400).json({success:false,code:'IDEMPOTENCY_KEY_REQUIRED'});
  if(!Array.isArray(deployment.files) || !deployment.files.length || !deployment.changeReference) return res.status(400).json({success:false,code:'DEPLOYMENT_INPUT_REQUIRED'});
  if(typeof deployment.image!=='string'||!/^([a-z0-9.-]+(?::[0-9]+)?\/)?[a-z0-9._/-]+:[A-Za-z0-9_.-]{1,64}$/.test(deployment.image)||deployment.image.includes('CHANGE_ME')||deployment.image.split(':').pop().toLowerCase()==='latest') return res.status(400).json({success:false,code:'DEPLOYMENT_IMAGE_REQUIRED'});
  const existing=await Job.findOne({idempotencyKey});
  if(existing) return res.status(200).json({success:true,accepted:true,deploymentId:existing.jobId,status:existing.status,job:publicJob(existing),replayed:true});
  const previous=await Job.findOne({provider,environment,operation:'deploy',status:'SUCCEEDED','request.serviceName':deployment.serviceName}).sort({createdAt:-1}).lean();
  const snapshotId=crypto.randomUUID();
  const artifactBytes=Array.isArray(deployment.files)?deployment.files.reduce((sum,file)=>sum+Buffer.byteLength(String(file?.content||'')),0):0;
  if(artifactBytes>8*1024*1024) return res.status(413).json({success:false,code:'ARTIFACT_SNAPSHOT_TOO_LARGE'});
  await ArtifactSnapshot.create({snapshotId,provider,environment,serviceName:deployment.serviceName,digest:String(deployment.artifactDigest||''),image:deployment.image,files:deployment.files});
  let job;
  try {
    job=await Job.create({jobId:crypto.randomUUID(),idempotencyKey,provider,operation:'deploy',environment,status:'QUEUED',request:{
      integrationId:String(integration.id),artifactDigest:deployment.artifactDigest,changeReference:deployment.changeReference,
      serviceName:deployment.serviceName,artifactSnapshotId:snapshotId,previousSnapshotId:previous?.request?.artifactSnapshotId||null
    }});
  } catch(error) { await ArtifactSnapshot.deleteOne({snapshotId}); if(error?.code===11000){const raced=await Job.findOne({idempotencyKey});if(raced)return res.status(200).json({success:true,accepted:true,deploymentId:raced.jobId,status:raced.status,job:publicJob(raced),replayed:true});} throw error; }
  try {
    const result=await providerCall(provider,'execute',{jobId:job.jobId,integration:{id:integration.id,endpoint:integration.endpoint,targetConfig:integration.targetConfig||{}},credentials,deployment});
    job.status=String(result.status||'SUBMITTED');
    if(!['SUBMITTED','RUNNING','SUCCEEDED','FAILED'].includes(job.status)) job.status='SUBMITTED';
    job.result={providerOperationId:result.operationId||null,message:'Provider execution accepted; reconcile status before declaring success.'};
    await job.save();
    return res.status(202).json({success:true,accepted:true,deploymentId:job.jobId,status:job.status,job:publicJob(job)});
  } catch(error) {
    job.status='FAILED'; job.errorCode=safeErrorCode(error.code,'PROVIDER_EXECUTION_FAILED'); await job.save();
    return res.status(error.statusCode||502).json({success:false,job:publicJob(job)});
  }
});

app.post('/v1/deployments/status',async(req,res)=>{
  const {integration,credentials,deployment}=req.body||{};
  const provider=integration?.provider, jobId=deployment?.remoteDeploymentId;
  if (!PROVIDERS.has(provider) || !integration?.id || !credentials || typeof credentials!=='object' || !jobId) return res.status(400).json({success:false,code:'STATUS_CONTEXT_REQUIRED'});
  const job=await Job.findOne({jobId,provider});
  if(!job) return res.status(404).json({success:false,code:'JOB_NOT_FOUND'});
  if(!TERMINAL.has(job.status)) {
    try {
      const result=await providerCall(provider,'status',{jobId,credentials,integration:{id:integration.id,endpoint:integration.endpoint,targetConfig:integration.targetConfig||{}},providerOperationId:job.result?.providerOperationId});
      if(['RUNNING','SUCCEEDED','FAILED','ROLLED_BACK'].includes(result.status)) job.status=result.status;
      job.result={...(job.result||{}),providerStatus:['SUBMITTED','RUNNING','SUCCEEDED','FAILED','ROLLED_BACK'].includes(result.status)?result.status:'UNKNOWN',health:typeof result.health==='string'?result.health.slice(0,240):null};
      job.errorCode=SAFE_CODE.test(String(result.errorCode||''))?String(result.errorCode):null; job.updatedAt=new Date(); await job.save();
      if(job.operation==='rollback'&&job.status==='ROLLED_BACK'){const source=await Job.findOne({jobId:job.request?.sourceJobId});if(source){source.status='ROLLED_BACK';source.updatedAt=new Date();await source.save();}}
    } catch(error) { return res.status(502).json({success:false,code:safeErrorCode(error.code,'STATUS_RECONCILIATION_FAILED'),job:publicJob(job)}); }
  }
  return res.json({success:true,status:job.status,errorCode:job.errorCode,job:publicJob(job)});
});

app.post('/v1/deployments/rollback',validateBase,async(req,res)=>{
  const {integration,credentials,deployment}=req.body||{};
  const provider=integration?.provider, environment=integration?.environment, jobId=deployment?.remoteDeploymentId, changeReference=deployment?.changeReference;
  if(!jobId||!changeReference) return res.status(400).json({success:false,code:'ROLLBACK_INPUT_REQUIRED'});
  const source=await Job.findOne({jobId,provider,environment});
  if(!source||!['SUCCEEDED','RUNNING'].includes(source.status)) return res.status(409).json({success:false,code:'ROLLBACK_SOURCE_NOT_ELIGIBLE'});
  const key='rollback:'+jobId+':'+changeReference;
  let job=await Job.findOne({idempotencyKey:key});
  if(!job) job=await Job.create({jobId:crypto.randomUUID(),idempotencyKey:key,provider,operation:'rollback',environment,status:'QUEUED',request:{sourceJobId:jobId,changeReference}});
  const previousSnapshot=source.request?.previousSnapshotId?await ArtifactSnapshot.findOne({snapshotId:source.request.previousSnapshotId}).lean():null;
  try {
    const result=await providerCall(provider,'rollback',{jobId:job.jobId,sourceJobId:jobId,environment,changeReference,credentials,integration:{id:integration.id,endpoint:integration.endpoint,targetConfig:integration.targetConfig||{}},deployment:{...deployment,previousFiles:previousSnapshot?.files,previousImage:previousSnapshot?.image}});
    job.status=['SUBMITTED','RUNNING','SUCCEEDED','FAILED','ROLLED_BACK'].includes(result.status)?result.status:'SUBMITTED';
    job.result={providerOperationId:result.operationId||null}; await job.save();
    if(job.status==='ROLLED_BACK'){source.status='ROLLED_BACK';source.updatedAt=new Date();await source.save();}
    return res.status(202).json({success:true,accepted:true,status:job.status,job:publicJob(job)});
  } catch(error) { job.status='FAILED'; job.errorCode=safeErrorCode(error.code,'ROLLBACK_FAILED'); await job.save(); return res.status(error.statusCode||502).json({success:false,job:publicJob(job)}); }
});

app.post('/v1/feature-flags/rollout',validateBase,async(req,res)=>{
  const {integration,credentials,flag}=req.body||{};
  const provider=integration?.provider, environment=integration?.environment, flagKey=flag?.key, rolloutPercent=flag?.rolloutPercent, changeReference=flag?.changeReference;
  if(provider!=='launchdarkly'||!flagKey||!Number.isFinite(rolloutPercent)||rolloutPercent<0||rolloutPercent>100||!changeReference) return res.status(400).json({success:false,code:'INVALID_FLAG_ROLLOUT'});
  const key='flag:'+environment+':'+flagKey+':'+rolloutPercent+':'+changeReference;
  let job=await Job.findOne({idempotencyKey:key});
  if(!job) job=await Job.create({jobId:crypto.randomUUID(),idempotencyKey:key,provider,operation:'flag_rollout',environment,status:'QUEUED',request:{flagKey,rolloutPercent,changeReference}});
  try {
    const result=await providerCall(provider,'flag',{jobId:job.jobId,environment,flag,credentials,integration:{id:integration.id,endpoint:integration.endpoint,targetConfig:integration.targetConfig||{}},preserveUnspecifiedRules:true});
    job.status=['SUBMITTED','RUNNING','SUCCEEDED','FAILED'].includes(result.status)?result.status:'SUBMITTED';
    job.result={providerOperationId:result.operationId||null,rollbackSnapshot:result.rollbackSnapshot||null}; await job.save();
    return res.status(202).json({success:true,accepted:true,requestId:job.jobId,status:job.status});
  } catch(error) { job.status='FAILED'; job.errorCode=safeErrorCode(error.code,'FLAG_ROLLOUT_FAILED'); await job.save(); return res.status(error.statusCode||502).json({success:false,code:job.errorCode}); }
});

app.post('/v1/feature-flags/rollback',validateBase,async(req,res)=>{
  const {integration,credentials,sourceRequestId,flag}=req.body||{};
  if(integration?.provider!=='launchdarkly'||!integration?.id||!sourceRequestId||!flag?.key) return res.status(400).json({success:false,code:'FLAG_ROLLBACK_CONTEXT_REQUIRED'});
  const source=await Job.findOne({jobId:sourceRequestId,provider:'launchdarkly',environment:integration.environment,operation:'flag_rollout',status:'SUCCEEDED'});
  if(!source?.result?.rollbackSnapshot) return res.status(409).json({success:false,code:'FLAG_ROLLBACK_SNAPSHOT_MISSING'});
  const key='flag-rollback:'+sourceRequestId;
  let job=await Job.findOne({idempotencyKey:key});
  if(!job) job=await Job.create({jobId:crypto.randomUUID(),idempotencyKey:key,provider:'launchdarkly',operation:'flag_rollback',environment:integration.environment,status:'QUEUED',request:{sourceRequestId,flagKey:flag.key}});
  try {
    const result=await providerCall('launchdarkly','flagRollback',{integration:{id:integration.id,endpoint:integration.endpoint,targetConfig:integration.targetConfig||{}},credentials,flag,rollbackSnapshot:source.result.rollbackSnapshot});
    job.status=result.status==='ROLLED_BACK'?'ROLLED_BACK':'FAILED';
    job.result={providerOperationId:result.operationId||null};await job.save();
    return res.status(job.status==='ROLLED_BACK'?200:502).json({success:job.status==='ROLLED_BACK',accepted:job.status==='ROLLED_BACK',requestId:job.jobId,status:job.status});
  } catch(error){job.status='FAILED';job.errorCode=safeErrorCode(error.code,'FLAG_ROLLBACK_FAILED');await job.save();return res.status(502).json({success:false,code:job.errorCode});}
});

app.get('/v1/evidence',async(req,res)=>{
  const filter={}; if(req.query.environment) filter.environment=req.query.environment; if(req.query.provider) filter.provider=req.query.provider;
  if (filter.provider && !PROVIDERS.has(filter.provider)) return res.status(400).json({success:false,code:'INVALID_PROVIDER'});
  if (filter.environment && !ENVIRONMENTS.has(filter.environment)) return res.status(400).json({success:false,code:'INVALID_ENVIRONMENT'});
  const evidence=await Evidence.find(filter).sort({checkedAt:-1}).limit(100).lean();
  res.set('Cache-Control','private, no-store'); return res.json({success:true,evidence});
});
app.use((error,_req,res,_next)=>{const status=Number(error.statusCode||500);res.status(status).json({success:false,code:error.code||'ADAPTER_ERROR',message:status>=500?'Private adapter request failed.':error.message});});

if(!MONGO_URI) throw new Error('ADAPTER_MONGO_URI or MONGO_URI is required.');
if(TOKEN.length<32) throw new Error('PRIVATE_DEVOPS_ADAPTER_TOKEN must contain at least 32 characters.');
await mongoose.connect(MONGO_URI);
app.listen(PORT,'0.0.0.0',()=>console.info('Private DevOps adapter listening on '+PORT));
