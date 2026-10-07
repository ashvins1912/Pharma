"""Durable MongoDB-backed Prescription Service Engine."""
from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from ..config import settings
from ..db import get_db
from ..models.state import PrescriptionState, can_transition
from ..security.encryption import crypto
from ..integration.registry import integration_registry
from .pipeline import process_prescription_bytes, ProcessingError

logger = logging.getLogger(__name__)

AUDIT_ACTIONS = {
    "PRESCRIPTION_UPLOADED",
    "PRESCRIPTION_PROCESSING_STARTED",
    "PRESCRIPTION_PROCESSING_FAILED",
    "PRESCRIPTION_REVIEW_REQUIRED",
    "PRESCRIPTION_REVIEW_OPENED",
    "PRESCRIPTION_REVIEW_LEASED",
    "PRESCRIPTION_REVIEW_LEASE_EXPIRED",
    "PRESCRIPTION_APPROVED",
    "PRESCRIPTION_REJECTED",
    "PRESCRIPTION_REPROCESS_REQUESTED",
    "PRESCRIPTION_REMOVAL_REQUESTED",
    "PRESCRIPTION_REMOVED",
}

def _now():
    return datetime.now(timezone.utc)

def _mask_puid(puid: Optional[str]) -> Optional[str]:
    if not puid:
        return None
    return f"PUID-••••{puid[-4:]}" if len(puid) >= 4 else "PUID-••••"

