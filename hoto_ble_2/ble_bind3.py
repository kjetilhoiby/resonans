#!/usr/bin/env python3
"""
Hoto Smart Kitchen Scale BLE binding — P-256 + AES-CCM (post-Yeelight model).

Three modes:
  replay : send captured iOS payloads exactly. Expected to fail (ephemeral ECDH).
           Confirms whether replay is a viable shortcut. ~30s.
  probe  : do one bind handshake with deliberately invalid proof, observe
           whether scale disconnects or just signals 0x12. Determines whether
           brute-force can hammer many proofs in one connection.
  brute  : structured enumeration of HKDF + plaintext candidates. Logs every
           attempt. Saves working combination to working_keys.json on success.

Dependencies:
    pip3 install bleak cryptography pycryptodomex   # pycryptodomex, NOT pycryptodome
"""
from __future__ import annotations

import argparse
import asyncio
import itertools
import json
import sys
import time
import zlib
from dataclasses import dataclass
from pathlib import Path

from bleak import BleakClient, BleakScanner
from Cryptodome.Cipher import AES
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.ec import (
    ECDH,
    SECP256R1,
    EllipticCurvePublicKey,
    generate_private_key,
)
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

# ---------- Constants ----------

HOTO_MAC = "DC:ED:83:84:2E:9D"
FE95 = "0000fe95-0000-1000-8000-00805f9b34fb"
CHAR_CONTROL = "00000010-0000-1000-8000-00805f9b34fb"  # short 0x0010
CHAR_DATA = "00000019-0000-1000-8000-00805f9b34fb"  # short 0x0019

# Cloud credentials (Kjetil's Mi account; scraped via Mi Cloud API)
BEACONKEY = bytes.fromhex("8094bbd44bf1a5b9d400e147b2c5e221")  # 16 B
TOKEN = bytes.fromhex("e77246463e2eca3d1fdf0a0d")  # 12 B (non-standard length)
DID = b"blt.4.1h37o9hp0gg00"

# Static AES-CCM nonce from Yeelight reference
STATIC_NONCE = bytes.fromhex("101112131415161718191a1b")

# Captured iOS bind from session B (2026-05-11 19:39:00)
IOS_PHONE_PUB_B = bytes.fromhex(
    "826e9052eb7f16e2da4e833a2eee9adad48c"
    "e622d9d730afd2a049d0b297de5ad08b036f"
    "c2ca6aeac76d908335ebde8af7e7d386928e"
    "874bcbe89200006da3ab"
)
IOS_PROOF_B = bytes.fromhex("64bba61ebe4370d33a02c03868adb978e9c701e41cde89bc")

CONTROL_OK_BIND = b"\x11\x00\x00\x00"
CONTROL_FAIL_BIND = b"\x12\x00\x00\x00"

OUT_DIR = Path(__file__).parent
WORKING_KEYS_FILE = OUT_DIR / "working_keys.json"
ATTEMPT_LOG = OUT_DIR / "bind3_attempts.log"


# ---------- Fragment protocol on data char ----------


class Fragmenter:
    """Send/receive payloads using announce → ready → fragments → ack."""

    def __init__(self, client: BleakClient, data_char: str):
        self.client = client
        self.data_char = data_char
        self.q: asyncio.Queue[bytes] = asyncio.Queue()

    def _on_notify(self, _sender, data: bytearray):
        self.q.put_nowait(bytes(data))

    async def start(self):
        await self.client.start_notify(self.data_char, self._on_notify)

    async def _read(self, timeout=5.0) -> bytes:
        return await asyncio.wait_for(self.q.get(), timeout)

    async def send(self, frame_type: int, payload: bytes, chunk: int = 18) -> None:
        nfrags = (len(payload) + chunk - 1) // chunk
        announce = bytes([0, 0, 0, frame_type]) + nfrags.to_bytes(2, "little")
        await self.client.write_gatt_char(self.data_char, announce, response=False)

        ready = await self._read()
        if ready != b"\x00\x00\x01\x01":
            raise RuntimeError(f"expected ready, got {ready.hex()}")

        for i in range(nfrags):
            start, end = i * chunk, min((i + 1) * chunk, len(payload))
            frag = (i + 1).to_bytes(2, "little") + payload[start:end]
            await self.client.write_gatt_char(self.data_char, frag, response=False)
            # Small pacing so the iPhone-style write storm doesn't outrun the scale
            await asyncio.sleep(0.005)

        ack = await self._read()
        if ack != b"\x00\x00\x01\x00":
            raise RuntimeError(f"expected ack, got {ack.hex()}")

    async def recv(self, expected_type: int | None = None) -> tuple[int, bytes]:
        announce = await self._read(timeout=10.0)
        if announce[:3] != b"\x00\x00\x00" or len(announce) != 6:
            raise RuntimeError(f"expected announce, got {announce.hex()}")
        frame_type = announce[3]
        nfrags = int.from_bytes(announce[4:6], "little")
        if expected_type is not None and frame_type != expected_type:
            print(f"  WARN: announce type=0x{frame_type:02x}, expected 0x{expected_type:02x}")

        await self.client.write_gatt_char(self.data_char, b"\x00\x00\x01\x01", response=False)

        frags: dict[int, bytes] = {}
        for _ in range(nfrags):
            data = await self._read()
            idx = int.from_bytes(data[:2], "little")
            frags[idx] = data[2:]

        await self.client.write_gatt_char(self.data_char, b"\x00\x00\x01\x00", response=False)
        return frame_type, b"".join(frags[i + 1] for i in range(nfrags))


