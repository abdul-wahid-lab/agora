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

Phase 5b - signed discovery broadcasts. Adversarial testing (see
_test_adversarial.py's Attack 3) confirmed that trust-on-first-use above
wasn't actually reaching the layer where the real damage happens: the
live PeerRegistry (discovery.py) accepted *any* mDNS/UDP announcement for
*any* peer_id with zero verification, so a sustained flood of forged UDP
packets claiming an existing peer_id with an attacker's own encryption key
reliably won the registry, redirecting that peer_id's traffic (address,
port, *and* the encryption key derived from it) to the attacker - before
messaging.py's own trust-on-first-use check ever got a chance to notice
anything was wrong. The fix is a second, separate long-term keypair - a
signing keypair (Ed25519, never reused for the X25519 encryption above,
mixing key purposes is a real anti-pattern regardless of whether an actual
attack exploits it) - and every discovery announcement is now signed with
it. A receiver verifies the signature *and* pins the signing key to that
peer_id in storage.py's known_peers table, at the discovery layer itself,
before the announcement is ever allowed to reach the live registry - a
forged packet either has an invalid signature (rejected outright) or a
self-consistent signature from a *different* key than the one already
pinned for that peer_id (rejected as a real identity conflict, not merely
warned about after the fact). This still doesn't (and structurally can't)
protect the very first time a peer_id is ever seen - trust-on-first-use
always has that same boundary, the same as SSH's - but it closes the gap
where an *already-established* peer_id's traffic could be silently
redirected mid-relationship.

This intentionally does NOT cover WebRTC call media (audio/video) - that
path is always DTLS-SRTP encrypted by the browser/Electron engine itself,
with no way to turn that off, so there was never a gap there to close.
"""

from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.exceptions import InvalidSignature

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


def _raw_shared_secret(my_private_key_b64: str, their_public_key_b64: str) -> bytes:
    private_key = X25519PrivateKey.from_private_bytes(base64.b64decode(my_private_key_b64))
    public_key = X25519PublicKey.from_public_bytes(base64.b64decode(their_public_key_b64))
    return private_key.exchange(public_key)


def derive_directional_keys(my_private_key_b64: str, their_public_key_b64: str, my_peer_id: str, their_peer_id: str) -> tuple[bytes, bytes]:
    """Returns (send_key, recv_key) for talking to one specific peer.

    A single shared key used for both directions is a real, exploitable
    flaw: an eavesdropper who captures a ciphertext I sent to a peer can
    replay those exact bytes back to me, and I'd decrypt it successfully
    with no way to tell it apart from something that peer actually sent
    (found and confirmed via an actual reflection attack, not theoretical
    - see _test_reflection_attack.py). Binding a direction into each key's
    HKDF `info` fixes this: both sides derive the SAME raw X25519 shared
    secret as before, but then derive two labelled sub-keys from it, one
    per direction ("A->B" and "B->A"). Whichever side is "A" my own
    send_key always equals the other side's recv_key for that direction,
    and vice versa - but a blob encrypted with "A->B" can never be
    mistaken for one encrypted with "B->A", even though it's the exact
    same two devices and the exact same underlying secret.

    peer_id ordering doesn't matter here - each side just asks for its own
    (my_peer_id, their_peer_id) pair and gets back the correct two keys."""
    shared_secret = _raw_shared_secret(my_private_key_b64, their_public_key_b64)
    send_key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=HKDF_INFO + b"|" + my_peer_id.encode() + b"->" + their_peer_id.encode()).derive(shared_secret)
    recv_key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=HKDF_INFO + b"|" + their_peer_id.encode() + b"->" + my_peer_id.encode()).derive(shared_secret)
    return send_key, recv_key


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


# -- discovery-broadcast signing (Ed25519) -----------------------------------
# A deliberately separate keypair from the X25519 one above - a DH key and a
# signing key are different mathematical objects with different security
# properties, and reusing one for both purposes is a well-known crypto
# engineering anti-pattern regardless of whether a concrete attack exploits
# it here.


def generate_signing_keypair() -> tuple[str, str]:
    """Returns (signing_private_key_b64, signing_public_key_b64)."""
    private_key = Ed25519PrivateKey.generate()
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


def announcement_bytes(peer_id: str, address: str, port: int, public_key: str) -> bytes:
    """The exact bytes a discovery announcement's signature covers -
    deterministic and identical on both the signing (sender) and verifying
    (receiver) side. Plain delimited fields, not JSON: dict key order and
    whitespace are incidental in JSON and this must never depend on either.

    device_name is deliberately NOT covered: it's cosmetic display data a
    user can legitimately change at any time, not a security-relevant
    claim - the actual property worth signing is "this peer_id's traffic
    really goes to this address/port, encrypted with this public key",
    which is exactly the redirection an attacker needs to actually
    intercept anything."""
    fields = [peer_id, address, str(port), public_key]
    return "\x1f".join(fields).encode()


def sign_announcement(signing_private_key_b64: str, peer_id: str, address: str, port: int, public_key: str) -> str:
    private_key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(signing_private_key_b64))
    signature = private_key.sign(announcement_bytes(peer_id, address, port, public_key))
    return base64.b64encode(signature).decode()


def verify_announcement(signing_public_key_b64: str, signature_b64: str, peer_id: str, address: str, port: int, public_key: str) -> bool:
    """True if `signature_b64` is a valid Ed25519 signature, by whoever
    holds the private half of `signing_public_key_b64`, over exactly this
    announcement's fields. False for anything else (malformed key,
    malformed signature, or a signature that's simply wrong) - never
    raises, so a caller can treat "not verified" as one uniform outcome
    rather than needing to catch several different exception types."""
    try:
        public_key_obj = Ed25519PublicKey.from_public_bytes(base64.b64decode(signing_public_key_b64))
        public_key_obj.verify(base64.b64decode(signature_b64), announcement_bytes(peer_id, address, port, public_key))
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False
