import express from 'express';
import { timingSafeEqual } from 'node:crypto';

const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'256kb'}));
app.use((_req,res,next)=>{res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');next();});
const MODEL=process.env.MEDICINE_VECTOR_MODEL||'onnx-community/all-MiniLM-L6-v2-ONNX';
const REVISION=process.env.MEDICINE_VECTOR_MODEL_REVISION||'main';
const DIMENSIONS=Math.max(1,Math.min(4096,Number.parseInt(process.env.MEDICINE_VECTOR_DIMENSIONS||'384',10)||384));
const TOKEN=process.env.MEDICINE_EMBEDDING_TOKEN||'';
let extractorPromise=null, ready=false, active=0;
const MAX_CONCURRENT=Math.max(1,Math.min(8,Number.parseInt(process.env.MEDICINE_EMBEDDING_MAX_CONCURRENT||'2',10)||2));
const MAX_BATCH=32;
function authorized(req){
 const supplied=String(req.get('authorization')||'').replace(/^Bearer\s+/i,'');
 if(!TOKEN||!supplied)return false;
 const a=Buffer.from(supplied),b=Buffer.from(TOKEN);
 return a.length===b.length&&timingSafeEqual(a,b);
}
async function getExtractor(){
 if(!extractorPromise) extractorPromise=import('@huggingface/transformers').then(({pipeline})=>
   pipeline('feature-extraction',MODEL,{revision:REVISION}));
 try{return await extractorPromise;}catch(error){extractorPromise=null;throw error;}
}
async function embed(texts){
 const extractor=await getExtractor();
 const output=await extractor(texts,{pooling:'mean',normalize:true});
 const rows=output.tolist();
 if(!Array.isArray(rows)||rows.length!==texts.length||rows.some(row=>!Array.isArray(row)||row.length!==DIMENSIONS||row.some(v=>!Number.isFinite(Number(v)))))throw new Error('Invalid embedding output shape');
 return rows.map(row=>row.map(Number));
}
app.disable('etag');
app.get('/health',(_req,res)=>res.json({status:'ok',service:'medicine-embedding'}));
app.get('/ready',(_req,res)=>res.status(ready?200:503).json({status:ready?'ready':'loading-model',model:MODEL,revision:REVISION,dimensions:DIMENSIONS}));
app.post('/v1/embeddings',async(req,res)=>{
 if(!authorized(req))return res.status(401).json({code:'EMBEDDING_UNAUTHORIZED'});
 if(active>=MAX_CONCURRENT)return res.status(503).set('Retry-After','1').json({code:'EMBEDDING_BUSY'});
 const texts=req.body?.texts;
 if(!Array.isArray(texts)||texts.length<1||texts.length>MAX_BATCH||texts.some(t=>typeof t!=='string'||!t.trim()||t.length>4000))return res.status(400).json({code:'INVALID_EMBEDDING_INPUT'});
 active++;
 try{
  const embeddings=await embed(texts);
  ready=true;
  return res.json({model:MODEL,revision:REVISION,dimensions:DIMENSIONS,embeddings});
 }catch(error){
  console.error(JSON.stringify({service:'medicine-embedding',error:error.name||'EmbeddingError'}));
  return res.status(503).json({code:'EMBEDDING_UNAVAILABLE'});
 }finally{active--;}
});
const port=Number(process.env.PORT||8080);
const server=app.listen(port,'0.0.0.0',async()=>{
 try{await getExtractor();ready=true;console.info('Medicine embedding model loaded',MODEL,REVISION);}
 catch(error){console.error('Embedding model initialization failed',error.name||'Error');}
});
const shutdown=()=>server.close(()=>process.exit(0));
process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
