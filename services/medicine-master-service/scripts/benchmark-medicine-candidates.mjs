#!/usr/bin/env node
/**
 * Read-only MongoDB benchmark for medicine catalogue candidate retrieval.
 * Required: MONGODB_URI
 * Optional: MEDICINE_MASTER_COLLECTION (default: medicinemasters)
 *           BENCHMARK_SAMPLE_SIZE (default: 100)
 */
import mongoose from 'mongoose';
import { CharacterNgramCandidateIndex } from '@pharma/algorithm-kernel';

const COLLECTION = process.env.MEDICINE_MASTER_COLLECTION || 'medicinemasters';
const SAMPLE_SIZE = Math.max(10, Math.min(500, Number(process.env.BENCHMARK_SAMPLE_SIZE) || 100));
const PROJECTION = { _id: 1, medicineId: 1, brandName: 1, isArchived: 1 };
function typoFirstCharacter(value) {
  const name = String(value || '').trim();
  if (name.length < 4) return null;
  return (name[0].toLowerCase() === 'x' ? 'z' : 'x') + name.slice(1);
function legacyPrefixTerms(records) {
  return [...new Set(records.map(record => String(record.brandName || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 2)).filter(term => term.length === 2))].slice(0, 120);
function ngramTerms(records) {
  return [...new Set(records.flatMap(record =>
    CharacterNgramCandidateIndex.searchTerms(record.brandName)))].slice(0, 600);
function buildFilter(terms, prefix) {
  return {
    isArchived: { $ne: true },
    $or: terms.map(term => ({
      brandName: { $regex: prefix ? '^' + term : term, $options: 'i' }
    }))
  };
function explainMetrics(explain) {
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

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required; this benchmark never writes to MongoDB.');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    const collection = mongoose.connection.db.collection(COLLECTION);
    const indexes = await collection.listIndexes().toArray();
    const samples = await collection.aggregate([
      { $match: { isArchived: { $ne: true }, brandName: { $type: 'string' } } },
      { $sample: { size: SAMPLE_SIZE } },
      { $project: PROJECTION }
    ], { allowDiskUse: false }).toArray();
    const queries = samples.map(source => ({ source, query: typoFirstCharacter(source.brandName) }))
      .filter(item => item.query);
    if (!queries.length) throw new Error('No usable brand names found in the sampled catalogue.');

    const batch = queries.map(item => ({ brandName: item.query }));
    const strategies = [
      { name: 'legacy-two-character-prefix', terms: legacyPrefixTerms(batch), prefix: true },
      { name: 'character-ngram-substring', terms: ngramTerms(batch), prefix: false }
    ];
    const results = [];
    for (const strategy of strategies) {
      const filter = buildFilter(strategy.terms, strategy.prefix);
      const explain = await collection.find(filter, { projection: PROJECTION }).limit(5001).explain('executionStats');
      const started = performance.now();
      const candidates = await collection.find(filter, { projection: PROJECTION }).limit(5001).toArray();
      const wallTimeMs = Number((performance.now() - started).toFixed(2));
      const ids = new Set(candidates.map(item => String(item._id)));
      const recovered = queries.filter(item => ids.has(String(item.source._id))).length;
      results.push({
        strategy: strategy.name,
        queryTermCount: strategy.terms.length,
        returnedCandidates: candidates.length,
        candidateLimitReached: candidates.length > 5000,
        sampledKnownRecordRecall: Number((recovered / queries.length).toFixed(4)),
        sampledKnownRecords: queries.length,
        wallTimeMs,
        ...explainMetrics(explain)
      });
    }
    process.stdout.write(JSON.stringify({
      benchmark: 'medicine-master-candidate-retrieval',
      readOnly: true,
      collection: COLLECTION,
      sampledCatalogueRows: samples.length,
      typoQueries: queries.length,
      note: 'Recall is measured against sampled source rows after deterministic first-character typos; it is not total fuzzy-match recall.',
      indexes: indexes.map(index => ({ name: index.name, key: index.key, collation: index.collation || null })),
      results,
      comparison: {
        candidateRecallDelta: Number((results[1].sampledKnownRecordRecall - results[0].sampledKnownRecordRecall).toFixed(4)),
        docsExaminedRatioNgramToPrefix: results[0].totalDocsExamined
          ? Number((results[1].totalDocsExamined / results[0].totalDocsExamined).toFixed(3)) : null,
        executionTimeRatioNgramToPrefix: results[0].executionTimeMillis
          ? Number((results[1].executionTimeMillis / results[0].executionTimeMillis).toFixed(3)) : null
      }
    }, null, 2) + '\n');
  } finally {
    await mongoose.disconnect();
  }
main().catch(error => {
  process.stderr.write((error?.stack || String(error)) + '\n');
  process.exitCode = 1;
});
