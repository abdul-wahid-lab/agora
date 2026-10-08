"""
Phase 1 - Peer Discovery

Two independent discovery paths feed the same peer registry:
  1. mDNS/Zeroconf (primary) - service type _lanchat._tcp.local.
  2. UDP broadcast (fallback) - for networks where mDNS is filtered.

A peer discovered by either path lands in the same PeerRegistry, keyed by
peer_id, so callers never need to know which transport found it.
"""

from __future__ import annotations

import json
import logging
import platform
import socket
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Optional

from zeroconf import ServiceBrowser, ServiceInfo, ServiceListener, Zeroconf

from app import crypto_identity

SERVICE_TYPE = "_lanchat._tcp.local."
UDP_BROADCAST_PORT = 42424
UDP_ANNOUNCE_INTERVAL_SEC = 3.0
PEER_TTL_SEC = 10.0  # if we haven't heard from a peer in this long, drop it


def detect_device_type() -> str:
    """A real, honest device-type label ("Windows PC"/"Mac"/"Linux PC"),
    not a fabricated specific model name - see the design reference's own
    "MacBook Pro"/"Pixel" examples. Python has no portable, reliable way to
    read the actual hardware model (that needs OS-specific native calls on
    every platform), so this reports what it can genuinely know - the OS -
    rather than inventing a plausible-looking model string with nothing
    real behind it."""
    system = platform.system()
    if system == "Windows":
        return "Windows PC"
    if system == "Darwin":
        return "Mac"
    if system == "Linux":
        return "Linux PC"
    return "Unknown device"


@dataclass
class Peer:
    peer_id: str
    name: str
    address: str
    port: int
    source: str  # "mdns" or "udp"
    last_seen: float = field(default_factory=time.time)
    # This peer's X25519 public key (base64), broadcast openly alongside
    # peer_id/name - see crypto_identity.py for why that's fine (it's
    # public by design). Empty string means not yet resolved (a fresh
    # sighting whose full record hasn't arrived, or - in principle - a
    # peer running old code without this field at all); messaging.py
    # treats that as "can't encrypt to this peer yet" rather than ever
    # falling back to sending anything unencrypted.
    public_key: str = ""
    device_type: str = ""

    def is_expired(self, now: Optional[float] = None) -> bool:
        return (now or time.time()) - self.last_seen > PEER_TTL_SEC


class PeerRegistry:
    """Thread-safe store of currently-visible peers, deduped by peer_id."""

    def __init__(self, on_change: Optional[Callable[[], None]] = None):
        self._peers: dict[str, Peer] = {}
        self._lock = threading.Lock()
        self._on_change = on_change

    def upsert(self, peer: Peer) -> None:
        with self._lock:
            self._peers[peer.peer_id] = peer
        if self._on_change:
            self._on_change()

    def remove(self, peer_id: str) -> None:
        with self._lock:
            self._peers.pop(peer_id, None)
        if self._on_change:
            self._on_change()

    def sweep_expired(self) -> list[str]:
        """Drop peers whose TTL lapsed (no heartbeat/re-announce). Returns removed ids."""
        now = time.time()
        removed = []
        with self._lock:
            for pid, peer in list(self._peers.items()):
                if peer.is_expired(now):
                    del self._peers[pid]
                    removed.append(pid)
        if removed and self._on_change:
            self._on_change()
        return removed

    def list(self) -> list[Peer]:
        with self._lock:
            return sorted(self._peers.values(), key=lambda p: p.name.lower())


