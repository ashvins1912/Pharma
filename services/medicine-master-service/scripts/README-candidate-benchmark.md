# Medicine candidate retrieval benchmark

A **read-only** benchmark comparing the previous two-character prefix query
with the character n-gram substring query against a real MedicineMaster MongoDB
catalogue.

## Run from repository root

```bash
MONGODB_URI='your-read-only-mongodb-connection-string' \
  npm --workspace services/medicine-master-service run benchmark:candidates
```

Optional: `MEDICINE_MASTER_COLLECTION` (default `medicinemasters`) and
`BENCHMARK_SAMPLE_SIZE` (default 100, clamped to 10–500).

Use a read-only MongoDB user and production-like staging snapshot. The script
uses `aggregate($sample)`, `find`, `listIndexes`, and
`explain('executionStats')`; it performs no writes or index builds.

## Metrics

- `sampledKnownRecordRecall`: fraction of sampled source rows recovered after a
  deterministic first-character typo. This specifically probes prefix matching's
  known weakness; it is not overall fuzzy-match recall.
- `totalDocsExamined`, `totalKeysExamined`, `executionTimeMillis`: winning
  MongoDB plan statistics.
- `wallTimeMs`: separately timed query execution.
- `winningStages` and `indexes`: help identify collection scans and index use.
- `returnedCandidates` and `candidateLimitReached`: expose overly broad scans.

## Interpretation

The MedicineMaster schema currently defines a text index and a case-insensitive
collation index on `brandName`. An unanchored case-insensitive regular expression
is generally not served efficiently by a normal B-tree index. Do not assume the
n-gram query is faster; inspect explain output on representative data. If it
causes high document examination or latency, prefer a persisted normalized
n-gram inverted collection or Atlas Search index with a versioned backfill and
parity tests over adding more regex clauses.

The benchmark does not change clinical scoring thresholds or merge policy.
