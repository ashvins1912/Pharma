from datetime import datetime
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field

class PrescriptionReview(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    reviewId: str
    prescriptionId: str
    tenantId: str
    customerId: str
    sourceExtractionVersion: int = 1
    reviewVersion: int = 1
    reviewedData: Dict[str, Any] = Field(default_factory=dict)
    reviewedBy: str
    reviewReason: Optional[str] = "Pharmacist validation and corrections"
    createdAt: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
