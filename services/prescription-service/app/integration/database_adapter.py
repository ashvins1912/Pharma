import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from .adapter import IntegrationAdapter
from ..db import get_db

OUTBOX_STATUSES = ("PENDING", "PROCESSING", "SENT", "RETRY", "FAILED", "DEAD_LETTER")

class DatabaseAdapter(IntegrationAdapter):
    @property
    def provider_name(self) -> str:
        return "DATABASE"

    async def publish(self, event: Dict[str, Any], session=None) -> Dict[str, Any]:
        db = get_db()
        doc = {
            "event_id": event.get("eventId") or event.get("event_id") or str(uuid.uuid4()),
            "event_type": event["eventType"] if "eventType" in event else event["event_type"],
            "aggregate_type": event.get("aggregateType") or event.get("aggregate_type"),
            "aggregate_id": str(event.get("aggregateId") or event.get("aggregate_id")),
            "tenant_id": str(event.get("tenantId") or event.get("tenant_id") or "global"),
            "branch_id": event.get("branchId") or event.get("branch_id"),
            "correlation_id": event.get("correlationId") or event.get("correlation_id"),
            "schema_version": event.get("schemaVersion") or event.get("schema_version") or 1,
            "aggregate_version": event.get("aggregateVersion") or event.get("aggregate_version") or 1,
            "payload": event.get("payload") or {},
            "status": "PENDING",
            "attempt_count": 0,
            "available_at": datetime.now(timezone.utc),
            "locked_until": None,
            "locked_by": None,
            "last_error": None,
            "created_at": datetime.now(timezone.utc),
            "processed_at": None,
        }
        try:
            await db.integration_outbox.insert_one(doc)
            return {"duplicate": False, "event_id": doc["event_id"]}
        except Exception as exc:
            if "duplicate" in str(exc).lower() or getattr(exc, "code", None) == 11000:
                return {"duplicate": True, "event_id": doc["event_id"]}
            raise

    async def health_check(self) -> Dict[str, Any]:
        try:
            await get_db().command("ping")
            return {"healthy": True, "provider": self.provider_name}
        except Exception as exc:
            return {"healthy": False, "provider": self.provider_name, "error": str(exc)}

    async def claim_batch(self, worker_id: str, limit: int = 20, lease_seconds: int = 60):
        db = get_db()
        now = datetime.now(timezone.utc)
        from datetime import timedelta
        locked_until = now + timedelta(seconds=lease_seconds)
        claimed = []
        for _ in range(limit):
            doc = await db.integration_outbox.find_one_and_update(
                {
                    "status": {"$in": ["PENDING", "RETRY"]},
                    "available_at": {"$lte": now},
                    "$or": [{"locked_until": None}, {"locked_until": {"$lte": now}}],
                },
                {
                    "$set": {
                        "status": "PROCESSING",
                        "locked_by": worker_id,
                        "locked_until": locked_until,
                    },
                    "$inc": {"attempt_count": 1},
                },
                sort=[("available_at", 1)],
                return_document=True,
            )
            if not doc:
                break
            claimed.append(doc)
        return claimed
