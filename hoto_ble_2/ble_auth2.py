#!/usr/bin/env python3
import asyncio
import datetime
import os
import struct
from bleak import BleakScanner, BleakClient

try:
    from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
    HAS_X25519 = True
except ImportError:
    HAS_X25519 = False

XIAOMI_SVC = "0000fe95-0000-1000-8000-00805f9b34fb"
CHAR_0010 = "00000010-0000-1000-8000-00805f9b34fb"
CHAR_0019 = "00000019-0000-1000-8000-00805f9b34fb"
CHAR_0017 = "00000017-0000-1000-8000-00805f9b34fb"
CHAR_0018 = "00000018-0000-1000-8000-00805f9b34fb"
CHAR_CMD  = "00000101-0065-6c62-2e74-6f696d2e696d"
CHAR_RSP  = "00000102-0065-6c62-2e74-6f696d2e696d"

def ts():
    return datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]

def make_phone_pubkey():
    if HAS_X25519:
        priv = X25519PrivateKey.generate()
        pub  = priv.public_key().public_bytes_raw()
        return priv, pub
    return None, os.urandom(32)

def ecdh_shared_secret(priv, peer_pub_bytes):
    if HAS_X25519 and priv:
        from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PublicKey
        peer_pub = X25519PublicKey.from_public_bytes(peer_pub_bytes)
        return priv.exchange(peer_pub)
    return None

async def find_device():
    found = asyncio.Event()
    target = None

    def cb(device, adv):
        nonlocal target
        name = device.name or adv.local_name or ""
        if XIAOMI_SVC in (adv.service_data or {}) or "hoto" in name.lower() or "stand" in name.lower():
            if not found.is_set():
                print(f"[{ts()}] Fant: {device.address} ({name!r}) rssi={adv.rssi}")
                target = device
                found.set()

    print(f"[{ts()}] Scanner (3 min)...\n")
    async with BleakScanner(cb):
        await asyncio.wait_for(found.wait(), timeout=180)
    return target

