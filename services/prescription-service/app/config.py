import os
from typing import List
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings

INSECURE_DEFAULTS = {
    "ashvin-pharma-prescription-aes-256-gcm-master-key-32bytes!",
    "ashvin-pharmacy-demo-admin-jwt-secret-key-32chars!",
    "change-me",
    "secret123",
    "default-secret",
}

class Settings(BaseSettings):
    SERVICE_NAME: str = "prescription-intelligence-service"
    ENVIRONMENT: str = Field(default_factory=lambda: os.getenv("NODE_ENV", os.getenv("ENVIRONMENT", "development")))
    PORT: int = Field(default_factory=lambda: int(os.getenv("PORT", "8000")))

    MONGO_URI: str = Field(default_factory=lambda: os.getenv("MONGO_URI", "mongodb://localhost:27017/pharma"))
    PRESCRIPTION_DB_NAME: str = Field(default_factory=lambda: os.getenv("PRESCRIPTION_DB_NAME", "pharma_prescriptions"))

    PRESCRIPTION_ENCRYPTION_KEY: str = Field(default_factory=lambda: os.getenv("PRESCRIPTION_ENCRYPTION_KEY", ""))
    KEY_VERSION: str = "v1"

    SERVICE_AUTH_SECRET: str = Field(default_factory=lambda: os.getenv("SERVICE_AUTH_SECRET", ""))
    SERVICE_JWT_ISSUER: str = Field(default_factory=lambda: os.getenv("SERVICE_JWT_ISSUER", "ashvin-pharmacy"))
    SERVICE_JWT_AUDIENCE: str = Field(default_factory=lambda: os.getenv("SERVICE_JWT_AUDIENCE", "prescription-service"))

    PRESCRIPTION_MAX_RETRIES: int = Field(default_factory=lambda: int(os.getenv("PRESCRIPTION_MAX_RETRIES", "3")))
    PROCESSING_LEASE_SECONDS: int = 600
    HEARTBEAT_INTERVAL_SECONDS: int = 45
    IDEMPOTENCY_EXPIRES_SECONDS: int = 86400
    WORKER_ID: str = Field(default_factory=lambda: os.getenv("WORKER_ID", "rx-worker-1"))
    DOCUMENT_URL_TTL_SECONDS: int = 300

    OCR_REVIEW_THRESHOLD: float = 0.75
    MEDICINE_REVIEW_THRESHOLD: float = 0.85
    PATIENT_NAME_REVIEW_THRESHOLD: float = 0.90
    OVERALL_AUTO_APPROVE_THRESHOLD: float = 0.90

    MAX_FILE_SIZE_BYTES: int = 25 * 1024 * 1024
    MAX_PDF_PAGES: int = 15
    ALLOWED_EXTENSIONS: List[str] = [".pdf", ".png", ".jpg", ".jpeg", ".webp"]
    ALLOWED_MIME_TYPES: List[str] = [
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/webp",
    ]

    ORDER_SERVICE_URL: str = Field(default_factory=lambda: os.getenv("ORDER_SERVICE_URL", ""))

    @model_validator(mode="after")
    def validate_secrets(self):
        production = self.ENVIRONMENT == "production"
        if production:
            if not self.PRESCRIPTION_ENCRYPTION_KEY or len(self.PRESCRIPTION_ENCRYPTION_KEY) < 32:
                raise ValueError("PRESCRIPTION_ENCRYPTION_KEY (≥32 chars) is required in production")
            if not self.SERVICE_AUTH_SECRET or len(self.SERVICE_AUTH_SECRET) < 32:
                raise ValueError("SERVICE_AUTH_SECRET (≥32 chars) is required in production")
            if self.PRESCRIPTION_ENCRYPTION_KEY in INSECURE_DEFAULTS or self.SERVICE_AUTH_SECRET in INSECURE_DEFAULTS:
                raise ValueError("Insecure default secrets are not allowed in production")
        else:
            if not self.PRESCRIPTION_ENCRYPTION_KEY:
                self.PRESCRIPTION_ENCRYPTION_KEY = os.urandom(32).hex()
            if not self.SERVICE_AUTH_SECRET:
                # Dev-only ephemeral; production path already rejected empty
                self.SERVICE_AUTH_SECRET = "dev-only-prescription-service-auth-secret-key!!"
        return self

    class Config:
        case_sensitive = True

settings = Settings()
