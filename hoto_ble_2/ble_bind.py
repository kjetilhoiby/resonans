#!/usr/bin/env python3
"""
ble_bind.py — Gjennomfører binding-protokollen mot Hoto-vekta.

Binding gjøres én gang og lagrer en persistent X25519-nøkkel til disk.
Etter binding: koble til med denne nøkkelen → scale svarer 21000000 → vektdata strømmer.

Binding-protokoll (char 0x0019, etter a2000000 init på 0x0010):
  Scale sender DID (2 fragmenter)
  Phone svarer med 66 bytes (persistent pubkey + data, 4 fragmenter)
  Scale svarer med 66 bytes (4 fragmenter)
  Phone svarer med 24 bytes (2 fragmenter)
  Phone sender 13000000 til 0x0010
  Scale svarer 11000000 → binding komplett
"""
import asyncio, datetime, hashlib, os, struct, json
from pathlib import Path
from bleak import BleakScanner, BleakClient

try:
    from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
    HAS_X25519 = True
except ImportError:
    HAS_X25519 = False

XIAOMI_SVC   = "0000fe95-0000-1000-8000-00805f9b34fb"
CHAR_0010    = "00000010-0000-1000-8000-00805f9b34fb"
CHAR_0019    = "00000019-0000-1000-8000-00805f9b34fb"
CHAR_0018    = "00000018-0000-1000-8000-00805f9b34fb"
KEY_FILE     = Path(__file__).parent / "persistent_key.json"

def ts():
    return datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]

def load_or_create_key():
    if KEY_FILE.exists():
        data = json.loads(KEY_FILE.read_text())
        priv_bytes = bytes.fromhex(data["private_key"])
        priv = X25519PrivateKey.from_private_bytes(priv_bytes)
        pub  = bytes.fromhex(data["public_key"])
        print(f"  Lastet eksisterende nøkkel: pubkey={pub.hex()[:16]}...")
        return priv, pub
    priv = X25519PrivateKey.generate()
    pub  = priv.public_key().public_bytes_raw()
    priv_bytes = priv.private_bytes_raw()
    KEY_FILE.write_text(json.dumps({
        "private_key": priv_bytes.hex(),
        "public_key":  pub.hex(),
    }, indent=2))
    print(f"  Genererte ny persistent nøkkel: pubkey={pub.hex()[:16]}...")
    return priv, pub

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
    print(f"[{ts()}] Scanner...\n")
    async with BleakScanner(cb):
        await asyncio.wait_for(found.wait(), timeout=180)
    return target

