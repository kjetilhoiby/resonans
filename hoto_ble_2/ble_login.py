#!/usr/bin/env python3
"""
Hoto BLE login + weight reading.

Uses token from mi_token.bin (saved by ble_bind4.py).

Login flow (per dnandha/miauth miclient.py::login + calc_login_info):
  → CMD_LOGIN (24000000) on control
  → CMD_SEND_KEY announce (00 00 00 0b 01 00) + [0100][rand_key(16B)]
  ← RCV_RESP_KEY (00 00 00 0d 01 00) + [0100][remote_key(16B)]
  ← RCV_RESP_INFO (00 00 00 0c 02 00) + 2 frags totalling remote_info(32B)

  salt = rand_key + remote_key                                   (32 B)
  derived = HKDF-SHA256(token, salt=salt, info=b"mible-login-info", length=64)
    dev_key = derived[:16]    app_key = derived[16:32]
    dev_iv  = derived[32:36]  app_iv  = derived[36:40]

  expected_remote_info = HMAC-SHA256(dev_key, remote_key+rand_key)   # salt_inv
  assert remote_info == expected_remote_info

  info = HMAC-SHA256(app_key, salt)
  → CMD_SEND_INFO (00 00 00 0a 02 00) + 2 frags of info(32B)
  ← CFM_LOGIN_OK (21000000)

After login: subscribe to MiBle notify char (UUID 0x0102) and decrypt
incoming weight frames using dev_key + dev_iv + LE16 frame counter.
"""
from __future__ import annotations

import asyncio
import json
import secrets
import sys
import time
from pathlib import Path

from bleak import BleakClient, BleakScanner
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESCCM
from cryptography.hazmat.primitives.hmac import HMAC
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

# ---------- Constants ----------

FE95 = "0000fe95-0000-1000-8000-00805f9b34fb"
CHAR_CONTROL = "00000010-0000-1000-8000-00805f9b34fb"
CHAR_DATA = "00000019-0000-1000-8000-00805f9b34fb"
MIBLE_NOTIFY = "00000102-0065-6c62-2e74-6f696d2e696d"
MIBLE_COMMAND = "00000101-0065-6c62-2e74-6f696d2e696d"

CMD_LOGIN = b"\x24\x00\x00\x00"
CMD_SEND_KEY = b"\x00\x00\x00\x0b\x01\x00"
CMD_SEND_INFO = b"\x00\x00\x00\x0a\x02\x00"
RCV_RDY = b"\x00\x00\x01\x01"
RCV_OK = b"\x00\x00\x01\x00"
LOGIN_OK = b"\x21\x00\x00\x00"
LOGIN_ERR = b"\x23\x00\x00\x00"

OUT_DIR = Path(__file__).parent
TOKEN_FILE = OUT_DIR / "mi_token.bin"
LOGIN_KEYS_FILE = OUT_DIR / "mi_login_keys.json"


# ---------- Crypto ----------


def derive_login_key(token: bytes, rand_key: bytes, remote_key: bytes) -> bytes:
    salt = rand_key + remote_key  # 32 B
    return HKDF(
        algorithm=hashes.SHA256(),
        length=64,
        salt=salt,
        info=b"mible-login-info",
        backend=default_backend(),
    ).derive(token)


def hmac_sha256(key: bytes, data: bytes) -> bytes:
    h = HMAC(key, hashes.SHA256(), backend=default_backend())
    h.update(data)
    return h.finalize()


# ---------- Weight decoding ----------


def parse_weight_packet(plain: bytes) -> dict:
    """Parse Hoto M365-style UART frame: 55 aa 01 [cmd] [data...] [chk] fe."""
    if len(plain) < 5 or plain[0] != 0x55 or plain[1] != 0xaa or plain[-1] != 0xfe:
        return {"type": "unknown", "raw": plain.hex()}
    if plain[2] != 0x01:
        return {"type": "unknown", "prefix_byte": plain[2], "raw": plain.hex()}

    cmd = plain[3]
    body = plain[4:-2]
    chk = plain[-2]

    if cmd == 0x02 and len(plain) == 7:
        # 55aa 01 02 00 [status] fe — idle / no significant weight
        return {"type": "idle", "status": body[1] if len(body) > 1 else None}

    if cmd == 0x05 and len(plain) == 7:
        return {"type": "event_05", "data": body.hex()}

    if cmd in (0x07, 0x08) and len(plain) == 10:
        # 55aa 01 [07|08] 03 [v0 v1 v2] [chk] fe — weight reading
        # cmd 0x07 = active/unstable, 0x08 = stabilized
        if body[0] != 0x03:
            return {"type": "weight_unknown_subcmd", "raw": plain.hex()}
        value = int.from_bytes(body[1:4], "little")
        return {
            "type": "stable" if cmd == 0x08 else "active",
            "raw_value": value,
            "grams_if_0.1g": value / 10.0,
            "grams_if_1g": value,
        }

    return {"type": "unknown", "cmd": cmd, "body": body.hex(), "raw": plain.hex()}


