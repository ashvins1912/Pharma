# Persisted medicine name n-gram index

This service can retrieve typo-tolerant catalogue candidates through a persisted
MongoDB inverted index instead of issuing many unanchored substring regex
clauses against MedicineMaster.

## Backfill

The script is dry-run by default:

```bash
MONGODB_URI='READ_ONLY_OR_STAGING_URI' npm --workspace services/medicine-master-service run index:medicine-ngrams
```

Apply only against a production-like staging snapshot first. Pause catalogue
publishing/imports for the initial backfill:

```bash
MONGODB_URI='STAGING_URI' npm --workspace services/medicine-master-service run index:medicine-ngrams -- --apply
```

The apply operation creates:
- `medicine_name_ngram_index`: one document per medicine with normalized
  name grams and archive state.
- A unique `medicineId` index.
- A multikey `grams + isArchived` lookup index.
- `medicine_name_ngram_index_state` state document with `BUILDING`, `READY`,
  or `FAILED` status.

Do not run the initial apply while catalogue imports are publishing. The state
is marked `READY` only after the full backfill completes.

## Enable retrieval

After verifying index counts and query plans in staging, set:

```bash
MEDICINE_NGRAM_INDEX_ENABLED=true
```

The application uses the persisted index only when the feature flag is enabled
and state `brandName-v1` is `READY`. Otherwise it retains the previous
substring-regex fallback. When enabled, catalogue publishing marks the index
`SYNCING`, updates affected medicine index documents, and returns it to
`READY`; readers use the fallback while synchronization is in progress.

## Safety and operations

- The index discovers candidates only. Existing clinical scoring, conflict
  checks, ambiguity handling, and manual-review safeguards remain unchanged.
- A failed sync leaves the index unavailable to readers until repaired.
- The initial backfill is not transactional; pause catalogue writes and rerun
  the backfill after any interrupted/failed attempt.
- Compare `explain('executionStats')`, documents examined, keys examined,
  latency, recall, and candidate caps against the PR #214 benchmark.
