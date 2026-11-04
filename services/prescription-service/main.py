from fastapi import FastAPI, HTTPException, Header, Depends
from pydantic import BaseModel, Field
import jwt
import os

app = FastAPI(title="Prescription Service", version="1.0.0")

SERVICE_AUTH_SECRET = os.getenv("SERVICE_AUTH_SECRET", "")
SERVICE_JWT_ISSUER = os.getenv("SERVICE_JWT_ISSUER", "ashvin-pharmacy")
SERVICE_JWT_AUDIENCE = os.getenv("PRESCRIPTION_SERVICE_JWT_AUDIENCE", "prescription-service")

def require_scope(required_scope: str):
    def verify_service_token(authorization: str = Header(default="")):
        if not SERVICE_AUTH_SECRET or len(SERVICE_AUTH_SECRET) < 32:
            raise HTTPException(status_code=503, detail="Prescription service authentication is not configured.")
        if not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Service authentication is required.")
        token = authorization[7:].strip()
        try:
            claims = jwt.decode(
                token,
                SERVICE_AUTH_SECRET,
                algorithms=["HS256"],
                issuer=SERVICE_JWT_ISSUER,
                audience=SERVICE_JWT_AUDIENCE,
                options={"require": ["exp", "iss", "aud", "sub"]}
            )
        except jwt.PyJWTError:
            raise HTTPException(status_code=401, detail="Service credential is invalid or expired.")
        scopes = str(claims.get("scope", "")).split()
        if claims.get("sub") != "api-gateway" or required_scope not in scopes or not claims.get("userId"):
            raise HTTPException(status_code=403, detail="Service identity is not authorized for this operation.")
        return claims
    return verify_service_token

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "prescription-service"}

@app.get("/ready")
def ready_check():
    return {"status": "ready", "service": "prescription-service"}

@app.get("/api/v1/prescriptions")
def list_prescriptions(claims: dict = Depends(require_scope("prescription.read"))):
    return {"prescriptions": []}

class PrescriptionCreate(BaseModel):
    puid: str = Field(default="", max_length=128)
    imageUrl: str = Field(default="", max_length=2048)
    medicines: list = Field(default_factory=list)

@app.post("/api/v1/prescriptions")
def create_prescription(
    prescription: PrescriptionCreate,
    claims: dict = Depends(require_scope("prescription.write"))
):
    return {
        "id": "pres_12345",
        "status": "QUEUED",
        "puid": prescription.puid,
        "imageUrl": prescription.imageUrl,
        "medicines": prescription.medicines
    }
