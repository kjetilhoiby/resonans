#!/usr/bin/env python3
"""
Hoto BLE binding (register) — final implementation based on miauth crypto.

Protocol derivation per dnandha/miauth (lib/python/miauth/mi/micrypto.py,
miclient.py::calc_did):

    pubkey exchange (P-256, raw X||Y)
    shared = ECDH(phone_priv, scale_pub)
    derived = HKDF-SHA256(shared, salt=None, info=b"mible-setup-info", length=64)
    token    = derived[0:12]
    bind_key = derived[12:28]
    a        = derived[28:44]
    remote_info = scale_did_payload[4:]    # 20 bytes; first byte 0x00, then ASCII DID
    proof = AES-CCM(key=a, nonce=bytes(0x10..0x1b), aad=b"devID", tag=4).encrypt(remote_info)

After 11000000 (bind ok): save token to disk for later login (auth).

Dependencies: bleak, cryptography
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

from bleak import BleakClient, BleakScanner
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESCCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

# ---------- BLE constants ----------

FE95 = "0000fe95-0000-1000-8000-00805f9b34fb"
CHAR_CONTROL = "00000010-0000-1000-8000-00805f9b34fb"  # UPNP in miauth
CHAR_DATA = "00000019-0000-1000-8000-00805f9b34fb"  # AVDTP in miauth

# ---------- Protocol constants (from miauth) ----------

CMD_GET_INFO = b"\xa2\x00\x00\x00"  # init register/bind
CMD_SET_KEY = b"\x15\x00\x00\x00"  # phase-2 trigger
CMD_LOGIN = b"\x24\x00\x00\x00"  # init login/auth
CMD_AUTH = b"\x13\x00\x00\x00"  # finalize

CMD_SEND_DATA = b"\x00\x00\x00\x03\x04\x00"  # announce 64B pubkey (4 frags)
CMD_SEND_DID = b"\x00\x00\x00\x00\x02\x00"  # announce 24B proof / receive DID (2 frags)
CMD_SEND_KEY = b"\x00\x00\x00\x0b\x01\x00"  # announce 16B rand-key (login)

RCV_RDY = b"\x00\x00\x01\x01"
RCV_OK = b"\x00\x00\x01\x00"
RCV_TOUT = b"\x00\x00\x01\x05\x01\x00"

REGISTER_OK = b"\x11\x00\x00\x00"
REGISTER_ERR = b"\x12\x00\x00\x00"
LOGIN_OK = b"\x21\x00\x00\x00"
LOGIN_ERR = b"\x23\x00\x00\x00"

# AES-CCM constants for register proof
AES_NONCE_REGISTER = bytes(range(16, 28))  # 0x10..0x1b
AES_AAD_REGISTER = b"devID"

OUT_DIR = Path(__file__).parent
TOKEN_FILE = OUT_DIR / "mi_token.bin"
KEYS_FILE = OUT_DIR / "mi_keys.json"


# ---------- Crypto ----------


def pub_key_to_bytes(key) -> bytes:
    """Strip the 0x04 prefix to get raw X||Y (64 B)."""
    return key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)[1:]


def bytes_to_pub_key(data: bytes):
    return ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), b"\x04" + data)


def derive_register_key(shared: bytes) -> bytes:
    return HKDF(
        algorithm=hashes.SHA256(),
        length=64,
        salt=None,
        info=b"mible-setup-info",
        backend=default_backend(),
    ).derive(shared)


def derive_login_key(token: bytes, rand_key: bytes, remote_key: bytes) -> bytes:
    salt = rand_key + remote_key  # 16 + 16 = 32
    return HKDF(
        algorithm=hashes.SHA256(),
        length=64,
        salt=salt,
        info=b"mible-login-info",
        backend=default_backend(),
    ).derive(token)


def encrypt_did(aes_key: bytes, did: bytes) -> bytes:
    aes_ccm = AESCCM(aes_key, tag_length=4)
    return aes_ccm.encrypt(AES_NONCE_REGISTER, did, AES_AAD_REGISTER)


# ---------- Fragment protocol ----------


class Fragmenter:
    def __init__(self, client: BleakClient, data_char: str):
        self.client = client
        self.data_char = data_char
        self.q: asyncio.Queue[bytes] = asyncio.Queue()

    def _on_notify(self, _s, data: bytearray):
        self.q.put_nowait(bytes(data))

    async def start(self):
        await self.client.start_notify(self.data_char, self._on_notify)

    async def _read(self, timeout=5.0) -> bytes:
        return await asyncio.wait_for(self.q.get(), timeout)

    async def send(self, announce: bytes, payload: bytes, chunk: int = 18) -> None:
        """Send announce + payload split into idx-prefixed fragments."""
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
        """Receive announce + fragments. Returns (announce, assembled_payload)."""
        announce = await self._read(timeout=10.0)
        if announce[:3] != b"\x00\x00\x00" or len(announce) != 6:
            raise RuntimeError(f"expected announce, got {announce.hex()}")
        nfrags = int.from_bytes(announce[4:6], "little")
        await self.client.write_gatt_char(self.data_char, RCV_RDY, response=False)
        parts: dict[int, bytes] = {}
        for _ in range(nfrags):
            data = await self._read()
            idx = int.from_bytes(data[:2], "little")
            parts[idx] = data[2:]
        await self.client.write_gatt_char(self.data_char, RCV_OK, response=False)
        return announce, b"".join(parts[i + 1] for i in range(nfrags))


# ---------- Scanning ----------


async def find_scale(timeout_total: float = 60.0) -> str | None:
    deadline = time.monotonic() + timeout_total
    while time.monotonic() < deadline:
        devs = await BleakScanner.discover(timeout=3, return_adv=True)
        for addr, (d, adv) in devs.items():
            sd = (adv.service_data or {}).get(FE95)
            if sd and len(sd) >= 4 and sd[2:4] == bytes.fromhex("8011"):
                print(f"Found Hoto scale at {addr}, RSSI={adv.rssi}")
                return addr
            if (d.name or "").startswith("HOTO-") or d.name == "stand demo":
                print(f"Found by name at {addr}: {d.name}")
                return addr
    return None


# ---------- Bind (register) ----------


async def bind_once(addr: str, debug: bool = True) -> dict | None:
    """Run one register/bind handshake. Returns key dict on success, None on failure."""
    async with BleakClient(addr, timeout=20) as client:
        control_q: asyncio.Queue[bytes] = asyncio.Queue()
        client_control_buf: list[bytes] = []

        def on_ctrl(_s, data):
            buf = bytes(data)
            client_control_buf.append(buf)
            control_q.put_nowait(buf)

        frag = Fragmenter(client, CHAR_DATA)
        await client.start_notify(CHAR_CONTROL, on_ctrl)
        await frag.start()

        # 1. CMD_GET_INFO → scale sends DID
        if debug:
            print(f"  → CMD_GET_INFO ({CMD_GET_INFO.hex()})")
        await client.write_gatt_char(CHAR_CONTROL, CMD_GET_INFO, response=False)

        announce, received_data = await frag.recv()
        if debug:
            print(f"  ← raw remote_info (24 B): {received_data.hex()}")
        if len(received_data) != 24:
            raise RuntimeError(f"unexpected received_data length {len(received_data)}; expected 24")

        remote_info = received_data[4:]  # 20 bytes — what we'll encrypt as proof
        if len(remote_info) != 20:
            raise RuntimeError(f"remote_info length {len(remote_info)}; expected 20")
        if debug:
            print(f"  remote_info (20 B): {remote_info.hex()}  (ASCII: {remote_info.decode(errors='replace')!r})")

        # 2. CMD_SET_KEY (phase 2 trigger)
        if debug:
            print(f"  → CMD_SET_KEY ({CMD_SET_KEY.hex()})")
        await client.write_gatt_char(CHAR_CONTROL, CMD_SET_KEY, response=False)

        # 3. Generate keypair and send pubkey
        priv_key = ec.generate_private_key(ec.SECP256R1(), default_backend())
        pub_raw = pub_key_to_bytes(priv_key.public_key())
        if debug:
            print(f"  → phone pub: {pub_raw.hex()}")
        await frag.send(CMD_SEND_DATA, pub_raw)

        # 4. Receive scale pubkey
        announce, scale_pub_raw = await frag.recv()
        if len(scale_pub_raw) != 64:
            raise RuntimeError(f"scale_pub length {len(scale_pub_raw)}; expected 64")
        if debug:
            print(f"  ← scale pub: {scale_pub_raw.hex()}")

        # 5. Compute shared secret + derive keys
        scale_pub = bytes_to_pub_key(scale_pub_raw)
        shared = priv_key.exchange(ec.ECDH(), scale_pub)
        derived = derive_register_key(shared)
        token = derived[0:12]
        bind_key = derived[12:28]
        aes_key = derived[28:44]

        if debug:
            print(f"  shared:   {shared.hex()}")
            print(f"  derived:  {derived.hex()}")
            print(f"  token:    {token.hex()}")
            print(f"  bind_key: {bind_key.hex()}")
            print(f"  aes_key:  {aes_key.hex()}")

        # 6. Encrypt remote_info as proof
        proof = encrypt_did(aes_key, remote_info)
        if len(proof) != 24:
            raise RuntimeError(f"proof length {len(proof)}; expected 24")
        if debug:
            print(f"  → proof (24 B): {proof.hex()}")

        # 7. Send proof, then CMD_AUTH (finalize)
        await frag.send(CMD_SEND_DID, proof)
        if debug:
            print(f"  → CMD_AUTH ({CMD_AUTH.hex()})")
        await client.write_gatt_char(CHAR_CONTROL, CMD_AUTH, response=False)

        # 8. Read final response
        resp = await asyncio.wait_for(control_q.get(), timeout=5.0)
        print(f"\n  ← final response: {resp.hex()}")

        if resp == REGISTER_OK:
            print("  ✅ BIND SUCCESS")
            keys = {
                "scale_did_ascii": remote_info[1:].decode(errors="replace").rstrip("\x00"),
                "remote_info_hex": remote_info.hex(),
                "phone_priv_hex": format(priv_key.private_numbers().private_value, "064x"),
                "phone_pub_hex": pub_raw.hex(),
                "scale_pub_hex": scale_pub_raw.hex(),
                "shared_hex": shared.hex(),
                "derived_hex": derived.hex(),
                "token_hex": token.hex(),
                "bind_key_hex": bind_key.hex(),
                "aes_key_hex": aes_key.hex(),
                "proof_hex": proof.hex(),
            }
            TOKEN_FILE.write_bytes(token)
            KEYS_FILE.write_text(json.dumps(keys, indent=2))
            print(f"  saved token → {TOKEN_FILE}")
            print(f"  saved keys  → {KEYS_FILE}")
            return keys
        elif resp == REGISTER_ERR:
            print("  ❌ BIND FAIL (0x12000000) — check protocol/crypto")
            return None
        else:
            print(f"  ⚠️  Unexpected response: {resp.hex()}")
            return None


# ---------- Main ----------


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    print("Scanning for Hoto scale...")
    addr = await find_scale()
    if not addr:
        print("Not found. Press scale button and retry.")
        return 1

    print("\n=== BIND ATTEMPT ===")
    result = await bind_once(addr, debug=not args.quiet)
    return 0 if result else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
