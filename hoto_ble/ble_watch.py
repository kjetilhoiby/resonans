#!/usr/bin/env python3
"""
Overvåker Hoto-vekta: fanger advertisement-data (MiBeacon) og GATT notify.
Kjør: python3 ble_watch.py
Legg noe på vekta mens dette kjører!
"""
import asyncio
from bleak import BleakScanner, BleakClient

TARGET_ADDRESS = "D594DA38-3563-CAA8-B967-9988BEB19F58"

# Xiaomi fe95 service
CHAR_INIT   = "00000017-0000-1000-8000-00805f9b34fb"  # notify + write
CHAR_DATA   = "00000010-0000-1000-8000-00805f9b34fb"  # notify + write-without-response
CHAR_EVT    = "00000018-0000-1000-8000-00805f9b34fb"  # notify + write-without-response
CHAR_AVDTP  = "00000019-0000-1000-8000-00805f9b34fb"  # notify + write-without-response
# Second service
CHAR_CMD    = "00000101-0065-6c62-2e74-6f696d2e696d"  # write-without-response
CHAR_RSP    = "00000102-0065-6c62-2e74-6f696d2e696d"  # notify


def decode_adv(adv):
    lines = []
    if adv.local_name:
        lines.append(f"  Navn: {adv.local_name}")
    if adv.manufacturer_data:
        for company_id, data in adv.manufacturer_data.items():
            lines.append(f"  Manufacturer [{company_id:#06x}]: {data.hex()}  raw={list(data)}")
    if adv.service_data:
        for uuid, data in adv.service_data.items():
            lines.append(f"  ServiceData [{uuid}]: {data.hex()}  raw={list(data)}")
    return "\n".join(lines) if lines else "  (ingen payload)"


async def watch_advertisements(duration=20):
    print(f"Fanger advertisement-pakker fra {TARGET_ADDRESS} i {duration}s...")
    print("Legg noe på vekta nå!\n")

    seen = set()

    def callback(device, adv):
        if device.address.upper() == TARGET_ADDRESS.upper():
            key = adv.service_data.__repr__() + adv.manufacturer_data.__repr__()
            if key not in seen:
                seen.add(key)
                print(f"[ADV] rssi={adv.rssi}")
                print(decode_adv(adv))
                print()

    async with BleakScanner(detection_callback=callback):
        await asyncio.sleep(duration)

    print(f"Ferdig – fanget {len(seen)} unike advertisement-pakker.\n")


async def watch_gatt(duration=30):
    print(f"Kobler til via GATT og lytter i {duration}s...")
    print("Legg noe på vekta mens du venter!\n")

    async with BleakClient(TARGET_ADDRESS) as client:
        print(f"Tilkoblet: {client.is_connected}")

        msgs = []

        def handler(sender, data):
            char_name = str(sender)
            print(f"[NOTIFY] {char_name}: hex={data.hex()}  raw={list(data)}")
            msgs.append((char_name, data))

        # Abonner på alle notify-chars
        for char_uuid in [CHAR_INIT, CHAR_DATA, CHAR_EVT, CHAR_AVDTP, CHAR_RSP]:
            try:
                await client.start_notify(char_uuid, handler)
                print(f"Lytter: {char_uuid}")
            except Exception as e:
                print(f"Feil på {char_uuid}: {e}")

        # Prøv noen init-kommandoer (Xiaomi-stil)
        print("\nSender init-kommandoer...")
        init_cmds = [
            bytes([0xA2, 0x01, 0x00]),          # vanlig Xiaomi init
            bytes([0x01]),                        # enkelt init
            bytes([0xA2, 0x00]),
            bytes([0x55, 0xAA, 0x01, 0x01]),     # alternativ init
        ]
        for cmd in init_cmds:
            for char_uuid in [CHAR_INIT, CHAR_DATA, CHAR_CMD]:
                try:
                    await client.write_gatt_char(char_uuid, cmd)
                    print(f"  Sendt {cmd.hex()} → {char_uuid.split('-')[0]}")
                except Exception:
                    pass
            await asyncio.sleep(0.5)

        print(f"\nVenter {duration}s på data – legg noe på vekta!\n")
        await asyncio.sleep(duration)

        print(f"Fikk {len(msgs)} notify-meldinger totalt.")


async def main():
    print("=== HOTO BLE WATCHER ===\n")

    print("Steg 1: Advertisement-data (MiBeacon)")
    print("-" * 40)
    await watch_advertisements(duration=20)

    print("Steg 2: GATT notify + init-kommandoer")
    print("-" * 40)
    await watch_gatt(duration=30)


if __name__ == "__main__":
    asyncio.run(main())
