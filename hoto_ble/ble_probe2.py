#!/usr/bin/env python3
"""
Hoto vekt-probe: unngår 0017 (krever kryptering), fokuserer på 0010 og 0101.
Lytter passivt først, så sender kommandoer.
"""
import asyncio
from bleak import BleakScanner, BleakClient

XIAOMI_SVC = "0000fe95-0000-1000-8000-00805f9b34fb"

# Kun ikke-krypterte chars:
NOTIFY_CHARS = [
    "00000010-0000-1000-8000-00805f9b34fb",   # fe95: notify + write-without-response
    "00000018-0000-1000-8000-00805f9b34fb",   # fe95: notify + write-without-response
    "00000019-0000-1000-8000-00805f9b34fb",   # fe95: notify + write-without-response
    "00000102-0065-6c62-2e74-6f696d2e696d",   # mible: notify
]
WRITE_CHARS = [
    "00000010-0000-1000-8000-00805f9b34fb",
    "00000101-0065-6c62-2e74-6f696d2e696d",
]

CMDS = [
    bytes([0x01]),
    bytes([0x01, 0x00]),
    bytes([0x00]),
    bytes([0x02]),
    bytes([0x03, 0x00]),
    bytes([0xA0, 0x01, 0x00]),
    bytes([0xAA, 0x01]),
    bytes([0x55, 0xAA, 0x01]),
    bytes([0x00, 0x01, 0x00]),
    bytes([0xFF]),
    bytes([0x05]),
    bytes([0x06]),
    bytes([0x10]),
    bytes([0x20]),
]


async def find_device():
    print("Skanner...")
    results = await BleakScanner.discover(timeout=10, return_adv=True)
    for addr, (d, adv) in results.items():
        name = d.name or adv.local_name or ""
        has_fe95 = XIAOMI_SVC in (adv.service_data or {})
        if has_fe95 or "hoto" in name.lower():
            print(f"Fant: {addr}  ({name or 'ingen navn'})\n")
            return addr
    return None


async def main():
    target = await find_device()
    if not target:
        print("Ikke funnet – slå på vekta og prøv igjen.")
        return

    responses = []

    async with BleakClient(target) as client:
        print("Tilkoblet!\n")

        def handler(sender, data):
            import datetime
            ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
            print(f"  *** NOTIFY [{ts}] [{str(sender).split('-')[0]}]: hex={data.hex()}  raw={list(data)}")
            responses.append((str(sender), data.hex()))

        for uuid in NOTIFY_CHARS:
            try:
                await client.start_notify(uuid, handler)
                print(f"Lytter på {uuid.split('-')[0]}")
            except Exception as e:
                print(f"Feil {uuid.split('-')[0]}: {e}")

        print("\n--- Passiv lytting i 8 sek – legg noe på vekta! ---\n")
        await asyncio.sleep(8)

        print("\n--- Sender kommandoer (kun 0010 og 0101) ---\n")
        for cmd in CMDS:
            for w_uuid in WRITE_CHARS:
                label = w_uuid.split("-")[0]
                before = len(responses)
                try:
                    await client.write_gatt_char(w_uuid, cmd)
                    await asyncio.sleep(0.6)
                    got = len(responses) - before
                    tick = "  <-- SVAR!" if got else ""
                    print(f"  {cmd.hex():20s} → {label}{tick}")
                except Exception as e:
                    print(f"  {cmd.hex():20s} → {label}: FEIL: {e}")

        print("\n--- Venter 5 sek til ---\n")
        await asyncio.sleep(5)

    print(f"\n=== Totalt {len(responses)} notify-meldinger ===")
    for sender, hex_data in responses:
        print(f"  {sender.split('-')[0]}: {hex_data}")


if __name__ == "__main__":
    asyncio.run(main())
