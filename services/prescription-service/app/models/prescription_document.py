from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field

class DocumentStatus(str, Enum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"

class DocumentStorage(BaseModel):
    provider: str = "S3"  # S3, GCS, AZURE_BLOB, GRIDFS
    bucket: str = "prescription-private"
    objectKey: str

class DocumentFileInfo(BaseModel):
    originalFileName: str
    contentType: str
    sizeBytes: int
    checksumSha256: str

class DocumentEncryption(BaseModel):
    algorithm: str = "AES-256-GCM"
    keyVersion: str = "v1"
    encryptedDataKey: str
    nonce: str

class PrescriptionDocument(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    documentId: str
    prescriptionId: str
    tenantId: str
    customerId: str
    storage: DocumentStorage
    file: DocumentFileInfo
    encryption: DocumentEncryption
    status: DocumentStatus = DocumentStatus.ACTIVE
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
