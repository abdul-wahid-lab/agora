"""
Phase 5 - Transport encryption and peer identity.

There's no central authority here to issue TLS certificates from - this is
a peer-to-peer LAN app with no server anywhere, ever. The approach that
fits a no-authority design is the one SSH and Signal both use instead of
TLS:

  1. Each device generates its own X25519 keypair once, on first run, and
     keeps the private half local forever (storage.py's device_identity
     table). The public half is broadcast openly alongside peer_id/name
     over the existing discovery channel (mDNS/UDP) - it's public by
     design, there's nothing to protect by hiding it.
  2. Any two peers who both know each other's public key can independently
     compute the same shared secret via X25519 (Diffie-Hellman on Curve25519),
     without ever transmitting it.
  3. That shared secret is run through HKDF to derive a 32-byte symmetric
     key, then every real message/control/file-chunk frame exchanged with
     that peer is encrypted with ChaCha20-Poly1305 (authenticated
     encryption - tampering is detected, not just confidentiality).
  4. Trust-on-first-use: the first time a peer_id is ever seen, its public
     key is remembered (known_peers.public_key). If that same peer_id ever
     shows up with a *different* key later, that's a real red flag -
     someone else now claiming an identity they don't own (or a genuine
     reinstall) - surfaced to the user rather than silently trusted.

This intentionally does NOT cover WebRTC call media (audio/video) - that
path is always DTLS-SRTP encrypted by the browser/Electron engine itself,
with no way to turn that off, so there was never a gap there to close.
"""

from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

HKDF_INFO = b"agora-transport-v1"
NONCE_LEN = 12


class DecryptionError(Exception):
    """Raised when a frame fails to authenticate - either genuine tampering/
    corruption, or (far more likely in practice) a stale/wrong shared key.
    Callers treat this as "drop the frame", never as a crash."""


def generate_keypair() -> tuple[str, str]:
    """Returns (private_key_b64, public_key_b64) for a brand-new identity."""
    private_key = X25519PrivateKey.generate()
    private_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_bytes = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return base64.b64encode(private_bytes).decode(), base64.b64encode(public_bytes).decode()


def derive_shared_key(my_private_key_b64: str, their_public_key_b64: str) -> bytes:
    """X25519 key exchange + HKDF-SHA256. Symmetric by construction - both
    sides call this with their own private key and the other's public key,
    and always land on the exact same 32-byte result, with nothing ever
    sent over the wire to negotiate it."""
    private_key = X25519PrivateKey.from_private_bytes(base64.b64decode(my_private_key_b64))
    public_key = X25519PublicKey.from_public_bytes(base64.b64decode(their_public_key_b64))
    shared_secret = private_key.exchange(public_key)
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=HKDF_INFO).derive(shared_secret)


def encrypt(key: bytes, plaintext: bytes) -> bytes:
    """A random 96-bit nonce per call is the standard, safe choice for
    ChaCha20-Poly1305 (no counter/state to persist across restarts or
    coordinate between sender/receiver) - at this app's real message and
    file-chunk volumes, the odds of two random nonces ever colliding for
    the same key are not a realistic concern. Returns nonce || ciphertext
    (ciphertext already includes the 16-byte auth tag)."""
    nonce = os.urandom(NONCE_LEN)
    ciphertext = ChaCha20Poly1305(key).encrypt(nonce, plaintext, None)
    return nonce + ciphertext


def decrypt(key: bytes, blob: bytes) -> bytes:
    if len(blob) < NONCE_LEN:
        raise DecryptionError("frame too short to contain a nonce")
    nonce, ciphertext = blob[:NONCE_LEN], blob[NONCE_LEN:]
    try:
        return ChaCha20Poly1305(key).decrypt(nonce, ciphertext, None)
    except Exception as e:  # cryptography raises InvalidTag - don't leak that type to callers
        raise DecryptionError(str(e)) from e
