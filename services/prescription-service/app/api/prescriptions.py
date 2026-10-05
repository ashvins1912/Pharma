from fastapi import APIRouter, Depends, UploadFile, File, Form, Header, HTTPException, Query, status
from typing import Optional
from ..security.auth import get_current_service_context, ServiceUserContext
from ..services.prescription_service import prescription_engine
from ..services.hospital_service import hospital_service
from ..models.schemas import (
    ApiResponse, ApiErrorResponse, ApiErrorBody,
    PrescriptionUploadData, PrescriptionStatusData,
    PrescriptionRemovalRequest, PrescriptionRemovalData,
    PrescriptionReviewRequest, PrescriptionReviewData,
    HospitalCreateRequest, HospitalItem
)

router = APIRouter(prefix="/api/v1/prescriptions", tags=["prescriptions"])

@router.post("/upload", response_model=ApiResponse[PrescriptionUploadData], status_code=status.HTTP_201_CREATED)
async def upload_prescription(
    file: Optional[UploadFile] = File(None),
    notes: Optional[str] = Form(None),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    context: ServiceUserContext = Depends(get_current_service_context)
):
    file_bytes = await file.read() if file else None
    filename = file.filename if file else None
    content_type = file.content_type if file else None

    result = await prescription_engine.create_prescription(
        customer_id=context.user_id,
        tenant_id=context.tenant_id,
        branch_id=context.branch_id,
        file_bytes=file_bytes,
        filename=filename,
        content_type=content_type,
        idempotency_key=idempotency_key
    )
    return ApiResponse(
        success=True,
        data=PrescriptionUploadData(**result),
        message="Prescription uploaded successfully"
    )

@router.get("/{prescription_id}", response_model=ApiResponse[PrescriptionStatusData])
async def get_prescription(
    prescription_id: str,
    context: ServiceUserContext = Depends(get_current_service_context)
):
    record = await prescription_engine.get_prescription(prescription_id)
    if not record:
        raise HTTPException(status_code=404, detail="Prescription not found")

    return ApiResponse(
        success=True,
        data=PrescriptionStatusData(**record),
        message="Prescription retrieved successfully"
    )

@router.post("/{prescription_id}/remove", response_model=ApiResponse[PrescriptionRemovalData])
async def remove_prescription(
    prescription_id: str,
    payload: Optional[PrescriptionRemovalRequest] = None,
    context: ServiceUserContext = Depends(get_current_service_context)
):
    reason = payload.reason if payload else "Customer requested removal"
    record = await prescription_engine.remove_prescription(prescription_id, reason=reason)
    if not record:
        raise HTTPException(status_code=404, detail="Prescription not found")

    return ApiResponse(
        success=True,
        data=PrescriptionRemovalData(
            prescriptionId=record["prescriptionId"],
            status="INACTIVE",
            removalRequestedAt=record["removalRequestedAt"],
            inactiveAt=record["inactiveAt"]
        ),
        message="Prescription successfully deactivated"
    )

@router.post("/{prescription_id}/review", response_model=ApiResponse[PrescriptionReviewData])
async def review_prescription(
    prescription_id: str,
    payload: PrescriptionReviewRequest,
    context: ServiceUserContext = Depends(get_current_service_context)
):
    try:
        result = await prescription_engine.review_prescription(
            prescription_id=prescription_id,
            patient=payload.patient.dict() if payload.patient else None,
            diagnosis=[d.dict() for d in payload.diagnosis] if payload.diagnosis else None,
            medicines=[m.dict() for m in payload.medicines] if payload.medicines else None,
            expected_version=payload.expectedVersion,
            reviewer_id=context.user_id
        )
        return ApiResponse(
            success=True,
            data=PrescriptionReviewData(**result),
            message="Prescription review completed"
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

@router.post("/hospitals", response_model=ApiResponse[HospitalItem])
async def match_hospital(
    payload: HospitalCreateRequest,
    context: ServiceUserContext = Depends(get_current_service_context)
):
    result = await hospital_service.get_or_create_hospital(
        name=payload.name,
        address=payload.address.dict() if payload.address else {},
        phone=payload.phone,
        email=payload.email,
        registration_number=payload.registrationNumber
    )
    return ApiResponse(
        success=True,
        data=HospitalItem(
            hospitalId=result["hospitalId"],
            name=result["name"],
            city=result.get("address", {}).get("city", ""),
            state=result.get("address", {}).get("state", ""),
            status=result["status"]
        ),
        message="Hospital resolved"
    )
