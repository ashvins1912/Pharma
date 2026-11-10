# Shared medicine master catalogue import

The Inventory Service supports a platform-admin-only JSON enrichment workflow for the three reviewed source formats, including the 50,000-record Medicines Part 1 clinical metadata dataset. This is separate from the tenant/branch staged stock workbook import.

## API

All endpoints are routed through API Gateway and require a platform administrator:

- POST /api/v1/inventory/catalogue/imports/preview — multipart upload using field jsonFile; optional dataset is INDIAN_MEDICINE_DATA or INDIA_MEDICINES_INFO. The service can auto-detect either structure.
- POST /api/v1/inventory/catalogue/imports/merge — combine 2–10 unapproved READY batches into one new staged MULTI_SOURCE batch.
- GET /api/v1/inventory/catalogue/imports/:batchId — inspect staged batch status and reconciliation report.
- POST /api/v1/inventory/catalogue/imports/:batchId/publish — explicitly publish the staged records.
- POST /api/v1/inventory/catalogue/imports/:batchId/approve — record explicit platform-admin approval against the exact report fingerprint before publishing.
- PATCH /api/v1/inventory/catalogue/medicines/:medicineId — update allowlisted shared master fields; super-admin only, with before/after audit history.
- GET /api/v1/inventory/catalogue/medicines/:medicineId/audit — inspect manual update history; super-admin only.
- GET /api/v1/inventory/catalogue/medicines?search=&page=1&limit=20 — search the shared master catalogue.
- GET /api/v1/inventory/catalogue/medicines/:medicineId — fetch full medicine master details.

Uploads are limited to 110 MiB and 60,000 records. Large imports are stored as 500-record staging chunks so a batch never approaches MongoDB's 16 MiB document limit. Preview never writes live medicine master records. Re-uploading the same dataset file is idempotent and returns its existing batch.

## Preview performance and validation

- Source-field aliases are normalized once per source object and cached in a `WeakMap`; repeat field reads do not rebuild the alias index.
- Duplicate detection and list/alternative cleanup use `Map` and `Set` keyed by normalized identities, avoiding repeated linear scans through already-seen values.
- The request passes source rows directly to normalization instead of allocating a shallow copy of every row.
- Exact medicine-ID/canonical-key reconciliation is separated from case-insensitive brand-name matching. Brand-name matching uses a collation-aware index rather than applying `$toLower` to every stored catalogue row.
- These changes reduce avoidable CPU and database work; they do not make incomplete source data clinically complete. Scores measure field completeness, not factual accuracy or safety.

## Normalization and matching

- INDIAN_MEDICINE_DATA reads drugDetails and preserves brandIdentifier exactly as medicineId. It maps generic/product/manufacturer identifiers, ingredients, dosage form, routes, alternatives, indications, contraindications and interaction metadata.
- INDIA_MEDICINES_INFO reads the top-level array. It uses Medicine Name as the primary display name, strips retail MRP/price suffixes from the scraped product label, extracts only recognized dosage-form terms, and keeps the original medicine type separately.
- MEDICINES_PART_1 preserves its source ID as a MEDINFO-* medicine ID and captures up to 42 side effects, five uses and five suggested alternatives, plus chemical class, habit-forming flag, therapeutic class and action class. Exact duplicate payloads are collapsed while all source IDs are retained. Same-name rows with conflicting clinical details are kept separate and excluded from name-only reconciliation.
- Duplicate retail rows are consolidated by normalized name + composition + strength + dosage form. The structured source is deduplicated by its stable brand identifier so distinct source IDs are not silently collapsed.
- Cross-dataset reconciliation uses exact normalized canonical identity when composition is available. For MEDICINES_PART_1, a case-insensitive exact brand-name match is allowed only when the name is unique in both the incoming dataset and the existing master. Ambiguous name matches are never merged.
- Missing values are enriched without replacing better existing data. Structured source priority is higher than retail scrape priority.
- The source-2 prescription flag is stored as unverified metadata. Image URLs are stored only as untrusted source references and are never promoted to a served product image.

## Data boundaries

This workflow writes only the shared MedicineMaster collection in the Inventory database. It does not create tenant products or update tenant-specific selling prices, cost prices, discounts, branch stock, batches, MRP, expiry dates or manufacturing dates. It does not infer regulatory approval, clinical safety, missing contraindications or missing drug interactions.

