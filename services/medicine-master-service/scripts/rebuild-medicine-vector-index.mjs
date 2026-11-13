import mongoose from 'mongoose';
import {config} from '../src/config.js';
import {initializeMedicineCatalogueModels} from '../src/medicine-catalogue-import-routes.js';
import {buildMedicineEmbeddingText,upsertMedicineVectorDocuments} from '../src/medicine-vector-search.js';
const apply=process.argv.includes('--apply'),batchSize=Math.max(10,Math.min(100,Number(process.env.MEDICINE_VECTOR_BATCH_SIZE)||32)),stateId='medicine-master-vector-v1';
async function main(){
 if(!config.mongoUri)throw new Error('Medicine Master MongoDB URI is required.');
 await mongoose.connect(config.mongoUri,{dbName:config.dbName,serverSelectionTimeoutMS:10000,maxPoolSize:2});
 try{
  await initializeMedicineCatalogueModels();const model=mongoose.models.MedicineMaster,db=mongoose.connection.db;
  const vectors=db.collection(config.vectorCollection),states=db.collection(config.vectorStateCollection);
  const total=await model.countDocuments({medicineId:{$type:'string'}});
  if(!apply){process.stdout.write(JSON.stringify({mode:'dry-run',readOnly:true,sourceCollection:model.collection.collectionName,vectorCollection:config.vectorCollection,recordsToScan:total,model:config.vectorModel,dimensions:config.vectorDimensions,atlasIndex:config.vectorIndex,applyCommand:'npm --workspace services/medicine-master-service run vector:reindex -- --apply'},null,2)+'\n');return;}
  await vectors.createIndex({medicineId:1},{unique:true,name:'medicine_id_unique'});
  await states.updateOne({_id:stateId},{$set:{status:'BUILDING',model:config.vectorModel,dimensions:config.vectorDimensions,lastUpdatedAt:null,lastId:null,indexedCount:0,startedAt:new Date(),updatedAt:new Date()}},{upsert:true});
  let batch=[],indexed=0;
  const cursor=model.find({medicineId:{$type:'string'}}).sort({updatedAt:1,_id:1}).cursor({batchSize});
  const flush=async()=>{if(!batch.length)return;indexed+=await upsertMedicineVectorDocuments(batch);const last=batch.at(-1);
   await states.updateOne({_id:stateId},{$set:{indexedCount:indexed,lastUpdatedAt:last.updatedAt||new Date(),lastId:last._id,updatedAt:new Date()}});batch=[];};
  for await(const row of cursor){if(buildMedicineEmbeddingText(row))batch.push(row);if(batch.length>=batchSize)await flush();}
  await flush();await states.updateOne({_id:stateId},{$set:{status:'READY',indexedCount:indexed,model:config.vectorModel,dimensions:config.vectorDimensions,completedAt:new Date(),updatedAt:new Date()}});
  process.stdout.write(JSON.stringify({mode:'applied',status:'READY',sourceRecords:total,indexedRecords:indexed},null,2)+'\n');
 }catch(error){if(apply)await mongoose.connection.db.collection(config.vectorStateCollection).updateOne({_id:stateId},{$set:{status:'FAILED',errorCode:error.code||error.name,updatedAt:new Date()}},{upsert:true}).catch(()=>{});throw error;}
 finally{await mongoose.disconnect();}
}
main().catch(error=>{process.stderr.write((error.stack||String(error))+'\n');process.exitCode=1;});
