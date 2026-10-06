from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from app.config import settings
from app.api.prescriptions import router as prescriptions_router
from app.db import ensure_indexes, close_client, get_db

@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_indexes()
    yield
    await close_client()

app = FastAPI(
    title="Ashvin Pharmacy Prescription Intelligence Service",
    description="HIPAA-grade, patient-controlled prescription intelligence and clinical extraction service",
    version="1.0.0",
    lifespan=lifespan,
)

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
