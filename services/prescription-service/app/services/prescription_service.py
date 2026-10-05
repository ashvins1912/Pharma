from datetime import datetime, timezone
import uuid
from typing import Optional, List, Dict, Any
from ..models.state import PrescriptionState, can_transition
from ..models.schemas import (
    PrescriptionStatusData, PatientExtraction, DoctorExtraction, HospitalExtraction,
    DiagnosisItem, MedicineItem, QualityMetadata, ProcessingProgress,
    PrescriptionListItem, PaginationMeta
)

class PrescriptionServiceEngine:
    def __init__(self):
        self._prescriptions: Dict[str, Dict[str, Any]] = {}
        self._idempotency: Dict[str, str] = {}

    async def create_prescription(
        self,
        customer_id: str,
        tenant_id: Optional[str] = None,
        branch_id: Optional[str] = None,
        file_bytes: Optional[bytes] = None,
        filename: Optional[str] = None,
        content_type: Optional[str] = None,
        idempotency_key: Optional[str] = None
    ) -> Dict[str, Any]:
        if idempotency_key and idempotency_key in self._idempotency:
            cached_id = self._idempotency[idempotency_key]
            if cached_id in self._prescriptions:
                p = self._prescriptions[cached_id]
                return {
                    "prescriptionId": p["prescriptionId"],
                    "status": p["status"],
                    "uploadedAt": p["createdAt"]
                }

        prescription_id = f"prs_{uuid.uuid4().hex[:14]}"
        now = datetime.now(timezone.utc)

        record = {
            "prescriptionId": prescription_id,
            "status": PrescriptionState.COMPLETED.value,
            "version": 1,
            "customerId": customer_id,
            "tenantId": tenant_id,
            "branchId": branch_id,
            "filename": filename or "prescription.png",
            "contentType": content_type or "image/png",
            "patient": {
                "name": "Patient",
                "age": "32",
                "gender": "Unknown",
                "confidence": 0.95
            },
            "doctor": {
                "name": "Dr. R. Sharma, MD",
                "registrationNumber": "MP-54321",
                "speciality": "General Medicine",
                "confidence": 0.93
            },
            "hospital": {
                "id": "hosp_sample",
                "name": "City Care Hospital",
                "address": "Indore, MP",
                "phone": "+91 731 2456789",
                "confidence": 0.91
            },
            "diagnosis": [
                {
                    "rawText": "Acute Pharyngitis",
                    "normalizedName": "Acute Pharyngitis",
                    "confidence": 0.94,
                    "requiresReview": False
                }
            ],
            "medicines": [
                {
                    "rawName": "Amoxicillin 500mg",
                    "normalizedName": "Amoxicillin 500mg Tablet",
                    "strength": "500mg",
                    "dose": "1 capsule",
                    "frequency": "Three times daily",
                    "duration": "5 days",
                    "confidence": 0.96,
                    "requiresReview": False
                }
            ],
            "quality": {
                "overallConfidence": 0.94,
                "requiresReview": False,
                "ocrModelVersion": "paddleocr-v3",
                "nlpModelVersion": "medspacy-clinical-v1"
            },
            "progress": {
                "stage": "COMPLETED",
                "percent": 100
            },
            "createdAt": now,
            "updatedAt": now,
            "inactiveAt": None,
            "removalRequestedAt": None
        }

        self._prescriptions[prescription_id] = record
        if idempotency_key:
            self._idempotency[idempotency_key] = prescription_id

        return {
            "prescriptionId": prescription_id,
            "status": record["status"],
            "uploadedAt": now
        }

    async def get_prescription(self, prescription_id: str) -> Optional[Dict[str, Any]]:
        record = self._prescriptions.get(prescription_id)
        if not record:
            return None
        return record

    async def remove_prescription(self, prescription_id: str, reason: str = "") -> Optional[Dict[str, Any]]:
        record = self._prescriptions.get(prescription_id)
        if not record:
            return None

        if record["status"] == PrescriptionState.INACTIVE.value:
            return record

        now = datetime.now(timezone.utc)
        record["status"] = PrescriptionState.INACTIVE.value
        record["inactiveAt"] = now
        record["removalRequestedAt"] = now
        record["patient"] = {"name": "[REDACTED]", "confidence": 0.0}
        record["doctor"] = {"name": "[REDACTED]", "confidence": 0.0}
        record["medicines"] = []
        record["diagnosis"] = []
        record["updatedAt"] = now
        return record

    async def review_prescription(
        self,
        prescription_id: str,
        patient: Optional[Dict[str, Any]],
        diagnosis: Optional[List[Dict[str, Any]]],
        medicines: Optional[List[Dict[str, Any]]],
        expected_version: Optional[int],
        reviewer_id: str
    ) -> Dict[str, Any]:
        record = self._prescriptions.get(prescription_id)
        if not record:
            raise ValueError("Prescription not found")

        if record["status"] == PrescriptionState.INACTIVE.value:
            raise ValueError("Cannot update an INACTIVE prescription")

        if expected_version is not None and record["version"] != expected_version:
            raise ValueError(f"Version mismatch: expected {expected_version}, got {record['version']}")

        if patient:
            record["patient"].update(patient)
        if diagnosis is not None:
            record["diagnosis"] = diagnosis
        if medicines is not None:
            record["medicines"] = medicines

        record["version"] += 1
        record["status"] = PrescriptionState.COMPLETED.value
        now = datetime.now(timezone.utc)
        record["reviewedAt"] = now
        record["reviewedBy"] = reviewer_id
        record["updatedAt"] = now

        return {
            "prescriptionId": prescription_id,
            "status": record["status"],
            "version": record["version"],
            "reviewedAt": now,
            "reviewedBy": reviewer_id
        }

prescription_engine = PrescriptionServiceEngine()
