from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import json
import os
import time
import uuid
from app.config import settings
from app.api.prescriptions import router as prescriptions_router
from app.db import ensure_indexes, close_client, get_db

@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_indexes()
    yield
    await close_client()

@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    correlation_id = request.headers.get("x-correlation-id") or request_id
    started_at = time.perf_counter()
    response = None
    try:
        response = await call_next(request)
        return response
    finally:
        if os.getenv("LOGGING_ENABLED", "true").lower() == "true":
            print(json.dumps({
                "serviceName": settings.SERVICE_NAME,
                "event": "request_completed",
                "requestId": request_id,
                "correlationId": correlation_id,
                "method": request.method,
                "path": request.url.path,
                "statusCode": getattr(response, "status_code", 500),
                "durationMs": round((time.perf_counter() - started_at) * 1000, 2)
            }), flush=True)
        if response is not None:
            response.headers["X-Request-Id"] = request_id
            response.headers["X-Correlation-Id"] = correlation_id

app = FastAPI(
    title="Ashvin Pharmacy Prescription Intelligence Service",
    description="HIPAA-grade, patient-controlled prescription intelligence and clinical extraction service",
    version="1.0.0",
    lifespan=lifespan,
)

@app.get("/")
async def root_check():
    return {
        "status": "UP",
        "service": settings.SERVICE_NAME,
        "environment": settings.ENVIRONMENT
    }

@app.head("/")
async def root_head_check():
    return None

@app.get("/health")
async def health_check():
    return {
        "status": "UP",
        "service": settings.SERVICE_NAME,
        "environment": settings.ENVIRONMENT
    }

@app.get("/ready")
async def ready_check():
    try:
        await get_db().command("ping")
        return {"status": "READY", "service": settings.SERVICE_NAME}
    except Exception as exc:
        return JSONResponse(status_code=503, content={"status": "NOT_READY", "error": str(exc)})

app.include_router(prescriptions_router)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": "An unexpected error occurred",
                "details": []
            },
            "requestId": request.headers.get("x-request-id", "req-unknown")
        }
    )

if __name__ == "__main__":
    import os
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", str(settings.PORT))),
        reload=False,
    )
