import base64
import binascii
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

KEY_BYTES = 32
NONCE_BYTES = 12
VERSION = "v1"


class InvalidKeyError(ValueError):
    pass


class SecretBox:
    def __init__(self, key: bytes) -> None:
        if len(key) != KEY_BYTES:
            raise InvalidKeyError(f"The key must be {KEY_BYTES} bytes, got {len(key)}")

        self.cipher = AESGCM(key)

    @classmethod
    def from_base64(cls, encoded: str) -> SecretBox:
        try:
            key = base64.b64decode(encoded, validate=True)
        except binascii.Error as error:
            raise InvalidKeyError("The key is not valid base64") from error

        return cls(key)

    def seal(self, secret: str, context: str) -> str:
        nonce = os.urandom(NONCE_BYTES)
        sealed = self.cipher.encrypt(nonce, secret.encode(), context.encode())

        return f"{VERSION}.{base64.b64encode(nonce + sealed).decode()}"

    def open(self, sealed: str, context: str) -> str:
        version, encoded = sealed.split(".", 1)
        if version != VERSION:
            raise ValueError(f"Unknown sealed secret version {version}")

        raw = base64.b64decode(encoded)

        return self.cipher.decrypt(raw[:NONCE_BYTES], raw[NONCE_BYTES:], context.encode()).decode()