# ---------- Scanning ----------


async def find_scale(timeout_total: float = 60.0) -> str | None:
    """Scan for fe95 + Hoto device-type. Returns BLE address (macOS UUID)."""
    deadline = time.monotonic() + timeout_total
    while time.monotonic() < deadline:
        devs = await BleakScanner.discover(timeout=3, return_adv=True)
        for addr, (d, adv) in devs.items():
            sd = (adv.service_data or {}).get(FE95)
            if sd and len(sd) >= 4 and sd[2:4] == bytes.fromhex("8011"):
                print(f"Found Hoto scale at {addr}, RSSI={adv.rssi}, name={d.name!r}")
                return addr
            if (d.name or "").startswith("HOTO-"):
                print(f"Found by name: {addr} ({d.name})")
                return addr
    return None


# ---------- Candidate generator ----------


def crc32_le(b: bytes) -> bytes:
    return zlib.crc32(b).to_bytes(4, "little")


def crc32_be(b: bytes) -> bytes:
    return zlib.crc32(b).to_bytes(4, "big")


@dataclass
class Candidate:
    name: str
    ltmk: bytes
    blob_order: str  # "shared+ltmk" or "ltmk+shared"
    salt: bytes
    info: bytes
    key_slice: slice
    plaintext_kind: str  # describes how to build plaintext from pubkeys


def ltmk_variants():
    return [
        ("beaconkey*2", BEACONKEY * 2),
        ("beaconkey+token+0000", BEACONKEY + TOKEN + b"\x00" * 4),
        ("token+0000+beaconkey", TOKEN + b"\x00" * 4 + BEACONKEY),
        ("beaconkey+16null", BEACONKEY + b"\x00" * 16),
        ("16null+beaconkey", b"\x00" * 16 + BEACONKEY),
    ]


def kdf_variants():
    return [
        ("miot-mesh-login", b"miot-mesh-login-salt", b"miot-mesh-login-info"),
        ("miot-bind-login", b"miot-bind-login-salt", b"miot-bind-login-info"),
        ("miot-pair", b"miot-pair-salt", b"miot-pair-info"),
        ("mible-login", b"mible-login-salt", b"mible-login-info"),
    ]


def slice_variants():
    return [
        ("0:16", slice(0, 16)),
        ("16:32", slice(16, 32)),
        ("32:48", slice(32, 48)),
        ("48:64", slice(48, 64)),
    ]


def plaintext_variants():
    """Each returns a function (phone_pub, scale_pub) -> 20B plaintext."""
    return [
        ("token+crcLE(phone)+crcLE(scale)", lambda p, s: TOKEN + crc32_le(p) + crc32_le(s)),
        ("token+crcLE(scale)+crcLE(phone)", lambda p, s: TOKEN + crc32_le(s) + crc32_le(p)),
        ("crcLE(phone)+crcLE(scale)+token", lambda p, s: crc32_le(p) + crc32_le(s) + TOKEN),
        ("crcLE(scale)+crcLE(phone)+token", lambda p, s: crc32_le(s) + crc32_le(p) + TOKEN),
        ("token+crcBE(phone)+crcBE(scale)", lambda p, s: TOKEN + crc32_be(p) + crc32_be(s)),
        ("token+crcBE(scale)+crcBE(phone)", lambda p, s: TOKEN + crc32_be(s) + crc32_be(p)),
        ("did12+crcLE(phone)+crcLE(scale)", lambda p, s: DID[:12] + crc32_le(p) + crc32_le(s)),
        ("did12+crcLE(scale)+crcLE(phone)", lambda p, s: DID[:12] + crc32_le(s) + crc32_le(p)),
    ]


