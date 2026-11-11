from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field

class RemovalStatus(str, Enum):
    REQUESTED = "REQUESTED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    REJECTED = "REJECTED"

class PrescriptionRemovalRequestModel(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    removalRequestId: str
    prescriptionId: str
    tenantId: str
    customerId: str
    requestedBy: str
    reason: str = "CUSTOMER_REQUEST"
    status: RemovalStatus = RemovalStatus.COMPLETED
    requestedAt: datetime = Field(default_factory=datetime.utcnow)
    processedAt: Optional[datetime] = Field(default_factory=datetime.utcnow)
    processedBy: str = "system"

    class Config:
        populate_by_name = True
