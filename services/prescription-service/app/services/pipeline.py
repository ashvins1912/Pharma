"""OCR → NLP → medicine matching pipeline.

Never fabricates successful extraction. If libraries fail, raises ProcessingError
so callers mark FAILED/RETRY — never APPROVED.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

class ProcessingError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

@dataclass
class PipelineResult:
    raw_text: str = ""
    medicines: List[Dict[str, Any]] = field(default_factory=list)
    patient_name: Optional[str] = None
    overall_confidence: float = 0.0
    requires_review: bool = True
    ocr_version: str = "unavailable"
    nlp_version: str = "unavailable"
    error_code: Optional[str] = None
    error_message: Optional[str] = None

def _run_ocr(file_bytes: bytes, content_type: str) -> tuple[str, str]:
    # PDF → images via PyMuPDF when needed
    images: List[Any] = []
    try:
        if content_type == "application/pdf" or (file_bytes[:4] == b"%PDF"):
            import fitz
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            if doc.page_count < 1:
                raise ProcessingError("OCR_EMPTY", "PDF has no pages")
            for i, page in enumerate(doc):
                if i >= 15:
                    break
                pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
                import numpy as np
                import cv2
                img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
                if pix.n == 4:
                    img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
                images.append(img)
            ocr_src = "pymupdf+paddle"
        else:
            import numpy as np
            import cv2
            arr = np.frombuffer(file_bytes, dtype=np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if img is None:
                raise ProcessingError("OCR_DECODE", "Unable to decode image bytes")
            images.append(img)
            ocr_src = "opencv+paddle"
    except ProcessingError:
        raise
    except Exception as exc:
        raise ProcessingError("OCR_PREPROCESS", f"Preprocess failed: {exc}") from exc

    try:
        from paddleocr import PaddleOCR
        ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
        texts: List[str] = []
        for img in images:
            result = ocr.ocr(img, cls=True)
            if not result:
                continue
            for block in result:
                if not block:
                    continue
                for line in block:
                    if line and len(line) >= 2 and line[1]:
                        texts.append(str(line[1][0]))
        raw = "\n".join(texts).strip()
        if not raw:
            raise ProcessingError("OCR_EMPTY", "OCR produced no text")
        return raw, ocr_src
    except ProcessingError:
        raise
    except Exception as exc:
        raise ProcessingError("OCR_FAILURE", f"PaddleOCR failed: {exc}") from exc

def _run_nlp(raw_text: str) -> tuple[Optional[str], List[str], str]:
    patient = None
    medicine_lines: List[str] = []
    nlp_version = "regex-v1"
    try:
        import spacy
        try:
            nlp = spacy.load("en_core_web_sm")
            nlp_version = "spacy-en_core_web_sm"
            doc = nlp(raw_text[:10000])
            for ent in doc.ents:
                if ent.label_ == "PERSON" and not patient:
                    patient = ent.text
        except Exception:
            pass
    except Exception:
        pass

    name_match = re.search(r"(?:patient|name)\s*[:\-]\s*([A-Za-z .]{3,60})", raw_text, re.I)
    if name_match and not patient:
        patient = name_match.group(1).strip()

    for line in raw_text.splitlines():
        line = line.strip()
        if re.search(r"\b(mg|mcg|ml|tablet|tab|cap|syrup|injection)\b", line, re.I):
            medicine_lines.append(line)
    if not medicine_lines:
        # fallback: lines that look like Rx items
        for line in raw_text.splitlines():
            if re.match(r"^\s*\d+[\).\]]\s+\w+", line):
                medicine_lines.append(line.strip())
    return patient, medicine_lines, nlp_version

def _match_medicines(lines: List[str]) -> List[Dict[str, Any]]:
    try:
        from rapidfuzz import fuzz
    except Exception as exc:
        raise ProcessingError("MATCH_FAILURE", f"RapidFuzz unavailable: {exc}") from exc

    catalog = [
        "Amoxicillin 500mg",
        "Paracetamol 650mg",
        "Dolo 650",
        "Pantoprazole 40mg",
        "Azithromycin 500mg",
        "Cetirizine 10mg",
        "Metformin 500mg",
        "Amlodipine 5mg",
        "Atorvastatin 10mg",
        "Omeprazole 20mg",
    ]
    results = []
    for raw in lines[:30]:
        best_name = raw
        best_score = 0.0
        for candidate in catalog:
            score = fuzz.token_set_ratio(raw.lower(), candidate.lower()) / 100.0
            if score > best_score:
                best_score = score
                best_name = candidate
        results.append({
            "rawName": raw[:200],
            "normalizedName": best_name if best_score >= 0.55 else raw[:200],
            "confidence": round(best_score, 3),
            "requiresReview": best_score < 0.85,
        })
    return results

def process_prescription_bytes(file_bytes: Optional[bytes], content_type: str = "image/png") -> PipelineResult:
    if not file_bytes:
        raise ProcessingError("NO_DOCUMENT", "Prescription document bytes missing")

    raw_text, ocr_version = _run_ocr(file_bytes, content_type or "image/png")
    patient, medicine_lines, nlp_version = _run_nlp(raw_text)
    if not medicine_lines:
        raise ProcessingError("NLP_NO_MEDICINES", "No medicine lines detected")
    medicines = _match_medicines(medicine_lines)

    med_conf = [m["confidence"] for m in medicines] or [0.0]
    overall = sum(med_conf) / len(med_conf)
    if patient:
        overall = min(1.0, overall + 0.02)
    requires_review = overall < 0.90 or any(m["requiresReview"] for m in medicines)

    return PipelineResult(
        raw_text=raw_text[:5000],
        medicines=medicines,
        patient_name=patient,
        overall_confidence=round(overall, 3),
        requires_review=requires_review,
        ocr_version=ocr_version,
        nlp_version=nlp_version,
    )
