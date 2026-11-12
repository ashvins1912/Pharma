#!/usr/bin/env node
/**
 * Compare persisted n-gram index lookups with the current substring regex.
 * Read-only; requires a completed medicine n-gram backfill.
 */
import mongoose from 'mongoose';
import { CharacterNgramCandidateIndex } from '@pharma/algorithm-kernel';

const MASTER_COLLECTION = process.env.MEDICINE_MASTER_COLLECTION || 'medicinemasters';
const INDEX_COLLECTION = 'medicine_name_ngram_index';
const STATE_COLLECTION = 'medicine_name_ngram_index_state';
const SAMPLE_SIZE = Math.max(10, Math.min(500, Number(process.env.BENCHMARK_SAMPLE_SIZE) || 100));
const PROJECTION = { _id: 1, medicineId: 1, brandName: 1, isArchived: 1 };

function typoFirstCharacter(value) {
  const name = String(value || '').trim();
  if (name.length < 4) return null;
  return (name[0].toLowerCase() === 'x' ? 'z' : 'x') + name.slice(1);
}
function metrics(explain) {
  const stats = explain.executionStats || {};
  const stages = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.stage) stages.push(node.stage);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(explain.queryPlanner?.winningPlan);
  return {
    executionTimeMillis: stats.executionTimeMillis ?? null,
    totalKeysExamined: stats.totalKeysExamined ?? null,
    totalDocsExamined: stats.totalDocsExamined ?? null,
    nReturned: stats.nReturned ?? null,
    winningStages: [...new Set(stages)]
  };
}
async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    const db = mongoose.connection.db;
    const master = db.collection(MASTER_COLLECTION);
    const index = db.collection(INDEX_COLLECTION);
    const state = await db.collection(STATE_COLLECTION).findOne({ _id: 'brandName-v1' });
    if (state?.status !== 'READY') throw new Error('Persisted n-gram index is not READY; run the backfill first.');
    const samples = await master.aggregate([
      { $match: { isArchived: { $ne: true }, brandName: { $type: 'string' } } },
      { $sample: { size: SAMPLE_SIZE } },
      { $project: PROJECTION }
    ]).toArray();
    const queries = samples.map(source => ({ source, query: typoFirstCharacter(source.brandName) }))
      .filter(item => item.query);
    if (!queries.length) throw new Error('No usable catalogue names found in sample.');

    const terms = [...new Set(queries.flatMap(item =>
      CharacterNgramCandidateIndex.searchTerms(item.query, { limit: 1000 })
    ))].slice(0, 600);
    const persistedFilter = { grams: { $in: terms }, isArchived: false };
    const regexFilter = {
      isArchived: { $ne: true },
      $or: terms.map(term => ({ brandName: { $regex: term, $options: 'i' } }))
    };

    const persistedExplain = await index.find(persistedFilter, { projection: { medicineId: 1 } })
      .limit(5001).explain('executionStats');
    const persistedStarted = performance.now();
    const indexRows = await index.find(persistedFilter, { projection: { medicineId: 1 } })
      .limit(5001).toArray();
    const persistedWallTimeMs = Number((performance.now() - persistedStarted).toFixed(2));
    const candidateIds = [...new Set(indexRows.map(row => row.medicineId))];
    const persistedIds = new Set(candidateIds);

    const regexExplain = await master.find(regexFilter, { projection: PROJECTION })
      .limit(5001).explain('executionStats');
    const regexStarted = performance.now();
    const regexRows = await master.find(regexFilter, { projection: PROJECTION })
      .limit(5001).toArray();
    const regexWallTimeMs = Number((performance.now() - regexStarted).toFixed(2));
    const regexIds = new Set(regexRows.map(row => String(row.medicineId)));

    const recoveredPersisted = queries.filter(item => persistedIds.has(item.source.medicineId)).length;
    const recoveredRegex = queries.filter(item => regexIds.has(String(item.source.medicineId))).length;
    const masterLookupFilter = { medicineId: { $in: candidateIds.slice(0, 5000) }, isArchived: { $ne: true } };
    const masterLookupExplain = candidateIds.length
      ? await master.find(masterLookupFilter, { projection: PROJECTION }).limit(5001).explain('executionStats')
      : null;

    process.stdout.write(JSON.stringify({
      benchmark: 'persisted-medicine-ngram-vs-regex',
      readOnly: true,
      masterCollection: MASTER_COLLECTION,
      indexCollection: INDEX_COLLECTION,
      indexState: state.status,
      sampleSize: samples.length,
      typoQueries: queries.length,
      queryTermCount: terms.length,
      strategies: [
        {
          name: 'persisted-inverted-ngram-index',
          candidateCount: indexRows.length,
          candidateLimitReached: indexRows.length > 5000,
          sampledKnownRecordRecall: Number((recoveredPersisted / queries.length).toFixed(4)),
          wallTimeMs: persistedWallTimeMs,
          indexLookup: metrics(persistedExplain),
          masterLookup: masterLookupExplain ? metrics(masterLookupExplain) : null
        },
        {
          name: 'substring-regex',
          candidateCount: regexRows.length,
          candidateLimitReached: regexRows.length > 5000,
          sampledKnownRecordRecall: Number((recoveredRegex / queries.length).toFixed(4)),
          wallTimeMs: regexWallTimeMs,
          query: metrics(regexExplain)
        }
      ],
      note: 'Recall is measured only against sampled source records after deterministic first-character typos. Run multiple samples and compare p50/p95 latency on a production-like staging snapshot.'
    }, null, 2) + '\n');
  } finally {
    await mongoose.disconnect();
  }
}
main().catch(error => {
  process.stderr.write((error?.stack || String(error)) + '\n');
  process.exitCode = 1;
});
