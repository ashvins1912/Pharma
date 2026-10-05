from datetime import datetime
from enum import Enum
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field

class JobStatus(str, Enum):
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"

class PrescriptionProcessingJob(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    jobId: str
    prescriptionId: str
    tenantId: str
    type: str = "OCR_AND_EXTRACTION"
    status: JobStatus = JobStatus.QUEUED
    attempt: int = 1
    maxAttempts: int = 3
    workerId: Optional[str] = None
    startedAt: Optional[datetime] = None
    leaseExpiresAt: Optional[datetime] = None
    heartbeatAt: Optional[datetime] = None
    completedAt: Optional[datetime] = None
    error: Optional[Dict[str, Any]] = None
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
