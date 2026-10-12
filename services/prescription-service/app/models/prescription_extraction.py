from datetime import datetime
from typing import Optional, List, Any, Dict
from pydantic import BaseModel, Field

class ConfidenceField(BaseModel):
    value: Any
    confidence: float = 0.0

class ConfidenceUnitField(BaseModel):
    value: Any
    unit: Optional[str] = None
    confidence: float = 0.0

class FrequencyField(BaseModel):
    raw: str
    normalized: str
    confidence: float = 0.0

class MedicineValidationResult(BaseModel):
    status: str = "MATCHED"  # MATCHED, PARTIAL_MATCH, NOT_FOUND, REVIEW_REQUIRED
    productId: Optional[str] = None
    candidateCount: int = 0
    confidence: float = 0.0

class ExtractionMedicineItem(BaseModel):
    rawName: str
    normalizedName: str
    strength: Optional[ConfidenceUnitField] = None
    dose: Optional[ConfidenceUnitField] = None
    route: Optional[ConfidenceField] = None
    frequency: Optional[FrequencyField] = None
    duration: Optional[ConfidenceUnitField] = None
    course: Optional[ConfidenceField] = None
    instructions: Optional[ConfidenceField] = None
    medicineValidation: Optional[MedicineValidationResult] = None

class ExtractionDiagnosisItem(BaseModel):
    rawText: str
    normalizedName: str
    confidence: float = 0.0

class ExtractionPatient(BaseModel):
    name: Optional[ConfidenceField] = None
    age: Optional[ConfidenceField] = None
    gender: Optional[ConfidenceField] = None

class ExtractionDoctor(BaseModel):
    name: Optional[ConfidenceField] = None
    registrationNumber: Optional[ConfidenceField] = None
    speciality: Optional[ConfidenceField] = None

class ExtractionHospital(BaseModel):
    name: Optional[ConfidenceField] = None
    address: Optional[ConfidenceField] = None
    phone: Optional[ConfidenceField] = None

class ExtractionModelMeta(BaseModel):
    ocrEngine: str = "PaddleOCR"
    ocrVersion: str = "2.9.0"
    nlpEngine: str = "spaCy"
    nlpModel: str = "en_core_med7_lg"
    nlpVersion: str = "3.7.0"
    extractionVersion: str = "1.0"

class PrescriptionExtraction(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    extractionId: str
    prescriptionId: str
    tenantId: str
    customerId: str
    version: int = 1
    status: str = "CURRENT"  # CURRENT, SUPERSEDED, REVIEWED
    model: ExtractionModelMeta = Field(default_factory=ExtractionModelMeta)
    patient: ExtractionPatient = Field(default_factory=ExtractionPatient)
    doctor: ExtractionDoctor = Field(default_factory=ExtractionDoctor)
    hospital: ExtractionHospital = Field(default_factory=ExtractionHospital)
    diagnosis: List[ExtractionDiagnosisItem] = Field(default_factory=list)
    medicines: List[ExtractionMedicineItem] = Field(default_factory=list)
    prescriptionDate: Optional[ConfidenceField] = None
    rawOcr: Dict[str, Any] = Field(default_factory=lambda: {"encrypted": True})
    overallConfidence: float = 0.0
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
