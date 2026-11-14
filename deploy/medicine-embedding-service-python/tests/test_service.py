import os
import unittest

os.environ.setdefault("MEDICINE_EMBEDDING_TOKEN", "test-secret-token-with-at-least-32-chars")

from app.main import is_authorized


class AuthorizationTests(unittest.TestCase):
    def test_authorization_requires_exact_bearer_token(self):
        self.assertTrue(is_authorized("Bearer test-secret-token-with-at-least-32-chars"))
        self.assertFalse(is_authorized(None))
        self.assertFalse(is_authorized("Basic test-secret-token-with-at-least-32-chars"))
        self.assertFalse(is_authorized("Bearer wrong-token"))

    def test_authorization_scheme_is_case_insensitive(self):
        self.assertTrue(is_authorized("bearer test-secret-token-with-at-least-32-chars"))


if __name__ == "__main__":
    unittest.main()
