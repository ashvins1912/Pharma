from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field

class HospitalSource(str, Enum):
    MANUAL = "MANUAL"
    OCR = "OCR"
    IMPORTED = "IMPORTED"
    SYSTEM = "SYSTEM"

class HospitalAddress(BaseModel):
    line1: Optional[str] = ""
    city: str = "Indore"
    state: str = "Madhya Pradesh"
    postalCode: Optional[str] = ""

class HospitalContact(BaseModel):
    phone: Optional[str] = ""
    email: Optional[str] = ""

class Hospital(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    hospitalId: str
    tenantId: str
    name: str
    normalizedName: str
    registrationNumber: Optional[str] = None
    address: HospitalAddress = Field(default_factory=HospitalAddress)
    contact: HospitalContact = Field(default_factory=HospitalContact)
    source: HospitalSource = HospitalSource.MANUAL
    status: str = "ACTIVE"
    createdBy: str = "system"
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
