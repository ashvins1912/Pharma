import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { config } from './config.js';

const STATE_ID = 'medicine-master-vector-v1';
const FIELDS = ['brandName','genericName','productName','composition','strength','dosageForm','manufacturer','therapeuticClass','chemicalClass','actionClass','uses','indications'];
const clean = value => String(value ?? '').replace(/\s+/g,' ').trim().slice(0,500);


export function buildMedicineEmbeddingText(record = {}) {
  const values = [];
  for (const field of FIELDS) {
    const value = record[field];
    if (Array.isArray(value)) values.push(...value.filter(item => typeof item === 'string'));
    else if (typeof value === 'string' || typeof value === 'number') values.push(String(value));
  }
  return [...new Set(values.map(clean).filter(Boolean))].join(' | ').slice(0,4000);
}
export function normalizeMedicineSearchQuery(value) {
  return clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
}
const collection = name => {
  if (!mongoose.connection.db) throw new Error('MongoDB is not connected.');
  return mongoose.connection.db.collection(name);
};
export async function embedMedicineTexts(texts) {
  if (!Array.isArray(texts) || !texts.length) return [];
  if (texts.length > 32) throw new Error('Embedding batch cannot exceed 32 texts.');
  const input = texts.map(value => clean(value).slice(0, 4000));
  if (input.some(value => !value)) throw new Error('Embedding input cannot be empty.');
  if (!config.vectorInferenceUrl || !config.vectorInferenceToken) throw new Error('Isolated embedding inference is not configured.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.vectorInferenceTimeoutMs);
  try {
    const response = await fetch(new URL('/v1/embeddings', config.vectorInferenceUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.vectorInferenceToken },
      body: JSON.stringify({ texts: input }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error('Embedding inference returned HTTP ' + response.status);
    const payload = await response.json();
    const rows = payload?.embeddings;
    if (payload?.model !== config.vectorModel || payload?.dimensions !== config.vectorDimensions ||
        !Array.isArray(rows) || rows.length !== input.length ||
        rows.some(row => !Array.isArray(row) || row.length !== config.vectorDimensions ||
          row.some(value => !Number.isFinite(Number(value))))) {
      throw new Error('Embedding inference returned an incompatible model or vector shape.');
    }
    return rows.map(row => row.map(Number));
  } finally { clearTimeout(timeout); }
}
export async function upsertMedicineVectorDocuments(records,{embed=embedMedicineTexts}={}) {
  const rows = (records || []).filter(row => row?.medicineId && typeof row.medicineId === 'string');
  if (!rows.length) return 0;
  const texts = rows.map(buildMedicineEmbeddingText);
  if (texts.some(text => !text)) throw new Error('Cannot embed an empty Medicine Master record.');
  const vectors = await embed(texts);
  if (vectors.length !== rows.length) throw new Error('Embedding result count mismatch.');
  const operations = rows.map((row,index) => {
    const embedding = vectors[index];
    if (!Array.isArray(embedding) || embedding.length !== config.vectorDimensions ||
        embedding.some(value => !Number.isFinite(Number(value)))) throw new Error('Invalid embedding for '+row.medicineId);
    return {updateOne:{filter:{medicineId:row.medicineId},update:{$set:{
      medicineId:row.medicineId,embedding:embedding.map(Number),
      embeddingTextHash:createHash('sha256').update(texts[index]).digest('hex'),
      embeddingModel:config.vectorModel,embeddingDimensions:config.vectorDimensions,
      isArchived:Boolean(row.isArchived),sourceUpdatedAt:row.updatedAt || new Date(),updatedAt:new Date()
    }},upsert:true}};
  });
  await collection(config.vectorCollection).bulkWrite(operations,{ordered:false});
  return operations.length;
}
function lexicalScore(query,row) {
  const brand=normalizeMedicineSearchQuery(row.brandName), product=normalizeMedicineSearchQuery(row.productName);
  const generic=normalizeMedicineSearchQuery(row.genericName), composition=normalizeMedicineSearchQuery(row.composition);
  const clinical=normalizeMedicineSearchQuery([...(row.uses||[]),...(row.indications||[]),row.therapeuticClass,row.chemicalClass,row.actionClass].join(' '));
  const tokens=query.split(' ');
  if ([brand,product,generic].includes(query)) return 1;
  if ([brand,product].some(value=>value.startsWith(query))) return .96;
  if (brand.includes(query)||product.includes(query)) return .91;
  if (generic.includes(query)) return .88;
  if (composition.includes(query)) return .84;
  if (tokens.every(token=>clinical.includes(token))) return .68;
  return 0;
}
export function rankMedicineSearchResults({query,vectorRows=[],keywordRows=[],limit=15}) {
  const q=normalizeMedicineSearchQuery(query), scores=new Map(vectorRows.map(row=>[String(row.medicineId),Math.max(0,Math.min(1,Number(row.score)||0))]));
  const rows=new Map();
  for (const row of keywordRows) if (row?.medicineId&&!row.isArchived) rows.set(String(row.medicineId),row);
  return [...rows.values()].map(row=>{
    const lexical=lexicalScore(q,row), vector=scores.get(String(row.medicineId))||0, exact=lexical>=.96;
    const score=vector?Math.min(1,lexical*.55+vector*.45+(exact ? 0.15 : 0)):lexical;
    return {medicineId:row.medicineId,brandName:row.brandName||'',productName:row.productName||'',
      genericName:row.genericName||'',composition:row.composition||'',strength:row.strength||'',
      dosageForm:row.dosageForm||'',manufacturer:row.manufacturer||'',therapeuticClass:row.therapeuticClass||'',
      prescriptionVerification:row.prescriptionVerification||'UNVERIFIED',
      clinicalDataVerification:row.clinicalDataVerification||'UNVERIFIED',
      matchType:exact?'EXACT_OR_PREFIX':vector&&lexical?'HYBRID':vector?'SEMANTIC':'KEYWORD',searchScore:Number(score.toFixed(4)),_score:score};
  }).sort((a,b)=>b._score-a._score||a.brandName.localeCompare(b.brandName))
    .slice(0,Math.max(1,Math.min(50,Number(limit)||15))).map(({_score,...row})=>row);
}
export async function searchMedicineMaster({query,limit=15,model=mongoose.models.MedicineMaster}={}) {
  const q=normalizeMedicineSearchQuery(query),take=Math.max(1,Math.min(50,Number(limit)||15));
  if(q.length<2){const error=new Error('Enter at least two characters to search the medicine catalogue.');error.statusCode=400;error.code='MEDICINE_SEARCH_QUERY_TOO_SHORT';throw error;}
  if(!model) throw new Error('MedicineMaster model has not been initialized.');
  const safe=clean(query).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), regex=new RegExp(safe,'i');
  const filter={isArchived:{$ne:true},$or:['brandName','genericName','productName','composition','manufacturer','uses','indications','therapeuticClass','chemicalClass','actionClass'].map(field=>({[field]:regex}))};
  let vectorRows=[],vectorAvailable=false;
  if(config.vectorSearchEnabled){
    const state=await collection(config.vectorStateCollection).findOne({_id:STATE_ID});
    if(state?.status==='READY'&&state.model===config.vectorModel&&state.dimensions===config.vectorDimensions){
      try{
        const [queryVector]=await embedMedicineTexts([clean(query)]);
        vectorRows=await collection(config.vectorCollection).aggregate([
          {$vectorSearch:{index:config.vectorIndex,path:'embedding',queryVector,numCandidates:Math.max(100,take*20),limit:take*4,filter:{isArchived:false}}},
          {$project:{_id:0,medicineId:1,score:{$meta:'vectorSearchScore'}}}
        ]).toArray();
        vectorAvailable=true;
      }catch(error){console.warn('[MedicineVectorSearch] vector fallback:',error.code||error.name);}
    }
  }
  const ids=vectorRows.map(row=>String(row.medicineId));
  const [lexical,semantic]=await Promise.all([
    model.find(filter).limit(take*4).lean(),
    ids.length?model.find({medicineId:{$in:ids},isArchived:{$ne:true}}).lean():[]
  ]);
  const merged=new Map([...lexical,...semantic].filter(row=>row?.medicineId&&!row.isArchived).map(row=>[String(row.medicineId),row]));
  const results=rankMedicineSearchResults({query:q,vectorRows,keywordRows:[...merged.values()],limit:take});
  return {query:clean(query),searchMode:vectorAvailable?'HYBRID':'KEYWORD_FALLBACK',vectorAvailable,results,totalReturned:results.length,
    notice:'Catalogue discovery only; similarity does not establish clinical equivalence or authorize substitution.'};
}
