#!/usr/bin/env python3
"""
Minimal Hoto-probe: kobler til, sjekker tilkobling aktivt, skriver én kommando om gangen.
"""
import asyncio
from bleak import BleakScanner, BleakClient

XIAOMI_SVC = "0000fe95-0000-1000-8000-00805f9b34fb"

WRITE_CHARS = [
    "00000010-0000-1000-8000-00805f9b34fb",
    "00000101-0065-6c62-2e74-6f696d2e696d",
]
NOTIFY_CHARS = [
    "00000010-0000-1000-8000-00805f9b34fb",
    "00000018-0000-1000-8000-00805f9b34fb",
    "00000019-0000-1000-8000-00805f9b34fb",
    "00000102-0065-6c62-2e74-6f696d2e696d",
]

CMDS = [
    bytes([0x01]),
    bytes([0x02]),
    bytes([0x00]),
    bytes([0x01, 0x00]),
    bytes([0x03, 0x00]),
    bytes([0xA0, 0x01, 0x00]),
    bytes([0xAA, 0x01]),
    bytes([0xFF]),
    bytes([0x05]),
    bytes([0x10]),
    bytes([0x20]),
    bytes([0x55, 0xAA, 0x01]),
    bytes([0x00, 0x01, 0x00]),
]


async def find_device():
    print("Skanner...")
    results = await BleakScanner.discover(timeout=10, return_adv=True)
    for addr, (d, adv) in results.items():
        name = d.name or adv.local_name or ""
        if XIAOMI_SVC in (adv.service_data or {}) or "hoto" in name.lower():
            print(f"Fant: {addr}  ({name or 'ingen navn'})")
            return addr
    return None


async def main():
    target = await find_device()
    if not target:
        print("Ikke funnet.")
        return

    responses = []

    def disconnected(client):
        print("!!! KOBLET FRA !!!")

    print(f"Kobler til {target}...")
    client = BleakClient(target, disconnected_callback=disconnected)
    await client.connect()
    print(f"Tilkoblet: {client.is_connected}")

    # Eksplisitt service discovery
    svcs = await client.get_services()
    print(f"Tjenester funnet: {len(list(svcs))}")

    def handler(sender, data):
        import datetime
        ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
        print(f"  *** NOTIFY [{ts}] [{str(sender).split('-')[0]}]: hex={data.hex()}  raw={list(data)}")
        responses.append((str(sender), data.hex()))

    print("\nAbonnerer på notify-karakteristikker...")
    for uuid in NOTIFY_CHARS:
        try:
            await client.start_notify(uuid, handler)
            print(f"  OK: {uuid.split('-')[0]}")
        except Exception as e:
            print(f"  FEIL {uuid.split('-')[0]}: {e}")

    print("\n--- Passiv lytting 8 sek – legg noe på vekta nå! ---")
    for i in range(8):
        await asyncio.sleep(1)
        print(f"  {i+1}s  tilkoblet={client.is_connected}")

    print("\n--- Sender kommandoer ---")
    for cmd in CMDS:
        if not client.is_connected:
            print("Koblet fra – avbryter.")
            break
        for w_uuid in WRITE_CHARS:
            label = w_uuid.split("-")[0]
            before = len(responses)
            try:
                await client.write_gatt_char(w_uuid, cmd)
                await asyncio.sleep(0.5)
                got = len(responses) - before
                tick = "  <-- SVAR!" if got else ""
                print(f"  {cmd.hex():20s} → {label}{tick}")
            except Exception as e:
                print(f"  {cmd.hex():20s} → {label}: {e}")

    print("\n--- Venter 5 sek til ---")
    await asyncio.sleep(5)
    await client.disconnect()

    print(f"\n=== Totalt {len(responses)} notify-meldinger ===")
    for sender, hex_data in responses:
        print(f"  {sender.split('-')[0]}: {hex_data}")


if __name__ == "__main__":
    asyncio.run(main())
