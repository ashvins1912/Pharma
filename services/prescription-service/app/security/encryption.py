import hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from ..config import settings

def _derive_key(secret: str) -> bytes:
    return hashlib.sha256(secret.encode("utf-8")).digest()

class PrescriptionCrypto:
    def __init__(self, key: str = None):
        raw_key = key or settings.PRESCRIPTION_ENCRYPTION_KEY
        self.key = _derive_key(raw_key)
        self.aesgcm = AESGCM(self.key)

    def encrypt(self, data: bytes) -> bytes:
        import os
        nonce = os.urandom(12)
        ciphertext = self.aesgcm.encrypt(nonce, data, None)
        return nonce + ciphertext

    def decrypt(self, encrypted_bundle: bytes) -> bytes:
        nonce = encrypted_bundle[:12]
        ciphertext = encrypted_bundle[12:]
        return self.aesgcm.decrypt(nonce, ciphertext, None)

crypto = PrescriptionCrypto()