class PrescriptionServiceEngine:
    async def create_prescription(
        self,
        *,
        customer_id: str,
        tenant_id: Optional[str],
        branch_id: Optional[str],
        user_id: str,
        file_bytes: Optional[bytes],
        filename: Optional[str],
        content_type: Optional[str],
        idempotency_key: Optional[str] = None,
        order_id: Optional[str] = None,
        patient_puid: Optional[str] = None,
        correlation_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        db = get_db()
        if idempotency_key:
            existing = await db.idempotency_keys.find_one({"key": f"rx-upload:{tenant_id}:{idempotency_key}"})
            if existing:
                cached = await db.prescriptions.find_one({"prescriptionId": existing["prescriptionId"]})
                if cached:
                    return {
                        "prescriptionId": cached["prescriptionId"],
                        "status": cached["status"],
                        "uploadedAt": cached["createdAt"],
                    }

        if not file_bytes:
            raise ValueError("file is required")
        if len(file_bytes) > settings.MAX_FILE_SIZE_BYTES:
            raise ValueError("file too large")

        prescription_id = f"prs_{uuid.uuid4().hex[:14]}"
        job_id = f"job_{uuid.uuid4().hex[:14]}"
        now = _now()
        encrypted = crypto.encrypt(file_bytes)

        doc = {
            "prescriptionId": prescription_id,
            "tenantId": tenant_id,
            "branchId": branch_id,
            "customerId": customer_id,
            "createdBy": user_id,
            "updatedBy": user_id,
            "orderId": order_id,
            "patientPuid": patient_puid,
            "status": PrescriptionState.QUEUED.value,
            "version": 1,
            "filename": filename or "prescription.bin",
            "contentType": content_type or "application/octet-stream",
            "documentCiphertext": encrypted,
            "documentSha256": hashlib.sha256(file_bytes).hexdigest(),
            "extraction": {
                "overallConfidence": None,
                "reviewRequired": True,
                "medicines": [],
                "patientName": None,
                "ocrVersion": None,
                "nlpVersion": None,
            },
            "createdAt": now,
            "updatedAt": now,
            "inactiveAt": None,
        }
        job = {
            "jobId": job_id,
            "prescription_id": prescription_id,
            "tenant_id": tenant_id,
            "status": "QUEUED",
            "attempt_count": 0,
            "locked_by": None,
            "locked_until": None,
            "next_attempt_at": now,
            "priority": 100,
            "last_error_code": None,
            "last_error_message": None,
            "created_at": now,
            "updated_at": now,
        }

        await db.prescriptions.insert_one(doc)
        await db.processing_jobs.insert_one(job)
        if idempotency_key:
            await db.idempotency_keys.insert_one({
                "key": f"rx-upload:{tenant_id}:{idempotency_key}",
                "prescriptionId": prescription_id,
                "expires_at": now + timedelta(seconds=settings.IDEMPOTENCY_EXPIRES_SECONDS),
            })

        await self._audit("PRESCRIPTION_UPLOADED", prescription_id, tenant_id, user_id, {"orderId": order_id})
        adapter = await integration_registry.resolve_adapter(tenant_id, branch_id, "PrescriptionUploaded")
        await adapter.publish({
            "eventType": "PrescriptionUploaded",
            "aggregateType": "Prescription",
            "aggregateId": prescription_id,
            "tenantId": tenant_id,
            "branchId": branch_id,
            "correlationId": correlation_id,
            "aggregateVersion": 1,
            "payload": {"prescriptionId": prescription_id, "orderId": order_id, "status": doc["status"]},
        })

        # Transition UPLOADED semantics already represented as QUEUED insert
        return {
            "prescriptionId": prescription_id,
            "status": doc["status"],
            "uploadedAt": now,
        }

    async def get_prescription(
        self,
        prescription_id: str,
        *,
        requesting_user_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
        branch_id: Optional[str] = None,
        is_admin: bool = False,
        include_sensitive: bool = False,
    ) -> Optional[Dict[str, Any]]:
        db = get_db()
        record = await db.prescriptions.find_one({"prescriptionId": prescription_id}, {"documentCiphertext": 0})
        if not record:
            return None
        if record["status"] == PrescriptionState.INACTIVE.value and not include_sensitive:
            return None

        if not is_admin:
            if requesting_user_id and record.get("customerId") != requesting_user_id and record.get("createdBy") != requesting_user_id:
                raise PermissionError("Prescription access denied")
            if tenant_id and record.get("tenantId") and record.get("tenantId") != tenant_id:
                raise PermissionError("Tenant access denied")
            if branch_id and record.get("branchId") and record.get("branchId") != branch_id:
                raise PermissionError("Branch access denied")

        record.pop("_id", None)
        record["patientPuidMasked"] = _mask_puid(record.get("patientPuid"))
        return record

    async def claim_job(self, worker_id: str) -> Optional[Dict[str, Any]]:
        db = get_db()
        now = _now()
        lease = now + timedelta(seconds=settings.PROCESSING_LEASE_SECONDS)
        job = await db.processing_jobs.find_one_and_update(
            {
                "status": {"$in": ["QUEUED", "RETRY"]},
                "next_attempt_at": {"$lte": now},
                "$or": [{"locked_until": None}, {"locked_until": {"$lte": now}}],
            },
            {
                "$set": {
                    "status": "PROCESSING",
                    "locked_by": worker_id,
                    "locked_until": lease,
                    "updated_at": now,
                },
                "$inc": {"attempt_count": 1},
            },
            sort=[("priority", 1), ("next_attempt_at", 1)],
            return_document=True,
        )
        return job

    async def process_job(self, job: Dict[str, Any], worker_id: str) -> None:
        db = get_db()
        prescription_id = job["prescription_id"]
        rx = await db.prescriptions.find_one({"prescriptionId": prescription_id})
        if not rx:
            await db.processing_jobs.update_one({"jobId": job["jobId"]}, {"$set": {"status": "DEAD_LETTER", "last_error_code": "RX_MISSING"}})
            return
        if rx["status"] == PrescriptionState.INACTIVE.value:
            await db.processing_jobs.update_one({"jobId": job["jobId"]}, {"$set": {"status": "CANCELLED", "updated_at": _now()}})
            return
        if not can_transition(rx["status"], PrescriptionState.PROCESSING.value) and rx["status"] != PrescriptionState.PROCESSING.value:
            # Allow re-entry from QUEUED only
            if rx["status"] not in (PrescriptionState.QUEUED.value, PrescriptionState.FAILED.value, PrescriptionState.REVIEW_REQUIRED.value):
                await db.processing_jobs.update_one({"jobId": job["jobId"]}, {"$set": {"status": "COMPLETED", "updated_at": _now()}})
                return

        now = _now()
        await db.prescriptions.update_one(
            {"prescriptionId": prescription_id, "status": {"$ne": PrescriptionState.INACTIVE.value}},
            {"$set": {"status": PrescriptionState.PROCESSING.value, "updatedAt": now}},
        )
        await self._audit("PRESCRIPTION_PROCESSING_STARTED", prescription_id, rx.get("tenantId"), worker_id, {})

        try:
            plaintext = crypto.decrypt(rx["documentCiphertext"])
            result = process_prescription_bytes(plaintext, rx.get("contentType") or "image/png")
        except ProcessingError as exc:
            await self._fail_job(job, rx, exc.code, exc.message, worker_id)
            return
        except Exception as exc:
            await self._fail_job(job, rx, "PROCESSING_ERROR", str(exc), worker_id)
            return

        extraction = {
            "overallConfidence": result.overall_confidence,
            "reviewRequired": result.requires_review,
            "medicines": result.medicines,
            "patientName": result.patient_name,
            "ocrVersion": result.ocr_version,
            "nlpVersion": result.nlp_version,
            "rawTextPreview": (result.raw_text or "")[:500],
        }

        if result.requires_review or result.overall_confidence < settings.OVERALL_AUTO_APPROVE_THRESHOLD:
            new_status = PrescriptionState.REVIEW_REQUIRED.value
            await db.prescriptions.update_one(
                {"prescriptionId": prescription_id, "status": PrescriptionState.PROCESSING.value},
                {
                    "$set": {
                        "status": new_status,
                        "extraction": extraction,
                        "updatedAt": _now(),
                    },
                    "$inc": {"version": 1},
                },
            )
            review_id = f"rev_{uuid.uuid4().hex[:12]}"
            await db.prescription_reviews.update_one(
                {"prescription_id": prescription_id, "status": {"$in": ["PENDING", "IN_REVIEW"]}},
                {
                    "$setOnInsert": {
                        "reviewId": review_id,
                        "prescription_id": prescription_id,
                        "order_id": rx.get("orderId"),
                        "patient_puid": rx.get("patientPuid"),
                        "tenant_id": rx.get("tenantId"),
                        "branch_id": rx.get("branchId"),
                        "status": "PENDING",
                        "reason_code": "LOW_CONFIDENCE",
                        "claimed_by": None,
                        "claimed_at": None,
                        "lease_until": None,
                        "version": 1,
                        "created_at": _now(),
                        "updated_at": _now(),
                        "completed_at": None,
                    }
                },
                upsert=True,
            )
            await self._audit("PRESCRIPTION_REVIEW_REQUIRED", prescription_id, rx.get("tenantId"), worker_id, {"reason": "LOW_CONFIDENCE"})
            adapter = await integration_registry.resolve_adapter(rx.get("tenantId"), rx.get("branchId"), "PrescriptionReviewRequired")
            await adapter.publish({
                "eventType": "PrescriptionReviewRequired",
                "aggregateType": "Prescription",
                "aggregateId": prescription_id,
                "tenantId": rx.get("tenantId"),
                "branchId": rx.get("branchId"),
                "aggregateVersion": rx.get("version", 1) + 1,
                "payload": {"prescriptionId": prescription_id, "orderId": rx.get("orderId"), "reasonCode": "LOW_CONFIDENCE"},
            })
        else:
            # AUTO_APPROVED then APPROVED — never skip on infrastructure success only
            for status in (PrescriptionState.AUTO_APPROVED.value, PrescriptionState.APPROVED.value):
                await db.prescriptions.update_one(
                    {"prescriptionId": prescription_id},
                    {
                        "$set": {
                            "status": status,
                            "extraction": extraction,
                            "updatedAt": _now(),
                        },
                        "$inc": {"version": 1},
                    },
                )
            await self._audit("PRESCRIPTION_APPROVED", prescription_id, rx.get("tenantId"), worker_id, {"mode": "AUTO"})
            adapter = await integration_registry.resolve_adapter(rx.get("tenantId"), rx.get("branchId"), "PrescriptionApproved")
            await adapter.publish({
                "eventType": "PrescriptionApproved",
                "aggregateType": "Prescription",
                "aggregateId": prescription_id,
                "tenantId": rx.get("tenantId"),
                "branchId": rx.get("branchId"),
                "aggregateVersion": rx.get("version", 1) + 2,
                "payload": {"prescriptionId": prescription_id, "orderId": rx.get("orderId"), "mode": "AUTO"},
            })

        await db.processing_jobs.update_one(
            {"jobId": job["jobId"]},
            {"$set": {"status": "COMPLETED", "locked_until": None, "locked_by": None, "updated_at": _now()}},
        )
        adapter = await integration_registry.resolve_adapter(rx.get("tenantId"), rx.get("branchId"), "PrescriptionProcessingCompleted")
        await adapter.publish({
            "eventType": "PrescriptionProcessingCompleted",
            "aggregateType": "Prescription",
            "aggregateId": prescription_id,
            "tenantId": rx.get("tenantId"),
            "branchId": rx.get("branchId"),
            "aggregateVersion": rx.get("version", 1) + 1,
            "payload": {"prescriptionId": prescription_id, "requiresReview": result.requires_review},
        })

    async def _fail_job(self, job, rx, code, message, worker_id):
        db = get_db()
        attempt = job.get("attempt_count", 1)
        max_attempts = settings.PRESCRIPTION_MAX_RETRIES
        now = _now()
        await self._audit("PRESCRIPTION_PROCESSING_FAILED", rx["prescriptionId"], rx.get("tenantId"), worker_id, {"code": code})
        if attempt >= max_attempts:
            status = "DEAD_LETTER"
            rx_status = PrescriptionState.FAILED.value
            next_at = now
        else:
            status = "RETRY"
            rx_status = PrescriptionState.FAILED.value
            next_at = now + timedelta(seconds=min(3600, 2 ** attempt * 5))
        await db.processing_jobs.update_one(
            {"jobId": job["jobId"]},
            {
                "$set": {
                    "status": status,
                    "last_error_code": code,
                    "last_error_message": str(message)[:2000],
                    "next_attempt_at": next_at,
                    "locked_until": None,
                    "locked_by": None,
                    "updated_at": now,
                }
            },
        )
        if can_transition(PrescriptionState.PROCESSING.value, rx_status) or rx.get("status") == PrescriptionState.PROCESSING.value:
            await db.prescriptions.update_one(
                {"prescriptionId": rx["prescriptionId"], "status": {"$ne": PrescriptionState.INACTIVE.value}},
                {"$set": {"status": rx_status, "updatedAt": now}},
            )

    async def list_review_queue(self, tenant_id: str, branch_id: Optional[str] = None) -> List[Dict[str, Any]]:
        db = get_db()
        query: Dict[str, Any] = {"status": "PENDING", "tenant_id": tenant_id}
        if branch_id:
            query["branch_id"] = branch_id
        # Expire leases
        now = _now()
        await db.prescription_reviews.update_many(
            {"status": "IN_REVIEW", "lease_until": {"$lte": now}},
            {"$set": {"status": "PENDING", "claimed_by": None, "claimed_at": None, "lease_until": None, "updated_at": now}},
        )
        cursor = db.prescription_reviews.find({"$or": [query, {**query, "status": "IN_REVIEW"}]}).sort("created_at", 1).limit(100)
        items = []
        async for row in cursor:
            rx = await db.prescriptions.find_one({"prescriptionId": row["prescription_id"], "status": PrescriptionState.REVIEW_REQUIRED.value})
            if not rx:
                continue
            items.append({
                "reviewId": row["reviewId"],
                "prescriptionId": row["prescription_id"],
                "orderId": row.get("order_id"),
                "patientPuidMasked": _mask_puid(row.get("patient_puid")),
                "reasonCode": row.get("reason_code"),
                "status": row.get("status"),
                "version": row.get("version", 1),
            })
        return items

    async def claim_review(self, prescription_id: str, reviewer_id: str, expected_version: Optional[int] = None) -> Dict[str, Any]:
        db = get_db()
        now = _now()
        lease = now + timedelta(minutes=15)
        review = await db.prescription_reviews.find_one({"prescription_id": prescription_id, "status": {"$in": ["PENDING", "IN_REVIEW"]}})
        if not review:
            raise LookupError("Review not found")
        if expected_version is not None and review.get("version") != expected_version:
            raise RuntimeError("VERSION_CONFLICT")
        if review.get("status") == "IN_REVIEW" and review.get("claimed_by") and review.get("claimed_by") != reviewer_id and review.get("lease_until") and review["lease_until"] > now:
            raise RuntimeError("LEASE_HELD")
        updated = await db.prescription_reviews.find_one_and_update(
            {"reviewId": review["reviewId"], "version": review.get("version", 1)},
            {
                "$set": {
                    "status": "IN_REVIEW",
                    "claimed_by": reviewer_id,
                    "claimed_at": now,
                    "lease_until": lease,
                    "updated_at": now,
                },
                "$inc": {"version": 1},
            },
            return_document=True,
        )
        if not updated:
            raise RuntimeError("VERSION_CONFLICT")
        await self._audit("PRESCRIPTION_REVIEW_LEASED", prescription_id, review.get("tenant_id"), reviewer_id, {})
        return {"reviewId": updated["reviewId"], "version": updated["version"], "leaseUntil": lease}

    async def approve_review(
        self,
        prescription_id: str,
        reviewer_id: str,
        expected_version: int,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        return await self._complete_review(prescription_id, reviewer_id, expected_version, approve=True, reason=None, idempotency_key=idempotency_key)

    async def reject_review(
        self,
        prescription_id: str,
        reviewer_id: str,
        expected_version: int,
        reason: str,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not reason or not str(reason).strip():
            raise ValueError("Rejection reason is mandatory")
        return await self._complete_review(prescription_id, reviewer_id, expected_version, approve=False, reason=reason, idempotency_key=idempotency_key)

    async def wait_review(self, prescription_id: str, reviewer_id: str) -> Dict[str, Any]:
        db = get_db()
        now = _now()
        await db.prescription_reviews.update_one(
            {"prescription_id": prescription_id, "status": "IN_REVIEW", "claimed_by": reviewer_id},
            {"$set": {"status": "PENDING", "claimed_by": None, "claimed_at": None, "lease_until": None, "updated_at": now}},
        )
        rx = await db.prescriptions.find_one({"prescriptionId": prescription_id})
        return {
            "prescriptionId": prescription_id,
            "status": rx["status"] if rx else None,
            "reviewStatus": "PENDING",
        }

    async def _complete_review(self, prescription_id, reviewer_id, expected_version, approve, reason, idempotency_key):
        db = get_db()
        if idempotency_key:
            cached = await db.idempotency_keys.find_one({"key": f"rx-review:{prescription_id}:{idempotency_key}"})
            if cached:
                rx = await db.prescriptions.find_one({"prescriptionId": prescription_id}, {"documentCiphertext": 0})
                return {
                    "prescriptionId": prescription_id,
                    "status": rx["status"],
                    "version": rx["version"],
                    "replayed": True,
                }

        rx = await db.prescriptions.find_one({"prescriptionId": prescription_id})
        if not rx:
            raise LookupError("Prescription not found")
        if rx["status"] == PrescriptionState.INACTIVE.value:
            raise RuntimeError("INACTIVE")
        if rx.get("version") != expected_version:
            raise RuntimeError("VERSION_CONFLICT")
        target = PrescriptionState.APPROVED.value if approve else PrescriptionState.REJECTED.value
        if not can_transition(rx["status"], target):
            # Idempotent success if already in target
            if rx["status"] == target:
                return {"prescriptionId": prescription_id, "status": target, "version": rx["version"], "replayed": True}
            raise RuntimeError("INVALID_TRANSITION")

        now = _now()
        updated = await db.prescriptions.find_one_and_update(
            {"prescriptionId": prescription_id, "version": expected_version, "status": {"$ne": PrescriptionState.INACTIVE.value}},
            {
                "$set": {
                    "status": target,
                    "updatedAt": now,
                    "updatedBy": reviewer_id,
                    "reviewDecision": {"approved": approve, "reason": reason, "reviewedBy": reviewer_id, "reviewedAt": now},
                },
                "$inc": {"version": 1},
            },
            return_document=True,
        )
        if not updated:
            raise RuntimeError("VERSION_CONFLICT")

        await db.prescription_reviews.update_one(
            {"prescription_id": prescription_id, "status": {"$in": ["PENDING", "IN_REVIEW"]}},
            {"$set": {"status": "COMPLETED", "completed_at": now, "updated_at": now}},
        )
        action = "PRESCRIPTION_APPROVED" if approve else "PRESCRIPTION_REJECTED"
        await self._audit(action, prescription_id, rx.get("tenantId"), reviewer_id, {"reason": reason} if reason else {})
        event_type = "PrescriptionApproved" if approve else "PrescriptionRejected"
        adapter = await integration_registry.resolve_adapter(rx.get("tenantId"), rx.get("branchId"), event_type)
        await adapter.publish({
            "eventType": event_type,
            "aggregateType": "Prescription",
            "aggregateId": prescription_id,
            "tenantId": rx.get("tenantId"),
            "branchId": rx.get("branchId"),
            "aggregateVersion": updated["version"],
            "payload": {"prescriptionId": prescription_id, "orderId": rx.get("orderId"), "status": target},
        })
        if idempotency_key:
            await db.idempotency_keys.insert_one({
                "key": f"rx-review:{prescription_id}:{idempotency_key}",
                "prescriptionId": prescription_id,
                "expires_at": now + timedelta(seconds=settings.IDEMPOTENCY_EXPIRES_SECONDS),
            })
        return {
            "prescriptionId": prescription_id,
            "status": target,
            "version": updated["version"],
            "replayed": False,
        }

    async def remove_prescription(self, prescription_id: str, user_id: str, reason: str = "") -> Optional[Dict[str, Any]]:
        db = get_db()
        rx = await db.prescriptions.find_one({"prescriptionId": prescription_id})
        if not rx:
            return None
        now = _now()
        if rx["status"] == PrescriptionState.INACTIVE.value:
            return rx
        await db.removal_requests.insert_one({
            "prescriptionId": prescription_id,
            "requestedBy": user_id,
            "reason": reason,
            "created_at": now,
            "status": "COMPLETED",
        })
        await db.prescriptions.update_one(
            {"prescriptionId": prescription_id},
            {
                "$set": {
                    "status": PrescriptionState.INACTIVE.value,
                    "inactiveAt": now,
                    "inactiveBy": user_id,
                    "inactiveReason": reason,
                    "documentCiphertext": b"",
                    "extraction": {"medicines": [], "patientName": "[REDACTED]", "overallConfidence": 0},
                    "updatedAt": now,
                },
                "$inc": {"version": 1},
            },
        )
        await db.prescription_reviews.update_many(
            {"prescription_id": prescription_id, "status": {"$in": ["PENDING", "IN_REVIEW"]}},
            {"$set": {"status": "CANCELLED", "updated_at": now}},
        )
        await self._audit("PRESCRIPTION_REMOVAL_REQUESTED", prescription_id, rx.get("tenantId"), user_id, {})
        await self._audit("PRESCRIPTION_REMOVED", prescription_id, rx.get("tenantId"), user_id, {})
        adapter = await integration_registry.resolve_adapter(rx.get("tenantId"), rx.get("branchId"), "PrescriptionRemoved")
        await adapter.publish({
            "eventType": "PrescriptionRemoved",
            "aggregateType": "Prescription",
            "aggregateId": prescription_id,
            "tenantId": rx.get("tenantId"),
            "branchId": rx.get("branchId"),
            "aggregateVersion": rx.get("version", 1) + 1,
            "payload": {"prescriptionId": prescription_id, "orderId": rx.get("orderId")},
        })
        return await db.prescriptions.find_one({"prescriptionId": prescription_id}, {"documentCiphertext": 0})

    async def create_document_token(
        self,
        prescription_id: str,
        user_id: str,
        *,
        tenant_id: Optional[str] = None,
        branch_id: Optional[str] = None,
        is_admin: bool = False,
    ) -> Dict[str, Any]:
        rx = await self.get_prescription(
            prescription_id,
            requesting_user_id=user_id,
            tenant_id=tenant_id,
            branch_id=branch_id,
            is_admin=is_admin,
        )
        if not rx:
            raise LookupError("Not found")
        db = get_db()
        token = uuid.uuid4().hex
        expires = _now() + timedelta(seconds=settings.DOCUMENT_URL_TTL_SECONDS)
        await db.document_tokens.insert_one({
            "token": token,
            "prescriptionId": prescription_id,
            "userId": user_id,
            "expires_at": expires,
        })
        return {"token": token, "expiresAt": expires, "path": f"/api/v1/prescriptions/{prescription_id}/document?token={token}"}

    async def _audit(self, action: str, prescription_id: str, tenant_id: Optional[str], actor: str, meta: Dict[str, Any]):
        if action not in AUDIT_ACTIONS:
            return
        db = get_db()
        await db.prescription_audit.insert_one({
            "action": action,
            "prescription_id": prescription_id,
            "tenant_id": tenant_id,
            "actor": actor,
            "meta": meta,
            "created_at": _now(),
        })

prescription_engine = PrescriptionServiceEngine()
