"""Decode the agent's binary wire format.

The framing defined in ``agent-rust/src/transport.rs`` is:

    [0..16]   session UUID
    [16..20]  u32 count (big-endian)
    for each event:
        [u32] payload length (BE)
        [u8]  kind  (1=key, 2=mouse, 3=window)
        [u64] nonce (BE)
        [u64] ts_mono_ns (BE)
        [u8;32] HMAC-SHA256
        [var]  payload

Per-kind payload formats are defined in each capture module in Rust; this
module implements the reverse transform. We verify HMAC authenticity here,
then dispatch to kind-specific decoders.
"""

from __future__ import annotations

import hmac
import struct
from dataclasses import dataclass
from hashlib import sha256
from typing import Iterator


@dataclass
class DecodedEvent:
    """A single decoded, HMAC-verified event."""

    nonce: int
    ts_mono_ns: int
    kind: int
    payload: bytes


class DecodeError(ValueError):
    """Raised on framing or authentication error."""


def _canonical(nonce: int, ts_mono_ns: int, kind: int, payload: bytes) -> bytes:
    """Mirror of ``canonical_event_bytes`` in ``agent-rust/src/crypto.rs``."""
    return (
        struct.pack(">Q", nonce)
        + struct.pack(">Q", ts_mono_ns)
        + bytes([kind])
        + struct.pack(">I", len(payload))
        + payload
    )


def decode_batch(
    buf: bytes, hmac_key: bytes, *, max_events: int = 10_000
) -> tuple[bytes, list[DecodedEvent]]:
    """Decode a framed batch into ``(session_uuid, events)``.

    Verifies HMAC-SHA256 of every event against ``hmac_key``. Rejects the
    whole batch on the first authentication failure (strict mode).
    """
    if len(buf) < 20:
        raise DecodeError("batch smaller than header")
    session_uuid = buf[:16]
    count = struct.unpack(">I", buf[16:20])[0]
    if count > max_events:
        raise DecodeError(f"event count {count} exceeds limit {max_events}")

    events: list[DecodedEvent] = []
    offset = 20
    for i in range(count):
        if offset + 4 + 1 + 8 + 8 + 32 > len(buf):
            raise DecodeError(f"truncated event {i}")
        plen = struct.unpack(">I", buf[offset : offset + 4])[0]
        offset += 4
        kind = buf[offset]
        offset += 1
        nonce = struct.unpack(">Q", buf[offset : offset + 8])[0]
        offset += 8
        ts = struct.unpack(">Q", buf[offset : offset + 8])[0]
        offset += 8
        tag = buf[offset : offset + 32]
        offset += 32

        if offset + plen > len(buf):
            raise DecodeError(f"payload {i} overruns buffer")
        payload = buf[offset : offset + plen]
        offset += plen

        expected = hmac.new(hmac_key, _canonical(nonce, ts, kind, payload), sha256).digest()
        if not hmac.compare_digest(tag, expected):
            raise DecodeError(f"HMAC mismatch for event {i}")

        events.append(DecodedEvent(nonce=nonce, ts_mono_ns=ts, kind=kind, payload=payload))

    if offset != len(buf):
        raise DecodeError(f"trailing {len(buf) - offset} bytes after last event")

    return session_uuid, events


# --------------------------------------------------------------------------- #
# Per-kind decoders (mirror the Rust encode_* functions)
# --------------------------------------------------------------------------- #

@dataclass
class KeyEventPayload:
    """Decoded keyboard event."""

    keycode: int
    pressed: bool
    flags: int


def decode_key(payload: bytes) -> KeyEventPayload:
    """Mirror of ``agent-rust/src/capture/keystroke.rs::encode_key_event``."""
    if len(payload) != 8:
        raise DecodeError(f"key payload length {len(payload)} != 8")
    keycode, pressed, _reserved, flags = struct.unpack(">HBBI", payload)
    return KeyEventPayload(keycode=keycode, pressed=bool(pressed), flags=flags)


@dataclass
class MouseEventPayload:
    """Decoded mouse event."""

    subkind: int  # 1=move, 2=click_down, 3=click_up, 4=scroll
    dx: int
    dy: int
    dt_us: int
    button: int


def decode_mouse(payload: bytes) -> MouseEventPayload:
    """Mirror of ``agent-rust/src/capture/mouse.rs::encode_mouse_event``."""
    if len(payload) != 10:
        raise DecodeError(f"mouse payload length {len(payload)} != 10")
    subkind, dx, dy, dt_us, button = struct.unpack(">BhhIB", payload)
    return MouseEventPayload(subkind=subkind, dx=dx, dy=dy, dt_us=dt_us, button=button)


@dataclass
class WindowEventPayload:
    """Decoded window-focus event."""

    app_hash: bytes  # 16 bytes
    action: int  # 1=focus_in, 2=focus_out
    pid: int


def decode_window(payload: bytes) -> WindowEventPayload:
    """Mirror of ``agent-rust/src/capture/window.rs::encode_window_event``."""
    if len(payload) != 21:
        raise DecodeError(f"window payload length {len(payload)} != 21")
    app_hash = payload[:16]
    action = payload[16]
    pid = struct.unpack(">I", payload[17:21])[0]
    return WindowEventPayload(app_hash=app_hash, action=action, pid=pid)


def iter_key_events(events: list[DecodedEvent]) -> Iterator[tuple[int, KeyEventPayload]]:
    """Yield ``(ts_mono_ns, KeyEventPayload)`` for kind==1 events."""
    for e in events:
        if e.kind == 1:
            yield e.ts_mono_ns, decode_key(e.payload)


def iter_mouse_events(events: list[DecodedEvent]) -> Iterator[tuple[int, MouseEventPayload]]:
    """Yield ``(ts_mono_ns, MouseEventPayload)`` for kind==2 events."""
    for e in events:
        if e.kind == 2:
            yield e.ts_mono_ns, decode_mouse(e.payload)


def iter_window_events(events: list[DecodedEvent]) -> Iterator[tuple[int, WindowEventPayload]]:
    """Yield ``(ts_mono_ns, WindowEventPayload)`` for kind==3 events."""
    for e in events:
        if e.kind == 3:
            yield e.ts_mono_ns, decode_window(e.payload)
