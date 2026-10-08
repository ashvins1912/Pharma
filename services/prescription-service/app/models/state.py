from enum import Enum
from typing import Dict, Set

class PrescriptionState(str, Enum):
    UPLOADED = "UPLOADED"
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    AUTO_APPROVED = "AUTO_APPROVED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CONVERTED_TO_ORDER = "CONVERTED_TO_ORDER"
    FAILED = "FAILED"
    INACTIVE = "INACTIVE"

VALID_TRANSITIONS: Dict[PrescriptionState, Set[PrescriptionState]] = {
    PrescriptionState.UPLOADED: {
        PrescriptionState.QUEUED,
        PrescriptionState.INACTIVE,
    },
    PrescriptionState.QUEUED: {
        PrescriptionState.PROCESSING,
        PrescriptionState.FAILED,
        PrescriptionState.INACTIVE,
    },
    PrescriptionState.PROCESSING: {
        PrescriptionState.REVIEW_REQUIRED,
        PrescriptionState.AUTO_APPROVED,
        PrescriptionState.FAILED,
        PrescriptionState.INACTIVE,
    },
    PrescriptionState.AUTO_APPROVED: {
        PrescriptionState.APPROVED,
        PrescriptionState.INACTIVE,
    },
    PrescriptionState.REVIEW_REQUIRED: {
        PrescriptionState.APPROVED,
        PrescriptionState.REJECTED,
        PrescriptionState.PROCESSING,
        PrescriptionState.INACTIVE,
    },
    PrescriptionState.APPROVED: {
        PrescriptionState.CONVERTED_TO_ORDER,
        PrescriptionState.INACTIVE,
    },
    PrescriptionState.REJECTED: {
        PrescriptionState.INACTIVE,
        PrescriptionState.QUEUED,
    },
    PrescriptionState.FAILED: {
        PrescriptionState.QUEUED,
        PrescriptionState.INACTIVE,
    },
    PrescriptionState.INACTIVE: set(),
}

def can_transition(from_state: str, to_state: str) -> bool:
    try:
        source = PrescriptionState(from_state)
        target = PrescriptionState(to_state)
    except ValueError:
        return False
    return target in VALID_TRANSITIONS.get(source, set())

def is_inactive(state: str) -> bool:
    return state == PrescriptionState.INACTIVE.value

def is_queryable(state: str) -> bool:
    return state != PrescriptionState.INACTIVE.value


PUBLIC_STATUS_MAP = {
    PrescriptionState.UPLOADED.value: "UPLOADED",
    PrescriptionState.QUEUED.value: "UPLOADED",
    PrescriptionState.PROCESSING.value: "UNDER_REVIEW",
    PrescriptionState.REVIEW_REQUIRED.value: "UNDER_REVIEW",
    PrescriptionState.AUTO_APPROVED.value: "APPROVED",
    PrescriptionState.APPROVED.value: "APPROVED",
    PrescriptionState.REJECTED.value: "REJECTED",
    PrescriptionState.CONVERTED_TO_ORDER.value: "CONVERTED_TO_ORDER",
    PrescriptionState.INACTIVE.value: "REJECTED",
    PrescriptionState.FAILED.value: "UPLOADED",
}

def public_status(state: str) -> str:
    return PUBLIC_STATUS_MAP.get(str(state), str(state))
