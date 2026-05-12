#!/usr/bin/env python3
"""
Diagnostikk: send kjent iOS-binding-payload og se om scale svarer.
iOS-payload fra sysdiagnose session 0x005c (02:46) — bekreftet vellykket binding.
Hvis scale sender tilbake 64 bytes → scale er i ubundet/accept-any tilstand.
Hvis scale ikke svarer → scale er i bundet tilstand og krever owner-autentisering.
"""
import asyncio, datetime, struct
from bleak import BleakScanner, BleakClient

XIAOMI_SVC = "0000fe95-0000-1000-8000-00805f9b34fb"
CHAR_0010  = "00000010-0000-1000-8000-00805f9b34fb"
CHAR_0019  = "00000019-0000-1000-8000-00805f9b34fb"
CHAR_0018  = "00000018-0000-1000-8000-00805f9b34fb"

import os, json
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

KEY_FILE = Path(__file__).parent / "persistent_key.json"

# Kjent iOS-payload fra sysdiagnose session 0x005c — dette fungerte!
IOS_PAYLOAD = bytes.fromhex(
    "1cef4a3aa5f6f5ec9a7de5f26c5c33d1c110"
    "e2f84d0cb880c9b5be726ddb6c6c51640a5a"
    "c3ea2309a7f898d6d7254dac6a8958b100bd"
    "7a1d39368ab15d6616d9"
)

# Vår persistent pubkey + ephemeral pubkey (generert for denne sesjonen)
_key_data = json.loads(KEY_FILE.read_text())
OUR_PUBKEY = bytes.fromhex(_key_data["public_key"])
_ephemeral_priv = X25519PrivateKey.generate()
_ephemeral_pub  = _ephemeral_priv.public_key().public_bytes_raw()

EPHEMERAL_PAYLOAD = OUR_PUBKEY + _ephemeral_pub   # persistent + ephemeral = 64 bytes
RANDOM_PAYLOAD = os.urandom(64)
OUR_PAYLOAD    = OUR_PUBKEY + bytes(32)            # tidligere test (feilet)

# Vår pub + iOS andre halvdel (test: er andre halvdel et "sertifikat" uavhengig av første?)
OUR_PUB_IOS_CERT = OUR_PUBKEY + IOS_PAYLOAD[32:]

# Velg payload å teste
TEST_PAYLOAD = OUR_PUB_IOS_CERT   # vår pubkey(32) + iOS sertifikat-halvdel(32)

def ts():
    return datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]

