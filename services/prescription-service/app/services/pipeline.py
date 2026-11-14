"""Production prescription OCR/NLP extraction pipeline.

The pipeline only reports what was actually extracted from the document. It never
claims a medicine is catalog-matched unless a real catalog matcher is integrated.
Dose/frequency/duration/course fields are parsed from OCR text and are treated as
clinical verification inputs, not dispensing authorization by themselves.
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


_FREQ_MAP = {
    "od": ("ONCE_DAILY", 1),
    "qd": ("ONCE_DAILY", 1),
    "once daily": ("ONCE_DAILY", 1),
    "daily": ("ONCE_DAILY", 1),
    "bd": ("TWICE_DAILY", 2),
    "bid": ("TWICE_DAILY", 2),
    "twice daily": ("TWICE_DAILY", 2),
    "tds": ("THREE_TIMES_DAILY", 3),
    "tid": ("THREE_TIMES_DAILY", 3),
    "three times daily": ("THREE_TIMES_DAILY", 3),
    "qid": ("FOUR_TIMES_DAILY", 4),
    "four times daily": ("FOUR_TIMES_DAILY", 4),
    "hs": ("AT_BEDTIME", 1),
    "at bedtime": ("AT_BEDTIME", 1),
    "sos": ("AS_NEEDED", None),
    "prn": ("AS_NEEDED", None),
}

_UNIT_PATTERN = r"(?:tablet|tablets|tab|tabs|capsule|capsules|cap|caps|ml|milliliter|milliliters|puff|puffs|drop|drops|injection|vial|vials)"
_STRENGTH_PATTERN = r"(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>mg|mcg|g|ml|iu|%)"


def _normalize_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _parse_frequency(text: str) -> Optional[Dict[str, Any]]:
    normalized = _normalize_spaces(text).lower()
    for raw_key, (canonical, per_day) in sorted(_FREQ_MAP.items(), key=lambda item: -len(item[0])):
        if raw_key in normalized:
            return {
                "raw": raw_key,
                "normalized": canonical,
                "timesPerDay": per_day,
                "confidence": 0.94,
            }
    interval = re.search(r"\bq\s*(\d+)\s*h\b", normalized)
    if interval:
        hours = int(interval.group(1))
        per_day = round(24 / hours, 2) if hours > 0 else None
        return {
            "raw": interval.group(0),
            "normalized": f"EVERY_{hours}_HOURS",
            "timesPerDay": per_day,
            "confidence": 0.90,
        }
    return None


def _parse_strength(text: str) -> Optional[Dict[str, Any]]:
    match = re.search(_STRENGTH_PATTERN, text or "", re.I)
    if not match:
        return None
    return {
        "value": float(match.group("value")) if "." in match.group("value") else int(match.group("value")),
        "unit": match.group("unit").lower(),
        "confidence": 0.95,
    }


def _parse_dose(text: str) -> Optional[Dict[str, Any]]:
    match = re.search(
        rf"\b(?P<value>\d+(?:\.\d+)?|1/2|1/4)\s*(?P<unit>{_UNIT_PATTERN})\b",
        text or "",
        re.I,
    )
    if not match:
        return None
    raw_value = match.group("value")
    value = float(raw_value) if "/" in raw_value or "." in raw_value else int(raw_value)
    if isinstance(value, str):
        value = float(value)
    return {
        "value": value,
        "unit": match.group("unit").lower(),
        "confidence": 0.93,
    }


def _parse_duration(text: str) -> Optional[Dict[str, Any]]:
    normalized = _normalize_spaces(text).lower()
    patterns = [
        r"\b(?:for|x)\s*(\d+)\s*(day|days|week|weeks|month|months)\b",
        r"\b(\d+)\s*(day|days|week|weeks|month|months)\b",
        r"\bx\s*(\d+)\s*(d|w|m)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, normalized, re.I)
        if not match:
            continue
        value = int(match.group(1))
        unit = match.group(2).lower()
        canonical_unit = {
            "d": "days",
            "w": "weeks",
            "m": "months",
        }.get(unit, unit)
        days = value
        if canonical_unit.startswith("week"):
            days = value * 7
        elif canonical_unit.startswith("month"):
            days = value * 30
        return {
            "value": value,
            "unit": canonical_unit,
            "days": days,
            "raw": match.group(0),
            "confidence": 0.92,
        }
    return None


def _parse_course(text: str) -> Optional[Dict[str, Any]]:
    # A course quantity must be explicit. Do not interpret the dosage ("1 tablet")
    # as the total course quantity; that is calculated separately from
    # dose × frequency × duration.
    normalized = _normalize_spaces(text)
    match = re.search(
        rf"\b(?:qty|quantity|course|dispense|#)\s*[:=]?\s*(\d+)\s*({_UNIT_PATTERN})?\b",
        normalized,
        re.I,
    )
    if not match:
        return None
    quantity = int(match.group(1))
    unit = (match.group(2) or "").lower() or None
    return {
        "value": quantity,
        "unit": unit,
        "raw": match.group(0),
        "confidence": 0.96,
    }


def _parse_route(text: str) -> Optional[Dict[str, Any]]:
    normalized = _normalize_spaces(text).lower()
    for route in ("oral", "po", "topical", "iv", "im", "intravenous", "intramuscular", "subcutaneous", "sublingual"):
        if re.search(rf"\b{re.escape(route)}\b", normalized):
            return {"value": route.upper(), "confidence": 0.88}
    return None


def _parse_instructions(text: str) -> Optional[Dict[str, Any]]:
    normalized = _normalize_spaces(text)
    patterns = [
        r"\bafter food\b",
        r"\bbefore food\b",
        r"\bafter meals?\b",
        r"\bbefore meals?\b",
        r"\bat bedtime\b",
        r"\bon empty stomach\b",
        r"\bwith water\b",
        r"\bwith warm water\b",
        r"\bwith food\b",
    ]
    matches = [m.group(0) for pattern in patterns for m in re.finditer(pattern, normalized, re.I)]
    if not matches:
        return None
    unique = list(dict.fromkeys(matches))
    return {"value": "; ".join(unique), "confidence": 0.88}


def _clean_medicine_name(raw: str) -> str:
    cleaned = raw
    cleaned = re.sub(_STRENGTH_PATTERN, "", cleaned, flags=re.I)
    cleaned = re.sub(rf"\b\d+(?:\.\d+)?\s*{_UNIT_PATTERN}\b", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\b(?:od|qd|bd|bid|tds|tid|qid|hs|sos|prn)\b", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\b(?:once|twice|three|four)\s+times?\s+(?:daily|a day)\b", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\b(?:for|x)\s*\d+\s*(?:d|day|days|w|week|weeks|m|month|months)\b", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\b(?:qty|quantity|course|dispense|#)\s*[:=]?\s*\d+\b", "", cleaned, flags=re.I)
    cleaned = re.sub(r"^[\s\-:.)\d]+", "", cleaned)
    cleaned = _normalize_spaces(cleaned).strip("-,:;.")
    return cleaned or _normalize_spaces(raw)


def _parse_medicine_line(raw: str) -> Dict[str, Any]:
    raw = _normalize_spaces(raw)
    strength = _parse_strength(raw)
    dose = _parse_dose(raw)
    frequency = _parse_frequency(raw)
    duration = _parse_duration(raw)
    course = _parse_course(raw)
    route = _parse_route(raw)
    instructions = _parse_instructions(raw)
    name = _clean_medicine_name(raw)

    parse_signals = [bool(strength), bool(dose), bool(frequency), bool(duration), bool(course)]
    confidence = 0.72
    confidence += 0.05 * sum(parse_signals)
    if name and len(name.split()) >= 1:
        confidence += 0.05
    confidence = min(0.98, round(confidence, 3))

    calculated_quantity = None
    if dose and frequency and duration and frequency.get("timesPerDay"):
        dose_value = dose.get("value")
        if isinstance(dose_value, (int, float)) and duration.get("days"):
            calculated_quantity = round(float(dose_value) * float(frequency["timesPerDay"]) * float(duration["days"]), 2)

    return {
        "rawName": raw[:200],
        "normalizedName": name[:200],
        "strength": strength,
        "dose": dose,
        "route": route,
        "frequency": frequency,
        "duration": duration,
        "course": {
            **course,
            "calculatedQuantity": calculated_quantity,
        } if course else ({
            "calculatedQuantity": calculated_quantity,
            "raw": None,
            "confidence": 0.55
        } if calculated_quantity is not None else None),
        "instructions": instructions,
        "confidence": confidence,
        "requiresReview": confidence < 0.90 or not strength or not dose or not frequency,
        "medicineValidation": {
            "status": "NOT_FOUND",
            "productId": None,
            "candidateCount": 0,
            "confidence": 0.0,
        },
    }


def _run_ocr(file_bytes: bytes, content_type: str) -> tuple[str, str]:
    images: List[Any] = []
    try:
        if content_type == "application/pdf" or file_bytes[:4] == b"%PDF":
            import fitz
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            if doc.page_count < 1:
                raise ProcessingError("OCR_EMPTY", "PDF has no pages")
            for index, page in enumerate(doc):
                if index >= 15:
                    break
                pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                import numpy as np
                import cv2
                img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
                if pix.n == 4:
                    img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
                elif pix.n == 3:
                    img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
                images.append(img)
            source = "pymupdf+paddle"
        else:
            import numpy as np
            import cv2
            img = cv2.imdecode(np.frombuffer(file_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                raise ProcessingError("OCR_DECODE", "Unable to decode image bytes")
            images.append(img)
            source = "opencv+paddle"
    except ProcessingError:
        raise
    except Exception as exc:
        raise ProcessingError("OCR_PREPROCESS", f"Preprocess failed: {exc}") from exc

    try:
        try:
            from paddleocr import PaddleOCR
            try:
                ocr = PaddleOCR(
                    lang="en",
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=False,
                    show_log=False,
                )
                ocr_version = "paddleocr-new"
            except TypeError:
                ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
                ocr_version = "paddleocr-legacy"
        except Exception as exc:
            raise ProcessingError("OCR_IMPORT", f"PaddleOCR unavailable: {exc}") from exc

        texts: List[str] = []
        for image in images:
            result = ocr.ocr(image, cls=True)
            if not result:
                continue
            for block in result:
                if isinstance(block, dict):
                    rec_texts = block.get("rec_texts") or block.get("text") or []
                    texts.extend(str(value) for value in rec_texts if str(value).strip())
                    continue
                if hasattr(block, "json"):
                    try:
                        payload = block.json
                        if isinstance(payload, str):
                            import json
                            payload = json.loads(payload)
                        res = payload.get("res", payload) if isinstance(payload, dict) else {}
                        rec_texts = res.get("rec_texts") or []
                        texts.extend(str(value) for value in rec_texts if str(value).strip())
                        continue
                    except Exception:
                        pass
                if isinstance(block, list):
                    for line in block:
                        if line and len(line) >= 2 and isinstance(line[1], (list, tuple)) and line[1]:
                            texts.append(str(line[1][0]))
        raw = "\n".join(texts).strip()
        if not raw:
            raise ProcessingError("OCR_EMPTY", "OCR produced no text")
        return raw, source + ":" + ocr_version
    except ProcessingError:
        raise
    except Exception as exc:
        raise ProcessingError("OCR_FAILURE", f"PaddleOCR failed: {exc}") from exc


def _run_nlp(raw_text: str) -> tuple[Optional[str], List[str], str]:
    patient = None
    medicine_lines: List[str] = []
    nlp_version = "regex-v2"
    try:
        import spacy
        try:
            nlp = spacy.load("en_core_web_sm")
            nlp_version = "spacy-en_core_web_sm"
            doc = nlp(raw_text[:10000])
            for ent in doc.ents:
                if ent.label_ == "PERSON" and not patient:
                    patient = ent.text.strip()
        except Exception:
            pass
    except Exception:
        pass

    name_match = re.search(r"(?:patient|patient name|name)\s*[:\-]\s*([A-Za-z .]{3,60})", raw_text, re.I)
    if name_match and not patient:
        patient = _normalize_spaces(name_match.group(1))

    for line in raw_text.splitlines():
        normalized = _normalize_spaces(line)
        if not normalized:
            continue
        looks_like_medicine = bool(re.search(
            rf"(?:{_STRENGTH_PATTERN}|\b{_UNIT_PATTERN}\b|\b(?:od|qd|bd|bid|tds|tid|qid|hs|sos|prn)\b|\bfor\s+\d+\s*(?:day|days|week|weeks)\b)",
            normalized,
            re.I,
        ))
        if looks_like_medicine:
            medicine_lines.append(normalized)
    if not medicine_lines:
        medicine_lines = [
            _normalize_spaces(line)
            for line in raw_text.splitlines()
            if re.match(r"^\s*\d+[\).\]]\s+\w+", line)
        ]
    return patient, medicine_lines[:30], nlp_version


def _match_medicines(lines: List[str]) -> List[Dict[str, Any]]:
    if not lines:
        return []
    return [_parse_medicine_line(line) for line in lines[:30]]


def process_prescription_bytes(file_bytes: Optional[bytes], content_type: str = "image/png") -> PipelineResult:
    if not file_bytes:
        raise ProcessingError("NO_DOCUMENT", "Prescription document bytes missing")

    raw_text, ocr_version = _run_ocr(file_bytes, content_type or "image/png")
    patient, medicine_lines, nlp_version = _run_nlp(raw_text)
    if not medicine_lines:
        raise ProcessingError("NLP_NO_MEDICINES", "No medicine lines detected")

    medicines = _match_medicines(medicine_lines)
    med_conf = [m.get("confidence", 0.0) for m in medicines] or [0.0]
    overall = sum(med_conf) / len(med_conf)
    if patient:
        overall = min(1.0, overall + 0.02)
    requires_review = overall < 0.90 or any(m.get("requiresReview") for m in medicines)

    return PipelineResult(
        raw_text=raw_text[:10000],
        medicines=medicines,
        patient_name=patient,
        overall_confidence=round(overall, 3),
        requires_review=requires_review,
        ocr_version=ocr_version,
        nlp_version=nlp_version,
    )
