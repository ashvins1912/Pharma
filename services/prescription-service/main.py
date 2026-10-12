from fastapi import FastAPI, HTTPException, Header, Depends
from pydantic import BaseModel
import os

app = FastAPI(title="Prescription Service", version="1.0.0")

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "prescription-service"}

@app.get("/ready")
def ready_check():
    return {"status": "ready", "service": "prescription-service"}

@app.get("/api/v1/prescriptions")
def list_prescriptions():
    return {"prescriptions": []}

class PrescriptionCreate(BaseModel):
    puid: str = ""
    imageUrl: str = ""
    medicines: list = []

@app.post("/api/v1/prescriptions")
def create_prescription(prescription: PrescriptionCreate):
    return {
        "id": "pres_12345",
        "status": "QUEUED",
        "puid": prescription.puid,
        "imageUrl": prescription.imageUrl,
        "medicines": prescription.medicines
    }
