#!/usr/bin/env python3
"""
ble_miauth.py — Xiaomi MiBeacon v3 auth med beaconkey hentet fra Mi Cloud.

Auth-flyt på char 0x0017:
  1. Subscribe notify
  2. Skriv auth-start → device sender kryptert challenge
  3. Dekrypter challenge med beaconkey (AES-CBC)
  4. Send svar → device bekrefter
  5. Vektdata flommer på 0x0010 / 0x0017 notify

Nøkler:
  beaconkey = 8094bbd44bf1a5b9d400e147b2c5e221
  token     = e77246463e2eca3d1fdf0a0d
  did       = blt.4.1h37o9hp0gg00
"""
import asyncio, datetime, os, struct
from Crypto.Cipher import AES
from bleak import BleakScanner, BleakClient

XIAOMI_SVC = "0000fe95-0000-1000-8000-00805f9b34fb"
CHAR_0017  = "00000017-0000-1000-8000-00805f9b34fb"  # secure channel
CHAR_0010  = "00000010-0000-1000-8000-00805f9b34fb"  # data
CHAR_0018  = "00000018-0000-1000-8000-00805f9b34fb"
CHAR_0019  = "00000019-0000-1000-8000-00805f9b34fb"
CHAR_CMD   = "00000101-0065-6c62-2e74-6f696d2e696d"  # MiBle cmd
CHAR_RSP   = "00000102-0065-6c62-2e74-6f696d2e696d"  # MiBle notify

BEACONKEY = bytes.fromhex("8094bbd44bf1a5b9d400e147b2c5e221")
TOKEN     = bytes.fromhex("e77246463e2eca3d1fdf0a0d")

ALL_NOTIFY = [CHAR_0010, CHAR_0018, CHAR_0019, CHAR_RSP, CHAR_0017]


def ts():
    return datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]


def aes_decrypt(key, data):
    cipher = AES.new(key, AES.MODE_CBC, iv=bytes(16))
    return cipher.decrypt(data)


def aes_encrypt(key, data):
    if len(data) % 16:
        data = data + bytes(16 - len(data) % 16)
    cipher = AES.new(key, AES.MODE_CBC, iv=bytes(16))
    return cipher.encrypt(data)


def parse_weight(data: bytes):
    """Prøv å tolke notify-data som vekt."""
    results = []
    if len(data) >= 2:
        # Xiaomi-stil: uint16 little-endian / 100 = kg
        w1 = struct.unpack_from('<H', data, 0)[0]
        results.append(f"uint16_LE/100={w1/100:.3f}kg")
    if len(data) >= 2:
        w2 = struct.unpack_from('>H', data, 0)[0]
        results.append(f"uint16_BE/100={w2/100:.3f}kg")
    if len(data) >= 4:
        w3 = struct.unpack_from('<f', data, 0)[0]
        results.append(f"float32={w3:.3f}")
    return " | ".join(results)


async def find_device():
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
    print(f"[{ts()}] Slå på vekta! (prøver kontinuerlig i 3 min)\n")
    async with BleakScanner(cb):
        await asyncio.wait_for(found.wait(), timeout=180)
    return target


