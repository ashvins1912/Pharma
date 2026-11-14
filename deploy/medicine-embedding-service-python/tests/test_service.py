import os

os.environ.setdefault("MEDICINE_EMBEDDING_TOKEN", "test-secret-token-with-at-least-32-chars")

from app.main import is_authorized


def test_authorization_requires_exact_bearer_token():
    assert is_authorized("Bearer test-secret-token-with-at-least-32-chars")
    assert not is_authorized(None)
    assert not is_authorized("Basic test-secret-token-with-at-least-32-chars")
    assert not is_authorized("Bearer wrong-token")


def test_authorization_is_case_insensitive_for_scheme():
    assert is_authorized("bearer test-secret-token-with-at-least-32-chars")
