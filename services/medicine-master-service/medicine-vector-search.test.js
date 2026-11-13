import assert from 'node:assert/strict';
import test from 'node:test';
import {buildMedicineEmbeddingText,normalizeMedicineSearchQuery,rankMedicineSearchResults} from './src/medicine-vector-search.js';

test('only allowlisted shared catalogue fields enter embeddings',()=>{
 const text=buildMedicineEmbeddingText({brandName:'Dolo 650',genericName:'Paracetamol',uses:['Fever'],customerEmail:'private@example.com',prescriptionText:'patient secret'});
 assert.match(text,/Dolo 650/);assert.match(text,/Fever/);assert.doesNotMatch(text,/private@example|patient secret/);
});
test('embedding text is normalized and deduplicated',()=>{
 assert.equal(buildMedicineEmbeddingText({brandName:' Example   Tablet ',genericName:'Example',uses:['Fever','Fever']}),'Example Tablet | Example | Fever');
});
test('query normalization handles punctuation and diacritics',()=>{
 assert.equal(normalizeMedicineSearchQuery(' PARACETAMOL-650mg! '),'paracetamol 650mg');
});
test('exact identity outranks semantic-only match',()=>{
 const rows=rankMedicineSearchResults({query:'dolo 650',vectorRows:[{medicineId:'semantic',score:.99},{medicineId:'exact',score:.7}],keywordRows:[
 {medicineId:'semantic',brandName:'Other Fever Tablet',isArchived:false},{medicineId:'exact',brandName:'Dolo 650',isArchived:false}]});
 assert.equal(rows[0].medicineId,'exact');assert.equal(rows[0].matchType,'EXACT_OR_PREFIX');
});
test('archived results are excluded and duplicate IDs collapse',()=>{
 const rows=rankMedicineSearchResults({query:'paracetamol',vectorRows:[],keywordRows:[
 {medicineId:'a',brandName:'Paracetamol 650',isArchived:false},{medicineId:'a',brandName:'Paracetamol 650',isArchived:false},
 {medicineId:'b',brandName:'Paracetamol 500',isArchived:true}]});
 assert.equal(rows.length,1);assert.equal(rows[0].medicineId,'a');
});
test('result limit is bounded',()=>{
 const data=Array.from({length:75},(_,i)=>({medicineId:String(i),brandName:'Paracetamol '+i,isArchived:false}));
 assert.equal(rankMedicineSearchResults({query:'paracetamol',keywordRows:data,limit:1000}).length,50);
});
