#!/usr/bin/env python3
"""
ble_auth.py — To-delt strategi:
  1. Forsøk å trigge macOS-pairing via 0x0017 (watch for system dialog!)
  2. Systematisk probe av MiBle-tjenesten (0x0101 cmd → 0x0102 notify)

Kjør med: python3 ble_auth.py
"""
import asyncio
import datetime
from bleak import BleakScanner, BleakClient

XIAOMI_SVC  = "0000fe95-0000-1000-8000-00805f9b34fb"

# Xiaomi fe95-chars
CHAR_0017 = "00000017-0000-1000-8000-00805f9b34fb"  # notify+write – kryptert
CHAR_0010 = "00000010-0000-1000-8000-00805f9b34fb"  # notify+write-without-response
CHAR_0018 = "00000018-0000-1000-8000-00805f9b34fb"  # notify+write-without-response
CHAR_0019 = "00000019-0000-1000-8000-00805f9b34fb"  # notify+write-without-response

# MiBle-chars (UTENFOR Xiaomi-kryptering – fokuserer her)
CHAR_CMD  = "00000101-0065-6c62-2e74-6f696d2e696d"  # write-without-response
CHAR_RSP  = "00000102-0065-6c62-2e74-6f696d2e696d"  # notify

ALL_NOTIFY = [CHAR_0010, CHAR_0018, CHAR_0019, CHAR_RSP]

# Kjente Xiaomi-init sekvenser
MIBEACON_INIT = [
    bytes([0xA2, 0x01, 0x00]),
    bytes([0x01]),
    bytes([0xA2, 0x00]),
    bytes([0x55, 0xAA, 0x01, 0x01]),
    bytes([0x00, 0x00, 0x00]),
    bytes([0x01, 0x00]),
    bytes([0x02, 0x00]),
]

# Hoto-spesifikke gjetninger (typisk vektprotokoll)
HOTO_CMDS = [
    bytes([0xFE, 0x01]),          # magic + query
    bytes([0xFE, 0x02]),
    bytes([0xFE, 0x03]),
    bytes([0xFF, 0x01]),
    bytes([0x10, 0x00]),
    bytes([0x10, 0x01]),
    bytes([0x20, 0x00]),
    bytes([0x30, 0x00]),
    bytes([0x40, 0x00]),
    bytes([0x50, 0x00]),
    bytes([0xAA, 0x55, 0x01]),    # alternativ magic
    bytes([0x5A, 0xA5, 0x01]),
]

# Enkeltbyte sweep (0x00–0x20 + utvalgte høyere)
SINGLE_BYTES = [bytes([i]) for i in range(0x21)] + [
    bytes([0x40]), bytes([0x50]), bytes([0x60]), bytes([0x70]),
    bytes([0x80]), bytes([0x90]), bytes([0xA0]), bytes([0xA2]),
    bytes([0xAA]), bytes([0xB0]), bytes([0xC0]), bytes([0xD0]),
    bytes([0xE0]), bytes([0xF0]), bytes([0xFE]), bytes([0xFF]),
]


def ts():
    return datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]


async def find_device():
    print("Skanner etter Hoto-vekta...")
    results = await BleakScanner.discover(timeout=10, return_adv=True)
    for addr, (d, adv) in results.items():
        name = d.name or adv.local_name or ""
        if XIAOMI_SVC in (adv.service_data or {}) or "hoto" in name.lower():
            print(f"Fant: {addr}  ({name!r})  rssi={adv.rssi}")
            return addr
    return None


async def main():
    target = await find_device()
    if not target:
        print("Vekta ikke funnet – slå den på!")
        return

    responses = []

    def on_disconnect(client):
        print(f"\n!!! KOBLET FRA ved {ts()} !!!\n")

    def on_notify(sender, data):
        t = ts()
        label = str(sender).split("-")[0]
        print(f"  *** [{t}] NOTIFY {label}: {data.hex()}  {list(data)}")
        responses.append((t, label, data.hex()))

    print(f"\nKobler til {target}...")
    async with BleakClient(target, disconnected_callback=on_disconnect) as client:
        print(f"Tilkoblet OK. is_connected={client.is_connected}")

        # Subscribe på alle notify-chars
        print("\n-- Abonnerer på notify --")
        for uuid in ALL_NOTIFY:
            try:
                await client.start_notify(uuid, on_notify)
                print(f"  OK  {uuid.split('-')[0]}")
            except Exception as e:
                print(f"  FEIL {uuid.split('-')[0]}: {e}")

        # --- Del 1: Prøv 0x0017 for å trigge macOS-pairing ---
        print("\n-- Del 1: Trigger macOS-pairing via 0x0017 --")
        print("   (se etter pairing-dialog på skjermen!)")
        for cmd in [bytes([0x01]), bytes([0xA2, 0x01, 0x00])]:
            try:
                await client.write_gatt_char(CHAR_0017, cmd)
                print(f"  Sendt til 0017: {cmd.hex()} – OK (uventet!)")
            except Exception as e:
                print(f"  0017 {cmd.hex()}: {e}")
            await asyncio.sleep(1)

        # --- Del 2: Passiv lytting – legg noe på vekta! ---
        print("\n-- Del 2: Passiv lytting 10 sek – LEGG NOE PÅ VEKTA NÅ! --")
        for i in range(10):
            await asyncio.sleep(1)
            print(f"  {i+1}s  {len(responses)} meldinger  connected={client.is_connected}")

        # --- Del 3: MiBle init-kommandoer ---
        print("\n-- Del 3: Xiaomi init-kommandoer → 0x0101 --")
        for cmd in MIBEACON_INIT:
            before = len(responses)
            try:
                await client.write_gatt_char(CHAR_CMD, cmd)
                await asyncio.sleep(0.4)
                got = len(responses) - before
                mark = "  <-- SVAR!" if got else ""
                print(f"  {cmd.hex():20s} → 0101{mark}")
            except Exception as e:
                print(f"  {cmd.hex():20s} → 0101: {e}")

        # --- Del 4: Hoto-spesifikke kommandoer ---
        print("\n-- Del 4: Hoto-spesifikke kommandoer → 0x0101 --")
        for cmd in HOTO_CMDS:
            before = len(responses)
            try:
                await client.write_gatt_char(CHAR_CMD, cmd)
                await asyncio.sleep(0.4)
                got = len(responses) - before
                mark = "  <-- SVAR!" if got else ""
                print(f"  {cmd.hex():20s} → 0101{mark}")
            except Exception as e:
                print(f"  {cmd.hex():20s} → 0101: {e}")

        # --- Del 5: Enkeltbyte sweep ---
        print("\n-- Del 5: Enkeltbyte sweep 0x00–0xFF → 0x0101 --")
        for cmd in SINGLE_BYTES:
            if not client.is_connected:
                print("Koblet fra – avbryter sweep.")
                break
            before = len(responses)
            try:
                await client.write_gatt_char(CHAR_CMD, cmd)
                await asyncio.sleep(0.25)
                got = len(responses) - before
                if got:
                    print(f"  {cmd.hex()}: SVAR! ({got} meldinger)")
            except Exception as e:
                print(f"  {cmd.hex()}: {e}")

        # --- Oppsummering ---
        print(f"\n=== Ferdig – totalt {len(responses)} notify-meldinger ===")
        for t, label, hex_data in responses:
            print(f"  [{t}] {label}: {hex_data}")


if __name__ == "__main__":
    asyncio.run(main())