def try_decrypt(payload: bytes, idx_le: bytes, dev_key: bytes, dev_iv: bytes) -> bytes | None:
    """Try AES-CCM decryption with miauth's nonce structure.

    nonce = dev_iv (4B) + zeros(4B) + idx (2B) + zeros (2B) = 12 B
    """
    nonce = dev_iv + b"\x00\x00\x00\x00" + idx_le + b"\x00\x00"
    try:
        aes = AESCCM(dev_key, tag_length=4)
        return aes.decrypt(nonce, payload, None)
    except Exception:
        return None


def try_decrypt_variants(data: bytes, dev_key: bytes, dev_iv: bytes) -> list[dict]:
    """Try several nonce / framing hypotheses. Returns list of attempts."""
    results = []
    if len(data) < 6:
        return results
    idx_le = data[:2]
    payload = data[2:]

    # V1 (miauth uart): nonce = dev_iv + 4z + idx + 2z
    nonce = dev_iv + b"\x00\x00\x00\x00" + idx_le + b"\x00\x00"
    results.append(("v1_iv+4z+idx+2z", nonce, payload))

    # V2: nonce = dev_iv + idx + 6z
    nonce = dev_iv + idx_le + b"\x00" * 6
    results.append(("v2_iv+idx+6z", nonce, payload))

    # V3: nonce = idx + zeros + dev_iv
    nonce = idx_le + b"\x00" * 6 + dev_iv
    results.append(("v3_idx+6z+iv", nonce, payload))

    # V4: nonce = MAC[::-1] (6B) + dev_iv(4B) + idx(2B)
    mac = bytes.fromhex("dced83842e9d")
    nonce = mac[::-1] + dev_iv + idx_le
    results.append(("v4_mac+iv+idx", nonce, payload))

    # V5: like Mi advertisement: mac[::-1] + idx + zeros
    nonce = mac[::-1] + idx_le + b"\x00" * 4
    results.append(("v5_mac+idx+4z", nonce, payload))

    out = []
    for name, nonce, ct in results:
        try:
            aes = AESCCM(dev_key, tag_length=4)
            plain = aes.decrypt(nonce, ct, None)
            out.append({"variant": name, "ok": True, "plain": plain.hex(), "plain_len": len(plain)})
        except Exception as e:
            out.append({"variant": name, "ok": False})
    return out


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


# ---------- Main login + listen ----------