class _MdnsListener(ServiceListener):
    def __init__(self, registry: PeerRegistry, self_peer_id: str, on_verify_signing_key: Optional[Callable[[str, str], bool]] = None):
        self._registry = registry
        self._self_peer_id = self_peer_id
        self._on_verify_signing_key = on_verify_signing_key

    def add_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        self._handle(zc, type_, name)

    def update_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        self._handle(zc, type_, name)

    def remove_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        peer_id = name.split(".")[0]
        if peer_id != self._self_peer_id:
            self._registry.remove(peer_id)

    def _handle(self, zc: Zeroconf, type_: str, name: str) -> None:
        # The whole body is deliberately one try/except: a real 32-way
        # concurrent stress run found that an exception from
        # on_verify_signing_key (a transient SQLite lock, at the time - see
        # storage.py's own fix) propagating out of here is not a contained
        # failure. zeroconf's ServiceBrowser dispatches add_service/
        # update_service from its own internal thread, and nothing
        # upstream of this method is guaranteed to catch an unexpected
        # exception and keep that thread alive - relying on a third-party
        # library's internal exception handling as the only safety net
        # here would be a real single point of failure for one of this
        # app's two discovery paths. One malformed/unlucky announcement
        # dropping is correct and silent; the whole mDNS listener dying
        # for the rest of the session is not.
        try:
            info = zc.get_service_info(type_, name)
            if info is None or not info.addresses:
                return
            props = {k.decode(): v.decode() for k, v in info.properties.items()}
            peer_id = props.get("peer_id", name.split(".")[0])
            if peer_id == self._self_peer_id:
                return
            address = socket.inet_ntoa(info.addresses[0])
            port = info.port or 0
            public_key = props.get("public_key", "")
            # Signature verification (see crypto_identity.py's signed-broadcast
            # section, and the module docstring's Phase 5b) - an announcement
            # missing a signature, or one that doesn't verify, or one whose
            # signing key conflicts with what's already pinned for this
            # peer_id, is dropped outright rather than ever reaching the live
            # registry. Not optional/best-effort: a forged mDNS/UDP packet is
            # exactly how a real, confirmed attack redirected an established
            # peer_id's traffic before this existed.
            signing_public_key = props.get("signing_public_key", "")
            signature = props.get("signature", "")
            if not signing_public_key or not signature:
                return
            if not crypto_identity.verify_announcement(signing_public_key, signature, peer_id, address, port, public_key):
                return
            if self._on_verify_signing_key and not self._on_verify_signing_key(peer_id, signing_public_key):
                return
            self._registry.upsert(
                Peer(
                    peer_id=peer_id,
                    name=props.get("device_name", name),
                    address=address,
                    port=port,
                    source="mdns",
                    public_key=public_key,
                    device_type=props.get("device_type", ""),
                )
            )
        except Exception:
            logging.getLogger(__name__).exception("mDNS announcement from %s dropped due to an unexpected error", name)