def enumerate_candidates():
    """Yield (label, ltmk, blob_order, salt, info, key_slice, plain_fn) tuples.

    Ordered roughly by likelihood: Yeelight-faithful variants first.
    """
    # Most likely first: Yeelight strings + token-style plaintext
    priority_kdf = kdf_variants()  # mesh first
    priority_ltmk = ltmk_variants()
    priority_slice = slice_variants()  # 32:48 third = Yeelight "second half"
    priority_plain = plaintext_variants()

    for kdf_name, salt, info in priority_kdf:
        for ltmk_name, ltmk in priority_ltmk:
            for blob_order in ("shared+ltmk", "ltmk+shared"):
                for slice_name, key_slice in priority_slice:
                    for plain_name, plain_fn in priority_plain:
                        label = f"{kdf_name}/{ltmk_name}/{blob_order}/{slice_name}/{plain_name}"
                        yield label, ltmk, blob_order, salt, info, key_slice, plain_fn


# ---------- Crypto helpers ----------


def derive_session_key(shared: bytes, ltmk: bytes, blob_order: str, salt: bytes, info: bytes) -> bytes:
    blob = shared + ltmk if blob_order == "shared+ltmk" else ltmk + shared
    return HKDF(algorithm=hashes.SHA256(), length=64, salt=salt, info=info).derive(blob)


def build_proof(aes_key: bytes, plain: bytes) -> bytes:
    if len(plain) != 20:
        raise ValueError(f"plaintext must be 20 B, got {len(plain)}")
    cipher = AES.new(aes_key, AES.MODE_CCM, nonce=STATIC_NONCE, mac_len=4)
    ct, tag = cipher.encrypt_and_digest(plain)
    return ct + tag


# ---------- Bind handshake (shared core) ----------


@dataclass
class HandshakeState:
    """Captured state after the pubkey exchange in a bind run."""
    phone_priv: object
    phone_pub_raw: bytes
    scale_pub_raw: bytes
    shared_secret: bytes


async def bind_until_proof(client: BleakClient, control_q: asyncio.Queue,
                            frag: Fragmenter, phone_pub_raw: bytes | None = None,
                            phone_priv=None) -> HandshakeState:
    """Run the bind handshake up through scale-pubkey-receive. Returns state
    needed to compute proof. If phone_pub_raw is given, it's sent verbatim
    (replay mode); otherwise we generate a fresh keypair."""
    # 1. a2 init
    await client.write_gatt_char(CHAR_CONTROL, b"\xa2\x00\x00\x00", response=False)

    # 2. DID exchange
    typ, did_payload = await frag.recv(expected_type=0x00)
    # Some Hoto-frames have a small prefix before the ASCII DID
    ascii_part = bytes(b for b in did_payload if 0x20 <= b < 0x7F)
    print(f"  DID payload ({len(did_payload)} B): prefix={did_payload[: max(0, len(did_payload) - len(ascii_part))].hex()} ascii={ascii_part.decode(errors='replace')!r}")

    # 3. Trigger phase 2
    await client.write_gatt_char(CHAR_CONTROL, b"\x15\x00\x00\x00", response=False)

    # 4. Send phone 64B pubkey
    if phone_pub_raw is None:
        phone_priv = generate_private_key(SECP256R1())
        nums = phone_priv.public_key().public_numbers()
        phone_pub_raw = nums.x.to_bytes(32, "big") + nums.y.to_bytes(32, "big")
    print(f"  → phone pub: {phone_pub_raw.hex()}")
    await frag.send(0x03, phone_pub_raw)

    # 5. Receive scale's 64B pubkey
    typ, scale_pub_raw = await frag.recv(expected_type=0x03)
    if len(scale_pub_raw) != 64:
        raise RuntimeError(f"scale pub length {len(scale_pub_raw)} ≠ 64")
    print(f"  ← scale pub: {scale_pub_raw.hex()}")

    # 6. Compute shared secret (skipped in replay mode where we lack priv)
    shared = b""
    if phone_priv is not None:
        scale_pub = EllipticCurvePublicKey.from_encoded_point(
            SECP256R1(), b"\x04" + scale_pub_raw
        )
        shared = phone_priv.exchange(ECDH(), scale_pub)
        print(f"  shared secret (32 B): {shared.hex()}")
    else:
        print("  (no phone_priv — shared secret cannot be computed)")

    return HandshakeState(phone_priv, phone_pub_raw, scale_pub_raw, shared)


