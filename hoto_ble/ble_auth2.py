#!/usr/bin/env python3
"""
ble_auth2.py — Implementerer den FAKTISKE auth-protokollen fra iOS-trafikk-capture.

Auth skjer på char 0x0019 (IKKE 0x0017 som antatt).
Ingen BLE-bonding trengs. Fungerer fra macOS.

Protokoll (char 0x0019, handle 0x0015):
  Fase 1 (phone sender 16-byte nonce):
    → 00 00 00 0b 01 00
    ← 00 00 01 01          (scale: klar, send data)
    → 01 00 [16 random bytes]
    ← 00 00 01 00          (scale: mottatt)

  Fase 2 (scale sender 16-byte nonce):
    ← 00 00 00 0d 01 00    (scale: jeg har data til deg)
    → 00 00 01 01          (phone: klar)
    ← 01 00 [16 bytes]     (scale nonce)
    → 00 00 01 00          (phone: mottatt)

  Fase 3 (scale sender 32-byte public key):
    ← 00 00 00 0c 02 00
    → 00 00 01 01
    ← 01 00 [18 bytes]     (fragment 1)
    ← 02 00 [14 bytes]     (fragment 2 → total 32 bytes)
    → 00 00 01 00

  Fase 4 (phone sender 32-byte value):
    → 00 00 00 0a 02 00
    ← 00 00 01 01
    → 01 00 [18 bytes]     (fragment 1)
    → 02 00 [14 bytes]     (fragment 2 → total 32 bytes)
    ← 00 00 01 00          (auth OK!)

  Auth ferdig:
    ← char0x0010: 21 00 00 00
"""
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
    print("ADVARSEL: pip3 install cryptography — bruker tilfeldig 32 bytes som fallback")

XIAOMI_SVC = "0000fe95-0000-1000-8000-00805f9b34fb"

# Char UUIDs (bleak håndterer handle-mapping)
CHAR_0010 = "00000010-0000-1000-8000-00805f9b34fb"  # DATA notify
CHAR_0019 = "00000019-0000-1000-8000-00805f9b34fb"  # AUTH kanal (ikke 0x0017!)
CHAR_0017 = "00000017-0000-1000-8000-00805f9b34fb"  # Ignoreres
CHAR_0018 = "00000018-0000-1000-8000-00805f9b34fb"
CHAR_CMD  = "00000101-0065-6c62-2e74-6f696d2e696d"  # MiBle cmd
CHAR_RSP  = "00000102-0065-6c62-2e74-6f696d2e696d"  # MiBle notify

BEACONKEY = bytes.fromhex("8094bbd44bf1a5b9d400e147b2c5e221")
TOKEN     = bytes.fromhex("e77246463e2eca3d1fdf0a0d")


def ts():
    return datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]


def make_phone_pubkey():
    """Generer X25519-nøkkelpar og returner (private_key, public_key_bytes)."""
    if HAS_X25519:
        priv = X25519PrivateKey.generate()
        pub  = priv.public_key().public_bytes_raw()  # 32 bytes
        return priv, pub
    else:
        return None, os.urandom(32)


def ecdh_shared_secret(priv, peer_pub_bytes):
    """Beregn ECDH shared secret."""
    if HAS_X25519 and priv:
        from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PublicKey
        peer_pub = X25519PublicKey.from_public_bytes(peer_pub_bytes)
        return priv.exchange(peer_pub)
    return None


async def find_device():
    """Finn vekta via Xiaomi fe95 service UUID."""
    found = asyncio.Event()
    target = None

    def cb(device, adv):
        nonlocal target
        name = device.name or adv.local_name or ""
        if XIAOMI_SVC in (adv.service_data or {}) or "hoto" in name.lower():
            if not found.is_set():
                print(f"[{ts()}] Fant: {device.address} ({name!r}) rssi={adv.rssi}")
                target = device
                found.set()

    print(f"[{ts()}] Slå på vekta! (scanner i 3 min)\n")
    async with BleakScanner(cb):
        await asyncio.wait_for(found.wait(), timeout=180)
    return target


