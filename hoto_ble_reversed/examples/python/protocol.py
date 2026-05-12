#!/usr/bin/env python3
"""
Hoto Smart Kitchen Scale — read weight via BLE.

Reusable async module. CLI usage:

    python3 hoto_scale.py                # find scale, login, stream weights
    python3 hoto_scale.py --json         # one JSON object per stable reading
    python3 hoto_scale.py --bind         # re-bind (first time only, or after factory reset)

Pre-requisites:
- Run `ble_bind4.py` once to bind the scale and save `mi_token.bin`. After that,
  this module loads the token and does login on every connect.

State of reverse engineering (see HOTO_BLE_REVERSE_2.md):
- BIND: P-256 ECDH + HKDF-SHA256("mible-setup-info", salt=None) + AES-CCM
- LOGIN: HKDF-SHA256("mible-login-info", salt=rand+remote) + HMAC verification
- DATA: AES-CCM stream on MiBle notify, plaintext = M365 UART frames
        (55 aa 01 [cmd] [data] [chk] fe)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import secrets
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import AsyncIterator, Callable, Optional

from bleak import BleakClient, BleakScanner
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESCCM
from cryptography.hazmat.primitives.hmac import HMAC
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

# ---------- BLE UUIDs and protocol constants ----------

FE95 = "0000fe95-0000-1000-8000-00805f9b34fb"
CHAR_CONTROL = "00000010-0000-1000-8000-00805f9b34fb"
CHAR_DATA = "00000019-0000-1000-8000-00805f9b34fb"
MIBLE_NOTIFY = "00000102-0065-6c62-2e74-6f696d2e696d"

CMD_GET_INFO = b"\xa2\x00\x00\x00"
CMD_SET_KEY = b"\x15\x00\x00\x00"
CMD_LOGIN = b"\x24\x00\x00\x00"
CMD_AUTH = b"\x13\x00\x00\x00"

CMD_SEND_DATA = b"\x00\x00\x00\x03\x04\x00"
CMD_SEND_DID = b"\x00\x00\x00\x00\x02\x00"
CMD_SEND_KEY = b"\x00\x00\x00\x0b\x01\x00"
CMD_SEND_INFO = b"\x00\x00\x00\x0a\x02\x00"

RCV_RDY = b"\x00\x00\x01\x01"
RCV_OK = b"\x00\x00\x01\x00"
REGISTER_OK = b"\x11\x00\x00\x00"
REGISTER_ERR = b"\x12\x00\x00\x00"
LOGIN_OK = b"\x21\x00\x00\x00"
LOGIN_ERR = b"\x23\x00\x00\x00"

AES_NONCE_REGISTER = bytes(range(16, 28))
AES_AAD_REGISTER = b"devID"

DEFAULT_TOKEN_PATH = Path(__file__).parent / "mi_token.bin"

# ---------- Crypto helpers ----------


def _pub_to_bytes(key) -> bytes:
    return key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)[1:]


def _bytes_to_pub(data: bytes):
    return ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), b"\x04" + data)


def _hkdf(km: bytes, salt: bytes | None, info: bytes, length: int = 64) -> bytes:
    return HKDF(
        algorithm=hashes.SHA256(),
        length=length,
        salt=salt,
        info=info,
        backend=default_backend(),
    ).derive(km)


def _hmac(key: bytes, data: bytes) -> bytes:
    h = HMAC(key, hashes.SHA256(), backend=default_backend())
    h.update(data)
    return h.finalize()


# ---------- Fragment protocol ----------


class _Fragmenter:
    def __init__(self, client: BleakClient, data_char: str):
        self.client = client
        self.data_char = data_char
        self.q: asyncio.Queue[bytes] = asyncio.Queue()

    def _on_notify(self, _s, data: bytearray):
        self.q.put_nowait(bytes(data))

    async def start(self):
        await self.client.start_notify(self.data_char, self._on_notify)

    async def _read(self, timeout: float = 5.0) -> bytes:
        return await asyncio.wait_for(self.q.get(), timeout)

    async def send(self, announce: bytes, payload: bytes, chunk: int = 18) -> None:
        await self.client.write_gatt_char(self.data_char, announce, response=False)
        ready = await self._read()
        if ready != RCV_RDY:
            raise RuntimeError(f"expected RCV_RDY, got {ready.hex()}")
        nfrags = (len(payload) + chunk - 1) // chunk
        for i in range(nfrags):
            start, end = i * chunk, min((i + 1) * chunk, len(payload))
            frag = (i + 1).to_bytes(2, "little") + payload[start:end]
            await self.client.write_gatt_char(self.data_char, frag, response=False)
            await asyncio.sleep(0.005)
        ack = await self._read()
        if ack != RCV_OK:
            raise RuntimeError(f"expected RCV_OK, got {ack.hex()}")

    async def recv(self) -> tuple[bytes, bytes]:
        announce = await self._read(timeout=10.0)
        if announce[:3] != b"\x00\x00\x00" or len(announce) != 6:
            raise RuntimeError(f"expected announce, got {announce.hex()}")
        nfrags = int.from_bytes(announce[4:6], "little")
        await self.client.write_gatt_char(self.data_char, RCV_RDY, response=False)
        parts: dict[int, bytes] = {}
        for _ in range(nfrags):
            d = await self._read()
            idx = int.from_bytes(d[:2], "little")
            parts[idx] = d[2:]
        await self.client.write_gatt_char(self.data_char, RCV_OK, response=False)
        return announce, b"".join(parts[i + 1] for i in range(nfrags))


# ---------- Frame parsing ----------


@dataclass
class WeightFrame:
    """One decrypted scale event."""
    seq: int
    type: str  # "active", "stable", "idle", "event_05", "unknown"
    grams: Optional[float] = None
    raw_value: Optional[int] = None
    status_byte: Optional[int] = None
    plain_hex: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def _checksum_ok(plain: bytes) -> bool:
    if len(plain) < 5:
        return False
    expected = sum(plain[3:-2]) % 256
    return plain[-2] == expected


def parse_plain(plain: bytes) -> Optional[dict]:
    """Parse decrypted M365-style UART frame. Returns dict or None if malformed."""
    if len(plain) < 5 or plain[0] != 0x55 or plain[1] != 0xAA or plain[-1] != 0xFE or plain[2] != 0x01:
        return None
    if not _checksum_ok(plain):
        return {"type": "checksum_fail", "raw": plain.hex()}

    cmd = plain[3]

    if cmd == 0x02 and len(plain) == 7:
        return {"type": "idle", "status_byte": plain[5]}

    if cmd == 0x05 and len(plain) == 7:
        return {"type": "event_05", "status_byte": plain[5]}

    if cmd in (0x07, 0x08) and len(plain) == 10:
        if plain[4] != 0x03:
            return {"type": "weight_unknown_subcmd", "raw": plain.hex()}
        raw = int.from_bytes(plain[5:8], "little")
        return {
            "type": "stable" if cmd == 0x08 else "active",
            "raw_value": raw,
            "grams": raw / 10.0,
        }

    return {"type": "unknown", "cmd": cmd, "raw": plain.hex()}


# ---------- Session keys ----------


@dataclass
class SessionKeys:
    dev_key: bytes
    app_key: bytes
    dev_iv: bytes
    app_iv: bytes


def derive_session_keys(token: bytes, rand_key: bytes, remote_key: bytes) -> SessionKeys:
    derived = _hkdf(token, salt=rand_key + remote_key, info=b"mible-login-info")
    return SessionKeys(
        dev_key=derived[0:16],
        app_key=derived[16:32],
        dev_iv=derived[32:36],
        app_iv=derived[36:40],
    )


def decrypt_notify(payload: bytes, keys: SessionKeys) -> Optional[bytes]:
    """Decrypt a MiBle notify frame. Returns plaintext or None on failure.
    payload = [idx LE16][encrypted+tag]
    nonce   = dev_iv + 4 zero bytes + idx + 2 zero bytes (12 B)
    """
    if len(payload) < 6:
        return None
    idx_le = payload[:2]
    nonce = keys.dev_iv + b"\x00\x00\x00\x00" + idx_le + b"\x00\x00"
    try:
        return AESCCM(keys.dev_key, tag_length=4).decrypt(nonce, payload[2:], None)
    except Exception:
        return None


# ---------- Scanning ----------


async def find_scale(timeout_total: float = 60.0) -> Optional[str]:
    deadline = time.monotonic() + timeout_total
    while time.monotonic() < deadline:
        devs = await BleakScanner.discover(timeout=3, return_adv=True)
        for addr, (d, adv) in devs.items():
            sd = (adv.service_data or {}).get(FE95)
            if sd and len(sd) >= 4 and sd[2:4] == bytes.fromhex("8011"):
                return addr
            if (d.name or "").startswith("HOTO-") or d.name == "stand demo":
                return addr
    return None


# ---------- Bind (one-time) ----------


async def bind(addr: str, token_path: Path = DEFAULT_TOKEN_PATH) -> bytes:
    """Run register/bind handshake. Saves token to disk and returns it."""
    async with BleakClient(addr, timeout=20) as client:
        control_q: asyncio.Queue[bytes] = asyncio.Queue()

        def on_ctrl(_s, data):
            control_q.put_nowait(bytes(data))

        frag = _Fragmenter(client, CHAR_DATA)
        await client.start_notify(CHAR_CONTROL, on_ctrl)
        await frag.start()

        await client.write_gatt_char(CHAR_CONTROL, CMD_GET_INFO, response=False)
        _, received = await frag.recv()
        remote_info = received[4:]
        if len(remote_info) != 20:
            raise RuntimeError(f"remote_info len {len(remote_info)} (expected 20)")

        await client.write_gatt_char(CHAR_CONTROL, CMD_SET_KEY, response=False)
        priv = ec.generate_private_key(ec.SECP256R1(), default_backend())
        await frag.send(CMD_SEND_DATA, _pub_to_bytes(priv.public_key()))
        _, scale_pub_raw = await frag.recv()

        shared = priv.exchange(ec.ECDH(), _bytes_to_pub(scale_pub_raw))
        derived = _hkdf(shared, salt=None, info=b"mible-setup-info")
        token = derived[0:12]
        aes_key = derived[28:44]

        proof = AESCCM(aes_key, tag_length=4).encrypt(
            AES_NONCE_REGISTER, remote_info, AES_AAD_REGISTER
        )
        await frag.send(CMD_SEND_DID, proof)
        await client.write_gatt_char(CHAR_CONTROL, CMD_AUTH, response=False)
        resp = await asyncio.wait_for(control_q.get(), timeout=5.0)
        if resp != REGISTER_OK:
            raise RuntimeError(f"bind failed: {resp.hex()}")
        token_path.write_bytes(token)
        return token


# ---------- Login + weight streaming ----------


async def _login(client: BleakClient, token: bytes, frag: _Fragmenter,
                  control_q: asyncio.Queue[bytes]) -> SessionKeys:
    rand_key = secrets.token_bytes(16)
    await client.write_gatt_char(CHAR_CONTROL, CMD_LOGIN, response=False)
    await frag.send(CMD_SEND_KEY, rand_key)
    _, remote_key = await frag.recv()
    if len(remote_key) != 16:
        raise RuntimeError(f"remote_key len {len(remote_key)}")
    _, remote_info = await frag.recv()
    if len(remote_info) != 32:
        raise RuntimeError(f"remote_info len {len(remote_info)}")
    keys = derive_session_keys(token, rand_key, remote_key)
    expected = _hmac(keys.dev_key, remote_key + rand_key)
    if expected != remote_info:
        raise RuntimeError("login verification failed (HMAC mismatch); rebind")
    info = _hmac(keys.app_key, rand_key + remote_key)
    await frag.send(CMD_SEND_INFO, info)
    resp = await asyncio.wait_for(control_q.get(), timeout=5.0)
    if resp != LOGIN_OK:
        raise RuntimeError(f"login failed: {resp.hex()}")
    return keys


async def stream_weights(addr: str, token: bytes) -> AsyncIterator[WeightFrame]:
    """Connect, login, and yield WeightFrame objects as they arrive.

    The async generator never returns normally; cancel/break the loop to stop.
    """
    async with BleakClient(addr, timeout=20) as client:
        control_q: asyncio.Queue[bytes] = asyncio.Queue()
        weight_q: asyncio.Queue[bytes] = asyncio.Queue()

        def on_ctrl(_s, data):
            control_q.put_nowait(bytes(data))

        def on_notify(_s, data):
            weight_q.put_nowait(bytes(data))

        frag = _Fragmenter(client, CHAR_DATA)
        await client.start_notify(CHAR_CONTROL, on_ctrl)
        await frag.start()

        keys = await _login(client, token, frag, control_q)
        await client.start_notify(MIBLE_NOTIFY, on_notify)

        last_plain: Optional[bytes] = None
        while True:
            data = await weight_q.get()
            if len(data) < 6:
                continue
            idx = int.from_bytes(data[:2], "little")
            plain = decrypt_notify(data, keys)
            if plain is None or plain == last_plain:
                continue
            last_plain = plain
            parsed = parse_plain(plain)
            if not parsed or parsed.get("type") == "checksum_fail":
                continue
            yield WeightFrame(
                seq=idx,
                type=parsed["type"],
                grams=parsed.get("grams"),
                raw_value=parsed.get("raw_value"),
                status_byte=parsed.get("status_byte"),
                plain_hex=plain.hex(),
            )


# ---------- CLI ----------


async def cli_main(args):
    if args.bind:
        print("Scanning for Hoto scale (press scale button if not already on)...")
        addr = await find_scale()
        if not addr:
            print("Not found.")
            return 1
        print(f"Found {addr}. Binding...")
        token = await bind(addr)
        print(f"✅ Bound. Token = {token.hex()} (saved to {DEFAULT_TOKEN_PATH})")
        return 0

    token_path = Path(args.token) if args.token else DEFAULT_TOKEN_PATH
    if not token_path.exists():
        print(f"No token at {token_path}. Run with --bind first.")
        return 1
    token = token_path.read_bytes()

    print("Scanning for Hoto scale...", file=sys.stderr)
    addr = await find_scale()
    if not addr:
        print("Not found.", file=sys.stderr)
        return 1
    print(f"Connecting to {addr}...", file=sys.stderr)

    async for frame in stream_weights(addr, token):
        if args.json:
            print(json.dumps(frame.to_dict()), flush=True)
        else:
            if frame.type in ("active", "stable"):
                tag = "★" if frame.type == "stable" else " "
                print(f"{tag} {frame.grams:7.1f} g   seq=0x{frame.seq:04x}")
            elif frame.type == "idle":
                print(f"  idle      seq=0x{frame.seq:04x}")
            else:
                print(f"  {frame.type}     seq=0x{frame.seq:04x}  plain={frame.plain_hex}")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Read Hoto Smart Kitchen Scale via BLE.")
    parser.add_argument("--bind", action="store_true",
                        help="Run bind handshake (first time / after factory reset)")
    parser.add_argument("--json", action="store_true",
                        help="Output one JSON object per frame")
    parser.add_argument("--token", help="Path to token file (default: ./mi_token.bin)")
    args = parser.parse_args()
    try:
        sys.exit(asyncio.run(cli_main(args)))
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