async def main():
    device = await find_device()
    responses = []
    auth_challenges = []

    def on_dc(c):
        print(f"\n[{ts()}] KOBLET FRA\n")

    def on_notify(sender, data):
        t = ts()
        label = str(sender).split("-")[0]
        weight_hint = ""
        if len(data) >= 2:
            weight_hint = "  → " + parse_weight(data)
        print(f"  *** [{t}] NOTIFY {label}: {data.hex()}  {list(data)}{weight_hint}")
        responses.append((t, label, data))
        if label == "00000017":
            auth_challenges.append(data)

    async with BleakClient(device, disconnected_callback=on_dc, timeout=30.0) as client:
        print(f"[{ts()}] Tilkoblet!\n")

        # Subscribe ALT
        print("-- Subscribe notify --")
        for uuid in ALL_NOTIFY:
            try:
                await client.start_notify(uuid, on_notify)
                print(f"  OK  {uuid.split('-')[0]}")
            except Exception as e:
                print(f"  FEIL  {uuid.split('-')[0]}: {e}")

        await asyncio.sleep(1)

        # Passiv lytting 5 sek – vekta sender kanskje auth challenge spontant
        print(f"\n[{ts()}] Lytter 5 sek (vekta kan sende challenge spontant)...")
        await asyncio.sleep(5)

        # --- AUTH FORSØK på 0x0017 ---
        print(f"\n[{ts()}] Prøver auth-sekvenser på 0x0017...\n")

        auth_cmds = [
            # Standard Xiaomi auth init (ulike varianter sett i naturen)
            ("auth_init_A0",    bytes([0xA0, 0x01, 0x00, 0x00])),
            ("auth_init_90",    bytes([0x90, 0xCA, 0x85, 0xDE]) + os.urandom(4)),
            ("auth_init_beaconkey", bytes([0x01, 0x10]) + BEACONKEY),
            ("auth_init_token", bytes([0x01, 0x10]) + TOKEN.ljust(16, b'\x00')),
            ("auth_03_00",      bytes([0x03, 0x00])),
            ("auth_A2",        bytes([0xA2, 0x01, 0x00])),
            ("auth_04_01",     bytes([0x04, 0x01])),
            ("auth_00_16",     bytes([0x00, 0x16])),
        ]

        for name, cmd in auth_cmds:
            if not client.is_connected:
                print("Koblet fra!")
                break
            before = len(responses)
            try:
                await client.write_gatt_char(CHAR_0017, cmd)
                await asyncio.sleep(0.8)
                got = len(responses) - before
                ch = len(auth_challenges)
                mark = f"  ← {got} notify(er), {ch} på 0017!" if got else ""
                print(f"  {name:25s} [{cmd.hex()[:20]}]: SENDT OK{mark}")

                # Hvis vi fikk challenge på 0x0017 – prøv AES-svar
                if auth_challenges:
                    challenge = auth_challenges[-1]
                    print(f"\n  Challenge fra device: {challenge.hex()}")

                    # AES-CBC decrypt med beaconkey
                    if len(challenge) >= 16:
                        decrypted = aes_decrypt(BEACONKEY, challenge[:16])
                        print(f"  AES decrypt: {decrypted.hex()}")

                    # Send AES-kryptert svar
                    rnd = os.urandom(16)
                    token_padded = TOKEN.ljust(16, b'\x00')
                    response = aes_encrypt(BEACONKEY, token_padded)
                    print(f"  Sender auth-svar (AES): {response.hex()}")
                    try:
                        await client.write_gatt_char(CHAR_0017, response)
                        await asyncio.sleep(0.8)
                        print(f"  Auth-svar sendt! ({len(responses)-before-got} nye notify)")
                    except Exception as e2:
                        print(f"  Auth-svar feil: {e2}")

            except Exception as e:
                print(f"  {name:25s} [{cmd.hex()[:20]}]: {e}")

        # --- Passiv lytting etter auth ---
        print(f"\n[{ts()}] Lytter 20 sek etter auth – LEGG NOE PÅ VEKTA!\n")
        for i in range(20):
            if not client.is_connected:
                break
            await asyncio.sleep(1)
            print(f"  {i+1}s  notify={len(responses)}  connected={client.is_connected}", flush=True)

        # --- Probe MiBle 0x0101 etter evt auth ---
        print(f"\n[{ts()}] MiBle probe → 0x0101\n")
        for cmd in [bytes([0x01]), bytes([0x02]), bytes([0x03,0x00]), bytes([0xFE,0x01]),
                    bytes([0x10,0x01]), bytes([0x20,0x00]), bytes([0xA2,0x01,0x00])]:
            if not client.is_connected:
                break
            before = len(responses)
            try:
                await client.write_gatt_char(CHAR_CMD, cmd)
                await asyncio.sleep(0.3)
                got = len(responses) - before
                if got:
                    print(f"  {cmd.hex()}: SVAR! ({got})")
                else:
                    print(f"  {cmd.hex()}: (stille)")
            except Exception as e:
                print(f"  {cmd.hex()}: {e}")

        print(f"\n=== {len(responses)} totale notify-meldinger ===")
        for t, label, data in responses:
            print(f"  [{t}] {label}: {data.hex()}  {list(data)}")


if __name__ == "__main__":
    asyncio.run(main())
