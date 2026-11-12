#!/usr/bin/env node
/**
 * Backfill the persisted medicine name n-gram index.
 * Dry-run by default. Pass --apply to write index documents.
 * Pause catalogue publishing/imports while applying the initial backfill.
 */
import mongoose from 'mongoose';
import { CharacterNgramCandidateIndex } from '@pharma/algorithm-kernel';

const MASTER_COLLECTION = process.env.MEDICINE_MASTER_COLLECTION || 'medicinemasters';
const INDEX_COLLECTION = 'medicine_name_ngram_index';
const STATE_COLLECTION = 'medicine_name_ngram_index_state';
const BATCH_SIZE = Math.max(100, Math.min(2000, Number(process.env.NGRAM_INDEX_BATCH_SIZE) || 500));
const APPLY = process.argv.includes('--apply');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  const masters = db.collection(MASTER_COLLECTION);
  const index = db.collection(INDEX_COLLECTION);
  const state = db.collection(STATE_COLLECTION);
  try {
    const total = await masters.countDocuments({ medicineId: { $type: 'string' }, brandName: { $type: 'string' } });
    if (!APPLY) {
      process.stdout.write(JSON.stringify({
        mode: 'dry-run',
        readOnly: true,
        masterCollection: MASTER_COLLECTION,
        indexCollection: INDEX_COLLECTION,
        recordsToIndex: total,
        batchSize: BATCH_SIZE,
        applyCommand: 'npm --workspace services/medicine-master-service run index:medicine-ngrams -- --apply'
      }, null, 2) + '\n');
      return;
    }

    await state.updateOne(
      { _id: 'brandName-v1' },
      { $set: { status: 'BUILDING', version: 1, updatedAt: new Date() } },
      { upsert: true }
    );
    await index.createIndex({ medicineId: 1 }, { unique: true, name: 'medicine_id_unique' });
    await index.createIndex({ grams: 1, isArchived: 1 }, { name: 'grams_archived_lookup' });

    let operations = [];
    let indexedCount = 0;
    const flush = async () => {
      if (!operations.length) return;
      await index.bulkWrite(operations, { ordered: false });
      indexedCount += operations.length;
      operations = [];
      await state.updateOne(
        { _id: 'brandName-v1' },
        { $set: { indexedCount, updatedAt: new Date() } }
      );
    };

    const cursor = masters.find(
      { medicineId: { $type: 'string' }, brandName: { $type: 'string' } },
      { projection: { medicineId: 1, brandName: 1, isArchived: 1 } }
    ).batchSize(BATCH_SIZE);

    for await (const master of cursor) {
      operations.push({
        updateOne: {
          filter: { medicineId: master.medicineId },
          update: { $set: {
            grams: CharacterNgramCandidateIndex.searchTerms(master.brandName, { limit: 1000 }),
            isArchived: Boolean(master.isArchived)
          } },
          upsert: true
        }
      });
      if (operations.length >= BATCH_SIZE) await flush();
    }
    await flush();
    await state.updateOne(
      { _id: 'brandName-v1' },
      { $set: { status: 'READY', indexedCount, version: 1, updatedAt: new Date() } },
      { upsert: true }
    );
    process.stdout.write(JSON.stringify({
      mode: 'applied',
      readOnly: false,
      masterCollection: MASTER_COLLECTION,
      indexCollection: INDEX_COLLECTION,
      sourceRecords: total,
      indexedRecords: indexedCount,
      status: 'READY'
    }, null, 2) + '\n');
  } catch (error) {
    if (APPLY) {
      await state.updateOne(
        { _id: 'brandName-v1' },
        { $set: { status: 'FAILED', updatedAt: new Date() } },
        { upsert: true }
      ).catch(() => {});
    }
    throw error;
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(error => {
  process.stderr.write((error?.stack || String(error)) + '\n');
  process.exitCode = 1;
});
