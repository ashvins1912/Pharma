from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field

class AuditAction(str, Enum):
    CREATED = "CREATED"
    UPLOADED = "UPLOADED"
    QUEUED = "QUEUED"
    PROCESSING_STARTED = "PROCESSING_STARTED"
    PROCESSING_COMPLETED = "PROCESSING_COMPLETED"
    PROCESSING_FAILED = "PROCESSING_FAILED"
    REVIEW_REQUESTED = "REVIEW_REQUESTED"
    REVIEW_COMPLETED = "REVIEW_COMPLETED"
    RETRY_REQUESTED = "RETRY_REQUESTED"
    REMOVAL_REQUESTED = "REMOVAL_REQUESTED"
    MARKED_INACTIVE = "MARKED_INACTIVE"
    DOCUMENT_ACCESSED = "DOCUMENT_ACCESSED"
    EXTRACTION_ACCESSED = "EXTRACTION_ACCESSED"

class PrescriptionAudit(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    auditId: str
    prescriptionId: str
    tenantId: str
    actorType: str = "USER"  # USER, SYSTEM, WORKER
    actorId: str
    action: AuditAction
    fromState: Optional[str] = None
    toState: Optional[str] = None
    reason: Optional[str] = None
    requestId: Optional[str] = None
    createdAt: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
