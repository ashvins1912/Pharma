from typing import Optional, Dict, Any
import uuid
import re

class HospitalService:
    def __init__(self):
        self._hospitals: Dict[str, Dict[str, Any]] = {}

    def _normalize_key(self, name: str, city: str = "", state: str = "") -> str:
        clean_name = re.sub(r"\s+", " ", (name or "").strip().lower())
        clean_city = (city or "").strip().lower()
        clean_state = (state or "").strip().lower()
        return f"{clean_name}|{clean_city}|{clean_state}"

    async def get_or_create_hospital(
        self,
        name: str,
        address: Optional[Dict[str, Any]] = None,
        phone: Optional[str] = None,
        email: Optional[str] = None,
        registration_number: Optional[str] = None
    ) -> Dict[str, Any]:
        address = address or {}
        key = self._normalize_key(name, address.get("city", ""), address.get("state", ""))

        for h in self._hospitals.values():
            h_addr = h.get("address", {})
            if self._normalize_key(h.get("name", ""), h_addr.get("city", ""), h_addr.get("state", "")) == key:
                return h

        hospital_id = f"hosp_{uuid.uuid4().hex[:12]}"
        record = {
            "hospitalId": hospital_id,
            "name": name.strip(),
            "address": address,
            "phone": phone or "",
            "email": email or "",
            "registrationNumber": registration_number or "",
            "status": "ACTIVE"
        }
        self._hospitals[hospital_id] = record
        return record

hospital_service = HospitalService()
