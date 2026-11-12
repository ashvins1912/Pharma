from app.services.pipeline import _parse_medicine_line, _parse_frequency, _parse_duration
from app.models.schemas import MedicineItem

def test_medicine_line_extracts_dose_frequency_duration_and_course():
    item = _parse_medicine_line("Amoxicillin 500mg 1 tablet TDS for 5 days")
    assert item["normalizedName"]
    assert item["strength"]["value"] == 500
    assert item["strength"]["unit"] == "mg"
    assert item["dose"]["value"] == 1
    assert item["frequency"]["normalized"] == "THREE_TIMES_DAILY"
    assert item["duration"]["days"] == 5
    assert item["course"]["calculatedQuantity"] == 15

def test_frequency_aliases():
    assert _parse_frequency("1 tab BD")["normalized"] == "TWICE_DAILY"
    assert _parse_frequency("1 tab q8h")["normalized"] == "EVERY_8_HOURS"

def test_duration():
    assert _parse_duration("for 2 weeks")["days"] == 14

def test_response_schema_accepts_structured_medicine_fields():
    item = _parse_medicine_line("Paracetamol 650mg 1 tablet BD for 5 days")
    model = MedicineItem(**item)
    assert model.strength.value == 650
    assert model.dose.value == 1
    assert model.frequency.normalized == "TWICE_DAILY"
    assert model.duration.value == 5
    assert model.course.calculatedQuantity == 10

def test_dose_is_not_mistaken_for_course_quantity():
    item = _parse_medicine_line("Amoxicillin 500mg 1 tablet TDS for 5 days")
    assert item["course"]["value"] is None if item["course"] else True
    assert item["course"]["calculatedQuantity"] == 15

def test_explicit_course_quantity_is_preserved():
    item = _parse_medicine_line("Amoxicillin 500mg 1 tablet TDS for 5 days Qty 15 tablets")
    assert item["course"]["value"] == 15
    assert item["course"]["calculatedQuantity"] == 15


def test_ocr_candidate_ranking_prefers_high_confidence_readable_medical_text():
    from app.services.pipeline import _ocr_candidate_score, _select_ocr_candidate

    candidates = [
        {"text": "Amox1c1llin 5O0mg ???", "confidence": 0.41, "variant": "original"},
        {"text": "Amoxicillin 500mg 1 tablet BD", "confidence": 0.91, "variant": "clahe"},
    ]
    selected = _select_ocr_candidate(candidates)
    assert selected["variant"] == "clahe"
    assert _ocr_candidate_score(selected["text"], selected["confidence"]) > 0.75


def test_ocr_candidate_selection_never_joins_conflicting_hypotheses():
    from app.services.pipeline import _select_ocr_candidate

    selected = _select_ocr_candidate([
        {"text": "Dolo 650mg", "confidence": 0.82, "variant": "original"},
        {"text": "Dolo 500mg", "confidence": 0.78, "variant": "threshold"},
    ])
    assert selected["text"] in {"Dolo 650mg", "Dolo 500mg"}
    assert "650mg" not in selected["text"] or "500mg" not in selected["text"]


def test_empty_ocr_candidates_are_rejected():
    from app.services.pipeline import _select_ocr_candidate

    assert _select_ocr_candidate([{"text": "", "confidence": 0.99}]) is None