async def auth_session(client):
    """Gjennomfør auth-protokollen. Returnerer True hvis OK."""
    notify_queue = asyncio.Queue()
    auth_queue   = asyncio.Queue()
    data_msgs    = []

    def on_notify(sender, data):
        t = ts()
        uuid = str(sender).lower()
        short = str(sender).split("-")[0]
        print(f"  ← [{t}] NOTIFY {short}: {data.hex()}")
        if "00000019" in uuid:
            auth_queue.put_nowait(data)
        elif "00000010" in uuid:
            data_msgs.append(data)
            print(f"     → DATA: {data.hex()}")
        notify_queue.put_nowait((short, data))

    # Subscribe (IKKE char_rsp / MiBle før auth – iOS-appen gjør det etter)
    print("\n-- Subscribe --")
    for uuid in [CHAR_0010, CHAR_0019, CHAR_0018]:
        try:
            await client.start_notify(uuid, on_notify)
            print(f"  OK {uuid.split('-')[0]}")
        except Exception as e:
            print(f"  FEIL {uuid.split('-')[0]}: {e}")

    # Init: skriv 24000000 til char 0x0010 (som Hoto-appen gjør)
    await asyncio.sleep(0.5)
    print(f"\n[{ts()}] Init: skriver 24000000 til char 0x0010...")
    try:
        await client.write_gatt_char(CHAR_0010, bytes([0x24, 0x00, 0x00, 0x00]))
    except Exception as e:
        print(f"  Feil: {e}")

    await asyncio.sleep(0.3)

    # --- Fase 1: Send nonce ---
    phone_nonce = os.urandom(16)
    priv_key, phone_pubkey = make_phone_pubkey()
    print(f"\n[{ts()}] FASE 1: Sender nonce ({phone_nonce.hex()})...")

    async def send(data):
        print(f"  → [{ts()}] WRITE  {str(data.hex())}")
        await client.write_gatt_char(CHAR_0019, data)

    async def wait_for(expected_prefix, timeout=5.0):
        """Vent til vi får en melding som starter med expected_prefix."""
        deadline = asyncio.get_event_loop().time() + timeout
        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                print(f"  TIMEOUT: ventet på {expected_prefix.hex()}")
                return None
            try:
                data = await asyncio.wait_for(auth_queue.get(), timeout=remaining)
                if data[:len(expected_prefix)] == expected_prefix:
                    return data
                else:
                    print(f"  Uventet: {data.hex()} (ventet {expected_prefix.hex()})")
            except asyncio.TimeoutError:
                return None

    # → 00 00 00 0b 01 00
    await send(bytes([0x00, 0x00, 0x00, 0x0b, 0x01, 0x00]))
    r = await wait_for(bytes([0x00, 0x00, 0x01, 0x01]))
    if not r:
        print("FASE 1: Ingen ACK fra scale")
        return False
    print("  Scale: klar!")

    # → 01 00 + 16-byte nonce
    await send(bytes([0x01, 0x00]) + phone_nonce)
    r = await wait_for(bytes([0x00, 0x00, 0x01, 0x00]))
    if not r:
        print("FASE 1: Nonce ikke bekreftet")
        return False
    print("  Scale: nonce mottatt!")

    # --- Fase 2: Motta scale nonce ---
    print(f"\n[{ts()}] FASE 2: Venter på scale nonce...")
    r = await wait_for(bytes([0x00, 0x00, 0x00]), timeout=5.0)
    if not r:
        print("FASE 2: Ingen melding fra scale")
        return False
    print(f"  Scale: annonserer data ({r.hex()})")

    await send(bytes([0x00, 0x00, 0x01, 0x01]))
    r = await wait_for(bytes([0x01, 0x00]), timeout=5.0)
    if not r:
        print("FASE 2: Ingen scale nonce")
        return False
    scale_nonce = r[2:]
    print(f"  Scale nonce: {scale_nonce.hex()}")

    await send(bytes([0x00, 0x00, 0x01, 0x00]))

    # --- Fase 3: Motta scale public key (32 bytes, 2 fragmenter) ---
    print(f"\n[{ts()}] FASE 3: Venter på scale public key...")
    r = await wait_for(bytes([0x00, 0x00, 0x00]), timeout=5.0)
    if not r:
        print("FASE 3: Ingen melding fra scale")
        return False
    print(f"  Scale: annonserer pubkey ({r.hex()})")

    await send(bytes([0x00, 0x00, 0x01, 0x01]))

    frag1 = await wait_for(bytes([0x01, 0x00]), timeout=5.0)
    frag2 = await wait_for(bytes([0x02, 0x00]), timeout=5.0)
    if not frag1 or not frag2:
        print("FASE 3: Fikk ikke alle fragmenter")
        return False

    scale_pubkey = frag1[2:] + frag2[2:]  # 32 bytes total
    print(f"  Scale pubkey: {scale_pubkey.hex()} ({len(scale_pubkey)} bytes)")

    await send(bytes([0x00, 0x00, 0x01, 0x00]))

    # --- Fase 4: Send phone public key (32 bytes, 2 fragmenter) ---
    print(f"\n[{ts()}] FASE 4: Sender phone public key...")

    # Send pubkey i 2 fragmenter (18 + 14 bytes = 32 bytes data)
    await send(bytes([0x00, 0x00, 0x00, 0x0a, 0x02, 0x00]))
    r = await wait_for(bytes([0x00, 0x00, 0x01, 0x01]), timeout=5.0)
    if not r:
        print("FASE 4: Scale ikke klar")
        return False

    frag1_data = phone_pubkey[:18]
    frag2_data = phone_pubkey[18:]  # 14 bytes
    await send(bytes([0x01, 0x00]) + frag1_data)
    await asyncio.sleep(0.1)
    await send(bytes([0x02, 0x00]) + frag2_data)

    r = await wait_for(bytes([0x00, 0x00, 0x01, 0x00]), timeout=5.0)
    if r:
        print(f"\n[{ts()}] AUTH SUKSESS! Scale bekreftet!")
        shared = ecdh_shared_secret(priv_key, bytes(scale_pubkey))
        if shared:
            print(f"  ECDH shared secret: {shared.hex()}")
        return True, data_msgs, scale_nonce, scale_pubkey, phone_nonce, phone_pubkey, shared
    else:
        print(f"\n[{ts()}] AUTH FEILET – ingen ACK etter fase 4")
        return False


