from datetime import datetime
from typing import Optional, List, Any, Dict, Generic, TypeVar
from pydantic import BaseModel, Field

T = TypeVar("T")

# Standard Envelopes
class ApiErrorDetail(BaseModel):
    field: Optional[str] = None
    code: Optional[str] = None
    message: Optional[str] = None

class ApiErrorBody(BaseModel):
    code: str
    message: str
    details: List[ApiErrorDetail] = Field(default_factory=list)

class ApiResponse(BaseModel, Generic[T]):
    success: bool = True
    data: Optional[T] = None
    message: str = "Operation completed successfully"
    requestId: Optional[str] = None

class ApiErrorResponse(BaseModel):
    success: bool = False
    error: ApiErrorBody
    requestId: Optional[str] = None

# Extraction Schemas
class MedicineValidationResult(BaseModel):
    status: str = "NOT_FOUND"
    productId: Optional[str] = None
    candidateCount: int = 0
    confidence: float = 0.0

class PatientExtraction(BaseModel):
    name: Optional[str] = None
    rawName: Optional[str] = None
    age: Optional[str] = None
    gender: Optional[str] = None
    confidence: float = 0.0

class DoctorExtraction(BaseModel):
    name: Optional[str] = None
    registrationNumber: Optional[str] = None
    speciality: Optional[str] = None
    confidence: float = 0.0

class HospitalExtraction(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    confidence: float = 0.0

class DiagnosisItem(BaseModel):
    rawText: Optional[str] = None
    normalizedName: Optional[str] = None
    confidence: float = 0.0
    requiresReview: bool = False

class ConfidenceField(BaseModel):
    value: Any = None
    confidence: float = 0.0

class ConfidenceUnitField(BaseModel):
    value: Any = None
    unit: Optional[str] = None
    confidence: float = 0.0

class FrequencyField(BaseModel):
    raw: str = ""
    normalized: str = ""
    timesPerDay: Optional[float] = None
    confidence: float = 0.0

class MedicineCourseField(BaseModel):
    value: Optional[Any] = None
    unit: Optional[str] = None
    raw: Optional[str] = None
    calculatedQuantity: Optional[float] = None
    confidence: float = 0.0

class MedicineItem(BaseModel):
    rawName: Optional[str] = None
    normalizedName: Optional[str] = None
    strength: Optional[ConfidenceUnitField] = None
    dose: Optional[ConfidenceUnitField] = None
    unit: Optional[str] = None
    route: Optional[ConfidenceField] = None
    frequency: Optional[FrequencyField] = None
    duration: Optional[ConfidenceUnitField] = None
    course: Optional[MedicineCourseField] = None
    instructions: Optional[ConfidenceField] = None
    confidence: float = 0.0
    requiresReview: bool = False
    medicineValidation: Optional[MedicineValidationResult] = None

class QualityMetadata(BaseModel):
    overallConfidence: float = 0.0
    requiresReview: bool = False
    ocrModelVersion: str = "paddleocr-v3"
    nlpModelVersion: str = "medspacy-clinical-v1"

# Upload Responses
class PrescriptionUploadData(BaseModel):
    prescriptionId: str
    status: str
    uploadedAt: datetime

class ProcessingProgress(BaseModel):
    stage: str
    percent: int

class PrescriptionStatusData(BaseModel):
    prescriptionId: str
    status: str
    progress: Optional[ProcessingProgress] = None
    patient: Optional[PatientExtraction] = None
    doctor: Optional[DoctorExtraction] = None
    hospital: Optional[HospitalExtraction] = None
    diagnosis: List[DiagnosisItem] = Field(default_factory=list)
    medicines: List[MedicineItem] = Field(default_factory=list)
    quality: Optional[QualityMetadata] = None
    createdAt: Optional[datetime] = None
    updatedAt: Optional[datetime] = None

# Removal & Retention
class PrescriptionRemovalRequest(BaseModel):
    reason: Optional[str] = "Customer requested prescription data removal"

class PrescriptionRemovalData(BaseModel):
    prescriptionId: str
    status: str = "INACTIVE"
    removalRequestedAt: datetime
    inactiveAt: datetime

# Human Review
class PrescriptionReviewRequest(BaseModel):
    patient: Optional[PatientExtraction] = None
    diagnosis: Optional[List[DiagnosisItem]] = None
    medicines: Optional[List[MedicineItem]] = None
    expectedVersion: Optional[int] = None

class PrescriptionReviewData(BaseModel):
    prescriptionId: str
    status: str
    version: int
    reviewedAt: datetime
    reviewedBy: str

# Medicine Validation Candidate
class MedicineCandidate(BaseModel):
    productId: Optional[str] = None
    name: str
    strength: Optional[str] = None

class ValidatedMedicineResult(BaseModel):
    rawName: str
    candidate: Optional[MedicineCandidate] = None
    confidence: float
    requiresReview: bool

class MedicineValidationData(BaseModel):
    prescriptionId: str
    medicines: List[ValidatedMedicineResult]

# Hospital
class HospitalAddress(BaseModel):
    line1: Optional[str] = ""
    city: Optional[str] = ""
    state: Optional[str] = ""
    pincode: Optional[str] = ""

class HospitalCreateRequest(BaseModel):
    name: str
    address: Optional[HospitalAddress] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    registrationNumber: Optional[str] = None

class HospitalItem(BaseModel):
    hospitalId: str
    name: str
    city: Optional[str] = ""
    state: Optional[str] = ""
    status: str = "ACTIVE"

# Pagination
class PaginationMeta(BaseModel):
    page: int
    pageSize: int
    totalItems: int
    totalPages: int

class PrescriptionListItem(BaseModel):
    prescriptionId: str
    status: str
    hospital: Optional[Dict[str, Any]] = None
    prescriptionDate: Optional[str] = None
    overallConfidence: float = 0.0
    requiresReview: bool = False
    createdAt: datetime

class PrescriptionListData(BaseModel):
    items: List[PrescriptionListItem]
    pagination: PaginationMeta

# Analytics
class TopCounter(BaseModel):
    name: str
    count: int

class AnalyticsPeriod(BaseModel):
    from_date: Optional[str] = Field(default=None, alias="from")
    to_date: Optional[str] = Field(default=None, alias="to")

class AnalyticsSummaryData(BaseModel):
    period: AnalyticsPeriod
    totalPrescriptions: int
    processedPrescriptions: int
    reviewRequired: int
    averageExtractionConfidence: float
    topMedicines: List[TopCounter] = Field(default_factory=list)
    topDiagnoses: List[TopCounter] = Field(default_factory=list)
