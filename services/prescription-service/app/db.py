from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from .config import settings

_client: AsyncIOMotorClient | None = None

def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(settings.MONGO_URI)
    return _client

def get_db() -> AsyncIOMotorDatabase:
    return get_client()[settings.PRESCRIPTION_DB_NAME]

async def close_client():
    global _client
    if _client is not None:
        _client.close()
        _client = None

async def ensure_indexes():
    db = get_db()
    await db.prescriptions.create_index("prescriptionId", unique=True)
    await db.prescriptions.create_index([("tenantId", 1), ("status", 1), ("createdAt", -1)])
    await db.prescriptions.create_index([("tenantId", 1), ("branchId", 1), ("status", 1)])
    await db.prescriptions.create_index([("patientPuid", 1), ("status", 1)])
    await db.prescriptions.create_index([("orderId", 1)])
    await db.prescriptions.create_index([("status", 1), ("updatedAt", -1)])

    await db.processing_jobs.create_index("jobId", unique=True)
    await db.processing_jobs.create_index("prescriptionId")
    await db.processing_jobs.create_index([("status", 1), ("next_attempt_at", 1), ("locked_until", 1)])
    await db.processing_jobs.create_index([("tenant_id", 1), ("status", 1)])

    await db.prescription_reviews.create_index("reviewId", unique=True)
    await db.prescription_reviews.create_index("prescription_id")
    await db.prescription_reviews.create_index([("status", 1), ("tenant_id", 1), ("created_at", -1)])
    await db.prescription_reviews.create_index([("tenant_id", 1), ("branch_id", 1), ("status", 1)])

    await db.integration_outbox.create_index("event_id", unique=True)
    await db.integration_outbox.create_index([("status", 1), ("available_at", 1)])
    await db.integration_outbox.create_index([("event_type", 1), ("aggregate_id", 1), ("aggregate_version", 1)], unique=True)
    await db.integration_outbox.create_index([("tenant_id", 1), ("created_at", -1)])

    await db.idempotency_keys.create_index("key", unique=True)
    await db.idempotency_keys.create_index("expires_at", expireAfterSeconds=0)

    await db.prescription_audit.create_index([("prescription_id", 1), ("created_at", -1)])
    await db.prescription_audit.create_index([("tenant_id", 1), ("action", 1), ("created_at", -1)])

    await db.integration_provider.create_index([("enabled", 1), ("priority", 1)])