async def binding_session(client, priv_key, pub_key_bytes):
    queue_0019 = asyncio.Queue()
    queue_0010 = asyncio.Queue()

    def on_notify(sender, data):
        uuid = str(sender).lower()
        short = str(sender).split("-")[0]
        print(f"  ← [{ts()}] NOTIFY {short}: {data.hex()}")
        if "00000019" in uuid:
            queue_0019.put_nowait(data)
        elif "00000010" in uuid:
            queue_0010.put_nowait(data)

    print("\n-- Subscribe --")
    for uuid in [CHAR_0010, CHAR_0019, CHAR_0018]:
        try:
            await client.start_notify(uuid, on_notify)
            print(f"  OK {uuid.split('-')[0]}")
        except Exception as e:
            print(f"  FEIL {uuid.split('-')[0]}: {e}")

    await asyncio.sleep(0.3)

    async def send19(data):
        print(f"  → [{ts()}] WRITE19 {data.hex()}")
        await client.write_gatt_char(CHAR_0019, data)

    async def send10(data):
        print(f"  → [{ts()}] WRITE10 {data.hex()}")
        await client.write_gatt_char(CHAR_0010, data)

    async def wait19(prefix=None, timeout=8.0):
        deadline = asyncio.get_event_loop().time() + timeout
        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                print(f"  TIMEOUT på 0x0019")
                return None
            try:
                data = await asyncio.wait_for(queue_0019.get(), timeout=remaining)
                if prefix is None or data[:len(prefix)] == prefix:
                    return data
                print(f"  Uventet 0x0019: {data.hex()}")
            except asyncio.TimeoutError:
                return None

    async def wait10(prefix=None, timeout=8.0):
        deadline = asyncio.get_event_loop().time() + timeout
        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                print(f"  TIMEOUT på 0x0010")
                return None
            try:
                data = await asyncio.wait_for(queue_0010.get(), timeout=remaining)
                if prefix is None or data[:len(prefix)] == prefix:
                    return data
                print(f"  Uventet 0x0010: {data.hex()}")
            except asyncio.TimeoutError:
                return None

    async def recv_fragments(n, timeout=8.0):
        """Mott n fragmenter og sett dem sammen."""
        parts = []
        for i in range(n):
            r = await wait19(timeout=timeout)
            if not r:
                print(f"  Mangler fragment {i+1}/{n}")
                return None
            frag_idx = struct.unpack_from("<H", r, 0)[0]
            payload  = r[2:]
            print(f"  Fragment {frag_idx}: {payload.hex()}")
            parts.append(payload)
        return b"".join(parts)

    async def send_fragments(data, frag_type, chunk=18):
        """Send data i fragmenter à chunk bytes."""
        n_frags = (len(data) + chunk - 1) // chunk
        # Announce
        announcement = bytes([0x00, 0x00, 0x00, frag_type]) + struct.pack("<H", n_frags)
        await send19(announcement)
        r = await wait19(bytes([0x00, 0x00, 0x01, 0x01]))
        if not r:
            print("  Scale ikke klar for fragmenter")
            return False
        # Send fragments
        for i in range(n_frags):
            idx = i + 1
            chunk_data = data[i*chunk:(i+1)*chunk]
            await send19(struct.pack("<H", idx) + chunk_data)
            await asyncio.sleep(0.05)
        # Wait for ack
        r = await wait19(bytes([0x00, 0x00, 0x01, 0x00]))
        return r is not None

    # BINDING START
    print(f"\n[{ts()}] BINDING: sender a2000000...")
    await send10(bytes([0xa2, 0x00, 0x00, 0x00]))

    # Scale sender DID (2 fragmenter)
    print(f"\n[{ts()}] Venter på DID...")
    r = await wait19(bytes([0x00, 0x00, 0x00, 0x00]), timeout=10.0)
    if not r:
        print("Ingen DID-kunngjøring")
        return False
    n_frags = struct.unpack_from("<H", r, 4)[0]
    print(f"  Scale kunngjør {n_frags} DID-fragmenter")

    await send19(bytes([0x00, 0x00, 0x01, 0x01]))
    did_data = await recv_fragments(n_frags, timeout=5.0)
    if not did_data:
        return False

    # DID format: 01 00 00 00 00 00 [did_string]
    did_str = did_data[6:].decode("utf-8", errors="replace").rstrip("\x00")
    print(f"  DID: {did_str!r}")
    await send19(bytes([0x00, 0x00, 0x01, 0x00]))

    # Send 15000000 til 0x0010
    await asyncio.sleep(0.1)
    await send10(bytes([0x15, 0x00, 0x00, 0x00]))

    # Prøv ulike 64-byte payload-varianter til en fungerer
    ephemeral_priv = X25519PrivateKey.generate()
    ephemeral_pub  = ephemeral_priv.public_key().public_bytes_raw()

    payload_variants = [
        ("pubkey + ephemeral_pubkey",   pub_key_bytes + ephemeral_pub),
        ("pubkey + zeros(32)",          pub_key_bytes + bytes(32)),
        ("random 64 bytes",             __import__('os').urandom(64)),
    ]

    r = None
    for (label, binding_payload) in payload_variants:
        assert len(binding_payload) == 64
        print(f"\n[{ts()}] Prøver payload: {label}")
        ok = await send_fragments(binding_payload, frag_type=0x03, chunk=18)
        if not ok:
            print("  Payload ikke bekreftet av scale")
            continue
        r = await wait19(bytes([0x00, 0x00, 0x00]), timeout=5.0)
        if r:
            print(f"  ✓ Scale svarte! Bruker: {label}")
            # Lagre ephemeral for ECDH
            if "ephemeral" in label:
                pass  # ephemeral_priv allerede satt
            break
        print(f"  ✗ Ingen scale-respons på: {label}")
        # Re-connect trengs ikke — samme tilkobling

    if not r:
        print("\nAlle payload-varianter feilet.")
        return False
    n_resp_frags = struct.unpack_from("<H", r, 4)[0]
    print(f"  Scale kunngjør {n_resp_frags} fragmenter i respons")

    await send19(bytes([0x00, 0x00, 0x01, 0x01]))
    scale_resp = await recv_fragments(n_resp_frags, timeout=5.0)
    if not scale_resp:
        return False
    print(f"  Scale respons ({len(scale_resp)} bytes): {scale_resp.hex()}")
    await send19(bytes([0x00, 0x00, 0x01, 0x00]))

    # Re-abonnér på CCCDs — iOS gjør WRITE_REQ til CCCD etter scale-respons
    # Vi er allerede subscribed via start_notify, men sender likevel en liten pause
    await asyncio.sleep(0.05)

    # Beregn ECDH-derivert 24-byte second payload
    # Scale-respons første 32 bytes = scale's X25519 pubkey
    if priv_key is not None and len(scale_resp) >= 32:
        try:
            scale_pubkey = X25519PublicKey.from_public_bytes(scale_resp[:32])
            shared_secret = priv_key.exchange(scale_pubkey)
            second_payload = hashlib.sha256(shared_secret).digest()[:24]
            print(f"  ECDH shared_secret (første 8): {shared_secret[:8].hex()}")
            print(f"  second_payload: {second_payload.hex()}")
        except Exception as e:
            print(f"  ECDH feilet ({e}), bruker nullbytes")
            second_payload = bytes(24)
    else:
        second_payload = bytes(24)

    print(f"\n[{ts()}] Sender 24-byte second exchange...")
    ok = await send_fragments(second_payload, frag_type=0x00, chunk=18)
    if not ok:
        print("Second exchange ble ikke bekreftet")
        return False

    # Finaliser binding
    await asyncio.sleep(0.2)
    print(f"\n[{ts()}] Sender 13000000 (finalize)...")
    await send10(bytes([0x13, 0x00, 0x00, 0x00]))

    r = await wait10(bytes([0x11, 0x00, 0x00, 0x00]), timeout=5.0)
    if r:
        print(f"\n[{ts()}] BINDING SUKSESS! Scale svarte {r.hex()}")
        return True
    else:
        r2 = await wait10(timeout=3.0)
        print(f"\n[{ts()}] Binding uklar. Scale svarte: {r2.hex() if r2 else 'ingenting'}")
        return r2

async def main():
    if not HAS_X25519:
        print("FEIL: pip3 install cryptography")
        return

    print("=== Hoto BLE Binding ===\n")
    priv_key, pub_key = load_or_create_key()

    device = await find_device()

    def on_dc(c):
        print(f"\n[{ts()}] KOBLET FRA\n")

    async with BleakClient(device, disconnected_callback=on_dc, timeout=30.0) as client:
        print(f"[{ts()}] Tilkoblet! ({device.name})\n")
        result = await binding_session(client, priv_key, pub_key)
        if result:
            print(f"\n[{ts()}] Binding lagret til {KEY_FILE}")
            print("Neste steg: kjør ble_auth2_bound.py med denne nøkkelen for å lese vektdata.")
        else:
            print(f"\n[{ts()}] Binding feilet.")

if __name__ == "__main__":
    asyncio.run(main())
