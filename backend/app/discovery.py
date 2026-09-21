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
import socket
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Optional

from zeroconf import ServiceBrowser, ServiceInfo, ServiceListener, Zeroconf

SERVICE_TYPE = "_lanchat._tcp.local."
UDP_BROADCAST_PORT = 42424
UDP_ANNOUNCE_INTERVAL_SEC = 3.0
PEER_TTL_SEC = 10.0  # if we haven't heard from a peer in this long, drop it


@dataclass
class Peer:
    peer_id: str
    name: str
    address: str
    port: int
    source: str  # "mdns" or "udp"
    last_seen: float = field(default_factory=time.time)

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
    def __init__(self, registry: PeerRegistry, self_peer_id: str):
        self._registry = registry
        self._self_peer_id = self_peer_id

    def add_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        self._handle(zc, type_, name)

    def update_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        self._handle(zc, type_, name)

    def remove_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        peer_id = name.split(".")[0]
        if peer_id != self._self_peer_id:
            self._registry.remove(peer_id)

    def _handle(self, zc: Zeroconf, type_: str, name: str) -> None:
        info = zc.get_service_info(type_, name)
        if info is None or not info.addresses:
            return
        props = {k.decode(): v.decode() for k, v in info.properties.items()}
        peer_id = props.get("peer_id", name.split(".")[0])
        if peer_id == self._self_peer_id:
            return
        address = socket.inet_ntoa(info.addresses[0])
        self._registry.upsert(
            Peer(
                peer_id=peer_id,
                name=props.get("device_name", name),
                address=address,
                port=info.port or 0,
                source="mdns",
            )
        )


class PeerDiscovery:
    """Announces this device and browses for others, on mDNS and UDP broadcast."""

    def __init__(self, device_name: str, service_port: int, peer_id: Optional[str] = None):
        self.device_name = device_name
        self.service_port = service_port
        self.peer_id = peer_id or str(uuid.uuid4())
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
        self._start_mdns()
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

    # -- mDNS ------------------------------------------------------------

    def _start_mdns(self) -> None:
        self._zc = Zeroconf()
        local_ip = _get_local_ip()
        self._service_info = ServiceInfo(
            SERVICE_TYPE,
            f"{self.peer_id}.{SERVICE_TYPE}",
            addresses=[socket.inet_aton(local_ip)],
            port=self.service_port,
            properties={"peer_id": self.peer_id, "device_name": self.device_name},
        )
        self._zc.register_service(self._service_info)
        listener = _MdnsListener(self.registry, self.peer_id)
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
        payload = json.dumps(
            {
                "peer_id": self.peer_id,
                "device_name": self.device_name,
                "address": local_ip,
                "port": self.service_port,
            }
        ).encode()
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
                self.registry.upsert(
                    Peer(
                        peer_id=peer_id,
                        name=msg.get("device_name", peer_id),
                        address=msg["address"],
                        port=msg["port"],
                        source="udp",
                    )
                )
            except (KeyError, ValueError, UnicodeDecodeError):
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