class PeerDiscovery:
    """Announces this device and browses for others, on mDNS and UDP broadcast."""

    def __init__(
        self,
        device_name: str,
        service_port: int,
        peer_id: Optional[str] = None,
        public_key: str = "",
        signing_private_key: str = "",
        signing_public_key: str = "",
        on_verify_signing_key: Optional[Callable[[str, str], bool]] = None,
        mode: str = "auto",
    ):
        self.device_name = device_name
        self.service_port = service_port
        self.peer_id = peer_id or str(uuid.uuid4())
        # Preferences' discovery-method picker (design reference 10.10) -
        # "auto" (both, the long-standing default), "mdns", or "udp". An
        # unrecognized value falls back to "auto" rather than silently
        # discovering nobody, since that's a far worse failure mode than
        # ignoring a bad setting.
        self.mode = mode if mode in ("auto", "mdns", "udp") else "auto"
        # Broadcast openly alongside peer_id/name - see crypto_identity.py.
        self.public_key = public_key
        # This device's own Ed25519 signing identity, and the callback used
        # to verify + pin *other* peers' signing keys (storage.py's
        # check_and_pin_signing_key) - see crypto_identity.py's Phase 5b.
        # signing_private_key empty means "don't sign outgoing announcements"
        # (only ever used by cli_test.py's throwaway diagnostic identity,
        # never by the real app) - but incoming verification is enforced
        # unconditionally regardless of whether this device signs its own.
        self.signing_private_key = signing_private_key
        self.signing_public_key = signing_public_key
        self._on_verify_signing_key = on_verify_signing_key
        self.registry = PeerRegistry()

        self._zc: Optional[Zeroconf] = None
        self._service_info: Optional[ServiceInfo] = None
        self._browser: Optional[ServiceBrowser] = None

        self._udp_sock: Optional[socket.socket] = None
        self._udp_recv_sock: Optional[socket.socket] = None
        self._stop_event = threading.Event()
        self._udp_announce_thread: Optional[threading.Thread] = None
        self._udp_listen_thread: Optional[threading.Thread] = None
        self._sweep_thread: Optional[threading.Thread] = None

    # -- lifecycle -----------------------------------------------------

    def start(self) -> None:
        if self.mode in ("auto", "mdns"):
            self._start_mdns()
        if self.mode in ("auto", "udp"):
            self._start_udp_fallback()
        self._sweep_thread = threading.Thread(target=self._sweep_loop, daemon=True)
        self._sweep_thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._browser:
            self._browser.cancel()
        if self._zc and self._service_info:
            self._zc.unregister_service(self._service_info)
        if self._zc:
            self._zc.close()
        if self._udp_sock:
            self._udp_sock.close()
        if self._udp_recv_sock:
            self._udp_recv_sock.close()

    def self_announcement(self) -> dict:
        """The same signed announcement broadcast on mDNS/UDP, computed
        fresh on demand - backs the QR-pairing endpoint (api.py's GET
        /me/qr) so a scanned code and a live radar hit carry the exact same
        payload shape and go through the exact same verify_announcement +
        check_and_pin_signing_key trust check on the other end. Not a
        separate, weaker channel into the peer registry."""
        local_ip = _get_local_ip()
        payload = {
            "peer_id": self.peer_id,
            "device_name": self.device_name,
            "address": local_ip,
            "port": self.service_port,
            "public_key": self.public_key,
            "device_type": detect_device_type(),
        }
        if self.signing_private_key:
            payload["signing_public_key"] = self.signing_public_key
            payload["signature"] = crypto_identity.sign_announcement(
                self.signing_private_key, self.peer_id, local_ip, self.service_port, self.public_key
            )
        return payload

    # -- mDNS ------------------------------------------------------------

    def _start_mdns(self) -> None:
        self._zc = Zeroconf()
        local_ip = _get_local_ip()
        properties = {"peer_id": self.peer_id, "device_name": self.device_name, "public_key": self.public_key, "device_type": detect_device_type()}
        if self.signing_private_key:
            signature = crypto_identity.sign_announcement(self.signing_private_key, self.peer_id, local_ip, self.service_port, self.public_key)
            properties["signing_public_key"] = self.signing_public_key
            properties["signature"] = signature
        self._service_info = ServiceInfo(
            SERVICE_TYPE,
            f"{self.peer_id}.{SERVICE_TYPE}",
            addresses=[socket.inet_aton(local_ip)],
            port=self.service_port,
            properties=properties,
        )
        self._zc.register_service(self._service_info)
        listener = _MdnsListener(self.registry, self.peer_id, self._on_verify_signing_key)
        self._browser = ServiceBrowser(self._zc, SERVICE_TYPE, listener)

    # -- UDP broadcast fallback -------------------------------------------

    def _start_udp_fallback(self) -> None:
        send_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        send_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        send_sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        self._udp_sock = send_sock

        recv_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        recv_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        recv_sock.bind(("", UDP_BROADCAST_PORT))
        recv_sock.settimeout(1.0)
        self._udp_recv_sock = recv_sock

        self._udp_announce_thread = threading.Thread(target=self._udp_announce_loop, daemon=True)
        self._udp_listen_thread = threading.Thread(target=self._udp_listen_loop, daemon=True)
        self._udp_announce_thread.start()
        self._udp_listen_thread.start()

    def _udp_announce_loop(self) -> None:
        local_ip = _get_local_ip()
        message = {
            "peer_id": self.peer_id,
            "device_name": self.device_name,
            "address": local_ip,
            "port": self.service_port,
            "public_key": self.public_key,
            "device_type": detect_device_type(),
        }
        if self.signing_private_key:
            message["signing_public_key"] = self.signing_public_key
            message["signature"] = crypto_identity.sign_announcement(self.signing_private_key, self.peer_id, local_ip, self.service_port, self.public_key)
        payload = json.dumps(message).encode()
        while not self._stop_event.is_set():
            try:
                self._udp_sock.sendto(payload, ("<broadcast>", UDP_BROADCAST_PORT))
            except OSError:
                pass
            self._stop_event.wait(UDP_ANNOUNCE_INTERVAL_SEC)

    def _udp_listen_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                data, _addr = self._udp_recv_sock.recvfrom(4096)
            except socket.timeout:
                continue
            except OSError:
                break
            try:
                msg = json.loads(data.decode())
                peer_id = msg["peer_id"]
                if peer_id == self.peer_id:
                    continue
                address = msg["address"]
                port = msg["port"]
                public_key = msg.get("public_key", "")
                # Same unconditional verify-and-pin as the mDNS path - see
                # _MdnsListener._handle's own comment.
                signing_public_key = msg.get("signing_public_key", "")
                signature = msg.get("signature", "")
                if not signing_public_key or not signature:
                    continue
                if not crypto_identity.verify_announcement(signing_public_key, signature, peer_id, address, port, public_key):
                    continue
                if self._on_verify_signing_key and not self._on_verify_signing_key(peer_id, signing_public_key):
                    continue
                self.registry.upsert(
                    Peer(
                        peer_id=peer_id,
                        name=msg.get("device_name", peer_id),
                        address=address,
                        port=port,
                        source="udp",
                        public_key=public_key,
                        device_type=msg.get("device_type", ""),
                    )
                )
            except (KeyError, ValueError, UnicodeDecodeError):
                continue
            except Exception:
                # Broadened beyond the three expected parsing errors above
                # after a real 32-way concurrent stress run found this
                # exact gap: on_verify_signing_key raising an unexpected
                # error (a transient SQLite lock, at the time) propagated
                # straight out of this loop body, past this narrower
                # except, and with no try/except around the `while` loop
                # itself, killed this entire listener thread - silently
                # disabling UDP discovery fallback for the rest of the app
                # session after a single transient failure. One bad
                # announcement should be dropped, not the whole thread.
                logging.getLogger(__name__).exception("UDP announcement dropped due to an unexpected error")
                continue

    # -- housekeeping ------------------------------------------------------

    def _sweep_loop(self) -> None:
        while not self._stop_event.wait(PEER_TTL_SEC / 2):
            self.registry.sweep_expired()


def _get_local_ip() -> str:
    """Best-effort LAN IP (not 127.0.0.1) without needing external connectivity."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()
