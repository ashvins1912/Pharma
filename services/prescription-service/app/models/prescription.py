from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field

class PrescriptionStatus(str, Enum):
    UPLOADED = "UPLOADED"
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    INACTIVE = "INACTIVE"  # Terminal state

class PrescriptionSource(BaseModel):
    type: str = "CUSTOMER_UPLOAD"  # CUSTOMER_UPLOAD, CLINIC_WALKIN, PARTNER_API
    channel: str = "WEB"  # WEB, MOBILE_APP, POS, WHATSAPP

class PrescriptionProcessingInfo(BaseModel):
    attemptCount: int = 0
    maxAttempts: int = 3
    workerId: Optional[str] = None
    startedAt: Optional[datetime] = None
    leaseExpiresAt: Optional[datetime] = None
    heartbeatAt: Optional[datetime] = None
    lastErrorCode: Optional[str] = None
    lastErrorMessage: Optional[str] = None
    processingStartedAt: Optional[datetime] = None
    processingCompletedAt: Optional[datetime] = None

class PrescriptionExtractionSummary(BaseModel):
    extractionId: Optional[str] = None
    modelVersion: Optional[str] = None
    ocrVersion: Optional[str] = None
    overallConfidence: Optional[float] = None
    reviewRequired: bool = False

class Prescription(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    prescriptionId: str
    tenantId: str
    customerId: str
    branchId: Optional[str] = None
    patientReference: Optional[str] = None
    hospitalId: Optional[str] = None
    status: PrescriptionStatus = PrescriptionStatus.QUEUED
    source: PrescriptionSource = Field(default_factory=PrescriptionSource)
    documentId: Optional[str] = None
    processing: PrescriptionProcessingInfo = Field(default_factory=PrescriptionProcessingInfo)
    extraction: PrescriptionExtractionSummary = Field(default_factory=PrescriptionExtractionSummary)
    version: int = 1
    createdBy: str
    updatedBy: str
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)
    inactiveAt: Optional[datetime] = None
    inactiveReason: Optional[str] = None
    inactiveBy: Optional[str] = None

    class Config:
        populate_by_name = True
        json_encoders = {datetime: lambda dt: dt.isoformat()}
