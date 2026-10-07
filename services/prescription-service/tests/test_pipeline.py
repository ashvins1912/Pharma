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