The master record retains source datasets, all source record IDs (including IDs folded during exact duplicate cleanup), import batch, data quality state, clinical verification state and source-license verification state. The new 50,000-record source does not supply composition or manufacturer, so those fields remain blank unless another trusted source already provides them. Source licensing/provenance must be cleared before commercial redistribution or customer-facing use. Catalogue consumers should continue to treat unverified clinical/regulatory fields as informational until checked against authoritative sources.

### Combining already-staged uploads

The Medicine Master Catalogue batch history supports selecting 2–10 unapproved batches in READY state and creating one combined staged batch. The source batches are marked SUPERSEDED only after the combined batch and its chunks have been stored successfully; superseded source batches cannot be published independently. The combined batch receives a new report fingerprint and must be reviewed, approved and published separately.

The combine operation:
- Deduplicates exact canonical identities and exact identifiers where the canonical identity is unavailable.
- Uses the confidence-gated fuzzy matcher to combine high-confidence records across selected batches.
- Enriches missing descriptive and clinical metadata, deduplicates arrays, and retains all source dataset names, source record IDs and legacy medicine IDs.
- Preserves the highest-priority source for conflicting scalar fields.
- Lists ambiguous fuzzy matches for review and blocks approval if the same source medicine identifier carries conflicting composition, strength or dosage form.
- Does not alter tenant or branch inventory data.

Only batches in READY state that have not yet been approved can be combined. Select the combined batch's **Review** action in the batch history to inspect its analytics, approve the exact report and publish it.

## Intelligent multi-batch reconciliation

Every later upload is reconciled against the already-published shared Medicine Master catalogue, so independently uploaded source datasets can enrich the same canonical medicine record instead of creating a second record when the identity is sufficiently clear.

The matcher uses a hybrid record-linkage score implemented in the Node inventory service (no runtime Python dependency): token-sort edit similarity, character 3-gram Dice similarity, corpus-weighted TF-IDF character n-gram cosine similarity for brand names, and weighted field-agreement evidence for composition, generic name, strength and dosage form. Exact medicine IDs and exact canonical keys take precedence. The field weights are conservative Fellegi-Sunter-inspired heuristics, not trained Fellegi-Sunter m/u probabilities; they must be calibrated on adjudicated match/non-match pairs before being described as a trained probabilistic model.

- **Automatic fuzzy merge:** only when both records provide comparable composition, composition similarity is at least 96, hybrid brand-name similarity is at least 94, the weighted evidence score is at least 97, and both strength and dosage form are present and compatible, and any available generic names agree sufficiently.
- **Manual review candidate:** plausible name match but insufficient evidence for a safe automatic merge; missing or disagreeing generic names also require review. These records are not automatically merged.
- **Blocked conflict:** differing known composition, strength or dosage form prevents fuzzy auto-merge.
- **New record:** no sufficiently similar existing record is found.

The report includes fuzzy auto-merge count, manual-review count, unmatched count, candidate medicine ID, score and warnings. Candidate search currently uses normalized two-character brand-name prefixes to shortlist up to 5,000 existing candidates before TF-IDF/n-gram scoring; it is bounded to 120 prefixes. It remains non-exhaustive for typos in the first two characters, and the report marks when either cap is reached. A truncated or prefix-limited scan is not proof that no duplicate exists.

For an automatic merge, existing master medicine ID is preserved; the incoming medicine ID is retained as a legacy ID and source provenance is accumulated. Empty descriptive fields are enriched and list metadata is deduplicated. Source priority remains in force for conflicting scalar values. Clinical verification, prescription verification and licence status are never promoted by matching or merging. Tenant prices, stock, branch batches, MRP and expiry are outside this workflow.

## Review, approval and published catalogue management

1. Upload a dataset and inspect the reconciliation report. It is staged and does not change live catalogue records.
2. Review new-record and update-candidate counts, duplicate removals, rejected rows, quality gaps and source warnings.
3. Confirm the report in the UI. The approval request includes a server-generated fingerprint; publishing is rejected unless approval matches the exact stored report.
4. Publish explicitly. The publish operation applies staged records to the shared master catalogue; tenant pricing, branch stock, batches and expiry remain separate.
5. Use the dedicated **Medicine Master Catalogue** workspace to search and inspect published records. Manual updates are limited to approved metadata fields and record before/after values, actor and timestamp in an audit collection.

Manual editing does not verify clinical facts. Immutable medicine identifiers, source provenance, regulatory verification flags, tenant pricing and branch inventory are not editable from this screen.
