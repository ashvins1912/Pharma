# Prescription → Medicine Request → Order Flow

**Verified against main:** 2026-10-07

## Business outcome

A customer can:
1. enter one or more medicines manually,
2. attach a prescription,
3. use either/manual + prescription together,
4. see extracted medicine name, strength, dose, frequency, duration/course,
5. wait for automatic or pharmacist verification,
6. receive a pharmacy proposal,
7. approve the proposal,
8. convert to an Order,
9. have the final Order re-verified against every included medicine before fulfillment.

## Authoritative flow

```
Customer
  |
  +--> Manual medicine entries (optional when prescription exists)
  |
  +--> Prescription upload
          |
          v
   Python Prescription Service
          |
          +--> encrypted document
          +--> durable processing_jobs
          +--> OCR/PDF preprocessing
          +--> NLP/text extraction
          +--> dose/frequency/duration/course parsing
          |
          +--> high confidence --> AUTO_APPROVED --> APPROVED
          |
          +--> low confidence --> REVIEW_REQUIRED
                                   |
                                   +--> pharmacist
                                        APPROVE / REJECT / WAIT
          |
          v
   MedicineRequest.prescriptionVerification
          |
          v
   Pharmacist Proposal
          |
          v
   Customer Approval
          |
          v
   Order creation
          |
          v
   Order-level prescription verification
   against ALL included order medicines
          |
          +--> MATCHED --> prescription fulfillment gate APPROVED
          |
          +--> PROCESSING/REVIEW/PARTIAL --> PENDING_REVIEW
          |
          +--> MISMATCH/REJECTED/INACTIVE --> blocked
          |
          v
   Order fulfillment
```

## Medicine extraction contract

Each extracted medicine may contain:

- rawName
- normalizedName
- strength
- dose
- route
- frequency
- duration
- course
- instructions
- confidence
- validation state

Important: dosage is not the same as total course quantity.

Example:

`1 tablet TDS for 5 days`

means:

- dose = 1 tablet
- frequency = 3/day
- duration = 5 days
- calculated course quantity = 15

An explicit `Qty 15 tablets` is treated as an explicit course quantity.

## Order verification rule

For every included Order item:
1. exact productId match is preferred when a real catalog match exists,
2. otherwise medicine name/strength matching is used,
3. requested quantity cannot exceed an explicit/calculated prescribed quantity,
4. every included item must match,
5. any mismatch blocks fulfillment.

The browser cannot mark a prescription as verified.

## Prescription replacement

A customer may replace the prescription while the Medicine Request is still active.

Replacement:
- keeps the same prescriptionId,
- increments documentVersion/version,
- invalidates old extraction/review,
- cancels active processing jobs,
- creates a new durable processing job,
- sets verification back to PROCESSING,
- requires the new document to be approved/matched again.

An order cannot become fulfillment-ready from an old prescription result.

## Failure behavior

Infrastructure failure:
- never means APPROVED,
- becomes FAILED/RETRY/DEAD_LETTER,
- does not unblock fulfillment.

Inventory reservation expiry while waiting:
- reservation is released,
- after prescription MATCHED the existing fulfillment path can re-reserve idempotently.

Cancellation or prescription INACTIVE state wins over late approval.

## Current implementation limitations

1. Python extraction reports extracted text; true catalog identity matching is still an Order-side responsibility.
2. Medicine Request conversion still uses the legacy backend Order creation path; standalone Order Service migration is not complete.
3. Legacy Node Prescription implementation still exists and should not be extended.
4. Prescription document is currently stored in compatibility storage as well as Python's encrypted store.
5. Root Render deployment remains the compatibility/single-service blueprint. The standalone Python API/worker and Order Service need real deployed smoke validation.

## Production verification checklist

- [ ] Python Prescription API healthy
- [ ] Python Prescription worker running
- [ ] OCR against real PDF/image succeeds
- [ ] structured extraction response validates
- [ ] REVIEW_REQUIRED card appears
- [ ] pharmacist approve/reject/wait works
- [ ] customer can replace prescription
- [ ] old extraction cannot unblock order
- [ ] manual + extracted medicines coexist
- [ ] all Order medicines checked
- [ ] quantity/course mismatch blocks fulfillment
- [ ] cancellation/removal race tests pass
- [ ] Order reconciliation worker promotes only MATCHED prescriptions
- [ ] Render web + worker deployment tested