async def login_and_listen(addr: str, token: bytes, listen_seconds: float = 60.0):
    async with BleakClient(addr, timeout=20) as client:
        control_q: asyncio.Queue[bytes] = asyncio.Queue()

        def on_ctrl(_s, data):
            control_q.put_nowait(bytes(data))

        frag = Fragmenter(client, CHAR_DATA)
        await client.start_notify(CHAR_CONTROL, on_ctrl)
        await frag.start()

        # 1. CMD_LOGIN init
        rand_key = secrets.token_bytes(16)
        print(f"  rand_key: {rand_key.hex()}")
        print(f"  → CMD_LOGIN ({CMD_LOGIN.hex()})")
        await client.write_gatt_char(CHAR_CONTROL, CMD_LOGIN, response=False)

        # 2. Send our 16B rand_key
        await frag.send(CMD_SEND_KEY, rand_key)

        # 3. Receive scale's remote_key (16B)
        announce, remote_key = await frag.recv()
        print(f"  ← remote_key: {remote_key.hex()} ({len(remote_key)} B)")
        if len(remote_key) != 16:
            raise RuntimeError(f"remote_key wrong length {len(remote_key)}")

        # 4. Receive scale's remote_info (32B)
        announce, remote_info = await frag.recv()
        print(f"  ← remote_info: {remote_info.hex()} ({len(remote_info)} B)")
        if len(remote_info) != 32:
            raise RuntimeError(f"remote_info wrong length {len(remote_info)}")

        # 5. Derive session keys
        derived = derive_login_key(token, rand_key, remote_key)
        dev_key = derived[:16]
        app_key = derived[16:32]
        dev_iv = derived[32:36]
        app_iv = derived[36:40]
        print(f"  dev_key: {dev_key.hex()}")
        print(f"  app_key: {app_key.hex()}")
        print(f"  dev_iv:  {dev_iv.hex()}")
        print(f"  app_iv:  {app_iv.hex()}")

        # 6. Verify remote_info = HMAC(dev_key, remote_key+rand_key)
        salt_inv = remote_key + rand_key
        expected = hmac_sha256(dev_key, salt_inv)
        if expected != remote_info:
            print(f"  ⚠️  remote_info mismatch!")
            print(f"     got:      {remote_info.hex()}")
            print(f"     expected: {expected.hex()}")
            raise RuntimeError("login verification failed — maybe token is stale; rebind")
        print("  ✓ remote_info verified")

        # 7. Send our info
        salt = rand_key + remote_key
        info = hmac_sha256(app_key, salt)
        print(f"  → our info: {info.hex()}")
        await frag.send(CMD_SEND_INFO, info)

        # 8. Wait for LOGIN_OK
        resp = await asyncio.wait_for(control_q.get(), timeout=5.0)
        print(f"\n  ← final: {resp.hex()}")
        if resp != LOGIN_OK:
            raise RuntimeError(f"login failed: {resp.hex()}")
        print("  ✅ LOGIN SUCCESS\n")

        LOGIN_KEYS_FILE.write_text(json.dumps({
            "rand_key": rand_key.hex(),
            "remote_key": remote_key.hex(),
            "remote_info": remote_info.hex(),
            "derived": derived.hex(),
            "dev_key": dev_key.hex(),
            "app_key": app_key.hex(),
            "dev_iv": dev_iv.hex(),
            "app_iv": app_iv.hex(),
        }, indent=2))
        print(f"  saved session keys → {LOGIN_KEYS_FILE}")

        # 9. Subscribe to weight notifications
        print(f"\n=== Subscribing to MiBle notify ({MIBLE_NOTIFY}) ===")
        weight_q: asyncio.Queue[bytes] = asyncio.Queue()

        def on_weight(_s, data):
            weight_q.put_nowait(bytes(data))

        try:
            await client.start_notify(MIBLE_NOTIFY, on_weight)
        except Exception as e:
            print(f"  start_notify on MiBle notify failed: {e}")
            print("  (service may need GATT re-discovery first)")
            raise

        print(f"\nListening {listen_seconds}s — put something on the scale!\n")
        end = time.monotonic() + listen_seconds
        first_decrypt_logged = False
        winning_variant: str | None = None
        last_printed_plain: bytes | None = None
        while time.monotonic() < end:
            try:
                data = await asyncio.wait_for(weight_q.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            if len(data) < 6:
                print(f"  short frame: {data.hex()}")
                continue
            idx = int.from_bytes(data[:2], "little")
            payload = data[2:]

            if winning_variant is None:
                attempts = try_decrypt_variants(data, dev_key, dev_iv)
                successes = [a for a in attempts if a["ok"]]
                if successes:
                    winning_variant = successes[0]["variant"]
                    print(f"  🔑 found nonce variant: {winning_variant}")
                    print(f"     [{idx:#06x}] decrypted: {successes[0]['plain']}")
                else:
                    print(f"  [{idx:#06x}] {len(payload)}B raw: {payload.hex()} — no variant decrypted")
                continue

            # Once we know the variant, just decrypt directly using v1
            nonce = dev_iv + b"\x00\x00\x00\x00" + data[:2] + b"\x00\x00"
            try:
                plain = AESCCM(dev_key, tag_length=4).decrypt(nonce, payload, None)
            except Exception as e:
                print(f"  [{idx:#06x}] decrypt err: {e}")
                continue

            # Each frame is sent twice on consecutive idx — skip duplicates
            if plain == last_printed_plain:
                continue
            last_printed_plain = plain
            parsed = parse_weight_packet(plain)
            if parsed.get("type") in ("active", "stable"):
                t = parsed["type"].upper()
                g = parsed["grams_if_0.1g"]
                print(f"  [{idx:#06x}] {t:6s}  {g:7.1f} g   ({plain.hex()})")
            elif parsed.get("type") == "idle":
                print(f"  [{idx:#06x}] IDLE      status={parsed.get('status')}  ({plain.hex()})")
            else:
                print(f"  [{idx:#06x}] {parsed}")


async def main():
    if not TOKEN_FILE.exists():
        print(f"No token file at {TOKEN_FILE}. Run ble_bind4.py first.")
        return 1
    token = TOKEN_FILE.read_bytes()
    print(f"token: {token.hex()} ({len(token)}B)")

    print("Scanning for Hoto scale...")
    addr = await find_scale()
    if not addr:
        print("Not found.")
        return 1

    print("\n=== LOGIN ATTEMPT ===")
    try:
        await login_and_listen(addr, token, listen_seconds=60)
    except Exception as e:
        print(f"\n❌ {type(e).__name__}: {e}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