async def send_proof_and_finalize(client: BleakClient, frag: Fragmenter,
                                    control_q: asyncio.Queue,
                                    proof_24b: bytes, timeout: float = 5.0) -> bytes:
    await frag.send(0x00, proof_24b)
    await client.write_gatt_char(CHAR_CONTROL, b"\x13\x00\x00\x00", response=False)
    return await asyncio.wait_for(control_q.get(), timeout=timeout)


async def setup_session(client: BleakClient) -> tuple[Fragmenter, asyncio.Queue]:
    control_q: asyncio.Queue[bytes] = asyncio.Queue()
    def on_ctrl(_s, data):
        control_q.put_nowait(bytes(data))
    frag = Fragmenter(client, CHAR_DATA)
    await client.start_notify(CHAR_CONTROL, on_ctrl)
    await frag.start()
    return frag, control_q


# ---------- Modes ----------


async def mode_replay(addr: str):
    """Send iOS-fanget phone_pub + proof verbatim. Expected: 0x12 (fail)."""
    print("=== mode: replay ===")
    async with BleakClient(addr, timeout=20) as client:
        frag, control_q = await setup_session(client)
        state = await bind_until_proof(client, control_q, frag,
                                         phone_pub_raw=IOS_PHONE_PUB_B,
                                         phone_priv=None)
        print(f"  → sending iOS-proof: {IOS_PROOF_B.hex()}")
        resp = await send_proof_and_finalize(client, frag, control_q, IOS_PROOF_B)
        print(f"\nFinal response on 0x0010: {resp.hex()}")
        if resp == CONTROL_OK_BIND:
            print("✅ SUCCESS — replay worked. Protocol does NOT bind to ephemeral state.")
        elif resp == CONTROL_FAIL_BIND:
            print("❌ FAIL (expected) — proof rejected. Confirms ephemeral ECDH binding.")
        else:
            print(f"⚠️  Unexpected response — investigate.")


async def mode_probe(addr: str):
    """Generate own keypair, send DELIBERATELY BAD proof, observe scale behavior.

    Goal: learn whether scale disconnects on bad proof or just answers 0x12 and
    accepts further attempts. Defines brute-force loop architecture.
    """
    print("=== mode: probe ===")
    async with BleakClient(addr, timeout=20) as client:
        frag, control_q = await setup_session(client)
        state = await bind_until_proof(client, control_q, frag)

        # Send obviously-bogus proof
        bogus = b"\xde\xad\xbe\xef" * 6  # 24 B
        print(f"  → sending bogus proof: {bogus.hex()}")
        resp = await send_proof_and_finalize(client, frag, control_q, bogus)
        print(f"\nResponse #1: {resp.hex()}")

        # Try to send another finalize / proof and see if scale reacts
        print("  → trying second 13000000 (does scale accept retry?)")
        try:
            await client.write_gatt_char(CHAR_CONTROL, b"\x13\x00\x00\x00", response=False)
            resp2 = await asyncio.wait_for(control_q.get(), timeout=2.0)
            print(f"  Response #2: {resp2.hex()}")
        except asyncio.TimeoutError:
            print("  no response on retry 13000000")

        # Then try sending another proof entirely
        print("  → trying second 24B proof + 13000000 (retry-in-session test)")
        bogus2 = b"\xca\xfe\xba\xbe" * 6
        try:
            await frag.send(0x00, bogus2)
            await client.write_gatt_char(CHAR_CONTROL, b"\x13\x00\x00\x00", response=False)
            resp3 = await asyncio.wait_for(control_q.get(), timeout=2.0)
            print(f"  Response #3: {resp3.hex()}")
            print("  → SCALE ACCEPTS RETRY-IN-SESSION. Brute-force can hammer.")
        except (asyncio.TimeoutError, Exception) as e:
            print(f"  retry blocked: {e}")
            print("  → Brute-force must reconnect per attempt.")

        # Test: can we reset state machine with another a2 without reconnecting?
        print("  → trying a2 reset (re-init bind in same connection)")
        try:
            await client.write_gatt_char(CHAR_CONTROL, b"\xa2\x00\x00\x00", response=False)
            typ, did = await asyncio.wait_for(frag.recv(expected_type=0x00), timeout=3.0)
            print(f"  ✅ a2 RESET WORKS — got DID again ({len(did)}B). retry-in-session via a2 is possible!")
        except asyncio.TimeoutError:
            print("  ❌ a2 reset timed out — scale state machine is frozen until disconnect")
        except Exception as e:
            print(f"  ❌ a2 reset failed: {type(e).__name__}: {e}")

        print(f"  client.is_connected = {client.is_connected}")