async def auth_session(client):
    auth_queue = asyncio.Queue()
    data_msgs  = []

    def on_notify(sender, data):
        uuid = str(sender).lower()
        short = str(sender).split("-")[0]
        print(f"  ← [{ts()}] NOTIFY {short}: {data.hex()}")
        if "00000019" in uuid:
            auth_queue.put_nowait(data)
        elif "00000010" in uuid:
            data_msgs.append(data)

    print("\n-- Subscribe --")
    for uuid in [CHAR_0010, CHAR_0019, CHAR_0018]:
        try:
            await client.start_notify(uuid, on_notify)
            print(f"  OK {uuid.split('-')[0]}")
        except Exception as e:
            print(f"  FEIL {uuid.split('-')[0]}: {e}")

    await asyncio.sleep(0.5)
    print(f"\n[{ts()}] Init: skriver 24000000 til 0x0010...")
    try:
        await client.write_gatt_char(CHAR_0010, bytes([0x24, 0x00, 0x00, 0x00]))
    except Exception as e:
        print(f"  Feil: {e}")

    await asyncio.sleep(0.3)

    phone_nonce = os.urandom(16)
    priv_key, phone_pubkey = make_phone_pubkey()
    print(f"\n[{ts()}] FASE 1: nonce={phone_nonce.hex()}")

    async def send(data):
        print(f"  → [{ts()}] WRITE  {data.hex()}")
        await client.write_gatt_char(CHAR_0019, data)

    async def wait_for(prefix, timeout=5.0):
        deadline = asyncio.get_event_loop().time() + timeout
        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                print(f"  TIMEOUT: ventet på {prefix.hex()}")
                return None
            try:
                data = await asyncio.wait_for(auth_queue.get(), timeout=remaining)
                if data[:len(prefix)] == prefix:
                    return data
                print(f"  Uventet: {data.hex()}")
            except asyncio.TimeoutError:
                return None

    await send(bytes([0x00, 0x00, 0x00, 0x0b, 0x01, 0x00]))
    if not await wait_for(bytes([0x00, 0x00, 0x01, 0x01])):
        return False
    await send(bytes([0x01, 0x00]) + phone_nonce)
    if not await wait_for(bytes([0x00, 0x00, 0x01, 0x00])):
        return False
    print("  Fase 1 OK")

    print(f"\n[{ts()}] FASE 2: scale nonce...")
    r = await wait_for(bytes([0x00, 0x00, 0x00]), timeout=5.0)
    if not r: return False
    await send(bytes([0x00, 0x00, 0x01, 0x01]))
    r = await wait_for(bytes([0x01, 0x00]), timeout=5.0)
    if not r: return False
    scale_nonce = r[2:]
    print(f"  scale_nonce: {scale_nonce.hex()}")
    await send(bytes([0x00, 0x00, 0x01, 0x00]))

    print(f"\n[{ts()}] FASE 3: scale pubkey...")
    r = await wait_for(bytes([0x00, 0x00, 0x00]), timeout=5.0)
    if not r: return False
    await send(bytes([0x00, 0x00, 0x01, 0x01]))
    frag1 = await wait_for(bytes([0x01, 0x00]), timeout=5.0)
    frag2 = await wait_for(bytes([0x02, 0x00]), timeout=5.0)
    if not frag1 or not frag2: return False
    scale_pubkey = frag1[2:] + frag2[2:]
    print(f"  scale_pubkey: {scale_pubkey.hex()} ({len(scale_pubkey)} bytes)")
    await send(bytes([0x00, 0x00, 0x01, 0x00]))

    print(f"\n[{ts()}] FASE 4: sender phone pubkey...")
    await send(bytes([0x00, 0x00, 0x00, 0x0a, 0x02, 0x00]))
    if not await wait_for(bytes([0x00, 0x00, 0x01, 0x01]), timeout=5.0):
        return False
    await send(bytes([0x01, 0x00]) + phone_pubkey[:18])
    await asyncio.sleep(0.1)
    await send(bytes([0x02, 0x00]) + phone_pubkey[18:])
    r = await wait_for(bytes([0x00, 0x00, 0x01, 0x00]), timeout=5.0)
    if not r:
        print(f"\n[{ts()}] AUTH FEILET")
        return False

    shared = ecdh_shared_secret(priv_key, bytes(scale_pubkey))
    print(f"\n[{ts()}] AUTH SUKSESS!")
    if shared:
        print(f"  shared: {shared.hex()}")
    return True, data_msgs, scale_nonce, scale_pubkey, phone_nonce, phone_pubkey, shared

async def main():
    device = await find_device()

    def on_dc(c):
        print(f"\n[{ts()}] KOBLET FRA\n")

    async with BleakClient(device, disconnected_callback=on_dc, timeout=30.0) as client:
        print(f"[{ts()}] Tilkoblet! ({device.name})\n")

        result = await auth_session(client)
        if not result or result is False:
            print("Auth feilet.")
            return

        def post_notify(sender, data):
            print(f"  ← [{ts()}] POST {str(sender).split('-')[0]}: {data.hex()}")

        for uuid in [CHAR_RSP, CHAR_0017]:
            try:
                await client.start_notify(uuid, post_notify)
                print(f"  Post-subscribe OK: {uuid.split('-')[0]}")
            except Exception as e:
                print(f"  Post-subscribe FEIL: {e}")

        cmds = [
            (CHAR_0010, "query_01",   bytes([0x01])),
            (CHAR_0010, "query_2300", bytes([0x23, 0x00, 0x00, 0x00])),
            (CHAR_0010, "query_2400", bytes([0x24, 0x00, 0x00, 0x00])),
            (CHAR_CMD,  "query_01",   bytes([0x01])),
            (CHAR_CMD,  "query_0300", bytes([0x03, 0x00])),
            (CHAR_CMD,  "query_A001", bytes([0xA0, 0x01, 0x00, 0x00])),
        ]
        for uuid, name, cmd in cmds:
            try:
                await client.write_gatt_char(uuid, cmd)
                print(f"  → {name}: {cmd.hex()}")
            except Exception as e:
                print(f"  → {name}: FEIL {e}")
            await asyncio.sleep(0.3)

        print(f"\n[{ts()}] Lytter 60 sek – legg noe på vekta!\n")
        for i in range(60):
            await asyncio.sleep(1)
            print(f"  {i+1}s", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
