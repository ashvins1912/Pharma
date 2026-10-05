import os
from typing import List
from pydantic import Field
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    SERVICE_NAME: str = "prescription-intelligence-service"
    ENVIRONMENT: str = os.getenv("NODE_ENV", "development")
    PORT: int = int(os.getenv("PORT", 8000))
    
    # Storage & Mongo
    MONGO_URI: str = os.getenv("MONGO_URI", "mongodb://localhost:27017/pharma")
    PRESCRIPTION_DB_NAME: str = os.getenv("PRESCRIPTION_DB_NAME", "pharma_prescriptions")
    
    # Encryption (AES-256-GCM)
    PRESCRIPTION_ENCRYPTION_KEY: str = os.getenv(
        "PRESCRIPTION_ENCRYPTION_KEY",
        "ashvin-pharma-prescription-aes-256-gcm-master-key-32bytes!"
    )
    KEY_VERSION: str = "v1"
    
    # Internal Service Auth
    SERVICE_AUTH_SECRET: str = os.getenv(
        "SERVICE_AUTH_SECRET",
        "ashvin-pharmacy-demo-admin-jwt-secret-key-32chars!"
    )
    SERVICE_JWT_ISSUER: str = os.getenv("SERVICE_JWT_ISSUER", "ashvin-pharmacy")
    SERVICE_JWT_AUDIENCE: str = os.getenv("SERVICE_JWT_AUDIENCE", "prescription-service")
    
    # Concurrency & Leases
    PRESCRIPTION_MAX_RETRIES: int = int(os.getenv("PRESCRIPTION_MAX_RETRIES", "3"))
    PROCESSING_LEASE_SECONDS: int = 600  # 10 minutes
    HEARTBEAT_INTERVAL_SECONDS: int = 45
    IDEMPOTENCY_EXPIRES_SECONDS: int = 86400  # 24 hours
    
    # Quality & Human Review Thresholds
    OCR_REVIEW_THRESHOLD: float = 0.75
    MEDICINE_REVIEW_THRESHOLD: float = 0.85
    PATIENT_NAME_REVIEW_THRESHOLD: float = 0.90
    
    # File Limits
    MAX_FILE_SIZE_BYTES: int = 25 * 1024 * 1024  # 25 MB
    MAX_PDF_PAGES: int = 15
    ALLOWED_EXTENSIONS: List[str] = [".pdf", ".png", ".jpg", ".jpeg", ".webp"]
    ALLOWED_MIME_TYPES: List[str] = [
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/webp"
    ]

    class Config:
        case_sensitive = True

settings = Settings()
