from fastapi import APIRouter, Depends, UploadFile, File, Form, Header, HTTPException, Query, Response, status
from typing import Optional
from ..security.auth import get_current_service_context, ServiceUserContext
from ..services.prescription_service import prescription_engine
from ..services.hospital_service import hospital_service
from ..models.schemas import (
    ApiResponse, ApiErrorResponse, ApiErrorBody,
    PrescriptionUploadData, PrescriptionStatusData,
    PrescriptionRemovalRequest, PrescriptionRemovalData,
    PrescriptionReviewRequest, PrescriptionReviewData,
    HospitalCreateRequest, HospitalItem,
    ProcessingProgress, PatientExtraction, MedicineItem, QualityMetadata,
)
from ..db import get_db
from datetime import datetime, timezone

router = APIRouter(prefix="/api/v1/prescriptions", tags=["prescriptions"])

def _require_review_permission(context: ServiceUserContext):
    scopes = set(getattr(context, "scopes", None) or [])
    roles = set(getattr(context, "roles", None) or [])
    perms = set(getattr(context, "permissions", None) or [])
    if "prescription.review" in scopes or "prescription.review" in perms:
        return
    if roles & {"admin", "pharmacist", "ADMIN", "PHARMACIST", "SUPER_ADMIN", "TENANT_ADMIN"}:
        return
    if getattr(context, "is_admin", False):
        return
    raise HTTPException(status_code=403, detail="prescription.review permission required")