async def main():
    print("=== Hoto BLE Diagnostikk ===")
    print(f"Tester payload ({len(TEST_PAYLOAD)} bytes): {TEST_PAYLOAD.hex()[:32]}...")
    print()

    found = asyncio.Event()
    target = None
    def cb(device, adv):
        nonlocal target
        name = device.name or adv.local_name or ""
        if XIAOMI_SVC in (adv.service_data or {}) or "hoto" in name.lower() or "stand" in name.lower():
            if not found.is_set():
                print(f"[{ts()}] Fant: {device.address} ({name!r})")
                target = device
                found.set()
    async with BleakScanner(cb):
        await asyncio.wait_for(found.wait(), timeout=60)

    queue_0019 = asyncio.Queue()
    queue_0010 = asyncio.Queue()

    def on_notify(sender, data):
        uuid = str(sender).lower()
        print(f"  ← [{ts()}] NOTIFY {'0x0010' if '00000010' in uuid else '0x0019'}: {data.hex()}")
        if "00000019" in uuid:
            queue_0019.put_nowait(data)
        elif "00000010" in uuid:
            queue_0010.put_nowait(data)

    async def wait19(timeout=8.0):
        try:
            return await asyncio.wait_for(queue_0019.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None

    async with BleakClient(target, timeout=30.0) as client:
        print(f"[{ts()}] Tilkoblet!\n")
        for uuid in [CHAR_0010, CHAR_0019, CHAR_0018]:
            try:
                await client.start_notify(uuid, on_notify)
            except Exception:
                pass

        await asyncio.sleep(0.3)

        # Send binding init
        print(f"[{ts()}] Sender a2000000...")
        await client.write_gatt_char(CHAR_0010, bytes([0xa2, 0x00, 0x00, 0x00]))

        # Receive DID
        r = await wait19(timeout=5.0)
        if not r or r[:4] != bytes([0x00, 0x00, 0x00, 0x00]):
            print("Ingen DID-kunngjøring mottatt")
            return

        n_frags = struct.unpack_from("<H", r, 4)[0]
        print(f"  Scale kunngjør {n_frags} DID-fragmenter")
        await client.write_gatt_char(CHAR_0019, bytes([0x00, 0x00, 0x01, 0x01]))

        for _ in range(n_frags):
            await wait19(timeout=3.0)

        await client.write_gatt_char(CHAR_0019, bytes([0x00, 0x00, 0x01, 0x00]))
        await asyncio.sleep(0.1)
        await client.write_gatt_char(CHAR_0010, bytes([0x15, 0x00, 0x00, 0x00]))

        # Send kjent iOS-payload i 4 fragmenter
        chunk = 18
        data = TEST_PAYLOAD
        n = (len(data) + chunk - 1) // chunk
        announcement = bytes([0x00, 0x00, 0x00, 0x03]) + struct.pack("<H", n)
        print(f"\n[{ts()}] Sender iOS-payload ({len(data)} bytes, {n} fragmenter)...")
        await client.write_gatt_char(CHAR_0019, announcement)

        r = await wait19(timeout=5.0)
        if not r or r != bytes([0x00, 0x00, 0x01, 0x01]):
            print(f"  Uventet: {r.hex() if r else 'timeout'}")
            return

        for i in range(n):
            chunk_data = data[i*chunk:(i+1)*chunk]
            await client.write_gatt_char(CHAR_0019, struct.pack("<H", i+1) + chunk_data)
            await asyncio.sleep(0.05)

        r = await wait19(timeout=5.0)
        print(f"  ACK fra scale: {r.hex() if r else 'TIMEOUT'}")

        # Motta scale binding-respons
        print(f"\n[{ts()}] Venter på scale binding-respons (8 sek)...")
        r = await wait19(timeout=8.0)
        if not r:
            print(f"\n  ✗ Ingen respons fra scale")
            return

        print(f"\n  ✓ SCALE SVARTE: {r.hex()}")
        n_resp_frags = struct.unpack_from("<H", r, 4)[0]
        print(f"  Scale kunngjør {n_resp_frags} fragmenter i respons")

        # Motta scale's 64-byte data
        await client.write_gatt_char(CHAR_0019, bytes([0x00, 0x00, 0x01, 0x01]))
        parts = []
        for i in range(n_resp_frags):
            frag = await wait19(timeout=5.0)
            if not frag:
                print(f"  Mangler fragment {i+1}")
                return
            payload_part = frag[2:]
            parts.append(payload_part)
            print(f"  ← Frag {i+1}: {frag.hex()}")
        scale_resp = b"".join(parts)
        print(f"\n  Scale respons ({len(scale_resp)} bytes): {scale_resp.hex()}")
        await client.write_gatt_char(CHAR_0019, bytes([0x00, 0x00, 0x01, 0x00]))

        # iOS re-subscribes CCCDs her, men vi er allerede subscribed via start_notify
        await asyncio.sleep(0.05)

        # Send 24 zeros som second payload
        second = bytes(24)
        n2 = (len(second) + 18 - 1) // 18
        ann2 = bytes([0x00, 0x00, 0x00, 0x00]) + struct.pack("<H", n2)
        print(f"\n[{ts()}] Sender 24-byte second exchange (zeros)...")
        await client.write_gatt_char(CHAR_0019, ann2)
        r2 = await wait19(timeout=5.0)
        print(f"  Scale klar: {r2.hex() if r2 else 'TIMEOUT'}")
        if r2:
            for i in range(n2):
                chunk = second[i*18:(i+1)*18]
                await client.write_gatt_char(CHAR_0019, struct.pack("<H", i+1) + chunk)
                await asyncio.sleep(0.05)
            ack2 = await wait19(timeout=5.0)
            print(f"  ACK: {ack2.hex() if ack2 else 'TIMEOUT'}")

        # Finaliser
        print(f"\n[{ts()}] Sender 13000000...")
        await client.write_gatt_char(CHAR_0010, bytes([0x13, 0x00, 0x00, 0x00]))
        try:
            result = await asyncio.wait_for(queue_0010.get(), timeout=5.0)
            print(f"\n  SCALE SVARTE på 0x0010: {result.hex()}")
            if result == bytes([0x11, 0x00, 0x00, 0x00]):
                print("  ✓ BINDING SUKSESS! (11000000)")
            else:
                print(f"  (ikke 11000000)")
        except asyncio.TimeoutError:
            print("  Ingen respons på finalize")

if __name__ == "__main__":
    asyncio.run(main())