def _drain(q: asyncio.Queue) -> int:
    n = 0
    while not q.empty():
        try:
            q.get_nowait()
            n += 1
        except asyncio.QueueEmpty:
            break
    return n


async def _try_one_attempt(client, frag, control_q, ltmk, blob_order, salt, info, key_slice, plain_fn):
    """Run full handshake + proof. Returns (resp_bytes, shared, session_key, phone_pub, scale_pub).
    Each call generates fresh phone keypair (so different shared secret)."""
    state = await bind_until_proof(client, control_q, frag)
    session_key = derive_session_key(state.shared_secret, ltmk, blob_order, salt, info)
    plain = plain_fn(state.phone_pub_raw, state.scale_pub_raw)
    proof = build_proof(session_key[key_slice], plain)
    resp = await send_proof_and_finalize(client, frag, control_q, proof, timeout=4.0)
    return resp, state.shared_secret, session_key, state.phone_pub_raw, state.scale_pub_raw


async def mode_brute(addr: str, max_attempts: int | None = None, reconnect_per_attempt: bool = False):
    """Iterate HKDF + plaintext candidates.

    Default: stay in one connection, use `a2` to reset state machine between
    attempts (verified by probe). ~1.5s/attempt.

    --reconnect-per-attempt: full disconnect/connect cycle per attempt (~6s).
    Use only if a2-reset fails repeatedly.
    """
    print("=== mode: brute ===")
    candidates = list(enumerate_candidates())
    if max_attempts:
        candidates = candidates[:max_attempts]
    total = len(candidates)
    print(f"Total candidates: {total}")
    if reconnect_per_attempt:
        print(f"Estimated time: ~{total * 6 // 60} min (reconnect per attempt)")
    else:
        print(f"Estimated time: ~{total * 2 // 60} min (a2-reset within one connection)")

    ATTEMPT_LOG.write_text(f"# Brute started {time.ctime()}\n# mode={'reconnect' if reconnect_per_attempt else 'a2-reset'}\n")
    found = None

    # Per-connection attempt budget. Observation: connection drops around #255,
    # suggesting an 8-bit counter somewhere. Be conservative and reconnect well
    # before that. 200 leaves margin for retries on transient failures.
    PER_CONNECTION_LIMIT = 200

    # Track progress across reconnects via a closure on a list (mutable)
    cursor = [0]  # index into candidates

    async def run_attempts(client, start_idx: int) -> tuple[bool, int]:
        """Run attempts starting at start_idx. Returns (found_or_finished, last_idx_done).
        Stops after PER_CONNECTION_LIMIT attempts to proactively reconnect."""
        nonlocal found
        frag, control_q = await setup_session(client)
        attempts_this_conn = 0
        last_done = start_idx
        for i in range(start_idx, total):
            label, ltmk, blob_order, salt, info, key_slice, plain_fn = candidates[i]
            attempt_no = i + 1  # 1-based for display
            # Drain stale notifications between attempts
            _drain(control_q)
            _drain(frag.q)
            t0 = time.monotonic()
            try:
                resp, shared, skey, ppub, spub = await asyncio.wait_for(
                    _try_one_attempt(client, frag, control_q, ltmk, blob_order, salt, info, key_slice, plain_fn),
                    timeout=10.0,
                )
            except (asyncio.TimeoutError, Exception) as e:
                msg = f"{type(e).__name__}: {e}"
                with ATTEMPT_LOG.open("a") as f:
                    f.write(f"{attempt_no}\tERROR\t{label}\t{msg}\n")
                print(f"[{attempt_no}/{total}] ERROR ({msg})")
                if not client.is_connected:
                    print("  → disconnected; will reconnect and resume")
                    return False, i  # resume from same idx
                _drain(control_q)
                _drain(frag.q)
                await asyncio.sleep(0.3)
                continue
            dt = time.monotonic() - t0
            with ATTEMPT_LOG.open("a") as f:
                f.write(f"{attempt_no}\t{resp.hex()}\t{label}\t({dt:.2f}s)\n")
            status = "✅ SUCCESS" if resp == CONTROL_OK_BIND else resp.hex()
            if resp == CONTROL_OK_BIND or attempt_no % 25 == 0 or i == start_idx:
                print(f"[{attempt_no}/{total}] {status:10s} {label} ({dt:.2f}s)")
            last_done = i + 1
            if resp == CONTROL_OK_BIND:
                found = (label, ltmk, blob_order, salt, info, key_slice, plain_fn,
                          ppub, spub, shared, skey)
                return True, last_done
            attempts_this_conn += 1
            if attempts_this_conn >= PER_CONNECTION_LIMIT:
                print(f"  → reached {PER_CONNECTION_LIMIT} attempts in this connection; reconnecting proactively")
                return False, last_done
        return True, last_done  # finished without success

    if reconnect_per_attempt:
        for i, (label, ltmk, blob_order, salt, info, key_slice, plain_fn) in enumerate(candidates, 1):
            try:
                async with BleakClient(addr, timeout=20) as client:
                    frag, control_q = await setup_session(client)
                    resp, shared, skey, ppub, spub = await _try_one_attempt(
                        client, frag, control_q, ltmk, blob_order, salt, info, key_slice, plain_fn)
                with ATTEMPT_LOG.open("a") as f:
                    f.write(f"{i}\t{resp.hex()}\t{label}\n")
                status = "✅ SUCCESS" if resp == CONTROL_OK_BIND else resp.hex()
                print(f"[{i}/{total}] {status:10s} {label}")
                if resp == CONTROL_OK_BIND:
                    found = (label, ltmk, blob_order, salt, info, key_slice, plain_fn,
                              ppub, spub, shared, skey)
                    break
            except Exception as e:
                print(f"[{i}/{total}] EXCEPTION ({type(e).__name__}: {e})")
                with ATTEMPT_LOG.open("a") as f:
                    f.write(f"{i}\tEXC\t{label}\t{e}\n")
                await asyncio.sleep(2.0)
    else:
        # Stay connected; retry-via-a2. Reconnect proactively every 200 attempts
        # and resume from where we left off.
        idx_start = 0
        connect_attempts = 0
        max_connects = total // PER_CONNECTION_LIMIT + 10  # safety upper bound
        while idx_start < total and connect_attempts < max_connects and not found:
            connect_attempts += 1
            print(f"\n=== Connection #{connect_attempts}, resuming at candidate #{idx_start + 1}/{total} ===")
            try:
                async with BleakClient(addr, timeout=20) as client:
                    finished, idx_start = await run_attempts(client, idx_start)
                    if finished or found:
                        break
            except Exception as e:
                print(f"Connection error: {type(e).__name__}: {e}; rescanning")
                new_addr = await find_scale(timeout_total=30)
                if new_addr:
                    addr = new_addr
                else:
                    print("Could not re-find scale. Aborting.")
                    break
            # Brief pause between connections so scale resets cleanly
            await asyncio.sleep(2.0)

    if found:
        label, ltmk, order, salt, info, slc, _pfn, ppub, spub, shared, skey = found
        WORKING_KEYS_FILE.write_text(json.dumps({
            "label": label,
            "ltmk_hex": ltmk.hex(),
            "blob_order": order,
            "salt": salt.decode(),
            "info": info.decode(),
            "key_slice": f"{slc.start}:{slc.stop}",
            "phone_pub_hex": ppub.hex(),
            "scale_pub_hex": spub.hex(),
            "shared_secret_hex": shared.hex(),
            "session_key_hex": skey.hex(),
        }, indent=2))
        print(f"\n🎉 Wrote working combination to {WORKING_KEYS_FILE}")
    else:
        print(f"\n❌ No working combination found in {total} attempts. See {ATTEMPT_LOG}.")


# ---------- Main ----------


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["replay", "probe", "brute"], default="probe")
    parser.add_argument("--max", type=int, default=None,
                        help="brute mode: max candidates to try (default: all)")
    parser.add_argument("--reconnect-per-attempt", action="store_true",
                        help="brute mode: full disconnect/reconnect per attempt (~6s each). Default uses a2-reset in one connection (~2s each).")
    args = parser.parse_args()

    print("Scanning for Hoto scale...")
    addr = await find_scale()
    if not addr:
        print("Could not find Hoto scale. Press scale button and try again.")
        return 1

    if args.mode == "replay":
        await mode_replay(addr)
    elif args.mode == "probe":
        await mode_probe(addr)
    elif args.mode == "brute":
        await mode_brute(addr, max_attempts=args.max, reconnect_per_attempt=args.reconnect_per_attempt)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
