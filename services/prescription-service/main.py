from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from app.config import settings
from app.api.prescriptions import router as prescriptions_router

app = FastAPI(
    title="Ashvin Pharmacy Prescription Intelligence Service",
    description="HIPAA-grade, patient-controlled prescription intelligence and clinical extraction service",
    version="1.0.0"
)

@app.get("/health")
async def health_check():
    return {
        "status": "UP",
        "service": settings.SERVICE_NAME,
        "environment": settings.ENVIRONMENT
    }

app.include_router(prescriptions_router)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": str(exc),
                "details": []
            },
            "requestId": request.headers.get("x-request-id", "req-unknown")
        }
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=settings.PORT, reload=False)
