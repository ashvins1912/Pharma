# Shared medicine master catalogue import

The Inventory Service supports a platform-admin-only JSON enrichment workflow for the three reviewed source formats, including the 50,000-record Medicines Part 1 clinical metadata dataset. This is separate from the tenant/branch staged stock workbook import.

## API

All endpoints are routed through API Gateway and require a platform administrator:

- POST /api/v1/inventory/catalogue/imports/preview — multipart upload using field jsonFile; optional dataset is INDIAN_MEDICINE_DATA or INDIA_MEDICINES_INFO. The service can auto-detect either structure.
- GET /api/v1/inventory/catalogue/imports/:batchId — inspect staged batch status and reconciliation report.
- POST /api/v1/inventory/catalogue/imports/:batchId/publish — explicitly publish the staged records.
- GET /api/v1/inventory/catalogue/medicines?search=&page=1&limit=20 — search the shared master catalogue.
- GET /api/v1/inventory/catalogue/medicines/:medicineId — fetch full medicine master details.

Uploads are limited to 110 MiB and 60,000 records. Large imports are stored as 500-record staging chunks so a batch never approaches MongoDB's 16 MiB document limit. Preview never writes live medicine master records. Re-uploading the same dataset file is idempotent and returns its existing batch.

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