async def main():
    device = await find_device()

    def on_dc(c):
        print(f"\n[{ts()}] KOBLET FRA\n")

    async with BleakClient(device, disconnected_callback=on_dc, timeout=30.0) as client:
        print(f"[{ts()}] Tilkoblet!\n")

        result = await auth_session(client)

        if result and result is not False:
            print(f"\n[{ts()}] Auth OK – prøver kommandoer og venter på vektdata...")
            print("LEGG NOE PÅ VEKTA NÅ!\n")

            def post_notify(sender, data):
                print(f"  ← [{ts()}] POST-AUTH NOTIFY {str(sender).split('-')[0]}: {data.hex()}")

            # Aktiver MiBle CCCD ETTER auth – akkurat som iOS-appen gjør
            for uuid in [CHAR_RSP, CHAR_0017]:
                try:
                    await client.start_notify(uuid, post_notify)
                    print(f"  Post-auth subscribe OK: {uuid.split('-')[0]}")
                except Exception as e:
                    print(f"  Post-auth subscribe FEIL {uuid.split('-')[0]}: {e}")

            # Prøv wake/query-kommandoer til char 0x0010 og MiBle CMD
            cmds = [
                (CHAR_0010, "0x0010 query_01",   bytes([0x01])),
                (CHAR_0010, "0x0010 query_2300",  bytes([0x23, 0x00, 0x00, 0x00])),
                (CHAR_0010, "0x0010 query_2400",  bytes([0x24, 0x00, 0x00, 0x00])),
                (CHAR_CMD,  "0x0101 query_01",    bytes([0x01])),
                (CHAR_CMD,  "0x0101 query_0300",  bytes([0x03, 0x00])),
                (CHAR_CMD,  "0x0101 query_A001",  bytes([0xA0, 0x01, 0x00, 0x00])),
            ]
            for uuid, name, cmd in cmds:
                try:
                    await client.write_gatt_char(uuid, cmd)
                    print(f"  → {name}: {cmd.hex()}")
                except Exception as e:
                    print(f"  → {name}: FEIL {e}")
                await asyncio.sleep(0.3)

            # Vent og lytt
            print(f"\n[{ts()}] Lytter 60 sek – legg og løft ting på vekta!\n")
            for i in range(60):
                await asyncio.sleep(1)
                print(f"  {i+1}s", flush=True)
        else:
            print(f"\n[{ts()}] Auth feilet. Se feilmeldinger over.")


if __name__ == "__main__":
    asyncio.run(main())
