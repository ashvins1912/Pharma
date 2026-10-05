from enum import Enum
from typing import Dict, Set

class PrescriptionState(str, Enum):
    UPLOADED = "UPLOADED"
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    INACTIVE = "INACTIVE"

VALID_TRANSITIONS: Dict[PrescriptionState, Set[PrescriptionState]] = {
    PrescriptionState.UPLOADED: {
        PrescriptionState.QUEUED,
        PrescriptionState.INACTIVE
    },
    PrescriptionState.QUEUED: {
        PrescriptionState.PROCESSING,
        PrescriptionState.FAILED,
        PrescriptionState.INACTIVE
    },
    PrescriptionState.PROCESSING: {
        PrescriptionState.REVIEW_REQUIRED,
        PrescriptionState.COMPLETED,
        PrescriptionState.FAILED,
        PrescriptionState.INACTIVE
    },
    PrescriptionState.REVIEW_REQUIRED: {
        PrescriptionState.COMPLETED,
        PrescriptionState.PROCESSING,
        PrescriptionState.INACTIVE
    },
    PrescriptionState.COMPLETED: {
        PrescriptionState.INACTIVE
    },
    PrescriptionState.FAILED: {
        PrescriptionState.QUEUED,
        PrescriptionState.INACTIVE
    },
    PrescriptionState.INACTIVE: set()  # Terminal state: NO transitions allowed
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
    """Normal application queries must exclude INACTIVE records."""
    return state != PrescriptionState.INACTIVE.value