async def _authorized_prescription(prescription_id: str, context: ServiceUserContext):
    try:
        record = await prescription_engine.get_prescription(
            prescription_id,
            requesting_user_id=context.user_id,
            tenant_id=context.tenant_id,
            branch_id=context.branch_id,
            is_admin=context.is_admin,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    if not record:
        raise HTTPException(status_code=404, detail="Prescription not found")
    return record

@router.post("/upload", response_model=ApiResponse[PrescriptionUploadData], status_code=status.HTTP_201_CREATED)
async def upload_prescription(
    file: Optional[UploadFile] = File(None),
    notes: Optional[str] = Form(None),
    order_id: Optional[str] = Form(None),
    patient_puid: Optional[str] = Form(None),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    context: ServiceUserContext = Depends(get_current_service_context)
):
    file_bytes = await file.read() if file else None
    filename = file.filename if file else None
    content_type = file.content_type if file else None
    try:
        result = await prescription_engine.create_prescription(
            customer_id=context.user_id,
            tenant_id=context.tenant_id,
            branch_id=context.branch_id,
            user_id=context.user_id,
            file_bytes=file_bytes,
            filename=filename,
            content_type=content_type,
            idempotency_key=idempotency_key,
            order_id=order_id,
            patient_puid=patient_puid,
            correlation_id=None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return ApiResponse(
        success=True,
        data=PrescriptionUploadData(**{**result, 'status': public_status(result.get('status'))}),
        message="Prescription uploaded successfully"
    )

@router.put("/{prescription_id}/document")
async def replace_prescription_document(
    prescription_id: str,
    file: UploadFile = File(...),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    context: ServiceUserContext = Depends(get_current_service_context)
):
    try:
        await _authorized_prescription(prescription_id, context)
        file_bytes = await file.read()
        result = await prescription_engine.replace_prescription(
            prescription_id,
            user_id=context.user_id,
            tenant_id=context.tenant_id,
            branch_id=context.branch_id,
            file_bytes=file_bytes,
            filename=file.filename,
            content_type=file.content_type,
            idempotency_key=idempotency_key,
        )
        return {"success": True, "data": result, "message": "Prescription document replaced and queued for reprocessing."}
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except LookupError:
        raise HTTPException(status_code=404, detail="Prescription not found")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        if str(exc) == "INACTIVE":
            raise HTTPException(status_code=409, detail="Prescription is inactive")
        if str(exc) == "VERSION_CONFLICT":
            raise HTTPException(status_code=409, detail="Prescription was updated by another operation.")
        raise HTTPException(status_code=409, detail=str(exc))

@router.get("/reviews/queue")
async def review_queue(context: ServiceUserContext = Depends(get_current_service_context)):
    _require_review_permission(context)
    if not context.tenant_id:
        raise HTTPException(status_code=403, detail="tenant required")
    items = await prescription_engine.list_review_queue(context.tenant_id, context.branch_id)
    return {"success": True, "data": items}

@router.get("/{prescription_id}")
async def get_prescription(
    prescription_id: str,
    context: ServiceUserContext = Depends(get_current_service_context)
):
    record = await _authorized_prescription(prescription_id, context)
    extraction = record.get("extraction") or {}
    progress_map = {
        "UPLOADED": ("UPLOADED", 10),
        "QUEUED": ("QUEUED", 20),
        "PROCESSING": ("PROCESSING", 50),
        "REVIEW_REQUIRED": ("REVIEW_REQUIRED", 80),
        "AUTO_APPROVED": ("AUTO_APPROVED", 95),
        "APPROVED": ("APPROVED", 100),
        "REJECTED": ("REJECTED", 100),
        "FAILED": ("FAILED", 100),
        "INACTIVE": ("INACTIVE", 100),
    }
    stage, percent = progress_map.get(record.get("status"), (record.get("status"), 0))
    data = PrescriptionStatusData(
        prescriptionId=record["prescriptionId"],
        status=public_status(record["status"]),
        progress=ProcessingProgress(stage=stage, percent=percent),
        patient=PatientExtraction(name=extraction.get("patientName"), confidence=extraction.get("overallConfidence") or 0),
        medicines=[MedicineItem(**m) if isinstance(m, dict) else m for m in (extraction.get("medicines") or [])],
        quality=QualityMetadata(
            overallConfidence=extraction.get("overallConfidence") or 0,
            requiresReview=bool(extraction.get("reviewRequired")),
            ocrModelVersion=extraction.get("ocrVersion") or "unknown",
            nlpModelVersion=extraction.get("nlpVersion") or "unknown",
        ),
        createdAt=record.get("createdAt"),
        updatedAt=record.get("updatedAt"),
    )
    return {"success": True, "data": data.model_dump(), "message": "Prescription retrieved successfully", "version": record.get("version")}

@router.get("/{prescription_id}/document")
async def prescription_document(
    prescription_id: str,
    token: Optional[str] = Query(None),
    context: ServiceUserContext = Depends(get_current_service_context),
):
    record = await _authorized_prescription(prescription_id, context)
    db = get_db()
    if token:
        token_doc = await db.document_tokens.find_one({
            "token": token,
            "prescriptionId": prescription_id,
            "userId": context.user_id,
        })
        if not token_doc or token_doc.get("expires_at") <= datetime.now(timezone.utc):
            raise HTTPException(status_code=410, detail="Prescription document link is expired or invalid.")
    encrypted = record.get("documentCiphertext")
    if not encrypted:
        raise HTTPException(status_code=404, detail="Prescription document is unavailable.")
    try:
        document = crypto.decrypt(encrypted)
    except Exception:
        raise HTTPException(status_code=500, detail="Prescription document could not be decrypted.")
    return Response(
        content=document,
        media_type=record.get("contentType") or "application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{record.get("filename") or "prescription.pdf"}"',
            "Cache-Control": "private, no-store",
        },
    )

@router.post("/{prescription_id}/reprocess")
async def reprocess_prescription(
    prescription_id: str,
    context: ServiceUserContext = Depends(get_current_service_context)
):
    _require_review_permission(context)
    await _authorized_prescription(prescription_id, context)
    try:
        result = await prescription_engine.reprocess_prescription(
            prescription_id,
            context.user_id,
        )
        return {"success": True, "data": result, "message": "Prescription processing re-initiated."}
    except LookupError:
        raise HTTPException(status_code=404, detail="Prescription not found")
    except RuntimeError as exc:
        if str(exc) == "INACTIVE":
            raise HTTPException(status_code=409, detail="Prescription is inactive")
        raise HTTPException(status_code=409, detail=str(exc))

@router.post("/{prescription_id}/review/claim")
async def claim_review(
    prescription_id: str,
    expected_version: Optional[int] = None,
    context: ServiceUserContext = Depends(get_current_service_context)
):
    _require_review_permission(context)
    await _authorized_prescription(prescription_id, context)
    try:
        result = await prescription_engine.claim_review(prescription_id, context.user_id, expected_version)
        return {"success": True, "data": result}
    except LookupError:
        raise HTTPException(status_code=404, detail="Review not found")
    except RuntimeError as exc:
        if str(exc) == "VERSION_CONFLICT":
            raise HTTPException(status_code=409, detail="This prescription was already updated by another reviewer.")
        if str(exc) == "LEASE_HELD":
            raise HTTPException(status_code=409, detail="Review lease held by another reviewer.")
        raise HTTPException(status_code=409, detail=str(exc))

@router.post("/{prescription_id}/review/approve")
async def approve_review(
    prescription_id: str,
    expected_version: int = Form(...),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    context: ServiceUserContext = Depends(get_current_service_context)
):
    _require_review_permission(context)
    await _authorized_prescription(prescription_id, context)
    try:
        result = await prescription_engine.approve_review(prescription_id, context.user_id, expected_version, idempotency_key)
        return {"success": True, "data": result}
    except LookupError:
        raise HTTPException(status_code=404, detail="Prescription not found")
    except RuntimeError as exc:
        code = str(exc)
        if code == "VERSION_CONFLICT":
            raise HTTPException(status_code=409, detail="This prescription was already updated by another reviewer.")
        if code == "INACTIVE":
            raise HTTPException(status_code=409, detail="Prescription is inactive")
        raise HTTPException(status_code=409, detail=code)

@router.post("/{prescription_id}/review/reject")
async def reject_review(
    prescription_id: str,
    expected_version: int = Form(...),
    reason: str = Form(...),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    context: ServiceUserContext = Depends(get_current_service_context)
):
    _require_review_permission(context)
    await _authorized_prescription(prescription_id, context)
    try:
        result = await prescription_engine.reject_review(prescription_id, context.user_id, expected_version, reason, idempotency_key)
        return {"success": True, "data": result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except LookupError:
        raise HTTPException(status_code=404, detail="Prescription not found")
    except RuntimeError as exc:
        if str(exc) == "VERSION_CONFLICT":
            raise HTTPException(status_code=409, detail="This prescription was already updated by another reviewer.")
        raise HTTPException(status_code=409, detail=str(exc))

@router.post("/{prescription_id}/review/wait")
async def wait_review(
    prescription_id: str,
    context: ServiceUserContext = Depends(get_current_service_context)
):
    _require_review_permission(context)
    await _authorized_prescription(prescription_id, context)
    result = await prescription_engine.wait_review(prescription_id, context.user_id)
    return {"success": True, "data": result}

@router.post("/{prescription_id}/review", response_model=ApiResponse[PrescriptionReviewData])
async def review_prescription_legacy(
    prescription_id: str,
    payload: PrescriptionReviewRequest,
    context: ServiceUserContext = Depends(get_current_service_context)
):
    """Legacy combined review endpoint → approve path with optimistic lock."""
    _require_review_permission(context)
    await _authorized_prescription(prescription_id, context)
    try:
        result = await prescription_engine.approve_review(
            prescription_id=prescription_id,
            reviewer_id=context.user_id,
            expected_version=payload.expectedVersion or 1,
        )
        return ApiResponse(success=True, data=PrescriptionReviewData(**result), message="Prescription review completed")
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))

