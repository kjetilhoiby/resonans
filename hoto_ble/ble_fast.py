#!/usr/bin/env python3
"""
ble_fast.py — Rask tilkobling: stopper scanning øyeblikkelig når vekta
ses, kobler til og prober MiBle-tjenesten før tilkoblingsvinduet lukkes.
"""
import asyncio, datetime
from bleak import BleakScanner, BleakClient

XIAOMI_SVC = "0000fe95-0000-1000-8000-00805f9b34fb"
CHAR_0017  = "00000017-0000-1000-8000-00805f9b34fb"
CHAR_0010  = "00000010-0000-1000-8000-00805f9b34fb"
CHAR_0018  = "00000018-0000-1000-8000-00805f9b34fb"
CHAR_0019  = "00000019-0000-1000-8000-00805f9b34fb"
CHAR_CMD   = "00000101-0065-6c62-2e74-6f696d2e696d"
CHAR_RSP   = "00000102-0065-6c62-2e74-6f696d2e696d"
ALL_NOTIFY = [CHAR_0010, CHAR_0018, CHAR_0019, CHAR_RSP]

CMDS = [
    bytes([0x01]),
    bytes([0x02]),
    bytes([0x00]),
    bytes([0x01, 0x00]),
    bytes([0x03, 0x00]),
    bytes([0xA0, 0x01, 0x00]),
    bytes([0xA2, 0x01, 0x00]),
    bytes([0xFE, 0x01]),
    bytes([0xFE, 0x02]),
    bytes([0xFF, 0x01]),
    bytes([0x10, 0x00]),
    bytes([0x10, 0x01]),
    bytes([0x20, 0x00]),
    bytes([0xAA, 0x55, 0x01]),
    bytes([0x55, 0xAA, 0x01]),
]

def ts():
    return datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]


async def main():
    found = asyncio.Event()
    target_addr = None

    def detection_callback(device, adv):
        nonlocal target_addr
        name = device.name or adv.local_name or ""
        if XIAOMI_SVC in (adv.service_data or {}) or "hoto" in name.lower():
            if not found.is_set():
                print(f"[{ts()}] FANT: {device.address} ({name!r}) rssi={adv.rssi}")
                target_addr = device.address
                found.set()

    print(f"[{ts()}] Venter på vekta – slå den på nå!")
    print("         (scanner kontinuerlig, kobler til øyeblikkelig)\n")

    async with BleakScanner(detection_callback=detection_callback):
        await asyncio.wait_for(found.wait(), timeout=60)

    # Liten pause så macOS rekker å registrere enheten
    await asyncio.sleep(0.3)

    print(f"[{ts()}] Kobler til {target_addr}...")
    responses = []

    def on_disconnect(c):
        print(f"\n[{ts()}] !!! KOBLET FRA !!!\n")

    def on_notify(sender, data):
        t = ts(); label = str(sender).split("-")[0]
        print(f"  *** [{t}] NOTIFY {label}: {data.hex()}  {list(data)}")
        responses.append((t, label, data.hex()))

    try:
        async with BleakClient(target_addr, disconnected_callback=on_disconnect,
                               timeout=20.0) as client:
            print(f"[{ts()}] Tilkoblet! connected={client.is_connected}")

            # Subscribe
            print("\n-- Notify --")
            for uuid in ALL_NOTIFY:
                try:
                    await client.start_notify(uuid, on_notify)
                    print(f"  OK  {uuid.split('-')[0]}")
                except Exception as e:
                    print(f"  FEIL  {uuid.split('-')[0]}: {e}")

            # Forsøk pairing via 0x0017
            print("\n-- Prøver 0x0017 (se etter pairing-dialog!) --")
            for cmd in [bytes([0x01]), bytes([0xA2, 0x01, 0x00])]:
                try:
                    await client.write_gatt_char(CHAR_0017, cmd)
                    print(f"  0017 {cmd.hex()}: SKREV OK!")
                except Exception as e:
                    print(f"  0017 {cmd.hex()}: {e}")
                await asyncio.sleep(0.5)

            # Passiv lytting
            print("\n-- Passiv lytting 10 sek – LEGG NOE PÅ VEKTA! --")
            for i in range(10):
                await asyncio.sleep(1)
                print(f"  {i+1}s  meldinger={len(responses)}")

            # Kommandoprobe → 0x0101
            print("\n-- Kommandoprobe → 0x0101 --")
            for cmd in CMDS:
                if not client.is_connected:
                    print("Koblet fra – avbryter.")
                    break
                before = len(responses)
                try:
                    await client.write_gatt_char(CHAR_CMD, cmd)
                    await asyncio.sleep(0.3)
                    got = len(responses) - before
                    mark = "  <-- SVAR!" if got else ""
                    print(f"  {cmd.hex():20s} → 0101{mark}")
                except Exception as e:
                    print(f"  {cmd.hex():20s} → 0101: {e}")

            print(f"\n=== Ferdig – {len(responses)} notify-meldinger ===")
            for t, label, h in responses:
                print(f"  [{t}] {label}: {h}")

    except Exception as e:
        print(f"[{ts()}] Tilkoblingsfeil: {e}")


if __name__ == "__main__":
    asyncio.run(main())
