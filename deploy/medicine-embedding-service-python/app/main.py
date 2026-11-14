import asyncio
import hmac
import logging
import os
from contextlib import asynccontextmanager
from typing import Any

import numpy as np
from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("medicine-embedding")

MODEL_ID = os.getenv("MEDICINE_VECTOR_MODEL", "onnx-community/all-MiniLM-L6-v2-ONNX")
MODEL_REVISION = os.getenv("MEDICINE_VECTOR_MODEL_REVISION", "main")
DIMENSIONS = int(os.getenv("MEDICINE_VECTOR_DIMENSIONS", "384"))
TOKEN = os.getenv("MEDICINE_EMBEDDING_TOKEN", "")
MAX_BATCH = 32
MAX_TEXT_CHARS = 4000
MAX_CONCURRENT = max(1, min(8, int(os.getenv("MEDICINE_EMBEDDING_MAX_CONCURRENT", "2"))))
MAX_TOKENS = 256


class EmbeddingRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=MAX_BATCH)


class ModelRuntime:
    def __init__(self) -> None:
        self.tokenizer: Any = None
        self.model: Any = None
        self.ready = False

    def load(self) -> None:
        # Optimum loads the ONNX graph and executes it with ONNX Runtime.
        from optimum.onnxruntime import ORTModelForFeatureExtraction
        from transformers import AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
        model = ORTModelForFeatureExtraction.from_pretrained(
            MODEL_ID,
            revision=MODEL_REVISION,
            provider="CPUExecutionProvider",
        )
        actual_dimensions = int(getattr(model.config, "hidden_size", 0))
        if actual_dimensions != DIMENSIONS:
            raise RuntimeError(
                f"Model dimension mismatch: expected {DIMENSIONS}, got {actual_dimensions}"
            )
        model.eval()
        self.tokenizer = tokenizer
        self.model = model
        self.ready = True

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not self.ready or self.model is None or self.tokenizer is None:
            raise RuntimeError("Embedding model is not ready")

        tokens = self.tokenizer(
            texts,
            padding=True,
            truncation=True,
            max_length=MAX_TOKENS,
            return_tensors="pt",
        )
        outputs = self.model(**tokens)
        hidden = outputs.last_hidden_state.detach().cpu().numpy()
        mask = tokens["attention_mask"].cpu().numpy().astype(np.float32)[..., None]
        pooled = (hidden * mask).sum(axis=1) / np.maximum(mask.sum(axis=1), 1e-9)
        norms = np.linalg.norm(pooled, axis=1, keepdims=True)
        normalized = pooled / np.maximum(norms, 1e-12)
        if normalized.shape != (len(texts), DIMENSIONS) or not np.isfinite(normalized).all():
            raise RuntimeError("Model returned an invalid embedding shape or value")
        return normalized.astype(np.float32).tolist()


runtime = ModelRuntime()
capacity = asyncio.Semaphore(MAX_CONCURRENT)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await asyncio.to_thread(runtime.load)
        logger.info("embedding model ready: %s (%s)", MODEL_ID, MODEL_REVISION)
    except Exception as exc:  # Keep liveness up; readiness stays false and caller falls back.
        logger.exception("embedding model initialization failed: %s", type(exc).__name__)
    yield


app = FastAPI(title="Pharma Medicine Embedding Service", docs_url=None, redoc_url=None, lifespan=lifespan)


def is_authorized(header: str | None) -> bool:
    if not TOKEN or not header or not header.lower().startswith("bearer "):
        return False
    supplied = header[7:].strip()
    return bool(supplied) and hmac.compare_digest(supplied.encode(), TOKEN.encode())


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    return response


@app.get("/health")
async def health():
    return {"status": "ok", "service": "medicine-embedding-python"}


@app.get("/ready")
async def ready():
    if not runtime.ready:
        raise HTTPException(status_code=503, detail={"status": "loading-model"})
    return {
        "status": "ready",
        "model": MODEL_ID,
        "revision": MODEL_REVISION,
        "dimensions": DIMENSIONS,
    }


@app.post("/v1/embeddings")
async def embeddings(payload: EmbeddingRequest, authorization: str | None = Header(default=None)):
    if not is_authorized(authorization):
        raise HTTPException(status_code=401, detail={"code": "EMBEDDING_UNAUTHORIZED"})
    if any(not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_CHARS for text in payload.texts):
        raise HTTPException(status_code=400, detail={"code": "INVALID_EMBEDDING_INPUT"})
    if not runtime.ready:
        raise HTTPException(status_code=503, detail={"code": "EMBEDDING_UNAVAILABLE"})
    if capacity.locked():
        raise HTTPException(status_code=503, headers={"Retry-After": "1"}, detail={"code": "EMBEDDING_BUSY"})
    async with capacity:
        try:
            vectors = await asyncio.to_thread(runtime.embed, payload.texts)
        except Exception as exc:
            logger.exception("embedding inference failed: %s", type(exc).__name__)
            raise HTTPException(status_code=503, detail={"code": "EMBEDDING_UNAVAILABLE"}) from None
    return {
        "model": MODEL_ID,
        "revision": MODEL_REVISION,
        "dimensions": DIMENSIONS,
        "embeddings": vectors,
    }