@router.post("/{prescription_id}/remove", response_model=ApiResponse[PrescriptionRemovalData])
async def remove_prescription(
    prescription_id: str,
    payload: Optional[PrescriptionRemovalRequest] = None,
    context: ServiceUserContext = Depends(get_current_service_context)
):
    reason = payload.reason if payload else "Customer requested removal"
    await _authorized_prescription(prescription_id, context)
    record = await prescription_engine.remove_prescription(prescription_id, context.user_id, reason=reason)
    if not record:
        raise HTTPException(status_code=404, detail="Prescription not found")
    return ApiResponse(
        success=True,
        data=PrescriptionRemovalData(
            prescriptionId=record["prescriptionId"],
            status="INACTIVE",
            removalRequestedAt=record.get("inactiveAt"),
            inactiveAt=record.get("inactiveAt")
        ),
        message="Prescription successfully deactivated"
    )

@router.get("/{prescription_id}/document-url")
async def document_url(prescription_id: str, context: ServiceUserContext = Depends(get_current_service_context)):
    _require_review_permission(context)
    try:
        await _authorized_prescription(prescription_id, context)
        data = await prescription_engine.create_document_token(
            prescription_id,
            context.user_id,
            tenant_id=context.tenant_id,
            branch_id=context.branch_id,
            is_admin=context.is_admin,
        )
        return {"success": True, "data": data}
    except LookupError:
        raise HTTPException(status_code=404, detail="Not found")

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
